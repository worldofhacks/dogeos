import assert from "node:assert/strict";
import test from "node:test";

import { quoteV2ExactInput, quoteV2ExactOutput } from "../src/quotes/adapters/v2.mjs";

test("quoteV2ExactInput quotes constant-product output with fee", () => {
  const quote = quoteV2ExactInput({
    sourceId: "muchfi-v2",
    poolAddress: "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
    token0: "USDC",
    token1: "WDOGE",
    reserve0: 10_000_000n,
    reserve1: 5_000_000n,
    sellToken: "USDC",
    buyToken: "WDOGE",
    amountIn: 1_000_000n,
    feeBps: 30n,
    gasUnits: 95_000n,
    dataFinalityFeeWei: 1_000n,
    blockNumber: 5_200_000n,
    quoteTimestampMs: 1_000,
    ttlMs: 5_000,
  });

  assert.equal(quote.amountOut, 453_305n);
  assert.equal(quote.priceImpactBps, 933n);
  assert.equal(quote.status, "readOnly");
  assert.equal(quote.routeType, "direct");
});

test("quoteV2ExactInput handles reversed token order", () => {
  const quote = quoteV2ExactInput({
    sourceId: "muchfi-v2",
    poolAddress: "0x1498200A5D49081D8E55250aFeb13aAf3c1d9AE4",
    token0: "USDT",
    token1: "WDOGE",
    reserve0: 20_000_000n,
    reserve1: 10_000_000n,
    sellToken: "WDOGE",
    buyToken: "USDT",
    amountIn: 1_000_000n,
    feeBps: 30n,
    gasUnits: 95_000n,
    dataFinalityFeeWei: 1_000n,
    blockNumber: 5_200_000n,
    quoteTimestampMs: 1_000,
    ttlMs: 5_000,
  });

  assert.equal(quote.amountOut, 1_813_221n);
});

test("quoteV2ExactOutput quotes required input with fee", () => {
  const quote = quoteV2ExactOutput({
    sourceId: "muchfi-v2",
    poolAddress: "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
    token0: "USDC",
    token1: "WDOGE",
    reserve0: 10_000_000n,
    reserve1: 5_000_000n,
    sellToken: "USDC",
    buyToken: "WDOGE",
    amountOut: 453_305n,
    feeBps: 30n,
    gasUnits: 95_000n,
    dataFinalityFeeWei: 1_000n,
    blockNumber: 5_200_000n,
    quoteTimestampMs: 1_000,
    ttlMs: 5_000,
  });

  assert.equal(quote.quoteMode, "exactOutput");
  assert.equal(quote.amountIn, 999_999n);
  assert.equal(quote.amountOut, 453_305n);
  assert.equal(quote.priceImpactBps, 933n);
});

test("quoteV2ExactOutput rejects impossible output", () => {
  assert.throws(
    () =>
      quoteV2ExactOutput({
        sourceId: "muchfi-v2",
        poolAddress: "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
        token0: "USDC",
        token1: "WDOGE",
        reserve0: 10_000_000n,
        reserve1: 5_000_000n,
        sellToken: "USDC",
        buyToken: "WDOGE",
        amountOut: 5_000_000n,
        feeBps: 30n,
        gasUnits: 95_000n,
        dataFinalityFeeWei: 1_000n,
        blockNumber: 5_200_000n,
        quoteTimestampMs: 1_000,
        ttlMs: 5_000,
      }),
    /liquidity/i,
  );
});

test("quoteV2ExactInput rejects missing liquidity and token mismatches", () => {
  assert.throws(
    () =>
      quoteV2ExactInput({
        sourceId: "muchfi-v2",
        poolAddress: "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
        token0: "USDC",
        token1: "WDOGE",
        reserve0: 0n,
        reserve1: 5_000_000n,
        sellToken: "USDC",
        buyToken: "WDOGE",
        amountIn: 1_000_000n,
        feeBps: 30n,
        gasUnits: 95_000n,
        dataFinalityFeeWei: 1_000n,
        blockNumber: 5_200_000n,
        quoteTimestampMs: 1_000,
        ttlMs: 5_000,
      }),
    /liquidity/i,
  );

  assert.throws(
    () =>
      quoteV2ExactInput({
        sourceId: "muchfi-v2",
        poolAddress: "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
        token0: "USDC",
        token1: "WDOGE",
        reserve0: 10_000_000n,
        reserve1: 5_000_000n,
        sellToken: "USDC",
        buyToken: "WETH",
        amountIn: 1_000_000n,
        feeBps: 30n,
        gasUnits: 95_000n,
        dataFinalityFeeWei: 1_000n,
        blockNumber: 5_200_000n,
        quoteTimestampMs: 1_000,
        ttlMs: 5_000,
      }),
    /pool tokens/i,
  );
});
