// useSettings.js — app-level trade-defaults + appearance store, persisted to
// localStorage and shared via context.
//
// The Settings view writes these; SwapView reads the default slippage (the
// in-swap slider still overrides per-trade) and SwapFlow reads the tx deadline
// (threaded into execution). Theme (dark + accent) is also persisted here and
// wired to useTheme() at the Shell level.
//
// Shape:
//   slippage  — default slippage tolerance, percent (0.5 / 5 / 25 / 50=MAX)
//   gas       — gas-speed priority fee (gwei); tier derived via gasTier()
//   deadline  — tx deadline, minutes (10 / 20 / 30)
//   expert    — expert mode (allow high price impact / skip confirms)
//   dark      — dark device shell
//   accent    — signal accent color
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { DEFAULT_ACCENT } from "./theme.js";

const STORAGE_KEY = "doge.settings";

// Gas tier ↔ priority-fee presets (ported from the design's core.jsx).
export const GAS_PRESETS = { eco: 1, normal: 2, fast: 12 };
export function gasTier(g) {
  return g < 1.5 ? "eco" : g <= 6 ? "normal" : "fast";
}

export const DEFAULTS = Object.freeze({
  slippage: 0.5,
  gas: GAS_PRESETS.normal,
  deadline: 20,
  expert: false,
  dark: false,
  accent: DEFAULT_ACCENT,
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
      setSlippage: (slippage) => update({ slippage }),
      setGas: (gas) => update({ gas }),
      setDeadline: (deadline) => update({ deadline }),
      setExpert: (expert) => update({ expert }),
      setDark: (dark) => update({ dark }),
      setAccent: (accent) => update({ accent }),
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
    setExpert: () => {},
    setDark: () => {},
    setAccent: () => {},
  };
}
