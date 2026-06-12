// useSettings.js — app-level trade-defaults + appearance store, persisted to
// localStorage and shared via context.
//
// The Settings view writes these; SwapView reads the default slippage (the
// in-swap slider still overrides per-trade) and SwapFlow threads the tx
// deadline + gas-speed tip into execution. Theme (dark) is also persisted here
// and wired to useTheme() at the Shell level.
//
// Shape:
//   slippage  — default slippage tolerance, percent. Presets cap at 5%; higher
//               is a typed custom value (expert gate), clamped to MAX_SLIPPAGE_PERCENT.
//   gas       — gas-speed sequencer tip (DOGE gwei), sent as the tx
//               maxPriorityFeePerGas; tier derived via gasTier()
//   deadline  — tx deadline, minutes (10 / 20 / 30)
//   dark      — dark device shell
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "doge.settings";

// Gas tier ↔ priority-fee presets (ported from the design's core.jsx).
export const GAS_PRESETS = { eco: 1, normal: 2, fast: 12 };
export function gasTier(g) {
  return g < 1.5 ? "eco" : g <= 6 ? "normal" : "fast";
}

// Slippage UI bounds. Quick presets stop at 5%; anything higher must be typed
// as a custom value (the "expert gate") and is hard-clamped to MAX so the UI can
// never request a tolerance the server (50% ceiling) would reject. Kept in sync
// with quoteService.MAX_SLIPPAGE_BPS.
export const SLIPPAGE_PRESETS = [0.1, 0.5, 1, 5];
export const MAX_SLIPPAGE_PERCENT = 50;
export function clampSlippagePercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_SLIPPAGE_PERCENT);
}

export const DEFAULTS = Object.freeze({
  slippage: 0.5,
  gas: GAS_PRESETS.normal,
  deadline: 20,
  dark: false,
});

function readStored() {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const SettingsCtx = createContext(null);

// Provider — owns the persisted settings state. Mount once near the app root.
export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => ({ ...DEFAULTS, ...readStored() }));

  // Persist on every change (best-effort; quota/SSR-safe).
  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* non-fatal */
    }
  }, [settings]);

  const update = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo(
    () => ({
      ...settings,
      slippageBps: Math.round(settings.slippage * 100),
      deadlineMs: settings.deadline * 60 * 1000,
      setSlippage: (slippage) => update({ slippage: clampSlippagePercent(slippage) }),
      setGas: (gas) => update({ gas }),
      setDeadline: (deadline) => update({ deadline }),
      setDark: (dark) => update({ dark }),
    }),
    [settings, update],
  );

  return React.createElement(SettingsCtx.Provider, { value }, children);
}

// Hook — returns the live settings + setters. Falls back to DEFAULTS if used
// outside a provider (keeps components resilient in isolation/tests).
export function useSettings() {
  const ctx = useContext(SettingsCtx);
  if (ctx) return ctx;
  return {
    ...DEFAULTS,
    slippageBps: Math.round(DEFAULTS.slippage * 100),
    deadlineMs: DEFAULTS.deadline * 60 * 1000,
    setSlippage: () => {},
    setGas: () => {},
    setDeadline: () => {},
    setDark: () => {},
  };
}
