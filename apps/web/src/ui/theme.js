// theme.js — DogeSwap theme tokens + React provider/hook.
// Ported from the design's core.jsx makeTheme() (light/dark token sets) and the
// brand gold. Theme is user-selectable: light/dark + 4 accents.
import React, { createContext, useContext, useMemo } from "react";

// Default accent + the selectable accent set, per the design brief.
export const DEFAULT_ACCENT = "#ff4d2e";
export const ACCENTS = ["#ff4d2e", "#ffcf2e", "#2e6bff", "#1f9d57"];

// Light accents need dark text for contrast.
const LIGHT_ACCENTS = ["#ffcf2e", "#ffd60a", "#FED70B"];

export function makeTheme(dark, accent = DEFAULT_ACCENT) {
  const base = dark
    ? {
        shell: "#100f0e",
        bg: "#16150f",
        panel: "#1d1d19",
        panelHi: "#26261f",
        screen: "#1a1a16",
        ink: "#f1efe6",
        inkSoft: "#b7b4a8",
        mute: "#79766b",
        hair: "#33332c",
        hairHi: "#3d3d35",
        chartUp: "#5fd08a",
        chartDown: "#ff5a3c",
        grid: "rgba(255,255,255,0.05)",
      }
    : {
        shell: "#dad8cf",
        bg: "#e7e5dd",
        panel: "#f4f3ee",
        panelHi: "#fbfaf6",
        screen: "#f4f3ee",
        ink: "#1c1c1c",
        inkSoft: "#56544b",
        mute: "#8a8779",
        hair: "#d8d6cd",
        hairHi: "#e6e4db",
        chartUp: "#1f9d57",
        chartDown: "#ff4d2e",
        grid: "rgba(0,0,0,0.05)",
      };

  const onAccent = LIGHT_ACCENTS.includes(accent) ? "#1c1c1c" : "#ffffff";
  return { dark, accent, onAccent, gold: "#FED70B", ...base };
}

export const ThemeCtx = createContext(makeTheme(false, DEFAULT_ACCENT));
export const useTheme = () => useContext(ThemeCtx);

export function ThemeProvider({ dark = false, accent = DEFAULT_ACCENT, children }) {
  const theme = useMemo(() => makeTheme(dark, accent), [dark, accent]);
  return React.createElement(ThemeCtx.Provider, { value: theme }, children);
}
