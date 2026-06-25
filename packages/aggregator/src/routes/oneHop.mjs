function canCompose(firstLeg, secondLeg, viaToken) {
  return (
    firstLeg.buyToken === viaToken &&
    secondLeg.sellToken === viaToken &&
    firstLeg.amountOut === secondLeg.amountIn
  );
}

function matchingChainId(firstLeg, secondLeg) {
  return firstLeg.chainId === secondLeg.chainId ? firstLeg.chainId : undefined;
}

function earlierBlockNumber(firstLeg, secondLeg) {
  if (firstLeg.blockNumber === undefined) return secondLeg.blockNumber;
  if (secondLeg.blockNumber === undefined) return firstLeg.blockNumber;
  return firstLeg.blockNumber < secondLeg.blockNumber ? firstLeg.blockNumber : secondLeg.blockNumber;
}

function combinedWarnings(firstLeg, secondLeg) {
  return [...(firstLeg.warnings ?? []), ...(secondLeg.warnings ?? [])];
}

function legSummary(leg) {
  return {
    sourceId: leg.sourceId,
    protocolType: leg.protocolType,
    sellToken: leg.sellToken,
    buyToken: leg.buyToken,
    amountIn: leg.amountIn,
    amountOut: leg.amountOut,
  };
}

export function composeOneHopCandidates({ viaToken, firstLegQuotes, secondLegQuotes }) {
  const candidates = [];

  for (const firstLeg of firstLegQuotes) {
    for (const secondLeg of secondLegQuotes) {
      if (!canCompose(firstLeg, secondLeg, viaToken)) continue;

      candidates.push({
        routeType: "oneHop",
        sourceId: `${firstLeg.sourceId}+${secondLeg.sourceId}`,
        status: "readOnly",
        reason: "one-hop-execution-preview",
        chainId: matchingChainId(firstLeg, secondLeg),
        sellToken: firstLeg.sellToken,
        buyToken: secondLeg.buyToken,
        viaToken,
        amountIn: firstLeg.amountIn,
        amountOut: secondLeg.amountOut,
        gasUnits: firstLeg.gasUnits + secondLeg.gasUnits,
        dataFinalityFeeWei: firstLeg.dataFinalityFeeWei + secondLeg.dataFinalityFeeWei,
        ...(earlierBlockNumber(firstLeg, secondLeg) === undefined
          ? {}
          : { blockNumber: earlierBlockNumber(firstLeg, secondLeg) }),
        quoteTimestampMs: Math.min(firstLeg.quoteTimestampMs, secondLeg.quoteTimestampMs),
        ttlMs: Math.min(firstLeg.ttlMs, secondLeg.ttlMs),
        warnings: combinedWarnings(firstLeg, secondLeg),
        legs: [legSummary(firstLeg), legSummary(secondLeg)],
      });
    }
  }

  return candidates;
}

function isUsableViaToken({ viaToken, sellToken, buyToken }) {
  return viaToken && viaToken !== sellToken && viaToken !== buyToken;
}

export function createOneHopQuoteCandidateProvider({
  enabled = false,
  viaTokens = [],
  directQuoteProvider,
  dataFinalityFeeProvider,
} = {}) {
  return async function oneHopQuoteCandidateProvider(input) {
    if (!enabled || typeof directQuoteProvider !== "function") return [];
    if (input.quoteMode === "exactOutput") return [];

    const usableViaTokens = viaTokens.filter((viaToken) =>
      isUsableViaToken({
        viaToken,
        sellToken: input.sellToken,
        buyToken: input.buyToken,
      }),
    );

    const candidateGroups = await Promise.all(usableViaTokens.map(async (viaToken) => {
      const candidates = [];
      const firstLegQuotes = await directQuoteProvider({
        ...input,
        buyToken: viaToken,
      });
      const secondLegQuoteGroups = await Promise.all(
        firstLegQuotes.map((firstLeg) =>
          directQuoteProvider({
            ...input,
            sellToken: viaToken,
            amountIn: firstLeg.amountOut,
          }),
        ),
      );

      for (let index = 0; index < firstLegQuotes.length; index += 1) {
        candidates.push(
          ...composeOneHopCandidates({
            viaToken,
            firstLegQuotes: [firstLegQuotes[index]],
            secondLegQuotes: secondLegQuoteGroups[index],
          }),
        );
      }
      return candidates;
    }));

    const candidates = candidateGroups.flat();

    // A one-hop preview (when executable) runs as ONE DogeSwapRouter program —
    // single Permit2 pull + two swap commands + one settlement — not two
    // independent venue swaps. composeOneHopCandidates falls back to summing the
    // per-leg fees, which now each carry full 1-leg router overhead (~644B), so
    // charge a single combined 2-leg program fee (~900B) instead. Every one-hop
    // candidate is 2-leg, so swapPayloadForFee yields one stable payload and this
    // is a single cached oracle read regardless of candidate count.
    if (typeof dataFinalityFeeProvider === "function" && candidates.length > 0) {
      try {
        const combinedFee = await dataFinalityFeeProvider({
          routeType: "split",
          legCount: 2,
          quoteMode: "exactInput",
          sellToken: input.sellToken,
          buyToken: input.buyToken,
        });
        for (const candidate of candidates) candidate.dataFinalityFeeWei = combinedFee;
      } catch {
        // Keep the summed per-leg fallback on oracle failure.
      }
    }

    return candidates;
  };
}
