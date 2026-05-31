export const BALANCE_OF_SELECTOR = "0x70a08231";

function normalizeAddress(value, fieldName) {
  const normalized = String(value ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
  return normalized;
}

function assertHexAddress(value, fieldName) {
  const address = String(value ?? "");
  normalizeAddress(address, fieldName);
  return address;
}

function encodeAddress(value, fieldName) {
  return normalizeAddress(value, fieldName).slice(2).padStart(64, "0");
}

function positiveUint(value, fieldName) {
  const normalized = BigInt(value);
  if (normalized <= 0n) {
    throw new Error(`${fieldName} must be greater than zero.`);
  }
  return normalized;
}

function nonNegativeUint(value, fieldName) {
  const normalized = BigInt(value);
  if (normalized < 0n) {
    throw new Error(`${fieldName} must be zero or greater.`);
  }
  return normalized;
}

function decodeUint256Result(result, fieldName) {
  const normalized = String(result ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a uint256 ABI result.`);
  }
  return BigInt(normalized);
}

async function resolveGasPriceWei(gasPriceWei, input) {
  return typeof gasPriceWei === "function" ? gasPriceWei(input) : gasPriceWei;
}

function requiredSellAmountForQuote(quote) {
  if (quote.quoteMode === "exactOutput") {
    return positiveUint(quote.maxAmountIn ?? quote.maximumInput, "quote.maxAmountIn");
  }
  return positiveUint(quote.amountIn, "quote.amountIn");
}

function requiredNativeWeiForTransaction({ transaction, verification, gasPriceWei }) {
  const value = nonNegativeUint(transaction.value ?? 0n, "transaction.value");
  const gasLimit = positiveUint(
    verification.gasLimit ?? transaction.gas,
    "verification.gasLimit",
  );
  const dataFinalityFeeWei = nonNegativeUint(
    verification.dataFinalityFeeWei ?? 0n,
    "verification.dataFinalityFeeWei",
  );
  return value + gasLimit * nonNegativeUint(gasPriceWei, "gasPriceWei") + dataFinalityFeeWei;
}

export function encodeErc20BalanceOfCall({ owner }) {
  return `${BALANCE_OF_SELECTOR}${encodeAddress(owner, "owner")}`;
}

export function buildSwapBalancePreflight({
  quote,
  transaction,
  verification,
  gasPriceWei,
  sellTokenBalance,
  nativeBalance,
}) {
  assertHexAddress(quote.sellToken, "quote.sellToken");
  const requiredSellAmount = requiredSellAmountForQuote(quote);
  const normalizedSellTokenBalance = nonNegativeUint(sellTokenBalance, "sellTokenBalance");
  const requiredNativeWei = requiredNativeWeiForTransaction({
    transaction,
    verification,
    gasPriceWei,
  });
  const normalizedNativeBalance = nonNegativeUint(nativeBalance, "nativeBalance");

  if (normalizedSellTokenBalance < requiredSellAmount) {
    throw new Error(
      `Insufficient sell-token balance: required ${requiredSellAmount}, available ${normalizedSellTokenBalance}.`,
    );
  }

  if (normalizedNativeBalance < requiredNativeWei) {
    throw new Error(
      `Insufficient native DOGE balance: required ${requiredNativeWei}, available ${normalizedNativeBalance}.`,
    );
  }

  return {
    status: "sufficient",
    requiredSellAmount,
    sellTokenBalance: normalizedSellTokenBalance,
    requiredNativeWei,
    nativeBalance: normalizedNativeBalance,
  };
}

export function createSwapBalanceVerifier({ client, gasPriceWei, blockTag = "latest" } = {}) {
  if (!client?.call || !client?.getBalance) {
    throw new Error("Swap balance verification requires RPC call and getBalance methods.");
  }

  return async function verifySwapBalances({ quote, transaction, verification, sender }) {
    const owner = assertHexAddress(sender, "sender");
    const sellToken = assertHexAddress(quote.sellToken, "quote.sellToken");
    const input = { quote, transaction, verification, sender: owner, blockTag };
    const [sellTokenBalanceResult, nativeBalance, resolvedGasPriceWei] = await Promise.all([
      client.call(
        {
          to: sellToken,
          data: encodeErc20BalanceOfCall({ owner }),
        },
        blockTag,
      ),
      client.getBalance(owner, blockTag),
      resolveGasPriceWei(gasPriceWei, input),
    ]);

    return buildSwapBalancePreflight({
      quote,
      transaction,
      verification,
      gasPriceWei: resolvedGasPriceWei,
      sellTokenBalance: decodeUint256Result(sellTokenBalanceResult, "sellTokenBalance"),
      nativeBalance,
    });
  };
}
