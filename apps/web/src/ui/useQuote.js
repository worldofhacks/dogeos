// useQuote.js — the live quote state machine, ported from app.js's
// scheduleQuoteRefresh / requestQuote loop into a React hook.
//
// Behaviour preserved 1:1 from the DOM app:
//   • debounce: wait QUOTE_DEBOUNCE_MS after the last input change before firing.
//   • poll:     after a successful quote, re-quote every QUOTE_POLL_MS (~10s).
//   • seq-guard: a monotonically increasing request id; stale responses (older
//                than the latest issued id) are dropped so a slow earlier request
//                can never clobber a newer one.
//   • abort:    each new request aborts the in-flight one via AbortController.
//   • expiry:   a 1s ticker recomputes seconds-to-expiry from expiresAtMs so the
//                countdown ring stays honest even if a poll is late.
//
// Inputs are the *resolved* sell/buy tokens, the decimal amount string, and
// slippage in bps. When the amount is empty/zero we clear the quote and idle.
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchJson } from "../lib/api.js";
import { decimalToUnits } from "../lib/units.js";
import {
  QUOTE_DEBOUNCE_MS,
  QUOTE_POLL_MS,
  buildQuoteBody,
  quoteExpiresInSeconds,
} from "../lib/quote.js";

const IDLE = { quote: null, status: "idle", error: "" };

export function useQuote({ chainId, sellToken, buyToken, amount, slippageBps }) {
  const [quote, setQuote] = useState(null);
  // 'idle' | 'scanning' | 'ready' | 'error'
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(null);

  // Mutable refs that must not trigger re-renders.
  const seqRef = useRef(0);
  const controllerRef = useRef(null);
  const debounceRef = useRef(null);
  const pollRef = useRef(null);

  const amountStr = String(amount ?? "").trim();
  const amountNum = Number.parseFloat(amountStr) || 0;
  const hasAmount = amountNum > 0;

  // Stable inputs key — any change re-arms the debounce.
  const inputsKey = [
    chainId,
    sellToken?.address ?? "",
    buyToken?.address ?? "",
    sellToken?.decimals ?? "",
    amountStr,
    slippageBps,
  ].join("|");

  const clearTimers = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const abortInFlight = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
  }, []);

  // Fire one /quote request, guarded by a sequence id + AbortController.
  const runQuote = useCallback(async () => {
    if (!sellToken || !buyToken || !hasAmount) return;

    let amountInUnits;
    try {
      amountInUnits = decimalToUnits(amountStr, sellToken.decimals);
    } catch (err) {
      setStatus("error");
      setError(err.message);
      return;
    }

    const seq = ++seqRef.current;
    abortInFlight();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("scanning");
    setError("");

    try {
      const body = buildQuoteBody({
        chainId,
        sellToken: sellToken.address,
        buyToken: buyToken.address,
        amountInUnits,
        slippageBps,
      });
      // Use fetchJson directly (not postQuote) so the AbortSignal stays out of
      // the JSON body and travels as a real fetch option.
      const next = await fetchJson("/quote", {
        method: "POST",
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // Drop stale responses (a newer request was issued meanwhile).
      if (seq !== seqRef.current) return;

      setQuote(next);
      setStatus("ready");
      setSecondsLeft(quoteExpiresInSeconds(next));
    } catch (err) {
      if (err?.name === "AbortError") return;
      if (seq !== seqRef.current) return;
      setQuote(null);
      setStatus("error");
      setError(err?.message ?? "Quote failed.");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      // Only the latest request schedules the next poll tick.
      if (seq === seqRef.current && hasAmount) {
        if (pollRef.current) clearTimeout(pollRef.current);
        pollRef.current = setTimeout(() => runQuote(), QUOTE_POLL_MS);
      }
    }
  }, [chainId, sellToken, buyToken, hasAmount, amountStr, slippageBps, abortInFlight]);

  // Manual tap-to-refresh (the freshness line / countdown ring).
  const refresh = useCallback(() => {
    if (!hasAmount) return;
    clearTimers();
    runQuote();
  }, [hasAmount, clearTimers, runQuote]);

  // Debounced (re)scan whenever inputs change.
  useEffect(() => {
    clearTimers();
    abortInFlight();

    if (!sellToken || !buyToken || !hasAmount) {
      // bump the seq so any in-flight response is ignored, then idle.
      seqRef.current += 1;
      setQuote(null);
      setStatus("idle");
      setError("");
      setSecondsLeft(null);
      return undefined;
    }

    setStatus("scanning");
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      runQuote();
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputsKey]);

  // 1s expiry ticker — keeps the countdown ring accurate between polls.
  useEffect(() => {
    if (status !== "ready" || !quote?.expiresAtMs) {
      return undefined;
    }
    const id = setInterval(() => {
      setSecondsLeft(quoteExpiresInSeconds(quote));
    }, 1000);
    return () => clearInterval(id);
  }, [status, quote]);

  // Cleanup on unmount.
  useEffect(() => () => {
    clearTimers();
    abortInFlight();
  }, [clearTimers, abortInFlight]);

  return {
    quote,
    status, // 'idle' | 'scanning' | 'ready' | 'error'
    error,
    secondsLeft,
    refresh,
    isScanning: status === "scanning",
    isReady: status === "ready",
  };
}

export { IDLE };
