function assertPositive(value, label) {
  if (value <= 0n) {
    throw new Error(`${label} must be greater than zero.`);
  }
}

function resolveReserves({ token0, token1, reserve0, reserve1, sellToken, buyToken }) {
  if (sellToken === token0 && buyToken === token1) {
    return { reserveIn: reserve0, reserveOut: reserve1 };
  }

  if (sellToken === token1 && buyToken === token0) {
    return { reserveIn: reserve1, reserveOut: reserve0 };
  }

  throw new Error("Requested pair does not match pool tokens.");
}

function amountOutWithFee({ amountIn, reserveIn, reserveOut, feeBps }) {
  const feeDenominator = 10_000n;
  const amountInAfterFee = amountIn * (feeDenominator - feeBps);
  return (amountInAfterFee * reserveOut) / (reserveIn * feeDenominator + amountInAfterFee);
}

function amountInForExactOutput({ amountOut, reserveIn, reserveOut, feeBps }) {
  const feeDenominator = 10_000n;
  if (amountOut >= reserveOut) {
    throw new Error("amountOut exceeds pool liquidity.");
  }

  const numerator = reserveIn * amountOut * feeDenominator;
  const denominator = (reserveOut - amountOut) * (feeDenominator - feeBps);
  return numerator / denominator + 1n;
}

function priceImpactBps({ amountIn, amountOut, reserveIn, reserveOut }) {
  const midPriceOutput = (amountIn * reserveOut) / reserveIn;
  if (midPriceOutput === 0n || amountOut >= midPriceOutput) return 0n;
  return ((midPriceOutput - amountOut) * 10_000n) / midPriceOutput;
}

export function quoteV2ExactInput({
  sourceId,
  chainId,
  router,
  poolAddress,
  token0,
  token1,
  reserve0,
  reserve1,
  sellToken,
  buyToken,
  amountIn,
  feeBps,
  gasUnits,
  dataFinalityFeeWei,
  blockNumber,
  quoteTimestampMs,
  ttlMs,
  status = "readOnly",
}) {
  assertPositive(amountIn, "amountIn");
  assertPositive(reserve0, "reserve0 liquidity");
  assertPositive(reserve1, "reserve1 liquidity");

  const { reserveIn, reserveOut } = resolveReserves({
    token0,
    token1,
    reserve0,
    reserve1,
    sellToken,
    buyToken,
  });
  const amountOut = amountOutWithFee({ amountIn, reserveIn, reserveOut, feeBps });

  return {
    routeType: "direct",
    sourceId,
    chainId,
    status,
    protocolType: "v2",
    quoteMode: "exactInput",
    router,
    poolAddress,
    sellToken,
    buyToken,
    amountIn,
    amountOut,
    feeBps,
    priceImpactBps: priceImpactBps({ amountIn, amountOut, reserveIn, reserveOut }),
    gasUnits,
    dataFinalityFeeWei,
    blockNumber,
    quoteTimestampMs,
    ttlMs,
    warnings: [],
  };
}

export function quoteV2ExactOutput({
  sourceId,
  chainId,
  router,
  poolAddress,
  token0,
  token1,
  reserve0,
  reserve1,
  sellToken,
  buyToken,
  amountOut,
  feeBps,
  gasUnits,
  dataFinalityFeeWei,
  blockNumber,
  quoteTimestampMs,
  ttlMs,
  status = "readOnly",
}) {
  assertPositive(amountOut, "amountOut");
  assertPositive(reserve0, "reserve0 liquidity");
  assertPositive(reserve1, "reserve1 liquidity");

  const { reserveIn, reserveOut } = resolveReserves({
    token0,
    token1,
    reserve0,
    reserve1,
    sellToken,
    buyToken,
  });
  const amountIn = amountInForExactOutput({ amountOut, reserveIn, reserveOut, feeBps });

  return {
    routeType: "direct",
    sourceId,
    chainId,
    status,
    protocolType: "v2",
    quoteMode: "exactOutput",
    router,
    poolAddress,
    sellToken,
    buyToken,
    amountIn,
    amountOut,
    feeBps,
    priceImpactBps: priceImpactBps({ amountIn, amountOut, reserveIn, reserveOut }),
    gasUnits,
    dataFinalityFeeWei,
    blockNumber,
    quoteTimestampMs,
    ttlMs,
    warnings: [],
  };
}
