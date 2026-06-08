// SwapFlow.jsx — the swap execution overlay: review → approval → swap → pending
// → success / fail. Pixel-faithful port of the design's flows.jsx SwapFlow
// (review / pending / success visuals), EXTENDED with the real on-chain path the
// design omits: a fresh /approval (ERC-20 sell tokens) sub-step before /swap, a
// fresh /swap calldata build, and receipt polling (via useSwapExecution).
//
// Quote-expiry guard: while sitting on review, a per-quote countdown ticks from
// the quote's TTL; when it hits 0 the confirm button flips to a gold "↻ quote
// expired · refresh" that re-quotes (calls onRefresh) and resets the timer.
//
// Modal pattern matches TokenPicker (desktop centered scale-in, mobile bottom
// sheet w/ drag-dismiss). Pending is NON-dismissible; review/success/error are
// dismissible. Entrances are transform-only + reduced-motion safe (global.css).
import React, { useEffect, useRef, useState } from "react";

import { useTheme } from "./theme.js";
import { Label, TokenIcon, fmt, haptic, useIsMobile } from "./primitives.jsx";
import { decorateToken } from "../lib/tokens.js";
import { quoteTtlSeconds } from "../lib/quote.js";
import { DOGEOS_FAUCET_URL } from "../lib/execute.js";
import { useSwapExecution } from "./useSwapExecution.js";

function dpFor(n) {
  return n > 0 && n < 1 ? 4 : 2;
}

/* ---------- shared modal (mirrors TokenPicker's pattern) ---------- */
// `dismissible` gates backdrop / escape / close-button (pending = false).
function Modal({ children, onClose, width = 400, dismissible = true }) {
  const th = useTheme();
  const mobile = useIsMobile();
  const sheetRef = useRef(null);
  const dragRef = useRef({ y0: 0, dy: 0 });
  const [closing, setClosing] = useState(false);

  const close = () => {
    if (!dismissible) return;
    setClosing(true);
    setTimeout(() => onClose?.(), 240);
  };

  const onHandleDown = (e) => {
    if (!mobile || !dismissible) return;
    const y0 = e.touches ? e.touches[0].clientY : e.clientY;
    dragRef.current = { y0, dy: 0 };
    const move = (ev) => {
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const dy = Math.max(0, y - dragRef.current.y0);
      dragRef.current.dy = dy;
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
      if (dragRef.current.dy > 90) close();
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
        zIndex: 160,
        background: th.dark ? "rgba(0,0,0,0.62)" : "rgba(40,38,30,0.42)",
        display: "flex",
        alignItems: mobile ? "flex-end" : "center",
        justifyContent: "center",
        padding: mobile ? 0 : "4vmin",
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
          width: mobile ? "100%" : `min(${width}px, 96vw)`,
          maxHeight: mobile ? "92vh" : "90vh",
          background: th.panel,
          border: `1px solid ${th.hair}`,
          borderRadius: mobile ? "22px 22px 0 0" : 18,
          boxShadow: "0 -10px 60px rgba(0,0,0,0.3), 0 30px 80px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          paddingBottom: mobile ? "env(safe-area-inset-bottom)" : 0,
          transform: closing ? (mobile ? "translateY(100%)" : "scale(0.97)") : undefined,
          opacity: closing && !mobile ? 0 : 1,
          transition:
            "transform var(--t-med) var(--ease-out), opacity var(--t-med) var(--ease-soft)",
        }}
      >
        {mobile && dismissible && (
          <div
            onMouseDown={onHandleDown}
            onTouchStart={onHandleDown}
            style={{
              padding: "10px 0 4px",
              display: "flex",
              justifyContent: "center",
              cursor: "grab",
              touchAction: "none",
            }}
          >
            <span style={{ width: 38, height: 5, borderRadius: 3, background: th.hair }} />
          </div>
        )}
        {children({ close })}
      </div>
    </div>
  );
}

function ModalHead({ title, onClose, dismissible }) {
  const th = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 20px",
        borderBottom: `1px solid ${th.hair}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ width: 14, height: 14, background: th.accent, borderRadius: 3 }} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
      </div>
      {dismissible ? (
        <button
          className="tap"
          onClick={onClose}
          style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            border: `1px solid ${th.hair}`,
            background: th.panelHi,
            color: th.inkSoft,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          ✕
        </button>
      ) : (
        <span style={{ width: 30, height: 30 }} />
      )}
    </div>
  );
}

function ctaStyle(th) {
  return {
    width: "100%",
    padding: "15px 0",
    border: "none",
    borderRadius: 11,
    background: th.accent,
    color: th.onAccent,
    fontFamily: "'Space Grotesk',sans-serif",
    fontWeight: 700,
    fontSize: 15,
    letterSpacing: "0.02em",
    cursor: "pointer",
    textTransform: "uppercase",
  };
}

function Spinner({ th, size = 26, track }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `3px solid ${track ?? th.hair}`,
        borderTopColor: th.accent,
        animation: "spin 0.9s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

/* ---------- the flow ---------- */
// Props (all REAL, threaded from SwapView via Shell):
//   pay, get          — resolved token objects (symbol/address/decimals)
//   payAmt            — decimal input string
//   outNum            — estimated received (best route output, JS number)
//   minRecvNum        — min received after slippage (JS number)
//   slippage          — percent
//   venue             — best venue display name
//   bestRoute         — the live best route object from /quote (for /swap)
//   quote             — the full /quote response (for ttl / freshness)
//   slippageBps       — bps for execution binding
//   sender            — connected wallet address
//   onRefresh         — re-quote (returns void; resolves freshness)
//   isScanning        — true while a re-quote is in flight
//   onClose           — dismiss the modal (review/success/error only)
//   onComplete        — fired once on confirmed success (for toasts/activity UI)
export default function SwapFlow({
  pay,
  get,
  payAmt,
  outNum,
  minRecvNum,
  slippage,
  venue,
  bestRoute,
  quote,
  slippageBps,
  sender,
  onRefresh,
  isScanning,
  onClose,
  onComplete,
}) {
  const th = useTheme();
  const exec = useSwapExecution();

  // Quote-expiry countdown for the review screen. Re-armed on each fresh quote
  // (keyed by the route's amountOut + expiry so a re-quote resets it).
  const ttl = quoteTtlSeconds(quote);
  const quoteKey = `${bestRoute?.amountOut ?? ""}:${quote?.expiresAtMs ?? ""}`;
  const [validFor, setValidFor] = useState(ttl);
  const [expired, setExpired] = useState(false);

  // Reset the countdown whenever a new quote lands.
  useEffect(() => {
    setValidFor(ttl);
    setExpired(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  // Tick the countdown while on review (idle) and not mid-refresh.
  useEffect(() => {
    if (exec.status !== "idle" || expired || isScanning) return undefined;
    if (validFor <= 0) {
      setExpired(true);
      haptic(14);
      return undefined;
    }
    const t = setTimeout(() => setValidFor((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [exec.status, validFor, expired, isScanning]);

  // Fire onComplete exactly once on success.
  const completedRef = useRef(false);
  useEffect(() => {
    if (exec.status === "success" && !completedRef.current) {
      completedRef.current = true;
      onComplete?.({
        paySym: pay?.symbol,
        getSym: get?.symbol,
        payAmt: Number.parseFloat(payAmt) || 0,
        recv: exec.recv,
        venue,
        hash: exec.hash,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exec.status]);

  const refreshQuote = () => {
    onRefresh?.();
    // optimistic: the quoteKey effect will reset validFor/expired once the
    // fresh quote lands; clear expired now so the spinner shows immediately.
    setExpired(false);
  };

  const confirm = () => {
    haptic(12);
    exec.run({
      bestRoute,
      sellToken: pay,
      buyToken: get,
      sender,
      slippageBps,
      payAmt,
      recv: outNum,
      venue,
    });
  };

  const dismissible = !exec.isPending;
  const stage =
    exec.status === "success"
      ? "success"
      : exec.status === "error"
        ? "error"
        : exec.isPending
          ? "pending"
          : "review";

  const title =
    stage === "review"
      ? "review swap"
      : stage === "pending"
        ? exec.status === "approving"
          ? "approve token"
          : "swapping"
        : stage === "success"
          ? "success"
          : "swap failed";

  const payDeco = pay ? decorateToken(pay) : null;
  const getDeco = get ? decorateToken(get) : null;

  const Big = ({ deco, sym, amount, label }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <TokenIcon token={deco} size={40} />
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div
          className="te-num"
          style={{
            fontFamily: "'DM Mono',monospace",
            fontSize: 22,
            fontWeight: 500,
            color: th.ink,
            lineHeight: 1.1,
          }}
        >
          {amount} <span style={{ fontSize: 15 }}>{sym}</span>
        </div>
        <Label style={{ display: "block" }}>{label}</Label>
      </div>
    </div>
  );

  // pending sub-step copy: approval vs broadcast.
  const pendingLabel = (() => {
    if (exec.status === "approving") {
      if (exec.phase === "approve-check") return "checking allowance…";
      if (exec.phase === "approve-sign") return `approve ${pay?.symbol ?? "token"} in your wallet…`;
      return `approving ${pay?.symbol ?? "token"} on DogeOS…`;
    }
    if (exec.phase === "swap-build") return "building swap transaction…";
    if (exec.phase === "swap-sign") return "confirm the swap in your wallet…";
    return "broadcasting to DogeOS…";
  })();

  const faucetError = exec.error && /faucet/i.test(exec.error);

  return (
    <Modal
      onClose={onClose}
      width={400}
      dismissible={dismissible}
    >
      {({ close }) => (
        <>
          <ModalHead title={title} onClose={close} dismissible={dismissible} />
          <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
            {/* ----- SUCCESS ----- */}
            {stage === "success" ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 14,
                  padding: "12px 0",
                }}
              >
                <div className="anim-pop" style={{ position: "relative", width: 96, height: 96 }}>
                  <img
                    src="/doge-mascot.png"
                    alt="Doge"
                    onError={(e) => {
                      // inline fallback if the asset is missing.
                      e.currentTarget.style.display = "none";
                      e.currentTarget.nextSibling.style.display = "flex";
                    }}
                    style={{ width: 96, height: 96, objectFit: "contain", borderRadius: 20 }}
                  />
                  <span
                    style={{
                      display: "none",
                      width: 96,
                      height: 96,
                      borderRadius: 20,
                      background: th.gold,
                      color: "#1E1405",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 44,
                    }}
                  >
                    Ð
                  </span>
                  <div
                    style={{
                      position: "absolute",
                      right: -4,
                      bottom: -4,
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      background: th.chartUp,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                      border: `3px solid ${th.panel}`,
                    }}
                  >
                    ✓
                  </div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>much swap. very done.</div>
                  <Label style={{ marginTop: 5 }}>
                    received {fmt(exec.recv, dpFor(exec.recv))} {get?.symbol ?? ""}
                  </Label>
                </div>
              </div>
            ) : stage === "error" ? (
              /* ----- ERROR ----- */
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 14,
                  padding: "10px 0 2px",
                }}
              >
                <div
                  className="anim-pop"
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    background: th.dark ? "rgba(255,90,60,0.14)" : "rgba(255,77,46,0.12)",
                    border: `1px solid ${th.chartDown}55`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: th.chartDown,
                    fontSize: 30,
                  }}
                >
                  ✕
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>much sad. swap failed.</div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 12.5,
                      color: th.inkSoft,
                      lineHeight: 1.45,
                      maxWidth: 300,
                    }}
                  >
                    {exec.error}
                  </div>
                  {faucetError && (
                    <a
                      href={DOGEOS_FAUCET_URL}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-block",
                        marginTop: 10,
                        color: th.accent,
                        fontSize: 12.5,
                        fontWeight: 600,
                        textDecoration: "underline",
                      }}
                    >
                      open the DogeOS testnet faucet →
                    </a>
                  )}
                </div>
              </div>
            ) : (
              /* ----- REVIEW + PENDING share the pay→get summary ----- */
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Big
                  deco={payDeco}
                  sym={pay?.symbol ?? ""}
                  amount={fmt(Number.parseFloat(payAmt) || 0, 2)}
                  label="you pay"
                />
                <div style={{ color: th.mute, fontSize: 18, paddingLeft: 13 }}>↓</div>
                <Big
                  deco={getDeco}
                  sym={get?.symbol ?? ""}
                  amount={isScanning ? "…" : fmt(outNum, dpFor(outNum))}
                  label="you receive (est.)"
                />
              </div>
            )}

            {/* ----- REVIEW detail rows ----- */}
            {stage === "review" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: "14px 0",
                  borderTop: `1px solid ${th.hair}`,
                  borderBottom: `1px solid ${th.hair}`,
                }}
              >
                {[
                  ["venue", venue || "—"],
                  ["slippage", slippage.toFixed(1) + "%"],
                  [
                    "min received",
                    `${fmt(minRecvNum, dpFor(minRecvNum))} ${get?.symbol ?? ""}`,
                  ],
                  ["settles on", "Dogecoin · instant"],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                    <Label>{k}</Label>
                    <span
                      className="te-num"
                      style={{ fontFamily: "'DM Mono',monospace", fontSize: 12.5, color: th.inkSoft }}
                    >
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* ----- high-slippage warning band ----- */}
            {stage === "review" && slippage > 5 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 9,
                  padding: "10px 12px",
                  borderRadius: 9,
                  background: slippage > 20 ? "rgba(255,77,46,0.08)" : "rgba(255,207,46,0.12)",
                  border: `1px solid ${(slippage > 20 ? th.chartDown : th.gold)}55`,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: slippage > 20 ? th.chartDown : th.gold,
                    marginTop: 5,
                    flexShrink: 0,
                  }}
                />
                <div style={{ fontSize: 11.5, color: th.inkSoft, lineHeight: 1.4 }}>
                  <span
                    className="te-label"
                    style={{
                      color: slippage > 20 ? th.chartDown : th.gold,
                      letterSpacing: "0.1em",
                    }}
                  >
                    {slippage > 20 ? "gas-war mode · " : "high slippage · "}
                  </span>
                  you could receive as little as{" "}
                  <b style={{ color: th.ink }}>
                    {fmt(minRecvNum, dpFor(minRecvNum))} {get?.symbol ?? ""}
                  </b>
                  . confirm only if you mean it.
                </div>
              </div>
            )}

            {/* ----- PENDING spinner + sub-step copy ----- */}
            {stage === "pending" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  justifyContent: "center",
                  padding: "8px 0",
                }}
              >
                <Spinner th={th} />
                <Label>{pendingLabel}</Label>
              </div>
            )}

            {/* ----- review CTA (confirm / expired-refresh) ----- */}
            {stage === "review" &&
              (expired ? (
                <button
                  onClick={refreshQuote}
                  className="tap"
                  disabled={isScanning}
                  style={{
                    ...ctaStyle(th),
                    background: th.gold,
                    color: "#1c1c1c",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 9,
                  }}
                >
                  {isScanning ? (
                    <>
                      <span
                        style={{
                          width: 15,
                          height: 15,
                          borderRadius: "50%",
                          border: "2px solid rgba(0,0,0,0.25)",
                          borderTopColor: "#1c1c1c",
                          animation: "spin 0.8s linear infinite",
                        }}
                      />{" "}
                      refreshing…
                    </>
                  ) : (
                    <>↻ quote expired · refresh</>
                  )}
                </button>
              ) : (
                <button
                  onClick={confirm}
                  className="tap"
                  disabled={isScanning || !bestRoute}
                  style={{
                    ...ctaStyle(th),
                    opacity: isScanning || !bestRoute ? 0.6 : 1,
                    cursor: isScanning || !bestRoute ? "not-allowed" : "pointer",
                  }}
                >
                  confirm swap{" "}
                  <span style={{ opacity: 0.7, fontWeight: 500 }}>· {validFor}s</span>
                </button>
              ))}

            {/* ----- success / error CTA ----- */}
            {stage === "success" && (
              <button onClick={close} className="tap" style={ctaStyle(th)}>
                done
              </button>
            )}
            {stage === "error" && (
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => exec.reset()}
                  className="tap"
                  style={{
                    ...ctaStyle(th),
                    flex: 1,
                  }}
                >
                  try again
                </button>
                <button
                  onClick={close}
                  className="tap"
                  style={{
                    ...ctaStyle(th),
                    flex: "0 0 38%",
                    background: th.panelHi,
                    color: th.inkSoft,
                    border: `1px solid ${th.hair}`,
                  }}
                >
                  close
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
