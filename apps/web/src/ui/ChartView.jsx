// ChartView.jsx — the CHART chrome + a REAL TradingView Advanced Charts widget.
// ChartHead / ChartPanel / ChartPopout (TF pills, pop-out, close; docked beside
// the swap on desktop, slide-up sheet on mobile with drag-dismiss).
//
// HONESTY: DogeOS testnet has NO on-chain OHLC / price oracle, so we never
// fabricate candles. The widget is driven by makeDogeDatafeed, which builds a
// price series *forward in time* from REAL /quote prices (see lib/chartDatafeed).
// Until enough real ticks have accumulated, we show an unobtrusive "building
// live price history from on-chain quotes" note over the chart — the bars that
// exist are real. The 26MB licensed library is loaded at RUNTIME from
// /advanced_charting_library/...; if it isn't vendored (fresh checkout / CI
// without it) we fall back to the honest placeholder so the app never breaks.
import React, { useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "./theme.js";
import { Label, useIsMobile } from "./primitives.jsx";
import { makeDogeDatafeed } from "../lib/chartDatafeed.js";
import { DOGEOS_CHAIN_ID } from "../lib/api.js";

// TF pills: display label -> TradingView resolution string. The datafeed only
// supports these intraday/daily buckets.
const TIMEFRAMES = [
  { label: "1H", res: "60" },
  { label: "4H", res: "240" },
  { label: "1D", res: "1D" },
];

const LIBRARY_PATH = "/advanced_charting_library/charting_library/";
const SCRIPT_SRC = `${LIBRARY_PATH}charting_library.standalone.js`;

// Lazy-load the standalone script exactly once. Resolves true when
// window.TradingView.widget is available, false when the lib isn't vendored.
let scriptPromise = null;
function loadChartingLibrary() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(false);
  }
  if (window.TradingView?.widget) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve) => {
    const existing = document.querySelector(`script[data-doge-charting="1"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean(window.TradingView?.widget)));
      existing.addEventListener("error", () => resolve(false));
      // Already resolved case (cached).
      if (window.TradingView?.widget) resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.dataset.dogeCharting = "1";
    script.addEventListener("load", () => resolve(Boolean(window.TradingView?.widget)));
    script.addEventListener("error", () => {
      // Not vendored / failed to load — let the caller fall back honestly.
      scriptPromise = null;
      resolve(false);
    });
    document.head.appendChild(script);
  });
  return scriptPromise;
}

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
        {/* Honesty: price is built from live on-chain quotes, not a price feed. */}
        <Label color={th.mute}>live on-chain quote price</Label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {TIMEFRAMES.map(({ label, res }) => (
          <button key={res} className="tap" style={pill(res)} onClick={() => setTf(res)}>
            {label}
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

// honest empty canvas — used as the no-library fallback and inside the overlay.
function ChartEmpty({ pay, get, note }) {
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
        {note ?? "price chart coming soon — no on-chain OHLC feed on DogeOS testnet yet"}
      </Label>
    </div>
  );
}

// Small unobtrusive note pinned over the chart while the real series is sparse.
function BuildingHistoryNote() {
  const th = useTheme();
  return (
    <div
      style={{
        position: "absolute",
        left: 10,
        bottom: 10,
        zIndex: 3,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 9px",
        borderRadius: 8,
        border: `1px solid ${th.hair}`,
        background: th.dark ? "rgba(20,20,16,0.78)" : "rgba(255,255,255,0.82)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        maxWidth: "min(82%, 360px)",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: th.accent,
          flexShrink: 0,
          animation: "doge-pulse 1.6s ease-in-out infinite",
        }}
      />
      <Label
        color={th.inkSoft}
        style={{ textTransform: "none", letterSpacing: 0, fontSize: 11.5, lineHeight: 1.35 }}
      >
        building live price history from on-chain quotes — bars shown are real
      </Label>
    </div>
  );
}

// The REAL TradingView widget. Manages script load, widget lifecycle, theme,
// resize and the honest sparse-data overlay. Falls back to ChartEmpty if the
// library isn't vendored or fails to load.
function ChartWidget({ pay, get, tf }) {
  const th = useTheme();
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  // 'loading' | 'ready' | 'unavailable'
  const [libState, setLibState] = useState("loading");
  // Whether the persisted real series for this pair+res is still sparse/empty.
  const [sparse, setSparse] = useState(true);

  const sellAddr = pay?.address ?? "";
  const buyAddr = get?.address ?? "";
  const paySym = pay?.symbol ?? pay?.sym ?? "";
  const getSym = get?.symbol ?? get?.sym ?? "";

  // Stable datafeed identity — recreate the widget when the pair or TF changes.
  const datafeedKey = `${sellAddr}|${buyAddr}|${tf}`;

  // Track whether the persisted series has any real bars (drives the overlay).
  useEffect(() => {
    const key = `doge.chart.${paySym || sellAddr}-${getSym || buyAddr}.${tf}`;
    const check = () => {
      try {
        const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
        const arr = raw ? JSON.parse(raw) : [];
        setSparse(!Array.isArray(arr) || arr.length < 3);
      } catch {
        setSparse(true);
      }
    };
    check();
    // Re-check periodically while live ticks accumulate so the note can clear.
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, [paySym, getSym, sellAddr, buyAddr, tf]);

  useEffect(() => {
    let cancelled = false;

    // Clean up any prior widget instance before (re)creating.
    const teardown = () => {
      if (widgetRef.current) {
        try {
          widgetRef.current.remove();
        } catch {
          // already gone
        }
        widgetRef.current = null;
      }
    };

    if (!sellAddr || !buyAddr || !containerRef.current) {
      setLibState("loading");
      return teardown;
    }

    setLibState("loading");
    loadChartingLibrary().then((ok) => {
      if (cancelled) return;
      if (!ok || !window.TradingView?.widget || !containerRef.current) {
        setLibState("unavailable");
        return;
      }
      teardown();
      try {
        const datafeed = makeDogeDatafeed({
          sellToken: pay,
          buyToken: get,
          chainId: DOGEOS_CHAIN_ID,
          paySym,
          getSym,
        });
        widgetRef.current = new window.TradingView.widget({
          container: containerRef.current,
          library_path: LIBRARY_PATH,
          symbol: `${paySym}/${getSym}`,
          interval: tf,
          datafeed,
          theme: th.dark ? "dark" : "light",
          autosize: true,
          locale: "en",
          fullscreen: false,
          timezone: "Etc/UTC",
          disabled_features: [
            "header_symbol_search",
            "header_compare",
            "symbol_search_hot_key",
            "header_saveload",
            "use_localstorage_for_settings",
            "popup_hints",
          ],
          enabled_features: [],
          overrides: {
            "paneProperties.background": th.dark ? "#1a1a16" : "#f4f3ee",
            "paneProperties.backgroundType": "solid",
          },
          loading_screen: {
            backgroundColor: th.dark ? "#1a1a16" : "#f4f3ee",
            foregroundColor: th.accent,
          },
        });
        setLibState("ready");
      } catch {
        setLibState("unavailable");
      }
    });

    return () => {
      cancelled = true;
      teardown();
    };
    // Recreate on pair, interval, or theme change (theme can't be set live on
    // the standalone widget reliably, so we recreate).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datafeedKey, th.dark]);

  // Resize: the widget uses autosize, but a ResizeObserver nudges it when the
  // dock/sheet changes size (e.g. mobile sheet drag, window resize).
  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !containerRef.current) return undefined;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      // autosize handles the actual reflow; this just guarantees a layout tick.
      if (widgetRef.current && el) el.style.minHeight = el.style.minHeight || "0px";
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // No library: honest placeholder so the app never breaks on a fresh checkout.
  if (libState === "unavailable") {
    return <ChartEmpty pay={pay} get={get} />;
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 220 }}>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          minHeight: 220,
          borderRadius: 12,
          overflow: "hidden",
          border: `1px solid ${th.hair}`,
        }}
      />
      {/* Honest overlay while the real series is sparse/empty. */}
      {libState === "ready" && sparse && <BuildingHistoryNote />}
    </div>
  );
}

// docked chart panel (lives beside the swap on desktop)
export function ChartPanel({ pay, get, onClose, onPop }) {
  const th = useTheme();
  const [tf, setTf] = useState("60");

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
        <ChartWidget pay={pay} get={get} tf={tf} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Label>on-chain quote series · live</Label>
        <Label color={th.mute}>DogeOS testnet</Label>
      </div>
    </div>
  );
}

// fullscreen popout overlay (desktop centered dialog · mobile bottom sheet)
export function ChartPopout({ pay, get, onClose }) {
  const th = useTheme();
  const mobile = useIsMobile();
  const [tf, setTf] = useState("60");
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
          <ChartWidget pay={pay} get={get} tf={tf} />
        </div>
      </div>
    </div>
  );
}
