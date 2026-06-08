// chartDatafeed.js — a REAL TradingView Datafeed for DogeSwap.
//
// HONESTY: DogeOS testnet has no on-chain OHLC / price oracle, so we do NOT
// fabricate candles. Instead this datafeed builds a price series *forward in
// time* from REAL on-chain quotes: it periodically asks /quote for the live
// price of 1 unit of the sell token in the buy token and aggregates those real
// ticks into OHLC bars at the chart's resolution. The accumulated real series
// is persisted in localStorage per pair+resolution so it grows across sessions.
//
// Everything returned to the charting library is real (the bars that exist were
// observed on-chain). When we have no observations yet, getBars returns
// { noData: true } — we never invent history.
import { fetchJson, DOGEOS_CHAIN_ID } from "./api.js";
import { decimalToUnits, unitsToNumber } from "./units.js";

// Poll the live price roughly every 10s (matches the swap's QUOTE_POLL_MS).
const TICK_POLL_MS = 10_000;
// Cap persisted bars per series so localStorage can't grow unbounded.
const MAX_BARS = 1500;
// Default slippage used for the price probe (50 bps, same as the swap default).
const PRICE_PROBE_SLIPPAGE_BPS = 50;

// Supported resolutions exposed in the TF drop-down. Strings are TradingView's
// resolution format (minutes as numbers, "1D" for one day).
export const SUPPORTED_RESOLUTIONS = ["1", "5", "15", "60", "240", "1D"];

// Resolution string -> bucket size in milliseconds. Bars are aligned to these.
function resolutionToMs(resolution) {
  const res = String(resolution ?? "60");
  if (res === "1D" || res === "1d" || res === "D") return 24 * 60 * 60 * 1000;
  if (res === "1W" || res === "W") return 7 * 24 * 60 * 60 * 1000;
  const minutes = Number.parseInt(res, 10);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
  return 60 * 60 * 1000; // default 1h
}

// Align a timestamp (ms) down to the start of its bar bucket.
function bucketStart(timeMs, bucketMs) {
  return Math.floor(timeMs / bucketMs) * bucketMs;
}

/* ---------- persistence (real series only) ---------- */
function storageKey(sellToken, buyToken, resolution) {
  const sell = (sellToken?.symbol ?? sellToken?.address ?? "?").toString();
  const buy = (buyToken?.symbol ?? buyToken?.address ?? "?").toString();
  return `doge.chart.${sell}-${buy}.${resolution}`;
}

function loadBars(key) {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Sanitize: keep only well-formed, finite, ascending-by-time bars.
    return parsed
      .filter(
        (b) =>
          b &&
          Number.isFinite(b.time) &&
          Number.isFinite(b.open) &&
          Number.isFinite(b.high) &&
          Number.isFinite(b.low) &&
          Number.isFinite(b.close),
      )
      .sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}

function saveBars(key, bars) {
  if (typeof localStorage === "undefined") return;
  try {
    const capped = bars.slice(-MAX_BARS);
    localStorage.setItem(key, JSON.stringify(capped));
  } catch {
    // Quota / private-mode failures must not break the chart.
  }
}

/* ---------- live price probe (REAL /quote) ---------- */
// Ask /quote for the price of 1 sell token in buy tokens. Returns a finite
// positive number (buy per sell) or null when the venue has no executable route.
async function probePrice({ chainId, sellToken, buyToken, signal }) {
  if (!sellToken?.address || !buyToken?.address) return null;
  const decimals = Number(sellToken.decimals ?? 18);
  let amountInUnits;
  try {
    amountInUnits = decimalToUnits("1", decimals); // exactly 1 unit of sell
  } catch {
    return null;
  }

  let response;
  try {
    // fetchJson directly (like useQuote) so the AbortSignal travels as a fetch
    // option and stays out of the JSON body.
    response = await fetchJson("/quote", {
      method: "POST",
      body: JSON.stringify({
        chainId,
        quoteMode: "exactInput",
        sellToken: sellToken.address,
        buyToken: buyToken.address,
        amountIn: amountInUnits,
        slippageBps: String(PRICE_PROBE_SLIPPAGE_BPS),
      }),
      ...(signal ? { signal } : {}),
    });
  } catch {
    return null;
  }

  const route = response?.best ?? response?.alternatives?.[0] ?? null;
  if (!route) return null;

  // price = amountOut(decimal) / amountIn(decimal). amountIn is exactly 1 unit,
  // so the price is just amountOut expressed in the buy token's decimals.
  const outNum = unitsToNumber(route.amountOut, Number(buyToken.decimals ?? 18));
  if (!Number.isFinite(outNum) || outNum <= 0) return null;
  return outNum;
}

/* ---------- bar aggregation ---------- */
// Fold a real price tick at `nowMs` into the persisted series for `resolution`.
// Returns the (new or updated) current bar so subscribeBars can emit it.
function appendTick({ key, bucketMs, price, nowMs }) {
  const bars = loadBars(key);
  const startMs = bucketStart(nowMs, bucketMs);
  const last = bars[bars.length - 1];

  let currentBar;
  if (last && last.time === startMs) {
    // Update the open bar in place with the real tick.
    currentBar = {
      time: last.time,
      open: last.open,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
    };
    bars[bars.length - 1] = currentBar;
  } else {
    // New bucket: open at the previous close when known (continuity), else this
    // tick. Either way every value is a real observed price.
    const openPrice = last ? last.close : price;
    currentBar = {
      time: startMs,
      open: openPrice,
      high: Math.max(openPrice, price),
      low: Math.min(openPrice, price),
      close: price,
    };
    bars.push(currentBar);
  }

  saveBars(key, bars);
  return currentBar;
}

/* ---------- the datafeed factory ---------- */
// makeDogeDatafeed({ sellToken, buyToken, chainId, paySym, getSym })
// sellToken/buyToken: { address, decimals, symbol } (the resolved swap tokens).
export function makeDogeDatafeed({
  sellToken,
  buyToken,
  chainId = DOGEOS_CHAIN_ID,
  paySym,
  getSym,
} = {}) {
  const symbolFull = `${paySym ?? sellToken?.symbol ?? "?"}/${getSym ?? buyToken?.symbol ?? "?"}`;
  // pricescale from the buy token's decimals (cap so the int stays sane).
  const quoteDecimals = Math.min(Number(buyToken?.decimals ?? 6), 12);
  const pricescale = Math.pow(10, Math.max(2, quoteDecimals > 8 ? 8 : quoteDecimals));

  const config = {
    supported_resolutions: SUPPORTED_RESOLUTIONS,
    supports_marks: false,
    supports_timescale_marks: false,
    supports_time: true,
    exchanges: [],
    symbols_types: [],
  };

  // Active subscription pollers, keyed by the library's listener guid.
  const subscriptions = new Map();

  return {
    onReady(callback) {
      // Must be async per the API contract.
      setTimeout(() => callback(config), 0);
    },

    searchSymbols(_userInput, _exchange, _symbolType, onResult) {
      onResult([]); // single synthetic symbol; no search surface.
    },

    resolveSymbol(_symbolName, onResolve, onError) {
      if (!sellToken?.address || !buyToken?.address) {
        onError?.("unknown_symbol");
        return;
      }
      const symbolInfo = {
        ticker: symbolFull,
        name: symbolFull,
        full_name: symbolFull,
        description: `${symbolFull} · live on-chain quote price`,
        type: "crypto",
        session: "24x7",
        timezone: "Etc/UTC",
        exchange: "DogeOS",
        listed_exchange: "DogeOS",
        format: "price",
        pricescale,
        minmov: 1,
        has_intraday: true,
        has_daily: true,
        has_weekly_and_monthly: false,
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        intraday_multipliers: ["1", "5", "15", "60", "240"],
        volume_precision: 0,
        data_status: "streaming",
        currency_code: buyToken?.symbol ?? getSym ?? "",
      };
      setTimeout(() => onResolve(symbolInfo), 0);
    },

    getBars(_symbolInfo, resolution, periodParams, onResult, onError) {
      try {
        const key = storageKey(sellToken, buyToken, resolution);
        const bars = loadBars(key);
        const fromMs = (periodParams?.from ?? 0) * 1000;
        const toMs = (periodParams?.to ?? Math.floor(Date.now() / 1000)) * 1000;

        // Return only the REAL bars that fall inside the requested window.
        const slice = bars.filter((b) => b.time >= fromMs && b.time < toMs);

        if (slice.length === 0) {
          // Honest: no fabricated history. noData=true on the first request so
          // the library shows its own empty state and we surface our overlay.
          onResult([], { noData: true });
          return;
        }
        onResult(slice, { noData: false });
      } catch (err) {
        onError?.(err?.message ?? "getBars failed");
      }
    },

    subscribeBars(_symbolInfo, resolution, onTick, listenerGuid, _onResetCacheNeeded) {
      const key = storageKey(sellToken, buyToken, resolution);
      const bucketMs = resolutionToMs(resolution);
      let stopped = false;
      let controller = null;

      const tick = async () => {
        if (stopped) return;
        controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const price = await probePrice({
          chainId,
          sellToken,
          buyToken,
          signal: controller?.signal,
        });
        if (stopped) return;
        if (Number.isFinite(price) && price > 0) {
          const bar = appendTick({ key, bucketMs, price, nowMs: Date.now() });
          try {
            onTick(bar); // emit/update the current REAL bar forward.
          } catch {
            // a library hiccup must not kill the poller.
          }
        }
      };

      // Probe immediately so a real bar appears as fast as the chain allows,
      // then keep polling on the interval.
      tick();
      const intervalId = setInterval(tick, TICK_POLL_MS);

      subscriptions.set(listenerGuid, {
        stop() {
          stopped = true;
          clearInterval(intervalId);
          try {
            controller?.abort();
          } catch {
            // ignore
          }
        },
      });
    },

    unsubscribeBars(listenerGuid) {
      const sub = subscriptions.get(listenerGuid);
      if (sub) {
        sub.stop();
        subscriptions.delete(listenerGuid);
      }
    },
  };
}

export default makeDogeDatafeed;
