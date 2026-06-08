// useSwapExecution.js — React hook over lib/execute.js's executeSwap().
//
// Owns the execution state machine for the SwapFlow modal: idle → approving →
// swapping → success | error. It binds the live best route to the connected
// wallet, runs /approval (ERC-20 only) then /swap, polls the receipt, logs the
// confirmed swap to activity, and surfaces friendly errors. The flow is never
// left stuck: pending is non-dismissible, but success/error are dismissible.
import { useCallback, useRef, useState } from "react";

import { executeSwap, logSwapActivity, transactionErrorMessage } from "../lib/execute.js";

// status: 'idle' | 'approving' | 'swapping' | 'success' | 'error'
// phase mirrors execute.js's lifecycle phases (for sub-step labels).
const INITIAL = {
  status: "idle",
  phase: null,
  hash: "",
  approvalHash: "",
  receipt: null,
  recv: 0,
  error: "",
};

export function useSwapExecution() {
  const [state, setState] = useState(INITIAL);
  const abortRef = useRef(null);
  const runningRef = useRef(false);

  const reset = useCallback(() => {
    setState(INITIAL);
    runningRef.current = false;
  }, []);

  // Run the full review→approval→swap→receipt path. `recv` is the estimated
  // received amount (JS number) used for the success screen + activity log.
  const run = useCallback(
    async ({ bestRoute, sellToken, buyToken, sender, slippageBps, payAmt, recv, venue }) => {
      if (runningRef.current) return;
      runningRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      setState({ ...INITIAL, status: "approving", phase: "approve-check" });

      try {
        const { txHash, receipt } = await executeSwap({
          bestRoute,
          sellToken,
          sender,
          slippageBps,
          signal: controller.signal,
          report: ({ phase, hash }) => {
            setState((prev) => {
              const next = { ...prev, phase };
              if (phase === "approve-pending" || phase === "approve-done") {
                next.approvalHash = hash ?? prev.approvalHash;
              }
              if (phase === "swap-pending") {
                next.hash = hash ?? prev.hash;
              }
              // Status flips to 'swapping' once approval is done / not needed.
              if (phase === "swap-build" || phase === "swap-sign" || phase === "swap-pending") {
                next.status = "swapping";
              }
              return next;
            });
          },
        });

        // Log the confirmed swap to activity (localStorage 'doge.history').
        logSwapActivity({
          paySym: sellToken?.symbol ?? "",
          getSym: buyToken?.symbol ?? "",
          payAmt: Number.parseFloat(payAmt) || 0,
          recv: Number(recv) || 0,
          venue: venue ?? "",
          hash: txHash,
          ts: Date.now(),
        });

        setState((prev) => ({
          ...prev,
          status: "success",
          phase: "confirmed",
          hash: txHash,
          receipt,
          recv: Number(recv) || 0,
        }));
      } catch (error) {
        setState((prev) => ({
          ...prev,
          status: "error",
          error: transactionErrorMessage(error),
        }));
      } finally {
        runningRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [],
  );

  return {
    ...state,
    // pending = mid-flight (non-dismissible); not success/error/idle.
    isPending: state.status === "approving" || state.status === "swapping",
    run,
    reset,
  };
}
