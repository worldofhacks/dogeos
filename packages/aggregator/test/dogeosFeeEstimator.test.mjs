import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateDogeosFee,
  scoreExactOutputQuote,
  scoreQuote,
} from "../src/fees/dogeosFeeEstimator.mjs";

test("estimateDogeosFee separates execution and data/finality fees", () => {
  const fee = estimateDogeosFee({
    gasUnits: 150_000n,
    gasPriceWei: 20n,
    dataFinalityFeeWei: 2_000n,
  });

  assert.equal(fee.executionFeeWei, 3_000_000n);
  assert.equal(fee.dataFinalityFeeWei, 2_000n);
  assert.equal(fee.totalFeeWei, 3_002_000n);
});

test("scoreQuote penalizes calldata-heavy routes with higher DogeOS fee", () => {
  const simpleRoute = scoreQuote({
    amountOut: 1_000_000n,
    gasUnits: 100_000n,
    gasPriceWei: 1n,
    dataFinalityFeeWei: 1_000n,
    outputWeiPerFeeWei: 1n,
    failurePenalty: 0n,
  });

  const complexRoute = scoreQuote({
    amountOut: 1_050_000n,
    gasUnits: 100_000n,
    gasPriceWei: 1n,
    dataFinalityFeeWei: 100_000n,
    outputWeiPerFeeWei: 1n,
    failurePenalty: 0n,
  });

  assert.equal(simpleRoute.netOutput, 899_000n);
  assert.equal(complexRoute.netOutput, 850_000n);
  assert.equal(simpleRoute.netOutput > complexRoute.netOutput, true);
});

test("scoreExactOutputQuote prefers lower total input after DogeOS fee", () => {
  const cheaperRoute = scoreExactOutputQuote({
    amountIn: 1_000_000n,
    gasUnits: 100_000n,
    gasPriceWei: 1n,
    dataFinalityFeeWei: 1_000n,
    inputWeiPerFeeWei: 1n,
    failurePenalty: 0n,
  });

  const higherGasRoute = scoreExactOutputQuote({
    amountIn: 950_000n,
    gasUnits: 200_000n,
    gasPriceWei: 1n,
    dataFinalityFeeWei: 100_000n,
    inputWeiPerFeeWei: 1n,
    failurePenalty: 0n,
  });

  assert.equal(cheaperRoute.totalInput, 1_101_000n);
  assert.equal(higherGasRoute.totalInput, 1_250_000n);
  assert.equal(cheaperRoute.totalInput < higherGasRoute.totalInput, true);
});
