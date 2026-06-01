import assert from "node:assert/strict";
import test from "node:test";

import { getSource } from "../src/sources/registry.mjs";
import { createLiveV2QuoteCandidateProvider, discoverV2Pool } from "../src/discovery/v2Pools.mjs";

const now = 1_780_000_000_000;
const wdoge = "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE";
const usdc = "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925";
const lbtc = "0x29789F5A3e4c3113e7165c33A7E3bc592CF6fE0E";
const weth = "0x1a6094Ac3ca3Fc9F1B4777941a5f4AAc16A72000";
const pair = "0x2222222222222222222222222222222222222222";
const muchfiV2UsdcWdogePool = getSource("muchfi-v2").pools
  .find((pool) => pool.token0.toLowerCase() === usdc.toLowerCase())
  .address.toLowerCase();

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressResult(address) {
  return `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
}

function reservesResult(reserve0, reserve1, blockTimestampLast = 10n) {
  return `0x${word(reserve0)}${word(reserve1)}${word(blockTimestampLast)}`;
}

function fakeClient({
  pairAddress = pair,
  reserve0 = 1_000_000_000n,
  reserve1 = 2_000_000_000n,
  failingFactories = new Set(),
} = {}) {
  const calls = [];

  return {
    calls,
    async call({ to, data }, blockTag) {
      calls.push({ to, data, blockTag });
      if (failingFactories.has(to.toLowerCase())) {
        throw new Error(`factory unavailable ${to}`);
      }
      const selector = data.slice(0, 10);

      if (selector === "0xe6a43905") return addressResult(pairAddress);
      if (selector === "0x0dfe1681") return addressResult(usdc);
      if (selector === "0xd21220a7") return addressResult(wdoge);
      if (selector === "0x0902f1ac") return reservesResult(reserve0, reserve1);

      throw new Error(`unexpected selector ${selector}`);
    },
    async getBlockNumber() {
      return 5_200_000n;
    },
  };
}

function sourceWithFactory(sourceId, factory) {
  return {
    ...getSource("muchfi-v2"),
    sourceId,
    factory,
    pools: [],
  };
}

test("discoverV2Pool reads pair address, token order, and reserves at a fixed block", async () => {
  const client = fakeClient();
  const source = getSource("muchfi-v2");

  const pool = await discoverV2Pool({
    client,
    source,
    sellToken: usdc,
    buyToken: wdoge,
    blockNumber: 5_200_000n,
  });

  assert.equal(pool.sourceId, "muchfi-v2");
  assert.equal(pool.status, "active");
  assert.equal(pool.poolAddress, pair);
  assert.equal(pool.token0, usdc.toLowerCase());
  assert.equal(pool.token1, wdoge.toLowerCase());
  assert.equal(pool.reserve0, 1_000_000_000n);
  assert.equal(pool.reserve1, 2_000_000_000n);
  assert.equal(pool.blockNumber, 5_200_000n);
  assert.deepEqual(
    client.calls.map((call) => [call.to, call.data.slice(0, 10), call.blockTag]),
    [
      [source.factory.toLowerCase(), "0xe6a43905", "0x4f5880"],
      [pair, "0x0dfe1681", "0x4f5880"],
      [pair, "0xd21220a7", "0x4f5880"],
      [pair, "0x0902f1ac", "0x4f5880"],
    ],
  );
});

test("discoverV2Pool returns null when the V2 factory has no pair", async () => {
  const client = fakeClient({ pairAddress: "0x0000000000000000000000000000000000000000" });

  const pool = await discoverV2Pool({
    client,
    source: getSource("muchfi-v2"),
    sellToken: usdc,
    buyToken: wdoge,
    blockNumber: 5_200_000n,
  });

  assert.equal(pool, null);
  assert.equal(client.calls.length, 1);
});

test("createLiveV2QuoteCandidateProvider turns readable pools into active quote candidates", async () => {
  const client = fakeClient();
  const quoteProvider = createLiveV2QuoteCandidateProvider({
    client,
    nowMs: () => now,
    sources: [getSource("muchfi-v2")],
    gasUnits: 125_000n,
    dataFinalityFeeWei: 7_500n,
    ttlMs: 4_000,
  });

  const quotes = await quoteProvider({
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 1_000_000n,
  });

  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].sourceId, "muchfi-v2");
  assert.equal(quotes[0].status, "active");
  assert.equal(quotes[0].router, getSource("muchfi-v2").router);
  assert.equal(quotes[0].poolAddress, muchfiV2UsdcWdogePool);
  assert.equal(quotes[0].amountOut, 1_992_013n);
  assert.equal(quotes[0].gasUnits, 125_000n);
  assert.equal(quotes[0].dataFinalityFeeWei, 7_500n);
  assert.equal(quotes[0].blockNumber, 5_200_000n);
  assert.equal(quotes[0].quoteTimestampMs, now);
  assert.equal(quotes[0].ttlMs, 4_000);
});

test("createLiveV2QuoteCandidateProvider uses pinned V2 pools before factory discovery", async () => {
  const client = fakeClient();
  const source = getSource("muchfi-v2");
  const pinnedPool = source.pools.find(
    (pool) =>
      pool.token0.toLowerCase() === usdc.toLowerCase() &&
      pool.token1.toLowerCase() === wdoge.toLowerCase(),
  );
  const quoteProvider = createLiveV2QuoteCandidateProvider({
    client,
    nowMs: () => now,
    sources: [source],
  });

  const [quote] = await quoteProvider({
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 1_000_000n,
  });

  assert.equal(quote.poolAddress, pinnedPool.address.toLowerCase());
  assert.equal(
    client.calls.some((call) => call.data.slice(0, 10) === "0xe6a43905"),
    false,
  );
  assert.deepEqual(
    client.calls.map((call) => [call.to.toLowerCase(), call.data.slice(0, 10)]),
    [
      [pinnedPool.address.toLowerCase(), "0x0dfe1681"],
      [pinnedPool.address.toLowerCase(), "0xd21220a7"],
      [pinnedPool.address.toLowerCase(), "0x0902f1ac"],
    ],
  );
});

test("createLiveV2QuoteCandidateProvider batches pinned V2 pool state reads when RPC batching is available", async () => {
  const source = getSource("muchfi-v2");
  const pinnedPool = source.pools.find(
    (pool) =>
      pool.token0.toLowerCase() === usdc.toLowerCase() &&
      pool.token1.toLowerCase() === wdoge.toLowerCase(),
  );
  const calls = [];
  const batchCalls = [];
  const client = {
    async getBlockNumber() {
      return 5_200_000n;
    },
    async batchCall(transactions, blockTag) {
      batchCalls.push({ transactions, blockTag });
      return transactions.map(({ data }) => {
        const selector = data.slice(0, 10);
        if (selector === "0x0dfe1681") return addressResult(usdc);
        if (selector === "0xd21220a7") return addressResult(wdoge);
        if (selector === "0x0902f1ac") return reservesResult(1_000_000_000n, 2_000_000_000n);
        throw new Error(`unexpected batched selector ${selector}`);
      });
    },
    async call({ to, data }, blockTag) {
      calls.push({ to, data, blockTag });
      throw new Error("individual eth_call should not be used for pinned pool state");
    },
  };
  const quoteProvider = createLiveV2QuoteCandidateProvider({
    client,
    nowMs: () => now,
    sources: [source],
  });

  const [quote] = await quoteProvider({
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 1_000_000n,
  });

  assert.equal(quote.poolAddress, pinnedPool.address.toLowerCase());
  assert.equal(calls.length, 0);
  assert.equal(batchCalls.length, 1);
  assert.equal(batchCalls[0].blockTag, "0x4f5880");
  assert.deepEqual(
    batchCalls[0].transactions.map((transaction) => [
      transaction.to.toLowerCase(),
      transaction.data.slice(0, 10),
    ]),
    [
      [pinnedPool.address.toLowerCase(), "0x0dfe1681"],
      [pinnedPool.address.toLowerCase(), "0xd21220a7"],
      [pinnedPool.address.toLowerCase(), "0x0902f1ac"],
    ],
  );
});

test("createLiveV2QuoteCandidateProvider quotes exact-output pools", async () => {
  const client = fakeClient();
  const seenInputs = [];
  const quoteProvider = createLiveV2QuoteCandidateProvider({
    client,
    nowMs: () => now,
    sources: [getSource("muchfi-v2")],
    gasUnits: 125_000n,
    dataFinalityFeeWei: async (input) => {
      seenInputs.push(input);
      return input.amountIn / 100n;
    },
    ttlMs: 4_000,
  });

  const quotes = await quoteProvider({
    quoteMode: "exactOutput",
    sellToken: usdc,
    buyToken: wdoge,
    amountOut: 1_992_013n,
  });

  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].quoteMode, "exactOutput");
  assert.equal(quotes[0].sourceId, "muchfi-v2");
  assert.equal(quotes[0].router, getSource("muchfi-v2").router);
  assert.equal(quotes[0].amountIn, 1_000_000n);
  assert.equal(quotes[0].amountOut, 1_992_013n);
  assert.equal(quotes[0].dataFinalityFeeWei, 10_000n);
  assert.equal(seenInputs.length, 1);
  assert.equal(seenInputs[0].amountIn, 1_000_000n);
  assert.equal(seenInputs[0].amountOut, 1_992_013n);
});

test("createLiveV2QuoteCandidateProvider resolves data/finality fee for each quote input", async () => {
  const client = fakeClient();
  const seenInputs = [];
  const quoteProvider = createLiveV2QuoteCandidateProvider({
    client,
    nowMs: () => now,
    sources: [getSource("muchfi-v2")],
    dataFinalityFeeWei: async (input) => {
      seenInputs.push(input);
      return input.amountIn / 100n;
    },
  });

  const quotes = await quoteProvider({
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 1_000_000n,
  });

  assert.equal(quotes[0].dataFinalityFeeWei, 10_000n);
  assert.equal(seenInputs.length, 1);
  assert.equal(seenInputs[0].sellToken, usdc);
  assert.equal(seenInputs[0].buyToken, wdoge);
  assert.equal(seenInputs[0].amountIn, 1_000_000n);
  assert.equal(seenInputs[0].blockNumber, 5_200_000n);
  assert.equal(seenInputs[0].sourceId, "muchfi-v2");
  assert.equal(seenInputs[0].protocolType, "v2");
  assert.equal(seenInputs[0].poolAddress, muchfiV2UsdcWdogePool);
});

test("createLiveV2QuoteCandidateProvider prunes source filters before discovery reads", async () => {
  const badFactory = "0x1111111111111111111111111111111111111111";
  const client = fakeClient({
    failingFactories: new Set([badFactory]),
  });
  const quoteProvider = createLiveV2QuoteCandidateProvider({
    client,
    nowMs: () => now,
    sources: [
      sourceWithFactory("excluded-v2", badFactory),
      sourceWithFactory("muchfi-v2", getSource("muchfi-v2").factory.toLowerCase()),
    ],
  });

  const quotes = await quoteProvider({
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 1_000_000n,
    includeSources: ["muchfi-v2"],
    excludeSources: ["excluded-v2"],
  });

  assert.deepEqual(
    quotes.map((quote) => quote.sourceId),
    ["muchfi-v2"],
  );
  assert.equal(
    client.calls.some((call) => call.to.toLowerCase() === badFactory),
    false,
  );

  client.calls.length = 0;
  const noSourceQuotes = await quoteProvider({
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 1_000_000n,
    includeSources: ["muchfi-v3"],
  });

  assert.deepEqual(noSourceQuotes, []);
  assert.equal(client.calls.length, 0);
});

test("createLiveV2QuoteCandidateProvider prunes unsupported pinned pairs before block and factory reads", async () => {
  let blockNumberReads = 0;
  const client = {
    calls: [],
    async getBlockNumber() {
      blockNumberReads += 1;
      return 5_200_000n;
    },
    async call({ to, data }, blockTag) {
      this.calls.push({ to, data, blockTag });
      throw new Error("unsupported pair should not read the V2 factory");
    },
  };
  const quoteProvider = createLiveV2QuoteCandidateProvider({
    client,
    nowMs: () => now,
    sources: [getSource("muchfi-v2")],
  });

  const quotes = await quoteProvider({
    sellToken: lbtc,
    buyToken: weth,
    amountIn: 1_000_000n,
  });

  assert.deepEqual(quotes, []);
  assert.equal(blockNumberReads, 0);
  assert.deepEqual(client.calls, []);
});

test("createLiveV2QuoteCandidateProvider keeps healthy source quotes when another source fails", async () => {
  const badFactory = "0x1111111111111111111111111111111111111111";
  const goodFactory = getSource("muchfi-v2").factory.toLowerCase();
  const errors = [];
  const client = fakeClient({
    failingFactories: new Set([badFactory]),
  });
  const quoteProvider = createLiveV2QuoteCandidateProvider({
    client,
    nowMs: () => now,
    sources: [
      sourceWithFactory("broken-v2", badFactory),
      sourceWithFactory("healthy-v2", goodFactory),
    ],
    onSourceError: (error, context) => {
      errors.push([context.sourceId, error.message, context.input]);
    },
  });

  const requestInput = {
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 1_000_000n,
  };
  const quotes = await quoteProvider(requestInput);

  assert.deepEqual(
    quotes.map((quote) => quote.sourceId),
    ["healthy-v2"],
  );
  assert.deepEqual(errors, [["broken-v2", `factory unavailable ${badFactory}`, requestInput]]);
});

test("createLiveV2QuoteCandidateProvider times out one stalled source without losing healthy quotes", async () => {
  const slowFactory = "0x1111111111111111111111111111111111111111";
  const goodFactory = getSource("muchfi-v2").factory.toLowerCase();
  const errors = [];
  const client = {
    calls: [],
    async getBlockNumber() {
      return 5_200_000n;
    },
    async call({ to, data }, blockTag) {
      this.calls.push({ to, data, blockTag });
      if (to.toLowerCase() === slowFactory) {
        return new Promise(() => {});
      }
      const selector = data.slice(0, 10);
      if (selector === "0xe6a43905") return addressResult(pair);
      if (selector === "0x0dfe1681") return addressResult(usdc);
      if (selector === "0xd21220a7") return addressResult(wdoge);
      if (selector === "0x0902f1ac") return reservesResult(1_000_000_000n, 2_000_000_000n);
      throw new Error(`unexpected selector ${selector}`);
    },
  };
  const quoteProvider = createLiveV2QuoteCandidateProvider({
    client,
    nowMs: () => now,
    sourceTimeoutMs: 5,
    sources: [
      sourceWithFactory("slow-v2", slowFactory),
      sourceWithFactory("healthy-v2", goodFactory),
    ],
    onSourceError: (error, context) => {
      errors.push([context.sourceId, error.message]);
    },
  });

  const quotes = await Promise.race([
    quoteProvider({
      sellToken: usdc,
      buyToken: wdoge,
      amountIn: 1_000_000n,
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("v2 provider hung")), 100);
    }),
  ]);

  assert.deepEqual(
    quotes.map((quote) => quote.sourceId),
    ["healthy-v2"],
  );
  assert.deepEqual(errors, [["slow-v2", "Source slow-v2 timed out after 5ms."]]);
});
