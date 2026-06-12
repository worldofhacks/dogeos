import assert from "node:assert/strict";
import test from "node:test";

import { createTokenMetadataReader } from "../src/discovery/tokenMetadata.mjs";
import { scanVenuePools, discoverConcentratedPools } from "../src/discovery/poolScan.mjs";

const USDC = "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925";
const WDOGE = "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE";

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}
function addrWord(addr) {
  return addr.toLowerCase().slice(2).padStart(64, "0");
}
// ABI string return: offset(32), length, right-padded data
function stringReturn(str) {
  const hex = Buffer.from(str, "utf8").toString("hex");
  const len = str.length;
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
  return `0x${word(32n)}${word(BigInt(len))}${padded}`;
}
function bytes32Return(str) {
  return `0x${Buffer.from(str, "utf8").toString("hex").padEnd(64, "0")}`;
}

const SYMBOL = "0x95d89b41", NAME = "0x06fdde03", DECIMALS = "0x313ce567";

test("token metadata reader decodes standard string ERC-20 returns", async () => {
  const client = {
    async getCode() {
      return "0x6080";
    },
    async call({ data }) {
      if (data === SYMBOL) return stringReturn("USDC");
      if (data === NAME) return stringReturn("USD Coin");
      if (data === DECIMALS) return `0x${word(18n)}`;
      return "0x";
    },
  };
  const read = createTokenMetadataReader({ client });
  const meta = await read(USDC);
  assert.equal(meta.symbol, "USDC");
  assert.equal(meta.name, "USD Coin");
  assert.equal(meta.decimals, 18);
  assert.equal(meta.address, USDC.toLowerCase());
});

test("token metadata reader decodes legacy bytes32 symbol/name", async () => {
  const client = {
    async getCode() {
      return "0x60";
    },
    async call({ data }) {
      if (data === SYMBOL) return bytes32Return("MKR");
      if (data === NAME) return bytes32Return("Maker");
      if (data === DECIMALS) return `0x${word(18n)}`;
      return "0x";
    },
  };
  const meta = await createTokenMetadataReader({ client })(USDC);
  assert.equal(meta.symbol, "MKR");
  assert.equal(meta.name, "Maker");
});

test("token metadata reader rejects non-contracts and bad decimals", async () => {
  const eoa = { async getCode() { return "0x"; }, async call() { return "0x"; } };
  await assert.rejects(createTokenMetadataReader({ client: eoa })(USDC), /No contract code/);

  const noDecimals = {
    async getCode() { return "0x60"; },
    async call({ data }) {
      if (data === DECIMALS) return "0x"; // missing
      return stringReturn("X");
    },
  };
  await assert.rejects(createTokenMetadataReader({ client: noDecimals })(USDC), /decimals/);
});

test("token metadata reader falls back to a short symbol when symbol() is empty", async () => {
  const client = {
    async getCode() { return "0x60"; },
    async call({ data }) {
      if (data === DECIMALS) return `0x${word(6n)}`;
      return "0x"; // symbol/name empty
    },
  };
  const meta = await createTokenMetadataReader({ client })(USDC);
  assert.equal(meta.decimals, 6);
  assert.ok(meta.symbol.startsWith("0xd19d"));
});

function poolScanClient({ v2Pair, v3Pools = {}, algebraPool, liquidity = 1000n, reserves = [10n, 10n] }) {
  // v3Pools: { "<factory>:<fee>": address }
  return {
    async call({ to, data }) {
      const sel = data.slice(0, 10);
      if (sel === "0xe6a43905") return v2Pair ? `0x${addrWord(v2Pair)}` : `0x${word(0n)}`; // getPair
      if (sel === "0x1698ee82") {
        const fee = Number(BigInt(`0x${data.slice(-64)}`));
        const addr = v3Pools[`${to.toLowerCase()}:${fee}`];
        return addr ? `0x${addrWord(addr)}` : `0x${word(0n)}`; // getPool
      }
      if (sel === "0xd9a641e1") return algebraPool ? `0x${addrWord(algebraPool)}` : `0x${word(0n)}`; // poolByPair
      if (sel === "0x1a686502") return `0x${word(liquidity)}`; // liquidity()
      if (sel === "0x0902f1ac") return `0x${word(reserves[0])}${word(reserves[1])}${word(0n)}`; // getReserves
      return "0x";
    },
  };
}

test("discoverConcentratedPools finds V3 pools across fee tiers (live ones only)", async () => {
  const factory = "0x7d175e06570cafa1cfdf060850b84e0ca23eff0b";
  const client = poolScanClient({
    v3Pools: {
      [`${factory}:500`]: "0x1111111111111111111111111111111111111111",
      [`${factory}:2500`]: "0x2222222222222222222222222222222222222222",
    },
    liquidity: 5000n,
  });
  const pools = await discoverConcentratedPools({
    client,
    source: { protocolType: "v3", factory },
    tokenA: WDOGE,
    tokenB: USDC,
  });
  assert.deepEqual(
    pools.map((p) => `${p.feeTier}:${p.address}`).sort(),
    ["2500:0x2222222222222222222222222222222222222222", "500:0x1111111111111111111111111111111111111111"],
  );
});

test("discoverConcentratedPools skips zero-liquidity Algebra pools", async () => {
  const factory = "0x099f459d81ce99ad3ece1ca2c77d9869883d2457";
  const live = poolScanClient({ algebraPool: "0x3333333333333333333333333333333333333333", liquidity: 1n });
  const dead = poolScanClient({ algebraPool: "0x3333333333333333333333333333333333333333", liquidity: 0n });
  const src = { protocolType: "algebra", factory };
  assert.equal((await discoverConcentratedPools({ client: live, source: src, tokenA: WDOGE, tokenB: USDC })).length, 1);
  assert.equal((await discoverConcentratedPools({ client: dead, source: src, tokenA: WDOGE, tokenB: USDC })).length, 0);
});

test("scanVenuePools aggregates live pools across configured venues", async () => {
  const sources = [
    { sourceId: "v2x", protocolType: "v2", status: "active", factory: "0xaa" + "0".repeat(38) },
    { sourceId: "v3x", protocolType: "v3", status: "active", factory: "0xbb" + "0".repeat(38) },
    { sourceId: "off", protocolType: "v2", status: "disabled", factory: "0xcc" + "0".repeat(38) },
    { sourceId: "nofactory", protocolType: "v2", status: "active", factory: null },
  ];
  const client = poolScanClient({
    v2Pair: "0x1111111111111111111111111111111111111111",
    v3Pools: { [`0xbb${"0".repeat(38)}:500`]: "0x2222222222222222222222222222222222222222" },
  });
  const pools = await scanVenuePools({ client, tokenA: WDOGE, tokenB: USDC, sources });
  // disabled + no-factory venues excluded; v2 + v3 discovered
  assert.deepEqual(pools.map((p) => p.sourceId).sort(), ["v2x", "v3x"]);
  assert.equal(pools.find((p) => p.sourceId === "v3x").feeTier, 500);
});

import { createTrendingTokensProvider } from "../src/discovery/trendingTokens.mjs";

function blockscoutFetch(items) {
  return async () => ({ ok: true, async json() { return { items }; } });
}

test("trending provider drops clone-spam, debt artifacts, and officials; flags tradeable", async () => {
  const items = [
    // ZEX clone spam: 3 distinct contracts, same symbol -> dropped entirely
    { symbol: "ZEX", name: "Zex Coin", address: "0x" + "a".repeat(40), decimals: "5", holders_count: "1886" },
    { symbol: "ZEX", name: "Zex Coin", address: "0x" + "b".repeat(40), decimals: "5", holders_count: "1720" },
    { symbol: "ZEX", name: "Zex Coin", address: "0x" + "c".repeat(40), decimals: "5", holders_count: "972" },
    // lending artifact -> dropped
    { symbol: "variableDebtUSDT", name: "Aave Variable Debt", address: "0x" + "d".repeat(40), decimals: "18", holders_count: "31" },
    // official -> dropped
    { symbol: "USDC", name: "USD Coin", address: USDC, decimals: "18", holders_count: "413" },
    // legit-ish unverified token WITH a pool -> kept, tradeable
    { symbol: "FOO", name: "Foo Token", address: "0x" + "e".repeat(40), decimals: "18", holders_count: "50" },
    // legit-ish unverified token WITHOUT a pool -> kept, not tradeable
    { symbol: "BAR", name: "Bar Token", address: "0x" + "f".repeat(40), decimals: "18", holders_count: "80" },
  ];

  const fooAddress = "0x" + "e".repeat(40);
  const client = {
    async call({ data }) {
      const sel = data.slice(0, 10);
      // FOO has a v2 pair; everyone else returns zero
      if (sel === "0xe6a43905" && data.includes("e".repeat(40))) return `0x${"e".repeat(24)}${"1".repeat(40)}`.slice(0, 66);
      if (sel === "0x0902f1ac") return `0x${"0".repeat(63)}5${"0".repeat(63)}5${"0".repeat(64)}`;
      return `0x${"0".repeat(64)}`;
    },
  };

  const provider = createTrendingTokensProvider({
    client,
    fetchFn: blockscoutFetch(items),
    blockscoutBaseUrl: "https://bs.test",
    baseTokens: [{ symbol: "WDOGE", address: WDOGE }],
    officialAddresses: [USDC, WDOGE],
    nowMs: () => 1000,
  });

  const trending = await provider();
  const symbols = trending.map((t) => t.symbol);
  assert.equal(symbols.includes("ZEX"), false, "clone spam dropped");
  assert.equal(symbols.includes("variableDebtUSDT"), false, "debt artifact dropped");
  assert.equal(symbols.includes("USDC"), false, "official dropped");
  assert.equal(symbols.includes("FOO"), true, "tradeable token kept");
  assert.equal(symbols.includes("BAR"), false, "non-tradeable token excluded");
  assert.equal(trending.every((t) => t.verified === false && t.tradeable === true), true);
  void fooAddress;
});

test("trending provider caches results within the TTL", async () => {
  let fetches = 0;
  const provider = createTrendingTokensProvider({
    client: null,
    fetchFn: async () => {
      fetches += 1;
      return { ok: true, async json() { return { items: [] }; } };
    },
    blockscoutBaseUrl: "https://bs.test",
    baseTokens: [],
    officialAddresses: [],
    cacheTtlMs: 10_000,
    nowMs: () => 5000,
  });
  await provider();
  await provider();
  assert.equal(fetches, 1, "second call served from cache");
});
