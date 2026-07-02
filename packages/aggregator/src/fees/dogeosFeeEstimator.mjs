export function estimateDogeosFee({ gasUnits, gasPriceWei, dataFinalityFeeWei }) {
  const executionFeeWei = gasUnits * gasPriceWei;
  return {
    executionFeeWei,
    dataFinalityFeeWei,
    totalFeeWei: executionFeeWei + dataFinalityFeeWei,
  };
}

export function normalizeFeeWeiRate(rate = 0n) {
  if (typeof rate === "bigint") {
    if (rate < 0n) throw new RangeError("fee wei rate must be non-negative.");
    return { numerator: rate, denominator: 1n };
  }

  if (typeof rate === "number" || typeof rate === "string") {
    const numerator = BigInt(rate);
    if (numerator < 0n) throw new RangeError("fee wei rate must be non-negative.");
    return { numerator, denominator: 1n };
  }

  const numerator = BigInt(rate?.numerator ?? rate?.rateNumerator);
  const denominator = BigInt(rate?.denominator ?? rate?.rateDenominator ?? 1n);
  if (numerator < 0n) throw new RangeError("fee wei rate numerator must be non-negative.");
  if (denominator <= 0n) throw new RangeError("fee wei rate denominator must be positive.");
  return { numerator, denominator };
}

export function feeWeiToTokenAmount(feeWei, rate = 0n) {
  const { numerator, denominator } = normalizeFeeWeiRate(rate);
  return (feeWei * numerator) / denominator;
}

export function scoreQuote({
  amountOut,
  gasUnits,
  gasPriceWei,
  dataFinalityFeeWei,
  outputWeiPerFeeWei,
  failurePenalty = 0n,
}) {
  const fee = estimateDogeosFee({
    gasUnits,
    gasPriceWei,
    dataFinalityFeeWei,
  });
  const feeCostInOutputToken = feeWeiToTokenAmount(fee.totalFeeWei, outputWeiPerFeeWei);
  const netOutput = amountOut - feeCostInOutputToken - failurePenalty;

  return {
    ...fee,
    grossOutput: amountOut,
    feeCostInOutputToken,
    failurePenalty,
    netOutput,
  };
}

export function scoreExactOutputQuote({
  amountIn,
  gasUnits,
  gasPriceWei,
  dataFinalityFeeWei,
  inputWeiPerFeeWei,
  failurePenalty = 0n,
}) {
  const fee = estimateDogeosFee({
    gasUnits,
    gasPriceWei,
    dataFinalityFeeWei,
  });
  const feeCostInInputToken = feeWeiToTokenAmount(fee.totalFeeWei, inputWeiPerFeeWei);
  const totalInput = amountIn + feeCostInInputToken + failurePenalty;

  return {
    ...fee,
    grossInput: amountIn,
    feeCostInInputToken,
    failurePenalty,
    totalInput,
  };
}
