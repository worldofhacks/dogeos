// Slider.jsx — derp.trade-style horizontal slider, TE-flavored.
// Faithful port of the design's slider.jsx (NOT knob.jsx): filled accent track,
// draggable thumb, detent ticks + preset buttons. Pointer + touch drag with a
// soft haptic on each step. Reduced-motion safe (transitions degrade via CSS).
import React, { useRef, useState } from "react";

import { useTheme } from "./theme.js";
import { haptic } from "./primitives.jsx";

export default function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
  accent,
  presets,
  valueColor,
}) {
  const th = useTheme();
  const acc = accent || th.accent;
  const trackRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const lastStepRef = useRef(value);

  const norm = Math.max(0, Math.min(1, (value - min) / (max - min)));

  const setFromClientX = (clientX) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let p = (clientX - r.left) / r.width;
    p = Math.max(0, Math.min(1, p));
    let v = min + p * (max - min);
    v = Math.round(v / step) * step;
    // guard against FP dust on fractional steps
    v = Math.round(v * 1e6) / 1e6;
    v = Math.max(min, Math.min(max, v));
    if (v !== lastStepRef.current) {
      lastStepRef.current = v;
      haptic(4);
      onChange(v);
    }
  };

  const onDown = (e) => {
    e.preventDefault();
    setDrag(true);
    haptic(8);
    const getX = (ev) => (ev.touches ? ev.touches[0].clientX : ev.clientX);
    setFromClientX(getX(e));
    const move = (ev) => {
      ev.preventDefault();
      setFromClientX(getX(ev));
    };
    const up = () => {
      setDrag(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
  };

  const disp = format ? format(value) : value;

  return (
    <div style={{ width: "100%", userSelect: "none" }}>
      {/* header: label + current value */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 11,
        }}
      >
        <span className="te-label" style={{ color: th.mute }}>
          {label}
        </span>
        <span
          className="te-num"
          style={{
            fontFamily: "'DM Mono',monospace",
            fontSize: 13,
            fontWeight: 500,
            color: valueColor || th.ink,
          }}
        >
          {disp}
        </span>
      </div>

      {/* track */}
      <div
        ref={trackRef}
        onMouseDown={onDown}
        onTouchStart={onDown}
        style={{
          position: "relative",
          height: 22,
          display: "flex",
          alignItems: "center",
          cursor: "pointer",
          touchAction: "none",
        }}
      >
        <div
          style={{ position: "absolute", left: 0, right: 0, height: 6, borderRadius: 4, background: th.hair }}
        />
        {/* detent ticks */}
        {presets &&
          presets.map((p) => {
            const pn = (p.value - min) / (max - min);
            return (
              <span
                key={p.value}
                style={{
                  position: "absolute",
                  left: `${pn * 100}%`,
                  width: 2,
                  height: 10,
                  borderRadius: 2,
                  background: th.hairHi,
                  transform: "translateX(-50%)",
                }}
              />
            );
          })}
        {/* filled */}
        <div
          style={{
            position: "absolute",
            left: 0,
            width: `${norm * 100}%`,
            height: 6,
            borderRadius: 4,
            background: acc,
            transition: drag ? "none" : "width var(--t-fast) var(--ease-out)",
          }}
        />
        {/* thumb */}
        <div
          style={{
            position: "absolute",
            left: `${norm * 100}%`,
            transform: `translateX(-50%) scale(${drag ? 1.18 : 1})`,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: th.dark
              ? "radial-gradient(circle at 38% 30%, #4a4a40, #26261f)"
              : "radial-gradient(circle at 38% 30%, #fff, #eceadf)",
            boxShadow: drag
              ? `0 0 0 2px ${acc}, 0 4px 10px rgba(0,0,0,0.3)`
              : `inset 0 0 0 1px ${th.hairHi}, 0 2px 5px rgba(0,0,0,0.2)`,
            transition: drag
              ? "transform var(--t-fast) var(--ease-spring)"
              : "transform var(--t-fast) var(--ease-spring), left var(--t-fast) var(--ease-out), box-shadow var(--t-fast)",
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: 0,
              margin: "auto",
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: acc,
            }}
          />
        </div>
      </div>

      {/* presets */}
      {presets && (
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {presets.map((p) => {
            const active = Math.abs(value - p.value) < step / 2;
            return (
              <button
                key={p.value}
                className="tap"
                onClick={() => {
                  haptic(6);
                  onChange(p.value);
                  lastStepRef.current = p.value;
                }}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  borderRadius: 7,
                  cursor: "pointer",
                  border: `1px solid ${active ? acc : th.hair}`,
                  background: active ? acc : th.panelHi,
                  color: active ? th.onAccent : th.inkSoft,
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 11,
                  letterSpacing: "0.04em",
                  transition:
                    "background var(--t-fast), border-color var(--t-fast), color var(--t-fast)",
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
