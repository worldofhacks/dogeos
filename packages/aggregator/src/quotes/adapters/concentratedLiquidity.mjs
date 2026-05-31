const Q192 = 2n ** 192n;

function assertPositive(value, label) {
  if (value <= 0n) {
    throw new Error(`${label} must be greater than zero.`);
  }
}

function assertQuoterProvenance(provenance) {
  if (!provenance || provenance === "none") {
    throw new Error("Concentrated-liquidity quotes require verified quoter provenance.");
  }
}

function resolveDirection({ token0, token1, sellToken, buyToken }) {
  const normalizedToken0 = String(token0).toLowerCase();
  const normalizedToken1 = String(token1).toLowerCase();
  const normalizedSellToken = String(sellToken).toLowerCase();
  const normalizedBuyToken = String(buyToken).toLowerCase();

  if (normalizedSellToken === normalizedToken0 && normalizedBuyToken === normalizedToken1) {
    return "token0-to-token1";
  }
  if (normalizedSellToken === normalizedToken1 && normalizedBuyToken === normalizedToken0) {
    return "token1-to-token0";
  }
  throw new Error("Requested pair does not match pool tokens.");
}

function midPriceAmountOut({ direction, amountIn, sqrtPriceX96 }) {
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  if (direction === "token0-to-token1") {
    return (amountIn * priceX192) / Q192;
  }
  return (amountIn * Q192) / priceX192;
}

function priceImpactBps({ amountIn, quotedAmountOut, sqrtPriceX96, direction }) {
  const midAmountOut = midPriceAmountOut({ amountIn, sqrtPriceX96, direction });
  if (midAmountOut === 0n || quotedAmountOut >= midAmountOut) return 0n;
  return ((midAmountOut - quotedAmountOut) * 10_000n) / midAmountOut;
}

function exactInputQuoteFromQuoter({
  protocolType,
  sourceId,
  chainId,
  router,
  poolAddress,
  token0,
  token1,
  sellToken,
  buyToken,
  amountIn,
  quotedAmountOut,
  feeBps,
  sqrtPriceX96,
  liquidity,
  quoterProvenance,
  sourceStatus,
  gasUnits,
  dataFinalityFeeWei,
  blockNumber,
  quoteTimestampMs,
  ttlMs,
}) {
  assertQuoterProvenance(quoterProvenance);
  assertPositive(amountIn, "amountIn");
  assertPositive(quotedAmountOut, "quotedAmountOut");
  assertPositive(sqrtPriceX96, "sqrtPriceX96");
  assertPositive(liquidity, "liquidity");

  const direction = resolveDirection({ token0, token1, sellToken, buyToken });

  return {
    routeType: "direct",
    sourceId,
    chainId,
    status: sourceStatus,
    protocolType,
    router,
    poolAddress,
    sellToken,
    buyToken,
    amountIn,
    amountOut: quotedAmountOut,
    feeBps,
    priceImpactBps: priceImpactBps({
      amountIn,
      quotedAmountOut,
      sqrtPriceX96,
      direction,
    }),
    gasUnits,
    dataFinalityFeeWei,
    blockNumber,
    quoteTimestampMs,
    ttlMs,
    liquidity,
    quoterProvenance,
    poolState: {
      sqrtPriceX96,
      liquidity,
      feeBps,
    },
    warnings: [],
  };
}

function exactOutputQuoteFromQuoter({
  protocolType,
  sourceId,
  chainId,
  router,
  poolAddress,
  token0,
  token1,
  sellToken,
  buyToken,
  quotedAmountIn,
  amountOut,
  feeBps,
  sqrtPriceX96,
  liquidity,
  quoterProvenance,
  sourceStatus,
  gasUnits,
  dataFinalityFeeWei,
  blockNumber,
  quoteTimestampMs,
  ttlMs,
}) {
  assertQuoterProvenance(quoterProvenance);
  assertPositive(quotedAmountIn, "quotedAmountIn");
  assertPositive(amountOut, "amountOut");
  assertPositive(sqrtPriceX96, "sqrtPriceX96");
  assertPositive(liquidity, "liquidity");

  const direction = resolveDirection({ token0, token1, sellToken, buyToken });

  return {
    routeType: "direct",
    sourceId,
    chainId,
    status: sourceStatus,
    protocolType,
    quoteMode: "exactOutput",
    router,
    poolAddress,
    sellToken,
    buyToken,
    amountIn: quotedAmountIn,
    amountOut,
    feeBps,
    priceImpactBps: priceImpactBps({
      amountIn: quotedAmountIn,
      quotedAmountOut: amountOut,
      sqrtPriceX96,
      direction,
    }),
    gasUnits,
    dataFinalityFeeWei,
    blockNumber,
    quoteTimestampMs,
    ttlMs,
    liquidity,
    quoterProvenance,
    poolState: {
      sqrtPriceX96,
      liquidity,
      feeBps,
    },
    warnings: [],
  };
}

export function quoteV3ExactInputFromQuoter(params) {
  return exactInputQuoteFromQuoter({ ...params, protocolType: "v3" });
}

export function quoteAlgebraExactInputFromQuoter(params) {
  return exactInputQuoteFromQuoter({ ...params, protocolType: "algebra" });
}

export function quoteV3ExactOutputFromQuoter(params) {
  return exactOutputQuoteFromQuoter({ ...params, protocolType: "v3" });
}

export function quoteAlgebraExactOutputFromQuoter(params) {
  return exactOutputQuoteFromQuoter({ ...params, protocolType: "algebra" });
}
