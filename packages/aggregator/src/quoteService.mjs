import { chooseBestDirectRoute } from "./routes/direct.mjs";
import { estimateDogeosFee, scoreExactOutputQuote, scoreQuote } from "./fees/dogeosFeeEstimator.mjs";

const BASIS_POINTS = 10_000n;
// Absolute server-side slippage ceiling (5% = 500 bps). The UI presets and the
// typed custom input both cap at 5%; this is the hard backstop that keeps a
// buggy/hostile client from requesting the sandwich-grade tolerances that are a
// guaranteed loss on DogeOS's public, tip-ordered mempool. Exported so the API
// handler enforces the same bound up front. Kept in sync with
// useSettings.MAX_SLIPPAGE_PERCENT.
export const MAX_SLIPPAGE_BPS = 500n;

function normalizeSourceSet(sourceIds = []) {
  return new Set(sourceIds);
}

function rejectBeforeScoring(candidate, { expectedChainId, includeSources, excludeSources }) {
  if (candidate.chainId !== expectedChainId) return "wrong-chain";
  if (excludeSources.has(candidate.sourceId)) return "source-excluded";
  if (includeSources.size > 0 && !includeSources.has(candidate.sourceId)) {
    return "source-not-included";
  }
  return null;
}

function minimumOutputFor(route, slippageBps) {
  return (route.amountOut * (BASIS_POINTS - slippageBps)) / BASIS_POINTS;
}

function maximumInputFor(route, slippageBps) {
  return (route.amountIn * (BASIS_POINTS + slippageBps)) / BASIS_POINTS;
}

function withFeeEstimate(route) {
  if (route.feeEstimate || route.score?.totalFeeWei === undefined) return route;

  return {
    ...route,
    feeEstimate: {
      executionFeeWei: route.score.executionFeeWei,
      dataFinalityFeeWei: route.score.dataFinalityFeeWei,
      totalFeeWei: route.score.totalFeeWei,
    },
  };
}

function withExecutionBounds(route, slippageBps) {
  if (route.quoteMode === "exactOutput") {
    const maximumInput = maximumInputFor(route, slippageBps);
    return withFeeEstimate({
      ...route,
      maximumInput,
      maxAmountIn: maximumInput,
      minimumOutput: route.amountOut,
      minAmountOut: route.amountOut,
    });
  }

  const minimumOutput = minimumOutputFor(route, slippageBps);
  return withFeeEstimate({
    ...route,
    minimumOutput,
    minAmountOut: minimumOutput,
  });
}

function withNonExecutablePreview(
  route,
  slippageBps,
  gasPriceWei,
  outputWeiPerFeeWei,
  inputWeiPerFeeWei,
) {
  const preview = withExecutionBounds(route, slippageBps);

  if (route.gasUnits === undefined || route.dataFinalityFeeWei === undefined) {
    return preview;
  }

  return {
    ...preview,
    feeEstimate: estimateDogeosFee({
      gasUnits: route.gasUnits,
      gasPriceWei,
      dataFinalityFeeWei: route.dataFinalityFeeWei,
    }),
    score: route.quoteMode === "exactOutput"
      ? scoreExactOutputQuote({
          amountIn: route.amountIn,
          gasUnits: route.gasUnits,
          gasPriceWei,
          dataFinalityFeeWei: route.dataFinalityFeeWei,
          inputWeiPerFeeWei,
          failurePenalty: route.failurePenalty,
        })
      : scoreQuote({
          amountOut: route.amountOut,
          gasUnits: route.gasUnits,
          gasPriceWei,
          dataFinalityFeeWei: route.dataFinalityFeeWei,
          outputWeiPerFeeWei,
          failurePenalty: route.failurePenalty,
        }),
  };
}

function compareInactivePreviews(left, right) {
  if (left.quoteMode === "exactOutput" && right.quoteMode === "exactOutput") {
    const leftTotalInput = left.score?.totalInput;
    const rightTotalInput = right.score?.totalInput;

    if (leftTotalInput !== undefined && rightTotalInput !== undefined) {
      if (leftTotalInput < rightTotalInput) return -1;
      if (leftTotalInput > rightTotalInput) return 1;
    }
  }

  const leftNetOutput = left.score?.netOutput;
  const rightNetOutput = right.score?.netOutput;

  if (leftNetOutput !== undefined && rightNetOutput !== undefined) {
    if (leftNetOutput > rightNetOutput) return -1;
    if (leftNetOutput < rightNetOutput) return 1;
  }

  if (left.amountOut > right.amountOut) return -1;
  if (left.amountOut < right.amountOut) return 1;
  if (left.gasUnits < right.gasUnits) return -1;
  if (left.gasUnits > right.gasUnits) return 1;
  return left.sourceId.localeCompare(right.sourceId);
}

function sortedRejectedPreviews(routes) {
  const inactivePreviews = [];
  const otherRejected = [];

  for (const route of routes) {
    if (route.reason === "not-active") {
      inactivePreviews.push(route);
    } else {
      otherRejected.push(route);
    }
  }

  return [...otherRejected, ...inactivePreviews.sort(compareInactivePreviews)];
}

function normalizeSlippageBps(slippageBps) {
  const normalized = BigInt(slippageBps);
  if (normalized < 0n || normalized > MAX_SLIPPAGE_BPS) {
    throw new RangeError(`slippageBps must be between 0 and ${MAX_SLIPPAGE_BPS} (5%)`);
  }
  return normalized;
}

export function buildQuoteResponse({
  candidates,
  includeSources = [],
  excludeSources = [],
  nowMs,
  expectedChainId,
  gasPriceWei,
  outputWeiPerFeeWei,
  inputWeiPerFeeWei = outputWeiPerFeeWei,
  slippageBps,
}) {
  const included = normalizeSourceSet(includeSources);
  const excluded = normalizeSourceSet(excludeSources);
  const slippage = normalizeSlippageBps(slippageBps);
  const eligible = [];
  const preRejected = [];

  for (const candidate of candidates) {
    const reason = rejectBeforeScoring(candidate, {
      expectedChainId,
      includeSources: included,
      excludeSources: excluded,
    });

    if (reason) {
      preRejected.push({ ...candidate, reason });
      continue;
    }

    eligible.push(candidate);
  }

  const routed = chooseBestDirectRoute({
    candidates: eligible,
    nowMs,
    gasPriceWei,
    outputWeiPerFeeWei,
    inputWeiPerFeeWei,
  });
  const best = routed.best ? withExecutionBounds(routed.best, slippage) : null;
  const alternatives = routed.alternatives.map((route) => withExecutionBounds(route, slippage));
  const rejectedFromRouting = sortedRejectedPreviews(
    routed.rejected.map((route) =>
      withNonExecutablePreview(
        route,
        slippage,
        gasPriceWei,
        outputWeiPerFeeWei,
        inputWeiPerFeeWei,
      ),
    ),
  );
  const rejected = [
    ...preRejected,
    ...rejectedFromRouting,
  ];
  const hasInactiveQuotePreview = rejectedFromRouting.some((route) => route.status !== "active");
  const status = best ? "ok" : hasInactiveQuotePreview ? "read-only" : "no-route";

  return {
    status,
    best,
    alternatives,
    rejected,
    warnings: best ? [...(best.warnings ?? [])] : ["no-executable-route"],
    expiresAtMs: best ? best.quoteTimestampMs + best.ttlMs : null,
  };
}
