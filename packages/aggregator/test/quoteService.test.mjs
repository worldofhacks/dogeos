import assert from "node:assert/strict";
import test from "node:test";

import { buildQuoteResponse } from "../src/quoteService.mjs";

const now = 1_780_000_000_000;

function candidate(overrides = {}) {
  return {
    routeType: "direct",
    sourceId: "muchfi-v2",
    status: "active",
    chainId: 6_281_971,
    sellToken: "USDC",
    buyToken: "WDOGE",
    amountIn: 1_000_000n,
    amountOut: 1_000_000n,
    gasUnits: 100_000n,
    dataFinalityFeeWei: 1_000n,
    failurePenalty: 0n,
    blockNumber: 5_200_000n,
    quoteTimestampMs: now,
    ttlMs: 5_000,
    warnings: [],
    ...overrides,
  };
}

test("buildQuoteResponse returns best direct route, alternatives, and slippage-protected minimum output", () => {
  const response = buildQuoteResponse({
    candidates: [
      candidate({ sourceId: "muchfi-v2", amountOut: 1_000_000n }),
      candidate({
        sourceId: "muchfi-v3",
        amountOut: 1_050_000n,
        gasUnits: 120_000n,
        dataFinalityFeeWei: 5_000n,
      }),
    ],
    nowMs: now,
    expectedChainId: 6_281_971,
    gasPriceWei: 1n,
    outputWeiPerFeeWei: 1n,
    slippageBps: 50n,
  });

  assert.equal(response.status, "ok");
  assert.equal(response.best.sourceId, "muchfi-v3");
  assert.equal(response.best.minimumOutput, 1_044_750n);
  assert.equal(response.best.minAmountOut, 1_044_750n);
  assert.equal(response.best.score.netOutput, 925_000n);
  assert.deepEqual(
    response.alternatives.map((route) => [route.sourceId, route.minAmountOut]),
    [["muchfi-v2", 995_000n]],
  );
  assert.equal(response.expiresAtMs, now + 5_000);
  assert.deepEqual(response.warnings, []);
});

test("buildQuoteResponse applies include and exclude source filters before scoring", () => {
  const response = buildQuoteResponse({
    candidates: [
      candidate({ sourceId: "muchfi-v2", amountOut: 1_000_000n }),
      candidate({ sourceId: "muchfi-v3", amountOut: 1_500_000n }),
      candidate({ sourceId: "barkswap-algebra", amountOut: 1_100_000n }),
    ],
    includeSources: ["muchfi-v2", "barkswap-algebra"],
    excludeSources: ["barkswap-algebra"],
    nowMs: now,
    expectedChainId: 6_281_971,
    gasPriceWei: 1n,
    outputWeiPerFeeWei: 1n,
    slippageBps: 100n,
  });

  assert.equal(response.best.sourceId, "muchfi-v2");
  assert.deepEqual(
    response.rejected.map((route) => [route.sourceId, route.reason]),
    [
      ["muchfi-v3", "source-not-included"],
      ["barkswap-algebra", "source-excluded"],
    ],
  );
});

test("buildQuoteResponse distinguishes inactive quote previews from true no-route responses", () => {
  const response = buildQuoteResponse({
    candidates: [
      candidate({ sourceId: "wrong-chain", chainId: 1 }),
      candidate({ sourceId: "stale", quoteTimestampMs: now - 10_000, ttlMs: 1_000 }),
      candidate({ sourceId: "read-only", status: "readOnly" }),
    ],
    nowMs: now,
    expectedChainId: 6_281_971,
    gasPriceWei: 1n,
    outputWeiPerFeeWei: 1n,
    slippageBps: 50n,
  });

  assert.equal(response.status, "read-only");
  assert.equal(response.best, null);
  assert.deepEqual(response.warnings, ["no-executable-route"]);
  assert.deepEqual(
    response.rejected.map((route) => [route.sourceId, route.reason]),
    [
      ["wrong-chain", "wrong-chain"],
      ["stale", "stale"],
      ["read-only", "not-active"],
    ],
  );
});

test("buildQuoteResponse attaches non-executable fee and min-out previews to inactive routes", () => {
  const response = buildQuoteResponse({
    candidates: [
      candidate({
        sourceId: "muchfi-v2",
        status: "readOnly",
        amountOut: 2_000_000n,
        gasUnits: 135_000n,
        dataFinalityFeeWei: 7_000n,
      }),
    ],
    nowMs: now,
    expectedChainId: 6_281_971,
    gasPriceWei: 2n,
    outputWeiPerFeeWei: 1n,
    slippageBps: 50n,
  });

  assert.equal(response.status, "read-only");
  assert.equal(response.rejected[0].sourceId, "muchfi-v2");
  assert.equal(response.rejected[0].reason, "not-active");
  assert.equal(response.rejected[0].minAmountOut, 1_990_000n);
  assert.equal(response.rejected[0].minimumOutput, 1_990_000n);
  assert.deepEqual(response.rejected[0].feeEstimate, {
    executionFeeWei: 270_000n,
    dataFinalityFeeWei: 7_000n,
    totalFeeWei: 277_000n,
  });
  assert.deepEqual(response.rejected[0].score, {
    executionFeeWei: 270_000n,
    dataFinalityFeeWei: 7_000n,
    totalFeeWei: 277_000n,
    grossOutput: 2_000_000n,
    feeCostInOutputToken: 277_000n,
    failurePenalty: 0n,
    netOutput: 1_723_000n,
  });
});

test("buildQuoteResponse ranks inactive read-only previews by gas-aware net output", () => {
  const response = buildQuoteResponse({
    candidates: [
      candidate({
        sourceId: "larger-output-expensive",
        status: "readOnly",
        amountOut: 2_000_000n,
        gasUnits: 700_000n,
        dataFinalityFeeWei: 100_000n,
      }),
      candidate({
        sourceId: "smaller-output-cheaper",
        status: "readOnly",
        amountOut: 1_800_000n,
        gasUnits: 100_000n,
        dataFinalityFeeWei: 1_000n,
      }),
    ],
    nowMs: now,
    expectedChainId: 6_281_971,
    gasPriceWei: 1n,
    outputWeiPerFeeWei: 1n,
    slippageBps: 50n,
  });

  assert.equal(response.status, "read-only");
  assert.equal(response.best, null);
  assert.deepEqual(
    response.rejected.map((route) => [route.sourceId, route.score.netOutput]),
    [
      ["smaller-output-cheaper", 1_699_000n],
      ["larger-output-expensive", 1_200_000n],
    ],
  );
});

test("buildQuoteResponse ranks exact-output routes by lowest gas-aware required input", () => {
  const response = buildQuoteResponse({
    candidates: [
      candidate({
        sourceId: "lower-raw-input-high-fee",
        quoteMode: "exactOutput",
        status: "active",
        amountIn: 950_000n,
        amountOut: 1_000_000n,
        gasUnits: 300_000n,
        dataFinalityFeeWei: 100_000n,
      }),
      candidate({
        sourceId: "higher-raw-input-low-fee",
        quoteMode: "exactOutput",
        status: "active",
        amountIn: 1_000_000n,
        amountOut: 1_000_000n,
        gasUnits: 100_000n,
        dataFinalityFeeWei: 1_000n,
      }),
    ],
    nowMs: now,
    expectedChainId: 6_281_971,
    gasPriceWei: 1n,
    outputWeiPerFeeWei: 1n,
    slippageBps: 50n,
  });

  assert.equal(response.status, "ok");
  assert.equal(response.best.sourceId, "higher-raw-input-low-fee");
  assert.equal(response.best.maxAmountIn, 1_005_000n);
  assert.equal(response.best.score.totalInput, 1_101_000n);
  assert.equal(response.alternatives[0].sourceId, "lower-raw-input-high-fee");
});
