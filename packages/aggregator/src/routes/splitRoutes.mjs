// splitRoutes.mjs — composes ATOMIC split-route candidates executed by the
// first-party DogeSwapRouter: the input is divided across the two best direct
// venues and settled in ONE transaction with an aggregate enforced minOut.
//
// Exact-input only. The provider re-quotes each candidate ratio with the
// underlying direct providers (per-venue pinned), so leg outputs are real
// depth-aware quotes, not linear interpolations — on micro-liquidity pools a
// split materially beats single-venue execution.

export const SPLIT_SOURCE_ID = "dogeswap-split";
export const ROUTER_EXECUTION_MODE = "dogeswap-router";

const ROUTER_WRAPPABLE_PROTOCOLS = new Set(["v2", "v3", "algebra"]);

// Retarget an eligible single-venue exact-input quote onto the first-party
// DogeSwapRouter for execution: ranking and display stay venue-based, but the
// transaction goes through the router so EVERY swap gets enforced settlement
// (aggregate minOut on measured delta), an enforced deadline (MuchFi V3's own
// calldata drops it), refunds, pause/caps, and the one-approval-per-token
// Permit2 flow. Exact-output quotes pass through untouched — the router's
// command set is exact-input only.
export function wrapQuoteForRouterExecution(quote, { routerAddress } = {}) {
  if (!routerAddress) return quote;
  if ((quote.quoteMode ?? "exactInput") === "exactOutput") return quote;
  if (quote.sourceId === SPLIT_SOURCE_ID || quote.executionMode === ROUTER_EXECUTION_MODE) return quote;
  if (!ROUTER_WRAPPABLE_PROTOCOLS.has(quote.protocolType)) return quote;
  if (quote.status !== "active") return quote;

  return {
    ...quote,
    executionMode: ROUTER_EXECUTION_MODE,
    venueRouter: quote.router,
    router: routerAddress,
    legs: [
      {
        sourceId: quote.sourceId,
        protocolType: quote.protocolType,
        poolAddress: quote.poolAddress,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        gasUnits: quote.gasUnits,
        ...(quote.feeTier !== undefined ? { feeTier: quote.feeTier } : {}),
        ...(quote.feeBps !== undefined ? { feeBps: quote.feeBps } : {}),
        ...(quote.deployer !== undefined ? { deployer: quote.deployer } : {}),
        ...(quote.path !== undefined ? { path: quote.path } : {}),
      },
    ],
  };
}

const BASIS_POINTS = 10_000n;
// Router execution overhead on top of the venue legs: Permit2 pull +
// command dispatch + settlement transfers/refund.
const ROUTER_OVERHEAD_GAS_UNITS = 90_000n;
const DEFAULT_SPLIT_RATIOS_BPS = Object.freeze([2_500n, 5_000n, 7_500n]);

function activeBestBySource(candidates, quoteMode) {
  const bySource = new Map();
  for (const candidate of candidates) {
    if (candidate.status !== "active") continue;
    if ((candidate.quoteMode ?? "exactInput") !== quoteMode) continue;
    if (candidate.routeType === "oneHop" || candidate.routeType === "split") continue;
    const current = bySource.get(candidate.sourceId);
    if (!current || candidate.amountOut > current.amountOut) {
      bySource.set(candidate.sourceId, candidate);
    }
  }
  return [...bySource.values()].sort((left, right) => (right.amountOut > left.amountOut ? 1 : -1));
}

function legSummary(quote, amountIn) {
  return {
    sourceId: quote.sourceId,
    protocolType: quote.protocolType,
    poolAddress: quote.poolAddress,
    amountIn,
    amountOut: quote.amountOut,
    gasUnits: quote.gasUnits,
    ...(quote.feeTier !== undefined ? { feeTier: quote.feeTier } : {}),
    ...(quote.feeBps !== undefined ? { feeBps: quote.feeBps } : {}),
    ...(quote.deployer !== undefined ? { deployer: quote.deployer } : {}),
    ...(quote.path !== undefined ? { path: quote.path } : {}),
  };
}

export function composeSplitCandidate({ legs, routerAddress, input, nowMs = () => Date.now() }) {
  const amountOut = legs.reduce((total, { quote }) => total + quote.amountOut, 0n);
  const gasUnits =
    legs.reduce((total, { quote }) => total + quote.gasUnits, 0n) + ROUTER_OVERHEAD_GAS_UNITS;
  const dataFinalityFeeWei = legs.reduce(
    (total, { quote }) => total + (quote.dataFinalityFeeWei ?? 0n),
    0n,
  );

  return {
    routeType: "split",
    sourceId: SPLIT_SOURCE_ID,
    displayName: "DogeSwap Split",
    protocolType: "aggregator",
    status: "active",
    chainId: legs[0].quote.chainId,
    router: routerAddress,
    sellToken: input.sellToken,
    buyToken: input.buyToken,
    quoteMode: "exactInput",
    amountIn: input.amountIn,
    amountOut,
    gasUnits,
    dataFinalityFeeWei,
    quoteTimestampMs: Math.min(...legs.map(({ quote }) => quote.quoteTimestampMs ?? nowMs())),
    ttlMs: Math.min(...legs.map(({ quote }) => quote.ttlMs ?? 5_000)),
    warnings: [],
    legs: legs.map(({ quote, amountIn }) => legSummary(quote, amountIn)),
  };
}

// Deterministic refresh for an already-accepted split: re-quote the EXACT
// locked legs (same venues, same per-leg amountIn) instead of re-running the
// optimizer. The optimizer is marginal — re-running it on a refresh often
// fails to reproduce a split (so /swap would 422), and the original split's
// short TTL would otherwise expire during approval+permit signing. This pins
// the user-accepted structure, refreshes leg prices, and always reproduces.
export function createSplitQuoteRefresher({
  routerAddress = null,
  directQuoteProvider,
  nowMs = () => Date.now(),
} = {}) {
  return async function refreshSplitQuote(quote, { slippageBps = 50n } = {}) {
    if (!routerAddress || typeof directQuoteProvider !== "function") {
      throw new Error("Split refresh is not configured.");
    }
    const lockedLegs = Array.isArray(quote.legs) ? quote.legs : [];
    if (lockedLegs.length < 1) {
      throw new Error("Split quote has no legs to refresh.");
    }

    const base = {
      chainId: quote.chainId,
      quoteMode: "exactInput",
      sellToken: quote.sellToken,
      buyToken: quote.buyToken,
      excludeSources: [],
    };

    const refreshedLegs = await Promise.all(
      lockedLegs.map(async (leg) => {
        const legInput = {
          ...base,
          amountIn: BigInt(leg.amountIn),
          includeSources: [leg.sourceId],
        };
        const quotes = await directQuoteProvider(legInput);
        const fresh = activeBestBySource(quotes, "exactInput").find(
          (candidate) => candidate.sourceId === leg.sourceId,
        );
        if (!fresh) {
          throw new Error(
            `Split leg ${leg.sourceId} could not be re-quoted. Refresh the quote and try again.`,
          );
        }
        return { quote: fresh, amountIn: BigInt(leg.amountIn) };
      }),
    );

    const totalAmountIn = refreshedLegs.reduce((sum, { amountIn }) => sum + amountIn, 0n);
    const candidate = composeSplitCandidate({
      legs: refreshedLegs,
      routerAddress,
      input: { sellToken: quote.sellToken, buyToken: quote.buyToken, amountIn: totalAmountIn },
      nowMs,
    });

    // Apply the accepted slippage to the freshly-summed output.
    const slippage = BigInt(slippageBps);
    const minimumOutput = (candidate.amountOut * (BASIS_POINTS - slippage)) / BASIS_POINTS;
    return {
      ...candidate,
      minimumOutput,
      minAmountOut: minimumOutput,
    };
  };
}

export function createSplitQuoteCandidateProvider({
  enabled = true,
  routerAddress = null,
  directQuoteProvider,
  splitRatiosBps = DEFAULT_SPLIT_RATIOS_BPS,
  refineStepBps = 1_250n,
  minImprovementBps = 5n,
  nowMs = () => Date.now(),
} = {}) {
  return async function splitQuoteCandidateProvider(input) {
    if (!enabled || !routerAddress || typeof directQuoteProvider !== "function") return [];
    if ((input.quoteMode ?? "exactInput") === "exactOutput") return [];

    // Respect source pinning: a request pinned to other sources must not pay
    // for split exploration; a request pinned to the split itself (the /swap
    // refresh) re-plans with unpinned inner venue queries.
    const includeSources = input.includeSources ?? [];
    if (includeSources.length > 0 && !includeSources.includes(SPLIT_SOURCE_ID)) return [];
    const innerInput = { ...input, includeSources: [] };

    const fullQuotes = await directQuoteProvider(innerInput);
    const rankedVenues = activeBestBySource(fullQuotes, "exactInput");
    if (rankedVenues.length < 2) return [];

    const [venueA, venueB] = rankedVenues;
    const amountIn = BigInt(input.amountIn);

    const evaluateRatio = async (ratioBps) => {
      const amountA = (amountIn * BigInt(ratioBps)) / BASIS_POINTS;
      const amountB = amountIn - amountA;
      if (amountA <= 0n || amountB <= 0n) return null;

      const [quotesA, quotesB] = await Promise.all([
        directQuoteProvider({ ...innerInput, amountIn: amountA, includeSources: [venueA.sourceId] }),
        directQuoteProvider({ ...innerInput, amountIn: amountB, includeSources: [venueB.sourceId] }),
      ]);
      const legA = activeBestBySource(quotesA, "exactInput").find(
        (quote) => quote.sourceId === venueA.sourceId,
      );
      const legB = activeBestBySource(quotesB, "exactInput").find(
        (quote) => quote.sourceId === venueB.sourceId,
      );
      if (!legA || !legB) return null;

      return {
        ratioBps: BigInt(ratioBps),
        legs: [
          { quote: legA, amountIn: amountA },
          { quote: legB, amountIn: amountB },
        ],
        amountOut: legA.amountOut + legB.amountOut,
      };
    };

    const pickBest = (evaluated) =>
      evaluated
        .filter(Boolean)
        .reduce((best, candidate) => (!best || candidate.amountOut > best.amountOut ? candidate : best), null);

    // Stage 1: coarse ratio sweep. Stage 2: refine around the coarse winner —
    // real depth-aware re-quotes, so the chosen split tracks the true optimum
    // instead of snapping to a coarse grid point.
    const coarse = pickBest(await Promise.all(splitRatiosBps.map((ratio) => evaluateRatio(ratio))));
    if (!coarse) return [];

    let best = coarse;
    if (refineStepBps > 0n) {
      const tried = new Set(splitRatiosBps.map((ratio) => BigInt(ratio).toString()));
      const refineRatios = [coarse.ratioBps - refineStepBps, coarse.ratioBps + refineStepBps].filter(
        (ratio) => ratio > 0n && ratio < BASIS_POINTS && !tried.has(ratio.toString()),
      );
      const refined = pickBest(await Promise.all(refineRatios.map((ratio) => evaluateRatio(ratio))));
      if (refined && refined.amountOut > best.amountOut) best = refined;
    }

    const bestLegs = best.legs;
    const bestOut = best.amountOut;

    // Only surface the split when it genuinely beats the best single venue —
    // otherwise the extra router gas is pure cost.
    const bestSingleOut = rankedVenues[0].amountOut;
    const improvementFloor = (bestSingleOut * (BASIS_POINTS + minImprovementBps)) / BASIS_POINTS;
    if (bestOut <= improvementFloor) return [];

    return [composeSplitCandidate({ legs: bestLegs, routerAddress, input, nowMs })];
  };
}
