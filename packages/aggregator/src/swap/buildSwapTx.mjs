function assertHexAddress(value, fieldName) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value ?? "")) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
}

function assertHexData(value, fieldName) {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(value ?? "")) {
    throw new Error(`${fieldName} must be hex calldata.`);
  }
}

function positiveBigInt(value, fieldName) {
  const normalized = BigInt(value);
  if (normalized <= 0n) {
    throw new Error(`${fieldName} must be greater than zero.`);
  }
  return normalized;
}

function routeBindingFor(quote) {
  if (quote.quoteMode === "exactOutput") {
    return {
      quoteMode: "exactOutput",
      sellToken: quote.sellToken,
      buyToken: quote.buyToken,
      amountOut: positiveBigInt(quote.amountOut, "amountOut"),
      maxAmountIn: positiveBigInt(quote.maxAmountIn ?? quote.maximumInput, "maxAmountIn"),
      recipient: quote.recipient,
      deadline: quote.deadline,
    };
  }

  return {
    sellToken: quote.sellToken,
    buyToken: quote.buyToken,
    amountIn: quote.amountIn,
    minAmountOut: quote.minAmountOut,
    recipient: quote.recipient,
    deadline: quote.deadline,
  };
}

export function buildSwapTx({ quote, nowMs, expectedChainId, calldataBuilder }) {
  if (quote.chainId !== expectedChainId) {
    throw new Error(`Quote chain ${quote.chainId} does not match expected chain ${expectedChainId}.`);
  }

  if (quote.status !== "active") {
    throw new Error(`Source ${quote.sourceId} is not active for execution.`);
  }

  if (nowMs - quote.quoteTimestampMs > quote.ttlMs) {
    throw new Error(`Quote for ${quote.sourceId} is expired.`);
  }

  assertHexAddress(quote.router, "router");
  assertHexAddress(quote.sellToken, "sellToken");
  assertHexAddress(quote.buyToken, "buyToken");
  assertHexAddress(quote.recipient, "recipient");

  positiveBigInt(quote.amountIn, "amountIn");

  if (quote.quoteMode === "exactOutput") {
    positiveBigInt(quote.amountOut, "amountOut");
    positiveBigInt(quote.maxAmountIn ?? quote.maximumInput, "maxAmountIn");
  } else {
    positiveBigInt(quote.minAmountOut, "minAmountOut");
  }

  const data = calldataBuilder(quote);
  assertHexData(data, "data");

  return {
    chainId: quote.chainId,
    to: quote.router,
    data,
    value: quote.nativeValueWei ?? 0n,
    sourceId: quote.sourceId,
    routeBinding: routeBindingFor(quote),
  };
}
