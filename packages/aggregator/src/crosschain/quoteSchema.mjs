export const CROSSCHAIN_ROUTE_TYPE = "crosschain";
export const CROSSCHAIN_PROTOCOL_TYPE = "crosschain";
export const CROSSCHAIN_PREVIEW_STATUS = "readOnly";
export const CROSSCHAIN_PREVIEW_WARNING = "crosschain-preview-only";

export const CROSSCHAIN_LEG_KINDS = Object.freeze(["swap", "bridge", "fill"]);
export const CROSSCHAIN_LEG_STATUSES = Object.freeze([
  "pending",
  "awaiting-user",
  "submitted",
  "confirmed",
  "delayed",
  "failed",
  "refunded",
]);
export const CROSSCHAIN_ORDER_STATUSES = Object.freeze([
  "pending",
  "in-progress",
  "delayed",
  "partial",
  "success",
  "refunded",
  "failed",
]);

const LEG_KIND_SET = new Set(CROSSCHAIN_LEG_KINDS);
const LEG_STATUS_SET = new Set(CROSSCHAIN_LEG_STATUSES);
const TERMINAL_FAILURES = new Set(["failed", "refunded"]);

function fail(message) {
  throw new Error(message);
}

function normalizeChainId(value, fieldName) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      fail(`${fieldName} must be a positive safe integer or non-empty chain reference.`);
    }
    return value;
  }

  const text = String(value ?? "").trim();
  if (!text) fail(`${fieldName} must be a positive safe integer or non-empty chain reference.`);

  if (/^[0-9]+$/.test(text)) {
    const numeric = Number(text);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : text;
  }

  return text;
}

function normalizeString(value, fieldName) {
  const text = String(value ?? "").trim();
  if (!text) fail(`${fieldName} is required.`);
  return text;
}

function normalizePositiveBigInt(value, fieldName) {
  const normalized = BigInt(value);
  if (normalized <= 0n) fail(`${fieldName} must be greater than zero.`);
  return normalized;
}

function normalizeNonNegativeInteger(value, fieldName) {
  const normalized = Number(value ?? 0);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    fail(`${fieldName} must be a non-negative safe integer.`);
  }
  return normalized;
}

function normalizeNullableString(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeLegKind(value) {
  const kind = normalizeString(value, "leg.kind");
  if (!LEG_KIND_SET.has(kind)) fail(`leg.kind must be one of ${CROSSCHAIN_LEG_KINDS.join(", ")}.`);
  return kind;
}

function normalizeLegStatus(value = "pending") {
  const status = normalizeString(value, "leg.status");
  if (!LEG_STATUS_SET.has(status)) {
    fail(`leg.status must be one of ${CROSSCHAIN_LEG_STATUSES.join(", ")}.`);
  }
  return status;
}

export function isCrosschainEnabled(env = process.env) {
  return ["1", "true", "yes", "on"].includes(String(env.CROSSCHAIN_ENABLED ?? "").toLowerCase());
}

export function normalizeCrosschainLeg(leg = {}) {
  const kind = normalizeLegKind(leg.kind);
  const normalized = {
    ...leg,
    legIndex: normalizeNonNegativeInteger(leg.legIndex, "leg.legIndex"),
    kind,
    chainId: normalizeChainId(leg.chainId, "leg.chainId"),
    adapter: normalizeString(leg.adapter, "leg.adapter"),
    sellToken: normalizeString(leg.sellToken, "leg.sellToken"),
    buyToken: normalizeString(leg.buyToken, "leg.buyToken"),
    amountIn: normalizePositiveBigInt(leg.amountIn, "leg.amountIn"),
    amountOut: normalizePositiveBigInt(leg.amountOut, "leg.amountOut"),
    etaSeconds: normalizeNonNegativeInteger(leg.etaSeconds ?? 0, "leg.etaSeconds"),
    status: normalizeLegStatus(leg.status ?? "pending"),
    txHash: normalizeNullableString(leg.txHash),
    explorerUrl: normalizeNullableString(leg.explorerUrl),
  };

  if (kind !== "swap") {
    normalized.toChainId = normalizeChainId(leg.toChainId, "leg.toChainId");
  } else if (leg.toChainId !== undefined && leg.toChainId !== null) {
    normalized.toChainId = normalizeChainId(leg.toChainId, "leg.toChainId");
  }

  return normalized;
}

export function validateCrosschainLeg(leg = {}) {
  return normalizeCrosschainLeg(leg);
}

export function normalizeCrosschainLegs(legs = []) {
  if (!Array.isArray(legs) || legs.length === 0) fail("crosschain route requires at least one leg.");

  return legs.map((leg, index) => {
    const normalized = normalizeCrosschainLeg(leg);
    if (normalized.legIndex !== index) {
      fail(`crosschain legIndex ${normalized.legIndex} must match its route position ${index}.`);
    }
    return normalized;
  });
}

function routeEndpointChainIds(legs) {
  const first = legs[0];
  const last = legs[legs.length - 1];
  return {
    fromChainId: first.chainId,
    toChainId: last.toChainId ?? last.chainId,
  };
}

export function buildReadOnlyCrosschainRoute({
  sourceId,
  displayName = "Cross-chain preview",
  sellToken,
  buyToken,
  amountIn,
  amountOut,
  quoteTimestampMs = Date.now(),
  ttlMs = 60_000,
  legs,
  warnings = [],
  feeEstimate = null,
  score = null,
} = {}) {
  const normalizedLegs = normalizeCrosschainLegs(legs);
  const bridgeEtaWarning = normalizedLegs.some((leg) => leg.kind === "bridge" && leg.etaSeconds >= 14_400)
    ? ["bridge-relay-up-to-4h"]
    : [];
  const uniqueWarnings = [
    ...new Set([CROSSCHAIN_PREVIEW_WARNING, ...bridgeEtaWarning, ...warnings.map(String)]),
  ];
  const { fromChainId, toChainId } = routeEndpointChainIds(normalizedLegs);

  return {
    routeType: CROSSCHAIN_ROUTE_TYPE,
    sourceId: normalizeString(sourceId, "sourceId"),
    displayName,
    protocolType: CROSSCHAIN_PROTOCOL_TYPE,
    status: CROSSCHAIN_PREVIEW_STATUS,
    fromChainId,
    toChainId,
    sellToken: normalizeString(sellToken, "sellToken"),
    buyToken: normalizeString(buyToken, "buyToken"),
    quoteMode: "exactInput",
    amountIn: normalizePositiveBigInt(amountIn ?? normalizedLegs[0].amountIn, "amountIn"),
    amountOut: normalizePositiveBigInt(
      amountOut ?? normalizedLegs[normalizedLegs.length - 1].amountOut,
      "amountOut",
    ),
    etaSeconds: normalizedLegs.reduce((total, leg) => total + leg.etaSeconds, 0),
    quoteTimestampMs: normalizeNonNegativeInteger(quoteTimestampMs, "quoteTimestampMs"),
    ttlMs: normalizeNonNegativeInteger(ttlMs, "ttlMs"),
    warnings: uniqueWarnings,
    feeEstimate,
    score,
    legs: normalizedLegs,
  };
}

export function validateCrosschainRoute(route = {}) {
  if (route.routeType !== CROSSCHAIN_ROUTE_TYPE) fail("routeType must be crosschain.");
  if (route.protocolType !== CROSSCHAIN_PROTOCOL_TYPE) fail("protocolType must be crosschain.");
  if (route.status !== CROSSCHAIN_PREVIEW_STATUS) {
    fail(`crosschain phase-0 routes must be ${CROSSCHAIN_PREVIEW_STATUS}.`);
  }
  return buildReadOnlyCrosschainRoute(route);
}

function legExceededEta(leg, nowMs) {
  if (leg.status !== "submitted") return false;
  if (leg.submittedAtMs === undefined || leg.submittedAtMs === null) return false;
  const submittedAtMs = Number(leg.submittedAtMs);
  if (!Number.isFinite(submittedAtMs) || leg.etaSeconds <= 0) return false;
  return nowMs - submittedAtMs > leg.etaSeconds * 1_000;
}

export function deriveCrosschainOrderStatus(legs = [], { nowMs = Date.now() } = {}) {
  const normalizedLegs = normalizeCrosschainLegs(legs);

  if (normalizedLegs.every((leg) => leg.status === "confirmed")) return "success";
  if (normalizedLegs.some((leg) => leg.status === "refunded")) return "refunded";

  const failedIndex = normalizedLegs.findIndex((leg) => TERMINAL_FAILURES.has(leg.status));
  if (failedIndex >= 0) {
    const priorConfirmed = normalizedLegs
      .slice(0, failedIndex)
      .some((leg) => leg.status === "confirmed");
    return priorConfirmed ? "partial" : "failed";
  }

  if (
    normalizedLegs.some((leg) => leg.status === "delayed" || legExceededEta(leg, nowMs))
  ) {
    return "delayed";
  }

  if (normalizedLegs.some((leg) => ["awaiting-user", "submitted"].includes(leg.status))) {
    return "in-progress";
  }

  return "pending";
}
