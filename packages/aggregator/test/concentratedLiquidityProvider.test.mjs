import assert from "node:assert/strict";
import test from "node:test";

import { DOGEOS_CHAIN } from "../../config/src/chains.mjs";
import { getSource } from "../src/sources/registry.mjs";
import { createVerifiedConcentratedLiquidityQuoteCandidateProvider } from "../src/quotes/providers/concentratedLiquidity.mjs";

const now = 1_780_000_000_000;
const sqrtPriceOneToOne = 79_228_162_514_264_337_593_543_950_336n;
const usdc = "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925";
const wdoge = "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE";
const lbtc = "0x29789F5A3e4c3113e7165c33A7E3bc592CF6fE0E";
const weth = "0x1a6094Ac3ca3Fc9F1B4777941a5f4AAc16A72000";

test("concentrated-liquidity provider emits no quote without a verified quoter output provider", async () => {
  const provider = createVerifiedConcentratedLiquidityQuoteCandidateProvider({
    chainId: DOGEOS_CHAIN.id,
    sources: [getSource("muchfi-v3"), getSource("barkswap-algebra")],
    nowMs: () => now,
  });

  const candidates = await provider({
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 1_000_000n,
  });

  assert.deepEqual(candidates, []);
});

test("concentrated-liquidity provider normalizes verified V3 quoter output", async () => {
  const provider = createVerifiedConcentratedLiquidityQuoteCandidateProvider({
    chainId: DOGEOS_CHAIN.id,
    sources: [getSource("muchfi-v3")],
    nowMs: () => now,
    blockNumberProvider: async () => 5_200_000n,
    quoterOutputProvider: async ({ source, amountIn, blockNumber }) => {
      assert.equal(source.sourceId, "muchfi-v3");
      assert.equal(amountIn, 1_000_000n);
      assert.equal(blockNumber, 5_200_000n);

      return {
        poolAddress: "0x3333333333333333333333333333333333333333",
        token0: usdc,
        token1: wdoge,
        quotedAmountOut: 990_000n,
        feeBps: 25n,
        sqrtPriceX96: sqrtPriceOneToOne,
        liquidity: 10_000_000n,
        quoterProvenance: "blockscout",
      };
    },
  });

  const [quote] = await provider({
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 1_000_000n,
  });

  assert.equal(quote.sourceId, "muchfi-v3");
  assert.equal(quote.chainId, DOGEOS_CHAIN.id);
  assert.equal(quote.protocolType, "v3");
  assert.equal(quote.status, "active");
  assert.equal(quote.router, getSource("muchfi-v3").router);
  assert.equal(quote.amountOut, 990_000n);
  assert.equal(quote.poolState.sqrtPriceX96, sqrtPriceOneToOne);
  assert.equal(quote.blockNumber, 5_200_000n);
  assert.equal(quote.quoteTimestampMs, now);
});

test("concentrated-liquidity provider normalizes verified Algebra quoter output", async () => {
  const provider = createVerifiedConcentratedLiquidityQuoteCandidateProvider({
    chainId: DOGEOS_CHAIN.id,
    sources: [getSource("barkswap-algebra")],
    nowMs: () => now,
    blockNumberProvider: async () => 5_200_000n,
    quoterOutputProvider: async () => ({
      poolAddress: "0x4444444444444444444444444444444444444444",
      token0: usdc,
      token1: wdoge,
      quotedAmountOut: 985_000n,
      feeBps: 30n,
      sqrtPriceX96: sqrtPriceOneToOne,
      liquidity: 9_000_000n,
      quoterProvenance: "official-docs",
    }),
  });

  const [quote] = await provider({
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 1_000_000n,
  });

  assert.equal(quote.sourceId, "barkswap-algebra");
  assert.equal(quote.chainId, DOGEOS_CHAIN.id);
  assert.equal(quote.protocolType, "algebra");
  assert.equal(quote.status, "active");
  assert.equal(quote.router, getSource("barkswap-algebra").router);
  assert.equal(quote.amountOut, 985_000n);
});

test("concentrated-liquidity provider keeps healthy source quotes when another source fails", async () => {
  const errors = [];
  const provider = createVerifiedConcentratedLiquidityQuoteCandidateProvider({
    chainId: DOGEOS_CHAIN.id,
    sources: [getSource("muchfi-v3"), getSource("barkswap-algebra")],
    nowMs: () => now,
    blockNumberProvider: async () => 5_200_000n,
    onSourceError: (error, context) => {
      errors.push([context.sourceId, error.message, context.input]);
    },
    quoterOutputProvider: async ({ source }) => {
      if (source.sourceId === "muchfi-v3") {
        throw new Error("MuchFi quoter unavailable");
      }

      return {
        poolAddress: "0x4444444444444444444444444444444444444444",
        token0: usdc,
        token1: wdoge,
        quotedAmountOut: 985_000n,
        feeBps: 30n,
        sqrtPriceX96: sqrtPriceOneToOne,
        liquidity: 9_000_000n,
        quoterProvenance: "official-docs",
      };
    },
  });

  const requestInput = {
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 1_000_000n,
  };
  const quotes = await provider(requestInput);

  assert.deepEqual(
    quotes.map((quote) => quote.sourceId),
    ["barkswap-algebra"],
  );
  assert.deepEqual(errors, [["muchfi-v3", "MuchFi quoter unavailable", requestInput]]);
});

test("concentrated-liquidity provider times out one stalled source without losing healthy quotes", async () => {
  const errors = [];
  const provider = createVerifiedConcentratedLiquidityQuoteCandidateProvider({
    chainId: DOGEOS_CHAIN.id,
    sources: [getSource("muchfi-v3"), getSource("barkswap-algebra")],
    nowMs: () => now,
    blockNumberProvider: async () => 5_200_000n,
    sourceTimeoutMs: 5,
    onSourceError: (error, context) => {
      errors.push([context.sourceId, error.message]);
    },
    quoterOutputProvider: async ({ source }) => {
      if (source.sourceId === "muchfi-v3") {
        return new Promise(() => {});
      }

      return {
        poolAddress: "0x4444444444444444444444444444444444444444",
        token0: usdc,
        token1: wdoge,
        quotedAmountOut: 985_000n,
        feeBps: 30n,
        sqrtPriceX96: sqrtPriceOneToOne,
        liquidity: 9_000_000n,
        quoterProvenance: "official-docs",
      };
    },
  });

  const quotes = await Promise.race([
    provider({
      sellToken: usdc,
      buyToken: wdoge,
      amountIn: 1_000_000n,
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("concentrated provider hung")), 100);
    }),
  ]);

  assert.deepEqual(
    quotes.map((quote) => quote.sourceId),
    ["barkswap-algebra"],
  );
  assert.deepEqual(errors, [["muchfi-v3", "Source muchfi-v3 timed out after 5ms."]]);
});

test("concentrated-liquidity provider normalizes exact-output quoter output", async () => {
  const seenFeeInputs = [];
  const provider = createVerifiedConcentratedLiquidityQuoteCandidateProvider({
    chainId: DOGEOS_CHAIN.id,
    sources: [getSource("muchfi-v3")],
    nowMs: () => now,
    blockNumberProvider: async () => 5_200_000n,
    dataFinalityFeeWei: async (input) => {
      seenFeeInputs.push(input);
      return input.amountIn / 100n;
    },
    quoterOutputProvider: async ({ quoteMode, amountOut }) => {
      assert.equal(quoteMode, "exactOutput");
      assert.equal(amountOut, 990_000n);

      return {
        poolAddress: "0x3333333333333333333333333333333333333333",
        token0: usdc,
        token1: wdoge,
        quotedAmountIn: 1_010_000n,
        feeBps: 25n,
        sqrtPriceX96: sqrtPriceOneToOne,
        liquidity: 10_000_000n,
        quoterProvenance: "blockscout",
      };
    },
  });

  const [quote] = await provider({
    quoteMode: "exactOutput",
    sellToken: usdc,
    buyToken: wdoge,
    amountOut: 990_000n,
  });

  assert.equal(quote.quoteMode, "exactOutput");
  assert.equal(quote.router, getSource("muchfi-v3").router);
  assert.equal(quote.amountIn, 1_010_000n);
  assert.equal(quote.amountOut, 990_000n);
  assert.equal(quote.maxAmountIn, undefined);
  assert.equal(quote.dataFinalityFeeWei, 10_100n);
  assert.equal(seenFeeInputs.length, 1);
  assert.equal(seenFeeInputs[0].amountIn, 1_010_000n);
  assert.equal(seenFeeInputs[0].amountOut, 990_000n);
});

test("concentrated-liquidity provider resolves data/finality fee for each quote input", async () => {
  const seenInputs = [];
  const provider = createVerifiedConcentratedLiquidityQuoteCandidateProvider({
    chainId: DOGEOS_CHAIN.id,
    sources: [getSource("muchfi-v3")],
    nowMs: () => now,
    blockNumberProvider: async () => 5_200_000n,
    dataFinalityFeeWei: async (input) => {
      seenInputs.push(input);
      return input.amountIn / 200n;
    },
    quoterOutputProvider: async () => ({
      poolAddress: "0x3333333333333333333333333333333333333333",
      token0: usdc,
      token1: wdoge,
      quotedAmountOut: 990_000n,
      feeBps: 25n,
      sqrtPriceX96: sqrtPriceOneToOne,
      liquidity: 10_000_000n,
      quoterProvenance: "blockscout",
    }),
  });

  const [quote] = await provider({
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 1_000_000n,
  });

  assert.equal(quote.dataFinalityFeeWei, 5_000n);
  assert.equal(seenInputs.length, 1);
  assert.equal(seenInputs[0].sellToken, usdc);
  assert.equal(seenInputs[0].buyToken, wdoge);
  assert.equal(seenInputs[0].amountIn, 1_000_000n);
  assert.equal(seenInputs[0].blockNumber, 5_200_000n);
  assert.equal(seenInputs[0].sourceId, "muchfi-v3");
  assert.equal(seenInputs[0].protocolType, "v3");
  assert.equal(seenInputs[0].poolAddress, "0x3333333333333333333333333333333333333333");
});

test("concentrated-liquidity provider prunes source filters before quoter reads", async () => {
  const seenSources = [];
  let blockNumberReads = 0;
  const provider = createVerifiedConcentratedLiquidityQuoteCandidateProvider({
    chainId: DOGEOS_CHAIN.id,
    sources: [getSource("muchfi-v3"), getSource("barkswap-algebra")],
    nowMs: () => now,
    blockNumberProvider: async () => {
      blockNumberReads += 1;
      return 5_200_000n;
    },
    quoterOutputProvider: async ({ source }) => {
      seenSources.push(source.sourceId);
      return {
        poolAddress: "0x3333333333333333333333333333333333333333",
        token0: usdc,
        token1: wdoge,
        quotedAmountOut: 990_000n,
        feeBps: 25n,
        sqrtPriceX96: sqrtPriceOneToOne,
        liquidity: 10_000_000n,
        quoterProvenance: "blockscout",
      };
    },
  });

  const quotes = await provider({
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 1_000_000n,
    includeSources: ["barkswap-algebra"],
    excludeSources: ["muchfi-v3"],
  });

  assert.deepEqual(
    quotes.map((quote) => quote.sourceId),
    ["barkswap-algebra"],
  );
  assert.deepEqual(seenSources, ["barkswap-algebra"]);
  assert.equal(blockNumberReads, 1);

  seenSources.length = 0;
  const noSourceQuotes = await provider({
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 1_000_000n,
    includeSources: ["muchfi-v2"],
  });

  assert.deepEqual(noSourceQuotes, []);
  assert.deepEqual(seenSources, []);
  assert.equal(blockNumberReads, 1);
});

test("concentrated-liquidity provider attempts discovery for non-pinned pairs and yields nothing when no pool exists", async () => {
  const seenSources = [];
  const provider = createVerifiedConcentratedLiquidityQuoteCandidateProvider({
    chainId: DOGEOS_CHAIN.id,
    sources: [getSource("muchfi-v3"), getSource("barkswap-algebra")],
    nowMs: () => now,
    blockNumberProvider: async () => 5_200_000n,
    // The live quoter output provider performs on-chain factory discovery;
    // here it simulates "no pool discovered" by returning null.
    quoterOutputProvider: async ({ source }) => {
      seenSources.push(source.sourceId);
      return null;
    },
  });

  const quotes = await provider({
    sellToken: lbtc,
    buyToken: weth,
    amountIn: 1_000_000n,
  });

  // No pool -> no quotes, but discovery WAS attempted for the factory venues.
  assert.deepEqual(quotes, []);
  assert.deepEqual(seenSources.sort(), ["barkswap-algebra", "muchfi-v3"]);
});
