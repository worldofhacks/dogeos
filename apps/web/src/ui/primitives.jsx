// primitives.jsx — shared bits ported from the design's core.jsx (format helpers,
// useIsMobile, haptic, Label, TokenIcon) and the Seg segmented control from
// settings.jsx, plus address truncation + timeAgo from activity.jsx.
import React, { useEffect, useState } from "react";
import { useTheme } from "./theme.js";

/* ---------- format helpers (core.jsx) ---------- */
export function fmt(n, dp = 2) {
  if (n === 0) return (0).toFixed(dp);
  if (Math.abs(n) < 0.001 && n !== 0) return n.toPrecision(3);
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtUsd(n) {
  if (n >= 1) return "$" + fmt(n, 2);
  return "$" + n.toPrecision(2);
}

// compact balance: 1.2M / 4.3k / 920
export function compact(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return fmt(n, 0);
}

// 0x1234…cdef address truncation
export function truncateAddress(address, lead = 6, tail = 4) {
  if (!address) return "-";
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

// relative time (activity.jsx)
export function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}

/* ---------- responsive + haptic helpers (core.jsx) ---------- */
// viewport <= bp ? mobile
export function useIsMobile(bp = 760) {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth <= bp : false);
  useEffect(() => {
    const f = () => setM(window.innerWidth <= bp);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, [bp]);
  return m;
}

// soft haptic tick on supporting devices
export function haptic(ms = 8) {
  try {
    navigator.vibrate && navigator.vibrate(ms);
  } catch (e) {
    /* no-op */
  }
}

/* ---------- primitives ---------- */
// tiny uppercase mono label / eyebrow
export function Label({ children, color, style }) {
  const th = useTheme();
  return (
    <span className="te-label" style={{ color: color || th.mute, ...style }}>
      {children}
    </span>
  );
}

// circular token glyph chip
export function TokenIcon({ token, size = 26 }) {
  const t = token || {};
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: t.color || "#888",
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Space Grotesk',sans-serif",
        fontWeight: 700,
        fontSize: size * 0.5,
        lineHeight: 1,
        flexShrink: 0,
        boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.25)",
      }}
    >
      {t.glyph || t.sym?.[0] || "?"}
    </span>
  );
}

// shimmer skeleton bar (core.jsx) — theme-aware; uses the .shimmer keyframe from
// global.css and degrades to a flat visible bar if the animation stalls.
export function Skeleton({ w = "100%", h = 14, r = 6, style }) {
  const th = useTheme();
  const a = th.dark ? "rgba(255,255,255,0.055)" : "rgba(0,0,0,0.05)";
  const b = th.dark ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.11)";
  return (
    <span
      className="shimmer"
      style={{
        display: "inline-block",
        width: w,
        height: h,
        borderRadius: r,
        background: `linear-gradient(90deg, ${a} 25%, ${b} 50%, ${a} 75%)`,
        ...style,
      }}
    />
  );
}

// segmented control (ported from settings.jsx Seg)
export function Seg({ value, options, onChange, fmt: fmtLabel }) {
  const th = useTheme();
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: 3,
        background: th.panelHi,
        border: `1px solid ${th.hair}`,
        borderRadius: 9,
      }}
    >
      {options.map((o) => (
        <button
          key={o}
          className="tap"
          onClick={() => onChange(o)}
          style={{
            padding: "7px 13px",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            fontFamily: "'DM Mono',monospace",
            fontSize: 12,
            background: value === o ? th.accent : "transparent",
            color: value === o ? th.onAccent : th.inkSoft,
          }}
        >
          {fmtLabel ? fmtLabel(o) : o}
        </button>
      ))}
    </div>
  );
}
