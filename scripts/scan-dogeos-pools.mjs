// scan-dogeos-pools.mjs — DEEP DogeOS liquidity scanner.
//
// Enumerates EVERY pool each known venue factory has created (via Blockscout
// `getLogs` on the pool-creation event), decodes token0/token1/fee/pool, and
// cross-references against the official token list and the pools we already pin
// in the source registry. Surfaces:
//   • missingOfficialPairPools — both tokens official, live on-chain, but NOT
//     pinned to any registry source (the thing we must add a route for);
//   • officialTokenPools — one official token + one non-official (emerging
//     tokens that could become routable if the token is adopted);
//   • per-factory totals + a baseline diff for the daily routine.
//
// Unlike the probe-based discover-dogeos-liquidity.mjs (which only checks the 15
// official pairs against getPair/getPool/poolByPair), this catches pools for any
// token a factory ever created — so a brand-new official-pair pool, or a new
// token paired with WDOGE, shows up the moment it is created.
//
// Usage:
//   node scripts/scan-dogeos-pools.mjs                       # full JSON report to stdout
//   node scripts/scan-dogeos-pools.mjs --summary             # human summary to stderr too
//   node scripts/scan-dogeos-pools.mjs --baseline <file>     # diff vs a previous report (new pools)
//   node scripts/scan-dogeos-pools.mjs --save <file>         # write the JSON report to a file
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { listSources } from "../packages/aggregator/src/sources/registry.mjs";
import { OFFICIAL_DOGEOS_TOKENS } from "../packages/config/src/tokens.mjs";
import { DOGEOS_CHAIN } from "../packages/config/src/chains.mjs";

const BLOCKSCOUT = (DOGEOS_CHAIN.blockscoutBaseUrl || "https://blockscout.testnet.dogeos.com").replace(/\/+$/, "");

// Pool-creation event signatures + where the pool address lives in `data` (word index).
// v2:      PairCreated(address indexed token0, address indexed token1, address pair, uint)         -> pair = data[0]
// v3:      PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee,
//                      int24 tickSpacing, address pool)                                             -> pool = data[1], fee = topics[3]
// algebra: Pool(address indexed token0, address indexed token1, address pool)                      -> pool = data[0]
const POOL_EVENT = Object.freeze({
  v2: { topic0: "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9", poolWord: 0, hasFee: false },
  v3: { topic0: "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118", poolWord: 1, hasFee: true },
  algebra: { topic0: "0x91ccaa7a278130b65168c3a0c8d3bcae84cf5e43704342bd3ec0b59e59c036db", poolWord: 0, hasFee: false },
});

// Older Barkswap factory still emits live official-pair pools; the registry keeps it as a
// watchlist verification target only, so include it explicitly so the scan can flag its pools.
const EXTRA_FACTORIES = [
  { sourceId: "barkswap-algebra-old", displayName: "Barkswap (old factory)", protocolType: "algebra", factory: "0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263", status: "watchlist" },
];

const lc = (s) => String(s ?? "").toLowerCase();
const addrFromTopic = (t) => "0x" + lc(t).slice(26);
const addrFromWord = (word) => "0x" + lc(word).slice(24);
const dataWord = (data, i) => lc(data).slice(2 + i * 64, 2 + (i + 1) * 64);

const OFFICIAL = new Map(OFFICIAL_DOGEOS_TOKENS.map((t) => [lc(t.address), t.symbol]));
const symOf = (a) => OFFICIAL.get(lc(a)) ?? null;

function factoriesToScan(sources = listSources()) {
  const fromRegistry = sources
    .filter((s) => s.factory && POOL_EVENT[s.protocolType])
    .map((s) => ({ sourceId: s.sourceId, displayName: s.displayName, protocolType: s.protocolType, factory: s.factory, status: s.status }));
  const byFactory = new Map();
  for (const f of [...fromRegistry, ...EXTRA_FACTORIES]) byFactory.set(`${f.sourceId}:${lc(f.factory)}`, f);
  return [...byFactory.values()];
}

// Every pool address already pinned in the registry (so we know what we already route).
function pinnedPoolAddresses(sources = listSources()) {
  const set = new Set();
  for (const s of sources) for (const p of s.pools ?? []) set.add(lc(p.address));
  return set;
}

async function getLogs(factoryAddress, topic0, fetchFn, fromBlock = 0, toBlock = "latest") {
  const url = `${BLOCKSCOUT}/api?module=logs&action=getLogs&fromBlock=${fromBlock}&toBlock=${toBlock}&address=${factoryAddress}&topic0=${topic0}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`getLogs HTTP ${res.status} for ${factoryAddress}`);
  const body = await res.json();
  // Blockscout returns status "0" + "No logs found" for empty result sets.
  if (body.status !== "1") return [];
  return Array.isArray(body.result) ? body.result : [];
}

// Current head block via Blockscout's eth_block_number proxy. Injectable for tests.
export async function fetchHeadBlock(fetchFn = fetch) {
  const url = `${BLOCKSCOUT}/api?module=block&action=eth_block_number`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`eth_block_number HTTP ${res.status}`);
  const body = await res.json();
  const hex = body.result ?? body.jsonrpc?.result ?? null;
  return hex ? parseInt(hex, 16) : null;
}

function decodePool(factory, log) {
  const ev = POOL_EVENT[factory.protocolType];
  if (!log.topics || log.topics.length < 3) return null;
  const token0 = addrFromTopic(log.topics[1]);
  const token1 = addrFromTopic(log.topics[2]);
  const pool = addrFromWord(dataWord(log.data, ev.poolWord));
  const feeTier = ev.hasFee && log.topics[3] ? parseInt(log.topics[3], 16) : null;
  const s0 = symOf(token0);
  const s1 = symOf(token1);
  const officialCount = (s0 ? 1 : 0) + (s1 ? 1 : 0);
  // Canonical pair label uses official symbols where known, else short addresses.
  const label = (a, s) => s ?? `${a.slice(0, 8)}…`;
  return {
    sourceId: factory.sourceId,
    displayName: factory.displayName,
    protocolType: factory.protocolType,
    factory: lc(factory.factory),
    pool: lc(pool),
    token0,
    token1,
    symbol0: s0,
    symbol1: s1,
    pair: `${label(token0, s0)}/${label(token1, s1)}`,
    feeTier,
    officialCount, // 2 = official pair, 1 = official+non-official, 0 = neither
    // Block the pool-creation event landed in (used to dedupe accumulated pools
    // and, later, to compute token "age"). null if the log carried no blockNumber.
    creationBlock: log.blockNumber != null ? parseInt(log.blockNumber, 16) : null,
  };
}

// Scan factory pool-creation logs in [fromBlock..toBlock], MERGE the decoded
// pools with `priorPools` (the accumulated set persisted between runs), and
// classify the merged set. With the defaults (fromBlock=0, toBlock="latest",
// priorPools=[]) this is the original full genesis enumeration; pass a cursor
// range + priorPools to scan only newly-created pools incrementally. Returns the
// usual report PLUS `pools` = the merged accumulated set to persist.
export async function scanDogeosPools({
  fetchFn = fetch,
  sources = listSources(),
  fromBlock = 0,
  toBlock = "latest",
  priorPools = [],
} = {}) {
  const factories = factoriesToScan(sources);
  const pinned = pinnedPoolAddresses(sources);
  const errors = [];

  // Caught up: a numeric range with from > to means there are no new confirmed
  // blocks this cycle — skip the network entirely and just re-classify priorPools.
  const emptyRange = Number.isInteger(fromBlock) && Number.isInteger(toBlock) && fromBlock > toBlock;

  const newPools = [];
  if (!emptyRange) {
    for (const factory of factories) {
      try {
        const logs = await getLogs(factory.factory, POOL_EVENT[factory.protocolType].topic0, fetchFn, fromBlock, toBlock);
        newPools.push(...logs.map((log) => decodePool(factory, log)).filter(Boolean));
      } catch (error) {
        errors.push({ sourceId: factory.sourceId, factory: lc(factory.factory), message: error?.message ?? String(error) });
      }
    }
  }

  // Merge accumulated + newly-seen pools, deduped by pool address (newer wins).
  const byPool = new Map();
  for (const p of priorPools) byPool.set(lc(p.pool), p);
  for (const p of newPools) byPool.set(lc(p.pool), p);
  const allPools = [...byPool.values()];

  // Per-factory stats from the MERGED set; seed every scanned factory at 0 so the
  // report still lists factories that currently have no pools.
  const factoryMeta = new Map(factories.map((f) => [`${f.sourceId}:${lc(f.factory)}`, f]));
  const statsByKey = new Map();
  for (const f of factories) {
    statsByKey.set(`${f.sourceId}:${lc(f.factory)}`, {
      sourceId: f.sourceId, displayName: f.displayName, protocolType: f.protocolType,
      factory: lc(f.factory), status: f.status, poolCount: 0, officialPairCount: 0, officialTokenCount: 0,
    });
  }
  for (const p of allPools) {
    const key = `${p.sourceId}:${lc(p.factory)}`;
    let st = statsByKey.get(key);
    if (!st) {
      const meta = factoryMeta.get(key);
      st = {
        sourceId: p.sourceId, displayName: p.displayName, protocolType: p.protocolType,
        factory: lc(p.factory), status: meta?.status ?? "unknown", poolCount: 0, officialPairCount: 0, officialTokenCount: 0,
      };
      statsByKey.set(key, st);
    }
    st.poolCount += 1;
    if (p.officialCount === 2) st.officialPairCount += 1;
    if (p.officialCount === 1) st.officialTokenCount += 1;
  }
  const factoryStats = [...statsByKey.values()];

  const officialPairPools = allPools
    .filter((p) => p.officialCount === 2)
    .map((p) => ({ ...p, pinned: pinned.has(p.pool) }));

  // The headline: official-pair pools that exist on-chain but we do NOT route yet.
  const missingOfficialPairPools = officialPairPools.filter((p) => !p.pinned);

  // Emerging tokens: a non-official token paired with an official one (potential future routes).
  const officialTokenPools = allPools.filter((p) => p.officialCount === 1);
  const emergingTokens = [...new Set(officialTokenPools.map((p) => (p.symbol0 ? p.token1 : p.token0)))];

  return {
    checkedAt: new Date().toISOString(),
    blockscout: BLOCKSCOUT,
    expectedChainId: DOGEOS_CHAIN.id,
    officialTokenCount: OFFICIAL.size,
    factoriesScanned: factories.length,
    factoryStats,
    totals: {
      poolsSeen: allPools.length,
      officialPairPools: officialPairPools.length,
      missingOfficialPairPools: missingOfficialPairPools.length,
      officialTokenPools: officialTokenPools.length,
      emergingTokenCount: emergingTokens.length,
    },
    officialPairPools,
    missingOfficialPairPools,
    emergingTokens,
    errors,
    // The full accumulated pool set (merged prior + new). Persist this as the
    // next run's priorPools so the scan never re-enumerates from genesis.
    pools: allPools,
  };
}

function summarize(report, baseline) {
  const L = [];
  L.push(`DogeOS pool scan @ ${report.checkedAt}`);
  L.push(`  factories scanned: ${report.factoriesScanned} | pools seen: ${report.totals.poolsSeen}`);
  for (const f of report.factoryStats) {
    L.push(`  - ${f.displayName.padEnd(22)} ${String(f.poolCount).padStart(3)} pools  (official-pair ${f.officialPairCount}, official+token ${f.officialTokenCount})  [${f.status}]`);
  }
  L.push(`  official-pair pools on-chain: ${report.totals.officialPairPools} | NOT yet routed: ${report.totals.missingOfficialPairPools}`);
  for (const p of report.missingOfficialPairPools) {
    L.push(`    ⚠ MISSING  ${p.pair}${p.feeTier ? " fee=" + p.feeTier : ""}  ${p.pool}  (${p.displayName})`);
  }
  L.push(`  emerging tokens (1 official + 1 unknown): ${report.totals.emergingTokenCount}`);
  if (baseline) {
    const prev = new Set((baseline.officialPairPools ?? []).map((p) => p.pool));
    const newOfficial = report.officialPairPools.filter((p) => !prev.has(p.pool));
    const prevEmerging = new Set(baseline.emergingTokens ?? []);
    const newEmerging = report.emergingTokens.filter((t) => !prevEmerging.has(t));
    L.push(`  vs baseline: +${newOfficial.length} new official-pair pool(s), +${newEmerging.length} new emerging token(s)`);
    for (const p of newOfficial) L.push(`    ★ NEW official-pair pool: ${p.pair} ${p.pool} (${p.displayName})`);
  }
  if (report.errors.length) L.push(`  errors: ${report.errors.length}`);
  return L.join("\n");
}

function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };
  return {
    summary: argv.includes("--summary"),
    baseline: get("--baseline"),
    save: get("--save"),
    // --cursor FILE enables incremental scanning: read {lastScanned}, scan only
    // [lastScanned+1 .. head-reorgDepth], reusing the baseline's accumulated
    // `pools` as priorPools. --reorg-depth defaults to the chain's documented max.
    cursor: get("--cursor"),
    reorgDepth: get("--reorg-depth"),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const baseline = opts.baseline && existsSync(opts.baseline) ? JSON.parse(readFileSync(opts.baseline, "utf8")) : null;

  // Incremental mode (--cursor): scan only newly-confirmed blocks and merge with
  // the prior accumulated pool set (carried on baseline.pools). Reorg-safe: we
  // only ever commit pools at blocks <= head - reorgDepth (>= the chain's max
  // reorg depth), so a committed pool can't be reorged out.
  let scanOpts = {};
  let nextCursor = null;
  if (opts.cursor) {
    const cursorState = existsSync(opts.cursor) ? JSON.parse(readFileSync(opts.cursor, "utf8")) : { lastScanned: 0 };
    const priorPools = Array.isArray(baseline?.pools) ? baseline.pools : [];
    const head = await fetchHeadBlock().catch(() => null);
    if (head != null) {
      const reorgDepth = opts.reorgDepth != null ? Number(opts.reorgDepth) : (DOGEOS_CHAIN.documentedMaxReorgDepth ?? 17);
      const safeHead = Math.max(0, head - reorgDepth);
      const lastScanned = Number(cursorState.lastScanned ?? 0);
      const fromBlock = lastScanned > 0 ? lastScanned + 1 : 0;
      scanOpts = { fromBlock, toBlock: safeHead, priorPools };
      nextCursor = { lastScanned: safeHead, head, reorgDepth };
    } else {
      // Head unavailable — fall back to a full re-scan and DON'T advance the cursor.
      scanOpts = { priorPools };
    }
  }

  const report = await scanDogeosPools(scanOpts);

  if (opts.cursor && nextCursor) {
    writeFileSync(opts.cursor, JSON.stringify({ ...nextCursor, updatedAt: report.checkedAt }, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
  if (opts.summary) console.error("\n" + summarize(report, baseline) + "\n");
  if (opts.save) writeFileSync(opts.save, JSON.stringify(report, null, 2));

  // Non-zero exit when something needs attention, so the routine/timer can alert.
  if (report.missingOfficialPairPools.length > 0) process.exitCode = 2;
  if (report.errors.length > 0 && process.exitCode === undefined) process.exitCode = 1;
}

const isEntrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (isEntrypoint) main().catch((error) => { console.error(error); process.exitCode = 1; });
