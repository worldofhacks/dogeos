// splitRoutes.mjs — composes ATOMIC split-route candidates executed by the
// first-party DogeSwapRouter: the input is divided across the two best direct
// venues and settled in ONE transaction with an aggregate enforced minOut.
//
// Exact-input only. The provider re-quotes each candidate ratio with the
// underlying direct providers (per-venue pinned), so leg outputs are real
// depth-aware quotes, not linear interpolations — on micro-liquidity pools a
// split materially beats single-venue execution.

export const SPLIT_SOURCE_ID = "dogeswap-split";

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

export function createSplitQuoteCandidateProvider({
  enabled = true,
  routerAddress = null,
  directQuoteProvider,
  splitRatiosBps = DEFAULT_SPLIT_RATIOS_BPS,
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

    const ratioCandidates = await Promise.all(
      splitRatiosBps.map(async (ratioBps) => {
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

        return [
          { quote: legA, amountIn: amountA },
          { quote: legB, amountIn: amountB },
        ];
      }),
    );

    let bestLegs = null;
    let bestOut = 0n;
    for (const legs of ratioCandidates) {
      if (!legs) continue;
      const out = legs.reduce((total, { quote }) => total + quote.amountOut, 0n);
      if (out > bestOut) {
        bestOut = out;
        bestLegs = legs;
      }
    }
    if (!bestLegs) return [];

    // Only surface the split when it genuinely beats the best single venue —
    // otherwise the extra router gas is pure cost.
    const bestSingleOut = rankedVenues[0].amountOut;
    const improvementFloor = (bestSingleOut * (BASIS_POINTS + minImprovementBps)) / BASIS_POINTS;
    if (bestOut <= improvementFloor) return [];

    return [composeSplitCandidate({ legs: bestLegs, routerAddress, input, nowMs })];
  };
}
