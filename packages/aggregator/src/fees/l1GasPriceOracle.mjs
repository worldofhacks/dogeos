import { DOGEOS_CHAIN } from "../../../config/src/chains.mjs";

export const GET_L1_FEE_SELECTOR = "0x49948e0e";

const ESTIMATED_SWAP_PAYLOAD_BYTES = Object.freeze({
  v2: 260,
  v3: 228,
  algebra: 260,
});

function assertHexData(value, fieldName) {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(value ?? "")) {
    throw new Error(`${fieldName} must be hex data.`);
  }
}

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function padHexBytes(hexBytes) {
  if (hexBytes.length === 0) return "";
  return hexBytes.padEnd(Math.ceil(hexBytes.length / 64) * 64, "0");
}

export function encodeGetL1FeeCall(rawTransactionData) {
  assertHexData(rawTransactionData, "rawTransactionData");
  const hexBytes = rawTransactionData.slice(2);
  const byteLength = BigInt(hexBytes.length / 2);

  return `${GET_L1_FEE_SELECTOR}${word(32n)}${word(byteLength)}${padHexBytes(hexBytes)}`;
}

export function decodeUint256Result(result, fieldName = "eth_call result") {
  assertHexData(result, fieldName);
  const encoded = result.slice(2);

  if (encoded.length !== 64) {
    throw new Error(`${fieldName} must be an ABI-encoded uint256 result.`);
  }

  return BigInt(`0x${encoded}`);
}

export function estimatedSwapPayloadForFee({ protocolType } = {}) {
  const byteLength = ESTIMATED_SWAP_PAYLOAD_BYTES[protocolType];
  if (!byteLength) return "0x";
  return `0x${"ff".repeat(byteLength)}`;
}

export function createDogeosDataFinalityFeeProvider({
  client,
  oracleAddress = DOGEOS_CHAIN.l1GasPriceOracle,
  payloadProvider = estimatedSwapPayloadForFee,
  blockTag = "latest",
  cacheTtlMs = 15_000,
  nowMs = () => Date.now(),
  fallbackFeeWei = 0n,
  onProviderError,
} = {}) {
  if (!client?.call) {
    throw new Error("client.call is required for DogeOS data/finality fee reads.");
  }

  const cache = new Map();

  return async function dogeosDataFinalityFeeProvider(input = {}) {
    const payload = payloadProvider(input);
    assertHexData(payload, "data/finality fee payload");

    if (payload === "0x") return BigInt(fallbackFeeWei);

    const cacheKey = payload.toLowerCase();
    const now = nowMs();
    const cached = cache.get(cacheKey);
    if (cached && now - cached.cachedAtMs <= cacheTtlMs) {
      return cached.feeWei;
    }

    try {
      const result = await client.call(
        {
          to: oracleAddress,
          data: encodeGetL1FeeCall(payload),
        },
        blockTag,
      );
      const feeWei = decodeUint256Result(result);
      cache.set(cacheKey, { feeWei, cachedAtMs: now });
      return feeWei;
    } catch (error) {
      onProviderError?.(error, input);
      return BigInt(fallbackFeeWei);
    }
  };
}
