export async function resolveDataFinalityFeeWei(value = 0n, input = {}) {
  const resolved = typeof value === "function" ? await value(input) : value;
  const feeWei = BigInt(resolved ?? 0n);

  if (feeWei < 0n) {
    throw new Error("dataFinalityFeeWei must be zero or greater.");
  }

  return feeWei;
}
