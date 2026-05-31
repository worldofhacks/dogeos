export function estimateDogeosFee({ gasUnits, gasPriceWei, dataFinalityFeeWei }) {
  const executionFeeWei = gasUnits * gasPriceWei;
  return {
    executionFeeWei,
    dataFinalityFeeWei,
    totalFeeWei: executionFeeWei + dataFinalityFeeWei,
  };
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
  const feeCostInOutputToken = fee.totalFeeWei * outputWeiPerFeeWei;
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
  const feeCostInInputToken = fee.totalFeeWei * inputWeiPerFeeWei;
  const totalInput = amountIn + feeCostInInputToken + failurePenalty;

  return {
    ...fee,
    grossInput: amountIn,
    feeCostInInputToken,
    failurePenalty,
    totalInput,
  };
}
