// ChartView.jsx — the CHART chrome. Faithful port of the design's chart.jsx
// ChartHead / ChartPanel / ChartPopout (TF pills, pop-out, close; docked beside
// the swap on desktop, slide-up sheet on mobile with drag-dismiss).
//
// HONESTY: DogeOS testnet has NO on-chain OHLC / price feed, so we do NOT
// fabricate candles and do NOT pull in lightweight-charts. The canvas area
// renders an honest empty state ("price chart coming soon — no on-chain OHLC
// feed on DogeOS testnet yet") with the pair + the design's styling. The toggle,
// pop-out and responsive behavior all work; a real datafeed/indexer is a future
// task.
import React, { useRef, useState } from "react";

import { useTheme } from "./theme.js";
import { Label, useIsMobile } from "./primitives.jsx";

const TIMEFRAMES = ["1H", "4H", "1D"];

// header strip shared by docked + popout
function ChartHead({ pay, get, tf, setTf, onPop, onClose, popped }) {
  const th = useTheme();
  const paySym = pay?.symbol ?? pay?.sym ?? "—";
  const getSym = get?.symbol ?? get?.sym ?? "—";
  const pill = (k) => ({
    padding: "5px 10px",
    borderRadius: 6,
    cursor: "pointer",
    fontFamily: "'DM Mono',monospace",
    fontSize: 11,
    letterSpacing: "0.04em",
    border: `1px solid ${tf === k ? th.accent : th.hair}`,
    background: tf === k ? th.accent : "transparent",
    color: tf === k ? th.onAccent : th.inkSoft,
  });
  const iconBtn = {
    width: 30,
    height: 30,
    borderRadius: 7,
    border: `1px solid ${th.hair}`,
    background: th.panelHi,
    color: th.inkSoft,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>
          {paySym}/{getSym}
        </span>
        {/* Honesty: no last price / change — no price feed. */}
        <Label color={th.mute}>no live price feed</Label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {TIMEFRAMES.map((k) => (
          <button key={k} className="tap" style={pill(k)} onClick={() => setTf(k)}>
            {k}
          </button>
        ))}
        <span style={{ width: 1, height: 18, background: th.hair, margin: "0 2px" }} />
        {onPop && (
          <button className="tap" style={iconBtn} onClick={onPop} title="pop out">
            ⤢
          </button>
        )}
        {onClose && (
          <button className="tap" style={iconBtn} onClick={onClose} title={popped ? "close" : "hide chart"}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

// honest empty canvas — no fabricated candles
function ChartEmpty({ pay, get }) {
  const th = useTheme();
  const paySym = pay?.symbol ?? pay?.sym ?? "—";
  const getSym = get?.symbol ?? get?.sym ?? "—";
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 220,
        borderRadius: 12,
        border: `1px dashed ${th.hair}`,
        background:
          "repeating-linear-gradient(0deg, transparent, transparent 31px, " +
          th.grid +
          " 31px, " +
          th.grid +
          " 32px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        textAlign: "center",
        padding: 24,
      }}
    >
      {/* flat baseline mark — explicitly NOT a price line */}
      <svg width="120" height="40" viewBox="0 0 120 40" aria-hidden="true">
        <line
          x1="6"
          y1="20"
          x2="114"
          y2="20"
          stroke={th.hair}
          strokeWidth="2"
          strokeDasharray="4 5"
          strokeLinecap="round"
        />
      </svg>
      <div style={{ fontWeight: 700, fontSize: 15, color: th.inkSoft }}>
        {paySym}/{getSym}
      </div>
      <Label
        color={th.mute}
        style={{ textTransform: "none", letterSpacing: 0, fontSize: 12.5, maxWidth: 320, lineHeight: 1.5 }}
      >
        price chart coming soon — no on-chain OHLC feed on DogeOS testnet yet
      </Label>
    </div>
  );
}

// docked chart panel (lives beside the swap on desktop)
export function ChartPanel({ pay, get, onClose, onPop }) {
  const th = useTheme();
  const [tf, setTf] = useState("1H");

  return (
    <div
      style={{
        background: th.screen,
        border: `1px solid ${th.hair}`,
        borderRadius: 16,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        minHeight: 0,
        flex: 1,
        boxShadow: th.dark ? "none" : "inset 0 1px 0 #fff",
      }}
    >
      <ChartHead pay={pay} get={get} tf={tf} setTf={setTf} onPop={onPop} onClose={onClose} />
      <div style={{ flex: 1, minHeight: 240 }}>
        <ChartEmpty pay={pay} get={get} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Label>on-chain oracle · pending</Label>
        <Label color={th.mute}>DogeOS testnet</Label>
      </div>
    </div>
  );
}

// fullscreen popout overlay (desktop centered dialog · mobile bottom sheet)
export function ChartPopout({ pay, get, onClose }) {
  const th = useTheme();
  const mobile = useIsMobile();
  const [tf, setTf] = useState("1H");
  const [closing, setClosing] = useState(false);
  const sheetRef = useRef(null);

  const close = () => {
    setClosing(true);
    setTimeout(onClose, 240);
  };

  // drag-to-dismiss on the mobile sheet handle
  const onHandleDown = (e) => {
    if (!mobile) return;
    const y0 = e.touches ? e.touches[0].clientY : e.clientY;
    let dy = 0;
    const move = (ev) => {
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
      dy = Math.max(0, y - y0);
      if (sheetRef.current) {
        sheetRef.current.style.transition = "none";
        sheetRef.current.style.transform = `translateY(${dy}px)`;
      }
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      if (sheetRef.current) sheetRef.current.style.transition = "";
      if (dy > 90) close();
      else if (sheetRef.current) sheetRef.current.style.transform = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
  };

  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: th.dark ? "rgba(0,0,0,0.6)" : "rgba(40,38,30,0.45)",
        display: "flex",
        alignItems: mobile ? "flex-end" : "center",
        justifyContent: "center",
        padding: mobile ? 0 : "3vmin",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        opacity: closing ? 0 : 1,
        transition: "opacity var(--t-med) var(--ease-soft)",
      }}
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className={closing ? "" : mobile ? "anim-sheet" : "anim-scale"}
        style={{
          width: mobile ? "100%" : "min(1100px, 96vw)",
          height: mobile ? "74vh" : "min(680px, 92vh)",
          background: th.panel,
          border: `1px solid ${th.hair}`,
          borderRadius: mobile ? "22px 22px 0 0" : 20,
          padding: mobile ? "0 16px 16px" : 22,
          paddingBottom: mobile ? "calc(16px + env(safe-area-inset-bottom))" : 22,
          display: "flex",
          flexDirection: "column",
          gap: mobile ? 12 : 16,
          boxShadow: "0 -10px 60px rgba(0,0,0,0.3), 0 30px 80px rgba(0,0,0,0.4)",
          transform: closing ? (mobile ? "translateY(100%)" : "scale(0.97)") : undefined,
          transition: "transform var(--t-med) var(--ease-out), opacity var(--t-med)",
        }}
      >
        {mobile && (
          <div
            onMouseDown={onHandleDown}
            onTouchStart={onHandleDown}
            style={{
              padding: "10px 0 6px",
              display: "flex",
              justifyContent: "center",
              cursor: "grab",
              touchAction: "none",
              flexShrink: 0,
            }}
          >
            <span style={{ width: 38, height: 5, borderRadius: 3, background: th.hair }} />
          </div>
        )}
        <ChartHead pay={pay} get={get} tf={tf} setTf={setTf} onClose={close} popped />
        <div style={{ flex: 1, minHeight: 0 }}>
          <ChartEmpty pay={pay} get={get} />
        </div>
      </div>
    </div>
  );
}
