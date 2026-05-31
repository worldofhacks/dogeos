import assert from "node:assert/strict";
import test from "node:test";

import {
  quoteAlgebraExactOutputFromQuoter,
  quoteAlgebraExactInputFromQuoter,
  quoteV3ExactOutputFromQuoter,
  quoteV3ExactInputFromQuoter,
} from "../src/quotes/adapters/concentratedLiquidity.mjs";

const oneToOneSqrtPriceX96 = 79_228_162_514_264_337_593_543_950_336n;

test("quoteV3ExactInputFromQuoter normalizes verified V3 quoter output into a direct route quote", () => {
  const quote = quoteV3ExactInputFromQuoter({
    sourceId: "muchfi-v3",
    poolAddress: "0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC",
    token0: "USDC",
    token1: "WDOGE",
    sellToken: "USDC",
    buyToken: "WDOGE",
    amountIn: 1_000_000n,
    quotedAmountOut: 990_000n,
    feeBps: 25n,
    sqrtPriceX96: oneToOneSqrtPriceX96,
    liquidity: 10_000_000n,
    quoterProvenance: "blockscout",
    sourceStatus: "active",
    gasUnits: 160_000n,
    dataFinalityFeeWei: 2_000n,
    blockNumber: 5_200_000n,
    quoteTimestampMs: 1_000,
    ttlMs: 5_000,
  });

  assert.equal(quote.protocolType, "v3");
  assert.equal(quote.routeType, "direct");
  assert.equal(quote.status, "active");
  assert.equal(quote.amountOut, 990_000n);
  assert.equal(quote.priceImpactBps, 100n);
  assert.equal(quote.feeBps, 25n);
  assert.equal(quote.liquidity, 10_000_000n);
});

test("concentrated-liquidity adapters match checksum and lowercase token addresses", () => {
  const quote = quoteV3ExactInputFromQuoter({
    sourceId: "muchfi-v3",
    poolAddress: "0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC",
    token0: "0xd19d2ffb1c284668b7afe72cddae1baf3bc03925",
    token1: "0xf6bdb158a5ddf77f1b83bc9074f6a472c58d78ae",
    sellToken: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
    buyToken: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
    amountIn: 1_000_000n,
    quotedAmountOut: 990_000n,
    feeBps: 25n,
    sqrtPriceX96: oneToOneSqrtPriceX96,
    liquidity: 10_000_000n,
    quoterProvenance: "onchain-bytecode",
    sourceStatus: "readOnly",
    gasUnits: 160_000n,
    dataFinalityFeeWei: 2_000n,
    blockNumber: 5_200_000n,
    quoteTimestampMs: 1_000,
    ttlMs: 5_000,
  });

  assert.equal(quote.amountOut, 990_000n);
  assert.equal(quote.status, "readOnly");
});

test("quoteAlgebraExactInputFromQuoter keeps Algebra dynamic fee and global state metadata", () => {
  const quote = quoteAlgebraExactInputFromQuoter({
    sourceId: "barkswap-algebra",
    poolAddress: "0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1",
    token0: "USDC",
    token1: "WDOGE",
    sellToken: "USDC",
    buyToken: "WDOGE",
    amountIn: 1_000_000n,
    quotedAmountOut: 985_000n,
    feeBps: 30n,
    sqrtPriceX96: oneToOneSqrtPriceX96,
    liquidity: 9_000_000n,
    quoterProvenance: "official-docs",
    sourceStatus: "simulationOnly",
    gasUnits: 175_000n,
    dataFinalityFeeWei: 2_500n,
    blockNumber: 5_200_000n,
    quoteTimestampMs: 1_000,
    ttlMs: 5_000,
  });

  assert.equal(quote.protocolType, "algebra");
  assert.equal(quote.status, "simulationOnly");
  assert.deepEqual(quote.poolState, {
    sqrtPriceX96: oneToOneSqrtPriceX96,
    liquidity: 9_000_000n,
    feeBps: 30n,
  });
});

test("concentrated-liquidity adapters normalize exact-output quoter results", () => {
  const v3Quote = quoteV3ExactOutputFromQuoter({
    sourceId: "muchfi-v3",
    poolAddress: "0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC",
    token0: "USDC",
    token1: "WDOGE",
    sellToken: "USDC",
    buyToken: "WDOGE",
    quotedAmountIn: 1_010_000n,
    amountOut: 990_000n,
    feeBps: 25n,
    sqrtPriceX96: oneToOneSqrtPriceX96,
    liquidity: 10_000_000n,
    quoterProvenance: "blockscout",
    sourceStatus: "readOnly",
    gasUnits: 160_000n,
    dataFinalityFeeWei: 2_000n,
    blockNumber: 5_200_000n,
    quoteTimestampMs: 1_000,
    ttlMs: 5_000,
  });

  const algebraQuote = quoteAlgebraExactOutputFromQuoter({
    sourceId: "barkswap-algebra",
    poolAddress: "0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1",
    token0: "USDC",
    token1: "WDOGE",
    sellToken: "USDC",
    buyToken: "WDOGE",
    quotedAmountIn: 1_020_000n,
    amountOut: 990_000n,
    feeBps: 30n,
    sqrtPriceX96: oneToOneSqrtPriceX96,
    liquidity: 9_000_000n,
    quoterProvenance: "official-docs",
    sourceStatus: "readOnly",
    gasUnits: 175_000n,
    dataFinalityFeeWei: 2_500n,
    blockNumber: 5_200_000n,
    quoteTimestampMs: 1_000,
    ttlMs: 5_000,
  });

  assert.equal(v3Quote.quoteMode, "exactOutput");
  assert.equal(v3Quote.amountIn, 1_010_000n);
  assert.equal(v3Quote.amountOut, 990_000n);
  assert.equal(algebraQuote.quoteMode, "exactOutput");
  assert.equal(algebraQuote.amountIn, 1_020_000n);
  assert.equal(algebraQuote.protocolType, "algebra");
});

test("concentrated-liquidity adapters reject missing quoter provenance", () => {
  assert.throws(
    () =>
      quoteV3ExactInputFromQuoter({
        sourceId: "muchfi-v3",
        poolAddress: "0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC",
        token0: "USDC",
        token1: "WDOGE",
        sellToken: "USDC",
        buyToken: "WDOGE",
        amountIn: 1_000_000n,
        quotedAmountOut: 990_000n,
        feeBps: 25n,
        sqrtPriceX96: oneToOneSqrtPriceX96,
        liquidity: 10_000_000n,
        quoterProvenance: "none",
        sourceStatus: "active",
        gasUnits: 160_000n,
        dataFinalityFeeWei: 2_000n,
        blockNumber: 5_200_000n,
        quoteTimestampMs: 1_000,
        ttlMs: 5_000,
      }),
    /quoter provenance/i,
  );
});

test("concentrated-liquidity adapters reject pool token mismatches and empty liquidity", () => {
  assert.throws(
    () =>
      quoteAlgebraExactInputFromQuoter({
        sourceId: "barkswap-algebra",
        poolAddress: "0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1",
        token0: "USDC",
        token1: "WDOGE",
        sellToken: "USDC",
        buyToken: "USDT",
        amountIn: 1_000_000n,
        quotedAmountOut: 985_000n,
        feeBps: 30n,
        sqrtPriceX96: oneToOneSqrtPriceX96,
        liquidity: 9_000_000n,
        quoterProvenance: "official-docs",
        sourceStatus: "simulationOnly",
        gasUnits: 175_000n,
        dataFinalityFeeWei: 2_500n,
        blockNumber: 5_200_000n,
        quoteTimestampMs: 1_000,
        ttlMs: 5_000,
      }),
    /pool tokens/i,
  );

  assert.throws(
    () =>
      quoteV3ExactInputFromQuoter({
        sourceId: "muchfi-v3",
        poolAddress: "0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC",
        token0: "USDC",
        token1: "WDOGE",
        sellToken: "USDC",
        buyToken: "WDOGE",
        amountIn: 1_000_000n,
        quotedAmountOut: 990_000n,
        feeBps: 25n,
        sqrtPriceX96: oneToOneSqrtPriceX96,
        liquidity: 0n,
        quoterProvenance: "blockscout",
        sourceStatus: "active",
        gasUnits: 160_000n,
        dataFinalityFeeWei: 2_000n,
        blockNumber: 5_200_000n,
        quoteTimestampMs: 1_000,
        ttlMs: 5_000,
      }),
    /liquidity/i,
  );
});
