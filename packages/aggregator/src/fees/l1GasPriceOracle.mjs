import { DOGEOS_CHAIN } from "../../../config/src/chains.mjs";

export const GET_L1_FEE_SELECTOR = "0x49948e0e";

// Direct-venue calldata sizes (router-UNWRAPPED). Used when the swap executes
// straight against the venue's own router — exact-output (the DogeSwapRouter is
// exact-input only) or when router execution is off.
const DIRECT_VENUE_PAYLOAD_BYTES = Object.freeze({
  v2: 260,
  v3: 228,
  algebra: 260,
});

// DogeSwapRouter execute(...) program sizes, measured from the real calldata
// builder (buildDogeSwapSplitCalldata) WITHOUT the optional in-tx Permit2 permit
// (the common warm-allowance case; modeling it WITH the +permit command would
// over-charge every quote and bias against the router). base = execute head +
// Permit2 pull + settlement + deadline; per-leg = one swap command + its args.
// Measured: 1-leg v3 = 644B, 2-leg v3+v2 split = 900B → base 388, per-leg 256.
const ROUTER_PROGRAM_BASE_BYTES = 388;
const ROUTER_PROGRAM_PER_LEG_BYTES = 256;

function routerProgramBytes(legCount = 1) {
  const legs = Math.max(1, Number(legCount) || 1);
  return ROUTER_PROGRAM_BASE_BYTES + ROUTER_PROGRAM_PER_LEG_BYTES * legs;
}

function payloadOfByteLength(byteLength) {
  if (!byteLength || byteLength <= 0) return "0x";
  return `0x${"ff".repeat(byteLength)}`;
}

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

// Direct-venue payload (the historical default): a fixed per-protocol calldata
// size. Faithful only for swaps executed straight against the venue router.
export function estimatedSwapPayloadForFee({ protocolType } = {}) {
  return payloadOfByteLength(DIRECT_VENUE_PAYLOAD_BYTES[protocolType]);
}

// Route-aware payload whose BYTE LENGTH approximates the real submitted calldata,
// so getL1Fee charges the true DogeOS data/finality cost at quote-scoring time
// (fixing the ~3-5x under-count from charging direct-venue bytes for swaps that
// actually execute as a DogeSwapRouter program). Branches:
//   - split route → ONE router program sized for its leg count (~900B for 2 legs),
//     NOT the sum of per-leg direct-venue calldata.
//   - exactOutput, or router execution not active → direct-venue calldata (the
//     router is exact-input only).
//   - router-executable exactInput single venue → a 1-leg router program (~644B)
//     instead of the ~228-260B direct-venue calldata.
export function swapPayloadForFee(input = {}) {
  const { protocolType, quoteMode = "exactInput", routeType } = input;
  const isSplit = routeType === "split" || (Array.isArray(input.legs) && input.legs.length > 1);
  if (isSplit) {
    const legCount = Array.isArray(input.legs) ? input.legs.length : input.legCount ?? 2;
    return payloadOfByteLength(routerProgramBytes(legCount));
  }
  const routerExecutable = Boolean(input.routerExecutable) && input.routerMode === "all";
  if (quoteMode === "exactOutput" || !routerExecutable) {
    return payloadOfByteLength(DIRECT_VENUE_PAYLOAD_BYTES[protocolType]);
  }
  return payloadOfByteLength(routerProgramBytes(1));
}

export function createDogeosDataFinalityFeeProvider({
  client,
  oracleAddress = DOGEOS_CHAIN.l1GasPriceOracle,
  payloadProvider = estimatedSwapPayloadForFee,
  blockTag = "latest",
  cacheTtlMs = 15_000,
  maxCacheEntries = 256,
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
    if (cached) cache.delete(cacheKey);

    try {
      const result = await client.call(
        {
          to: oracleAddress,
          data: encodeGetL1FeeCall(payload),
        },
        blockTag,
      );
      const feeWei = decodeUint256Result(result);
      // The swap path keys this cache by full router calldata, which is unique
      // per swap (amounts + deadline are encoded) — without a cap the map of
      // the long-running server grows on every POST /swap. Evict in insertion
      // order once full.
      while (cache.size >= maxCacheEntries) {
        cache.delete(cache.keys().next().value);
      }
      cache.set(cacheKey, { feeWei, cachedAtMs: now });
      return feeWei;
    } catch (error) {
      onProviderError?.(error, input);
      return BigInt(fallbackFeeWei);
    }
  };
}
