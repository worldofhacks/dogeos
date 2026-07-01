// quote.js — framework-agnostic helpers over the /quote response shape.
//
// /quote returns { status, best, alternatives, rejected, warnings, expiresAtMs,
// telemetry }. Each route carries: sourceId, amountIn, amountOut, minAmountOut
// (a.k.a. minimumOutput), gasUnits, router, status, quoteMode, protocolType,
// routeType, and feeEstimate { executionFeeWei, dataFinalityFeeWei, totalFeeWei }.
//
// These helpers pull REAL fields only. Price impact IS real when present: the
// backend computes priceImpactBps per route from on-chain reserves (V2) or
// sqrtPriceX96 (concentrated liquidity). It is absent on synthetic split routes,
// where we show "—" rather than fabricate one. We never synthesize USD values
// (no price feed).
import { unitsToDecimal, unitsToNumber } from "./units.js";

export const QUOTE_DEBOUNCE_MS = 250;
export const QUOTE_POLL_MS = 10_000;
// When the backend answers status:"unavailable" (a transient RPC slowness, not a
// real no-route), re-poll fast instead of the normal 10s cadence so a flicker
// resolves into a route in ~1-2 ticks. Capped (MAX_TRANSIENT_RETRIES) so a
// sustained outage settles back to the normal poll rather than spinning forever.
export const QUOTE_RETRY_MS = 1_500;
export const MAX_TRANSIENT_RETRIES = 6;

/* ---------- timing ---------- */
// The auto-refresh cadence in seconds. The swap panel's freshness countdown +
// ring are anchored to THIS (not the server quote TTL, ~5s) so "refresh in Ns"
// reaches 0 exactly when the next poll re-quotes — the server TTL is shorter
// than the poll, which used to strand the countdown sitting at 0.
export function refreshCycleSeconds() {
  return Math.round(QUOTE_POLL_MS / 1000);
}

// Real server-side validity of the quote in seconds, from the best route's
// ttlMs — the review screen counts this down and blocks once a quote actually
// goes stale. Falls back to the refresh cadence when the backend omits a ttlMs.
export function quoteTtlSeconds(quote) {
  const ttlMs = quote?.best?.ttlMs;
  if (ttlMs !== undefined && ttlMs !== null && Number(ttlMs) > 0) {
    return Math.max(1, Math.round(Number(ttlMs) / 1000));
  }
  return refreshCycleSeconds();
}

/* ---------- route extraction ---------- */
// Flatten best + alternatives into a single ranked "venue list" for the scan UI.
// best first (winner), then alternatives in backend order (already best→worst).
export function venueRows(quote) {
  if (!quote) return [];
  const rows = [];
  if (quote.best) rows.push({ ...quote.best, isBest: true });
  for (const alt of quote.alternatives ?? []) rows.push({ ...alt, isBest: false });
  return rows;
}

// Count of executable routes (best + alternatives) — the "best of N".
export function executableRouteCount(quote) {
  const telemetryCount = Number(quote?.telemetry?.executableCandidateCount);
  if (Number.isFinite(telemetryCount) && telemetryCount > 0) return telemetryCount;
  return venueRows(quote).length;
}

/* ---------- amount math ---------- */
// A route's output as a JS number in the buy token's decimals.
export function routeOutputNumber(route, buyToken) {
  if (!route || !buyToken) return 0;
  return unitsToNumber(route.amountOut, buyToken.decimals);
}

export function routeOutputDecimal(route, buyToken, precision = 6) {
  if (!route || !buyToken) return "-";
  return unitsToDecimal(route.amountOut, buyToken.decimals, precision);
}

// min received (after slippage) for the best route.
export function minReceivedDecimal(route, buyToken, precision = 6) {
  if (!route || !buyToken) return "-";
  const min = route.minAmountOut ?? route.minimumOutput ?? route.amountOut;
  return unitsToDecimal(min, buyToken.decimals, precision);
}

// Price impact for a route as a JS number in percent, or null when the route
// carries no measured impact (e.g. synthetic split routes). REAL: derived from
// the backend's priceImpactBps (on-chain reserves / sqrtPriceX96), never faked.
export function priceImpactPercent(route) {
  const bps = route?.priceImpactBps;
  if (bps === undefined || bps === null) return null;
  const n = Number(bps);
  if (!Number.isFinite(n) || n < 0) return null;
  return n / 100;
}

// Effective rate: 1 sell = X buy, from the best route's actual amounts.
export function effectiveRate(route, sellToken, buyToken) {
  if (!route || !sellToken || !buyToken) return null;
  const inN = unitsToNumber(route.amountIn, sellToken.decimals);
  const outN = unitsToNumber(route.amountOut, buyToken.decimals);
  if (!Number.isFinite(inN) || !Number.isFinite(outN) || inN <= 0 || outN <= 0) return null;
  return outN / inN;
}

// Per-venue deficit vs the winner, as a positive percent (e.g. 0.42 -> "−0.42%").
export function venueDeficitPercent(route, bestRoute, buyToken) {
  const bestOut = routeOutputNumber(bestRoute, buyToken);
  const out = routeOutputNumber(route, buyToken);
  if (!bestOut || !out) return 0;
  return (1 - out / bestOut) * 100;
}

// Saving of the winner vs the runner-up, positive percent.
export function bestVsNextPercent(quote, buyToken) {
  const rows = venueRows(quote);
  if (rows.length < 2) return 0;
  const best = routeOutputNumber(rows[0], buyToken);
  const next = routeOutputNumber(rows[1], buyToken);
  if (!best || !next) return 0;
  return (best / next - 1) * 100;
}

/* ---------- network fee (REAL, derived from the quote) ---------- */
// The backend already computes feeEstimate.totalFeeWei = gasUnits * gasPrice +
// DogeOS data/finality fee. We surface that as DOGE (18 decimals), plus the
// user's gas-speed tip (gasUnits * priorityFeeGwei) so eco/normal/fast
// actually move the displayed estimate the way they move the paid fee.
// Returns null when the route didn't include a fee estimate (UI shows "—").
export function networkFeeDoge(route, precision = 6, priorityFeeGwei = 0) {
  const totalWei = route?.feeEstimate?.totalFeeWei ?? route?.score?.totalFeeWei;
  if (totalWei === undefined || totalWei === null) return null;
  try {
    let wei = BigInt(totalWei);
    if (Number.isFinite(priorityFeeGwei) && priorityFeeGwei > 0 && route?.gasUnits != null) {
      wei += BigInt(route.gasUnits) * BigInt(Math.round(priorityFeeGwei * 1e9));
    }
    const decimal = unitsToDecimal(wei, 18, precision);
    if (decimal === "-") return null;
    // trim trailing zeros for a tidy "~0.0018 Ð"
    return decimal.includes(".") ? decimal.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "") : decimal;
  } catch {
    return null;
  }
}

// Gas units for the best route (shown alongside the network fee), or null.
export function routeGasUnits(route) {
  const gas = route?.gasUnits;
  if (gas === undefined || gas === null) return null;
  try {
    return BigInt(gas).toString();
  } catch {
    return String(gas);
  }
}

/* ---------- request body ---------- */
// Build the exactInput /quote payload. `amountInUnits` must already be base units.
export function buildQuoteBody({ chainId, sellToken, buyToken, amountInUnits, slippageBps }) {
  return {
    chainId,
    quoteMode: "exactInput",
    sellToken,
    buyToken,
    amountIn: amountInUnits,
    slippageBps: String(slippageBps),
  };
}
