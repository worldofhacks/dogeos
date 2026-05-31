import assert from "node:assert/strict";
import test from "node:test";

import { chooseBestDirectRoute } from "../src/routes/direct.mjs";

const now = 1_780_000_000_000;

test("chooseBestDirectRoute ignores stale and non-executable candidates", () => {
  const result = chooseBestDirectRoute({
    nowMs: now,
    gasPriceWei: 1n,
    outputWeiPerFeeWei: 1n,
    candidates: [
      {
        sourceId: "muchfi-v2",
        status: "active",
        amountOut: 1_000_000n,
        gasUnits: 100_000n,
        dataFinalityFeeWei: 1_000n,
        failurePenalty: 0n,
        quoteTimestampMs: now - 20_000,
        ttlMs: 5_000,
      },
      {
        sourceId: "muchfi-v3",
        status: "readOnly",
        amountOut: 2_000_000n,
        gasUnits: 100_000n,
        dataFinalityFeeWei: 1_000n,
        failurePenalty: 0n,
        quoteTimestampMs: now,
        ttlMs: 5_000,
      },
      {
        sourceId: "barkswap-algebra",
        status: "active",
        amountOut: 900_000n,
        gasUnits: 90_000n,
        dataFinalityFeeWei: 1_000n,
        failurePenalty: 0n,
        quoteTimestampMs: now,
        ttlMs: 5_000,
      },
    ],
  });

  assert.equal(result.best.sourceId, "barkswap-algebra");
  assert.deepEqual(
    result.rejected.map((candidate) => [candidate.sourceId, candidate.reason]),
    [
      ["muchfi-v2", "stale"],
      ["muchfi-v3", "not-active"],
    ],
  );
});

test("chooseBestDirectRoute selects best net output after gas and data/finality fees", () => {
  const result = chooseBestDirectRoute({
    nowMs: now,
    gasPriceWei: 1n,
    outputWeiPerFeeWei: 1n,
    candidates: [
      {
        sourceId: "muchfi-v2",
        status: "active",
        amountOut: 1_000_000n,
        gasUnits: 100_000n,
        dataFinalityFeeWei: 1_000n,
        failurePenalty: 0n,
        quoteTimestampMs: now,
        ttlMs: 5_000,
      },
      {
        sourceId: "muchfi-v3",
        status: "active",
        amountOut: 1_050_000n,
        gasUnits: 100_000n,
        dataFinalityFeeWei: 100_000n,
        failurePenalty: 0n,
        quoteTimestampMs: now,
        ttlMs: 5_000,
      },
    ],
  });

  assert.equal(result.best.sourceId, "muchfi-v2");
  assert.equal(result.best.score.netOutput, 899_000n);
  assert.equal(result.alternatives[0].sourceId, "muchfi-v3");
});
