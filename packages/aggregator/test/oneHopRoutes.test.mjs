import assert from "node:assert/strict";
import test from "node:test";

import {
  composeOneHopCandidates,
  createOneHopQuoteCandidateProvider,
} from "../src/routes/oneHop.mjs";

test("composeOneHopCandidates creates a two-leg WDOGE route without split routing", () => {
  const routes = composeOneHopCandidates({
    viaToken: "WDOGE",
    firstLegQuotes: [
      {
        sourceId: "muchfi-v2",
        status: "active",
        chainId: 6_281_971,
        sellToken: "USDC",
        buyToken: "WDOGE",
        amountIn: 1_000_000n,
        amountOut: 950_000n,
        gasUnits: 80_000n,
        dataFinalityFeeWei: 1_000n,
        quoteTimestampMs: 1_000,
        ttlMs: 5_000,
      },
    ],
    secondLegQuotes: [
      {
        sourceId: "barkswap-algebra",
        status: "active",
        chainId: 6_281_971,
        sellToken: "WDOGE",
        buyToken: "USDT",
        amountIn: 950_000n,
        amountOut: 940_000n,
        gasUnits: 130_000n,
        dataFinalityFeeWei: 2_000n,
        quoteTimestampMs: 1_200,
        ttlMs: 5_000,
      },
    ],
  });

  assert.equal(routes.length, 1);
  assert.deepEqual(routes[0], {
    routeType: "oneHop",
    sourceId: "muchfi-v2+barkswap-algebra",
    status: "active",
    chainId: 6_281_971,
    sellToken: "USDC",
    buyToken: "USDT",
    viaToken: "WDOGE",
    amountIn: 1_000_000n,
    amountOut: 940_000n,
    gasUnits: 210_000n,
    dataFinalityFeeWei: 3_000n,
    quoteTimestampMs: 1_000,
    ttlMs: 5_000,
    warnings: [],
    legs: [
      {
        sourceId: "muchfi-v2",
        protocolType: undefined,
        sellToken: "USDC",
        buyToken: "WDOGE",
        amountIn: 1_000_000n,
        amountOut: 950_000n,
      },
      {
        sourceId: "barkswap-algebra",
        protocolType: undefined,
        sellToken: "WDOGE",
        buyToken: "USDT",
        amountIn: 950_000n,
        amountOut: 940_000n,
      },
    ],
  });
});

test("createOneHopQuoteCandidateProvider stays disabled by default", async () => {
  let directCalls = 0;
  const provider = createOneHopQuoteCandidateProvider({
    viaTokens: ["WDOGE"],
    directQuoteProvider: async () => {
      directCalls += 1;
      return [];
    },
  });

  assert.deepEqual(
    await provider({
      sellToken: "USDC",
      buyToken: "USDT",
      amountIn: 1_000_000n,
    }),
    [],
  );
  assert.equal(directCalls, 0);
});

test("createOneHopQuoteCandidateProvider skips exact-output requests until reverse composition is enabled", async () => {
  let directCalls = 0;
  const provider = createOneHopQuoteCandidateProvider({
    enabled: true,
    viaTokens: ["WDOGE"],
    directQuoteProvider: async () => {
      directCalls += 1;
      return [];
    },
  });

  assert.deepEqual(
    await provider({
      quoteMode: "exactOutput",
      sellToken: "USDC",
      buyToken: "USDT",
      amountOut: 1_000_000n,
    }),
    [],
  );
  assert.equal(directCalls, 0);
});

test("createOneHopQuoteCandidateProvider composes WDOGE routes when enabled", async () => {
  const calls = [];
  const directQuoteProvider = async (input) => {
    calls.push(input);

    if (input.sellToken === "USDC" && input.buyToken === "WDOGE") {
      return [
        {
          routeType: "direct",
          sourceId: "muchfi-v2",
          status: "active",
          chainId: 6_281_971,
          protocolType: "v2",
          sellToken: "USDC",
          buyToken: "WDOGE",
          amountIn: 1_000_000n,
          amountOut: 950_000n,
          gasUnits: 80_000n,
          dataFinalityFeeWei: 1_000n,
          blockNumber: 5_200_000n,
          quoteTimestampMs: 1_000,
          ttlMs: 5_000,
          warnings: ["first-leg-warning"],
        },
      ];
    }

    if (input.sellToken === "WDOGE" && input.buyToken === "USDT") {
      return [
        {
          routeType: "direct",
          sourceId: "barkswap-algebra",
          status: "readOnly",
          chainId: 6_281_971,
          protocolType: "algebra",
          sellToken: "WDOGE",
          buyToken: "USDT",
          amountIn: 950_000n,
          amountOut: 940_000n,
          gasUnits: 130_000n,
          dataFinalityFeeWei: 2_000n,
          blockNumber: 5_200_001n,
          quoteTimestampMs: 1_200,
          ttlMs: 4_000,
          warnings: ["second-leg-warning"],
        },
      ];
    }

    return [];
  };
  const provider = createOneHopQuoteCandidateProvider({
    enabled: true,
    viaTokens: ["WDOGE"],
    directQuoteProvider,
  });

  const routes = await provider({
    chainId: 6_281_971,
    sellToken: "USDC",
    buyToken: "USDT",
    amountIn: 1_000_000n,
  });

  assert.deepEqual(
    calls.map((call) => [call.sellToken, call.buyToken, call.amountIn]),
    [
      ["USDC", "WDOGE", 1_000_000n],
      ["WDOGE", "USDT", 950_000n],
    ],
  );
  assert.equal(routes.length, 1);
  assert.equal(routes[0].routeType, "oneHop");
  assert.equal(routes[0].sourceId, "muchfi-v2+barkswap-algebra");
  assert.equal(routes[0].status, "readOnly");
  assert.equal(routes[0].chainId, 6_281_971);
  assert.equal(routes[0].amountOut, 940_000n);
  assert.equal(routes[0].gasUnits, 210_000n);
  assert.equal(routes[0].dataFinalityFeeWei, 3_000n);
  assert.equal(routes[0].blockNumber, 5_200_000n);
  assert.equal(routes[0].quoteTimestampMs, 1_000);
  assert.equal(routes[0].ttlMs, 4_000);
  assert.deepEqual(routes[0].warnings, ["first-leg-warning", "second-leg-warning"]);
});

test("composeOneHopCandidates rejects incompatible intermediary amounts and tokens", () => {
  const routes = composeOneHopCandidates({
    viaToken: "WDOGE",
    firstLegQuotes: [
      {
        sourceId: "muchfi-v2",
        status: "active",
        sellToken: "USDC",
        buyToken: "WDOGE",
        amountIn: 1_000_000n,
        amountOut: 950_000n,
        gasUnits: 80_000n,
        dataFinalityFeeWei: 1_000n,
        quoteTimestampMs: 1_000,
        ttlMs: 5_000,
      },
    ],
    secondLegQuotes: [
      {
        sourceId: "muchfi-v3",
        status: "active",
        sellToken: "WETH",
        buyToken: "USDT",
        amountIn: 950_000n,
        amountOut: 940_000n,
        gasUnits: 100_000n,
        dataFinalityFeeWei: 1_000n,
        quoteTimestampMs: 1_000,
        ttlMs: 5_000,
      },
      {
        sourceId: "barkswap-algebra",
        status: "active",
        sellToken: "WDOGE",
        buyToken: "USDT",
        amountIn: 960_000n,
        amountOut: 940_000n,
        gasUnits: 100_000n,
        dataFinalityFeeWei: 1_000n,
        quoteTimestampMs: 1_000,
        ttlMs: 5_000,
      },
    ],
  });

  assert.deepEqual(routes, []);
});
