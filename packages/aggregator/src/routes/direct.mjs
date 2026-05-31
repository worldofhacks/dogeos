import { scoreExactOutputQuote, scoreQuote } from "../fees/dogeosFeeEstimator.mjs";

function rejectionReason(candidate, nowMs) {
  if (candidate.status !== "active") return "not-active";
  if (nowMs - candidate.quoteTimestampMs > candidate.ttlMs) return "stale";
  return null;
}

export function chooseBestDirectRoute({
  candidates,
  nowMs,
  gasPriceWei,
  outputWeiPerFeeWei,
  inputWeiPerFeeWei = outputWeiPerFeeWei,
}) {
  const rejected = [];
  const scored = [];

  for (const candidate of candidates) {
    const reason = rejectionReason(candidate, nowMs);
    if (reason) {
      rejected.push({ ...candidate, reason });
      continue;
    }

    const score = candidate.quoteMode === "exactOutput"
      ? scoreExactOutputQuote({
          amountIn: candidate.amountIn,
          gasUnits: candidate.gasUnits,
          gasPriceWei,
          dataFinalityFeeWei: candidate.dataFinalityFeeWei,
          inputWeiPerFeeWei,
          failurePenalty: candidate.failurePenalty,
        })
      : scoreQuote({
          amountOut: candidate.amountOut,
          gasUnits: candidate.gasUnits,
          gasPriceWei,
          dataFinalityFeeWei: candidate.dataFinalityFeeWei,
          outputWeiPerFeeWei,
          failurePenalty: candidate.failurePenalty,
        });

    scored.push({ ...candidate, score });
  }

  scored.sort((left, right) => {
    if (left.quoteMode === "exactOutput" && right.quoteMode === "exactOutput") {
      if (left.score.totalInput < right.score.totalInput) return -1;
      if (left.score.totalInput > right.score.totalInput) return 1;
    }

    if (left.score.netOutput > right.score.netOutput) return -1;
    if (left.score.netOutput < right.score.netOutput) return 1;
    if (left.gasUnits < right.gasUnits) return -1;
    if (left.gasUnits > right.gasUnits) return 1;
    return left.sourceId.localeCompare(right.sourceId);
  });

  return {
    best: scored[0] ?? null,
    alternatives: scored.slice(1),
    rejected,
  };
}
