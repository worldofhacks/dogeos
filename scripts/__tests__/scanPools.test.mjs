import assert from "node:assert/strict";
import test from "node:test";

import { scanDogeosPools, fetchHeadBlock } from "../scan-dogeos-pools.mjs";

// Official token addresses (lowercase) from packages/config/src/tokens.mjs.
const WDOGE = "0xf6bdb158a5ddf77f1b83bc9074f6a472c58d78ae";
const USDC = "0xd19d2ffb1c284668b7afe72cddae1baf3bc03925";
const USDT = "0xc81800b77d91391ef03d7868cb81204e753093a9";
const FAKE = "0x00000000000000000000000000000000000000aa"; // non-official "emerging" token

const FACTORY = "0x1111111111111111111111111111111111111111";
const PINNED = "0x2222222222222222222222222222222222222222";
const UNPINNED = "0x3333333333333333333333333333333333333333";
const EMERGING_POOL = "0x4444444444444444444444444444444444444444";
const V3_SIG = "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118";

const topic = (a) => "0x" + "0".repeat(24) + a.slice(2);
const feeTopic = (n) => "0x" + n.toString(16).padStart(64, "0");
const word = (a) => "0".repeat(24) + a.slice(2);
const v3Data = (pool) => "0x" + "0".repeat(64) + word(pool); // word0=tickSpacing, word1=pool
const v3Log = (t0, t1, fee, pool) => ({ topics: [V3_SIG, topic(t0), topic(t1), feeTopic(fee)], data: v3Data(pool) });

const LOGS = [
  v3Log(WDOGE, USDC, 500, PINNED), // official pair, already pinned
  v3Log(WDOGE, USDT, 500, UNPINNED), // official pair, NOT pinned -> "missing"
  v3Log(WDOGE, FAKE, 500, EMERGING_POOL), // official + non-official -> "emerging"
];

function mockFetch(url) {
  const address = new URL(url).searchParams.get("address")?.toLowerCase();
  const result = address === FACTORY.toLowerCase() ? LOGS : [];
  return Promise.resolve({ ok: true, json: async () => ({ status: result.length ? "1" : "0", result }) });
}

const sources = [
  {
    sourceId: "test-v3",
    displayName: "Test V3",
    protocolType: "v3",
    factory: FACTORY,
    status: "active",
    pools: [{ address: PINNED }],
  },
];

test("scanner classifies official-pair (pinned vs missing) and emerging tokens", async () => {
  const report = await scanDogeosPools({ fetchFn: mockFetch, sources });

  assert.equal(report.totals.officialPairPools, 2, "two official-pair pools");
  assert.equal(report.totals.missingOfficialPairPools, 1, "one official-pair pool is unpinned");
  assert.equal(report.missingOfficialPairPools[0].pool, UNPINNED);
  assert.equal(report.missingOfficialPairPools[0].pair, "WDOGE/USDT");

  const pinnedPool = report.officialPairPools.find((p) => p.pool === PINNED);
  assert.equal(pinnedPool?.pinned, true, "the registry-pinned pool is marked pinned");

  assert.ok(report.emergingTokens.includes(FAKE), "the non-official token is flagged as emerging");
  assert.equal(report.totals.emergingTokenCount, 1);
});

test("scanner decodes the v3 fee tier from the indexed topic", async () => {
  const report = await scanDogeosPools({ fetchFn: mockFetch, sources });
  assert.ok(report.officialPairPools.every((p) => p.feeTier === 500));
});

// A decoded pool as it would have been persisted from an earlier run.
const priorPool = (pool, t1, sym1, block) => ({
  sourceId: "test-v3", displayName: "Test V3", protocolType: "v3",
  factory: FACTORY.toLowerCase(), pool: pool.toLowerCase(),
  token0: WDOGE, token1: t1, symbol0: "WDOGE", symbol1: sym1,
  pair: `WDOGE/${sym1}`, feeTier: 500, officialCount: 2, creationBlock: block,
});

test("incremental scan threads the cursor block range and merges priorPools", async () => {
  const seenUrls = [];
  const rangeFetch = (url) => {
    seenUrls.push(url);
    const address = new URL(url).searchParams.get("address")?.toLowerCase();
    // Only a NEW emerging pool appears in the incremental window (block 100).
    const result =
      address === FACTORY.toLowerCase()
        ? [{ ...v3Log(WDOGE, FAKE, 500, EMERGING_POOL), blockNumber: "0x64" }]
        : [];
    return Promise.resolve({ ok: true, json: async () => ({ status: result.length ? "1" : "0", result }) });
  };
  const priorPools = [priorPool(PINNED, USDC, "USDC", 10), priorPool(UNPINNED, USDT, "USDT", 20)];

  const report = await scanDogeosPools({ fetchFn: rangeFetch, sources, fromBlock: 50, toBlock: 200, priorPools });

  assert.ok(
    seenUrls.some((u) => u.includes("fromBlock=50") && u.includes("toBlock=200")),
    "cursor range threaded into getLogs",
  );
  assert.equal(report.totals.poolsSeen, 3, "2 prior + 1 new merged");
  assert.equal(report.totals.officialPairPools, 2, "prior official-pair pools retained");
  assert.equal(report.totals.missingOfficialPairPools, 1, "the unpinned prior pool still flagged");
  assert.ok(report.emergingTokens.includes(FAKE), "new emerging token from the window");
  assert.equal(report.pools.find((p) => p.pool === EMERGING_POOL.toLowerCase()).creationBlock, 100);
});

test("incremental scan with no new blocks (from > to) skips the network and re-classifies priorPools", async () => {
  let fetched = false;
  const noFetch = () => {
    fetched = true;
    return Promise.resolve({ ok: true, json: async () => ({ status: "0", result: [] }) });
  };
  const priorPools = [priorPool(UNPINNED, USDT, "USDT", 20)];

  const report = await scanDogeosPools({ fetchFn: noFetch, sources, fromBlock: 300, toBlock: 200, priorPools });

  assert.equal(fetched, false, "no network call when caught up to the safe head");
  assert.equal(report.totals.poolsSeen, 1, "priorPools re-classified");
  assert.equal(report.totals.missingOfficialPairPools, 1);
});

test("fetchHeadBlock parses the eth_block_number hex result", async () => {
  const fh = () => Promise.resolve({ ok: true, json: async () => ({ jsonrpc: "2.0", result: "0x10" }) });
  assert.equal(await fetchHeadBlock(fh), 16);
});
