import assert from "node:assert/strict";
import test from "node:test";

import { createTokenIndexProvider } from "../src/discovery/tokenIndex.mjs";
import { createCreatorReputation } from "../src/discovery/creatorReputation.mjs";

const V3_TOPIC = "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118";
const WDOGE = "0xf6bdb158a5ddf77f1b83bc9074f6a472c58d78ae";
const MUCH = "0x" + "1".repeat(40);
const ABC = "0x" + "2".repeat(40);
const EOA = "0x" + "3".repeat(40); // in a pool but has no contract code -> not displayable
const DUP = "0x" + "4".repeat(40); // distinct contract, same symbol as MUCH (redeploy)
const AUTO = "0x" + "5".repeat(40); // auto-generated faucet symbol -> spam
const POOL_MUCH = "0x" + "a".repeat(40);
const POOL_ABC = "0x" + "b".repeat(40);
const POOL_EOA = "0x" + "c".repeat(40);
const POOL_DUP = "0x" + "d".repeat(40);
const POOL_AUTO = "0x" + "e".repeat(40);

const META = {
  [MUCH]: { symbol: "MUCH", name: "Much Token", decimals: 18 },
  [ABC]: { symbol: "ABC", name: "Alpha", decimals: 6 },
  [DUP]: { symbol: "MUCH", name: "Much Token (redeploy)", decimals: 18 },
  [AUTO]: { symbol: "AGT777", name: "Auto", decimals: 6 },
};

const topic = (addr) => `0x${addr.slice(2).padStart(64, "0")}`;
const word = (addr) => addr.slice(2).padStart(64, "0");
const fee = `0x${(500).toString(16).padStart(64, "0")}`;
const poolData = (pool) => `0x${word("0x" + "0".repeat(40))}${word(pool)}`; // [tickSpacing][pool]
const stringReturn = (str) => {
  const hex = Buffer.from(str, "utf8").toString("hex").padEnd(64, "0");
  return `0x${(32n).toString(16).padStart(64, "0")}${BigInt(str.length).toString(16).padStart(64, "0")}${hex}`;
};

function makeClient() {
  const counts = { getLogs: 0 };
  const client = {
    async getLogs({ topics }) {
      counts.getLogs += 1;
      if (topics[0] !== V3_TOPIC) return [];
      // Three non-official tokens each paired with the WDOGE base.
      return [
        { topics: [V3_TOPIC, topic(MUCH), topic(WDOGE), fee], data: poolData(POOL_MUCH) },
        { topics: [V3_TOPIC, topic(ABC), topic(WDOGE), fee], data: poolData(POOL_ABC) },
        { topics: [V3_TOPIC, topic(EOA), topic(WDOGE), fee], data: poolData(POOL_EOA) },
        { topics: [V3_TOPIC, topic(DUP), topic(WDOGE), fee], data: poolData(POOL_DUP) },
        { topics: [V3_TOPIC, topic(AUTO), topic(WDOGE), fee], data: poolData(POOL_AUTO) },
      ];
    },
    async getCode(addr) {
      return addr.toLowerCase() === EOA ? "0x" : "0x60"; // EOA has no code
    },
    async call({ to, data }) {
      const sel = data.slice(0, 10);
      if (sel === "0x1a686502") return `0x${(1000n).toString(16).padStart(64, "0")}`; // liquidity() -> live
      const m = META[to.toLowerCase()];
      if (!m) return "0x";
      if (sel === "0x313ce567") return `0x${BigInt(m.decimals).toString(16).padStart(64, "0")}`;
      if (sel === "0x95d89b41") return stringReturn(m.symbol);
      if (sel === "0x06fdde03") return stringReturn(m.name);
      return "0x";
    },
  };
  return { client, counts };
}

const SOURCES = [{ sourceId: "muchfi-v3", protocolType: "v3", status: "active", factory: "0x" + "f".repeat(40) }];

test("token index enriches every non-official pool token and marks it verified:false", async () => {
  const { client } = makeClient();
  const provider = createTokenIndexProvider({
    client,
    sources: SOURCES,
    baseTokens: [{ symbol: "WDOGE", address: WDOGE }],
    officialAddresses: [WDOGE],
    nowMs: () => 1000,
  });

  const tokens = await provider();

  // EOA (no code) is dropped; the two real ERC-20s are returned, sorted by symbol.
  assert.deepEqual(tokens.map((t) => t.symbol), ["ABC", "MUCH"]);
  assert.equal(tokens.every((t) => t.verified === false), true);
  // Never carry a provenance string — that would mis-read as "verified" in the UI.
  assert.equal(tokens.every((t) => !("provenance" in t)), true);

  const abc = tokens.find((t) => t.symbol === "ABC");
  assert.equal(abc.address, ABC);
  assert.equal(abc.decimals, 6);
  assert.equal(abc.name, "Alpha");
  assert.deepEqual(abc.venues, ["muchfi-v3"]);
});

test("token index drops auto-generated spam and collapses duplicate symbols by default", async () => {
  const { client } = makeClient();
  const provider = createTokenIndexProvider({
    client,
    sources: SOURCES,
    baseTokens: [{ symbol: "WDOGE", address: WDOGE }],
    officialAddresses: [WDOGE],
    nowMs: () => 1000,
  });

  const tokens = await provider();
  // AGT777 dropped (auto-gen); the two MUCH contracts collapse to one entry.
  assert.deepEqual(tokens.map((t) => t.symbol), ["ABC", "MUCH"]);
  assert.equal(tokens.filter((t) => t.symbol === "MUCH").length, 1);
});

test("token index can expose every raw pool token when filters are disabled", async () => {
  const { client } = makeClient();
  const provider = createTokenIndexProvider({
    client,
    sources: SOURCES,
    baseTokens: [{ symbol: "WDOGE", address: WDOGE }],
    officialAddresses: [WDOGE],
    dropAutoGenerated: false,
    dedupeBySymbol: false,
    nowMs: () => 1000,
  });

  const tokens = await provider();
  // EOA still skipped (no code); everything else survives, incl. AGT777 + both MUCHs.
  assert.equal(tokens.length, 4);
  assert.equal(tokens.some((t) => t.symbol === "AGT777"), true);
  assert.equal(tokens.filter((t) => t.symbol === "MUCH").length, 2);
});

test("token index caches within the TTL (one enumeration per window) and single-flights", async () => {
  const { client, counts } = makeClient();
  const provider = createTokenIndexProvider({
    client,
    sources: SOURCES,
    baseTokens: [{ symbol: "WDOGE", address: WDOGE }],
    officialAddresses: [WDOGE],
    nowMs: () => 1000,
  });

  const [a, b] = await Promise.all([provider(), provider()]); // concurrent -> single-flight
  const c = await provider(); // within TTL -> cache hit
  assert.equal(counts.getLogs, 1, "enumeration ran exactly once");
  assert.deepEqual(a.map((t) => t.symbol), b.map((t) => t.symbol));
  assert.deepEqual(a.map((t) => t.symbol), c.map((t) => t.symbol));
});

test("token index drops tokens that fail the route probe (no-route tokens hidden)", async () => {
  const { client } = makeClient();
  const provider = createTokenIndexProvider({
    client,
    sources: SOURCES,
    baseTokens: [{ symbol: "WDOGE", address: WDOGE }],
    officialAddresses: [WDOGE],
    nowMs: () => 1000,
    // ABC routes; MUCH (and its dup) do not — so only ABC should be indexed.
    routeProbe: async ({ address }) => address.toLowerCase() === ABC.toLowerCase(),
  });

  const tokens = await provider();
  assert.deepEqual(tokens.map((t) => t.symbol), ["ABC"]);
});

test("token index drops tokens whose deployer is flagged (guilt by association)", async () => {
  const { client } = makeClient();
  const rep = createCreatorReputation({ initial: ["0xbad"] });
  const provider = createTokenIndexProvider({
    client,
    sources: SOURCES,
    baseTokens: [{ symbol: "WDOGE", address: WDOGE }],
    officialAddresses: [WDOGE],
    nowMs: () => 1000,
    // MUCH and its redeploy DUP share the flagged deployer; ABC is clean.
    deployerProvider: async (addr) =>
      [MUCH, DUP].some((a) => a.toLowerCase() === addr.toLowerCase()) ? "0xbad" : "0xgood",
    reputation: rep,
  });

  const tokens = await provider();
  assert.deepEqual(tokens.map((t) => t.symbol), ["ABC"]);
});

test("token index returns [] when no venue has a factory", async () => {
  const { client } = makeClient();
  const provider = createTokenIndexProvider({
    client,
    sources: [],
    baseTokens: [{ symbol: "WDOGE", address: WDOGE }],
    officialAddresses: [WDOGE],
    nowMs: () => 1000,
  });
  assert.deepEqual(await provider(), []);
});
