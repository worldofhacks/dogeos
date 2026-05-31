export function sourceAllowedByRequest(sourceId, { includeSources = [], excludeSources = [] } = {}) {
  if (includeSources.length > 0 && !includeSources.includes(sourceId)) return false;
  if (excludeSources.includes(sourceId)) return false;
  return true;
}

function normalizedAddress(value) {
  const normalized = String(value ?? "").toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(normalized) ? normalized : null;
}

export function sourceSupportsTokenPair(source, { sellToken, buyToken } = {}) {
  const pools = source?.pools ?? [];
  if (pools.length === 0) return true;

  const sell = normalizedAddress(sellToken);
  const buy = normalizedAddress(buyToken);
  if (!sell || !buy) return true;

  return pools.some((pool) => {
    const token0 = normalizedAddress(pool.token0);
    const token1 = normalizedAddress(pool.token1);
    return (
      (token0 === sell && token1 === buy) ||
      (token0 === buy && token1 === sell)
    );
  });
}

export function filterSourcesByTokenPair(sources, input) {
  return sources.filter((source) => sourceSupportsTokenPair(source, input));
}

export function filterSourcesByRequest(sources, input) {
  return sources.filter((source) => sourceAllowedByRequest(source.sourceId, input));
}
