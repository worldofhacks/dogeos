// SwapView.jsx — the DogeSwap swap panel (the centerpiece).
//
// Faithful port of the design's swap.jsx, wired to the REAL backend:
//   • amount input ([0-9.] only) + token pair with flip (spins 180°, haptic)
//   • "you receive" output readout (amount + buy symbol + icon; skeleton while
//     scanning) — follows the live best route + the flip
//   • freshness line: scanning spinner OR countdown ring (tap-to-refresh)
//   • CTA states: connect / enter amount / insufficient balance / review swap
//   • amount + slippage sliders w/ presets + escalating slippage warning bands
//   • expandable aggregator scan (best venue, "best of N", ranked venues with
//     per-venue output + −X.XX% vs best, winner gold) — REAL from best+alternatives
//   • detail rows (rate, min received, network fee) — REAL from the quote
//
// HONESTY: no USD sublabels (no price feed), no price-impact row (backend has
// none), router fee shown as 0% (default), network fee derived from the quote's
// feeEstimate (gasUnits × gasPrice + data/finality fee), else "—".
//
// Layout: the module height is pinned constant across scanning↔ready via
// fixed-height rows + skeleton shimmers so there is NO layout shift.
import React, { useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "./theme.js";
import { Label, TokenIcon, Skeleton, fmt, compact, haptic, useIsMobile } from "./primitives.jsx";
import Slider from "./Slider.jsx";
import TokenPicker from "./TokenPicker.jsx";
import SwapFlow from "./SwapFlow.jsx";
import { ChartPanel, ChartPopout } from "./ChartView.jsx";
import { showToast } from "./Toast.jsx";
import { useWallet } from "./useWallet.js";
import { useSettings } from "./useSettings.js";
import { useQuote } from "./useQuote.js";
import { useTokenBalances } from "./useTokenBalances.js";
import { getTokens, getSources, DOGEOS_CHAIN_ID } from "../lib/api.js";
import { chainIdMatchesDogeos } from "../lib/execute.js";
import { decorateToken } from "../lib/tokens.js";
import { sanitizeAmountInput, unitsToNumber, walletBalanceKey } from "../lib/units.js";
import {
  venueRows,
  executableRouteCount,
  routeOutputNumber,
  routeOutputDecimal,
  minReceivedDecimal,
  effectiveRate,
  venueDeficitPercent,
  bestVsNextPercent,
  networkFeeDoge,
  routeGasUnits,
  quoteTtlSeconds,
} from "../lib/quote.js";

// Decimal places that scale with magnitude (mirrors the design's fmt usage).
function dpFor(n) {
  return n > 0 && n < 1 ? 4 : 2;
}

/* ---------- subcomponents ----------
   Module scope on purpose: defined inside SwapView's render body these get a
   fresh function identity every render, so React unmounts/remounts their
   subtree on each keystroke and each 1s countdown tick — the amount input
   inside <Section> loses focus/caret per character. */
function Chip({ token, onPick, th }) {
  const deco = token ? decorateToken(token) : null;
  return (
    <button
      className="tap lift"
      onClick={onPick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px 8px 8px",
        borderRadius: 999,
        border: `1px solid ${th.hair}`,
        background: th.panelHi,
        fontFamily: "'Space Grotesk',sans-serif",
        fontSize: 15,
        cursor: "pointer",
        color: th.ink,
        flex: "1 1 0",
        justifyContent: "flex-start",
        boxShadow: th.dark ? "none" : "0 1px 2px rgba(0,0,0,0.05)",
      }}
    >
      {deco ? <TokenIcon token={deco} size={24} /> : <span style={{ width: 24 }} />}
      <span style={{ fontWeight: 600 }}>{token?.symbol ?? "select"}</span>
      <span style={{ color: th.mute, fontSize: 11, marginLeft: "auto" }}>▾</span>
    </button>
  );
}

function Section({ no, title, right, children, th, mobile }) {
  return (
    <div style={{ padding: mobile ? "11px 18px" : "15px 20px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: mobile ? 8 : 11,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="te-label te-num" style={{ color: th.accent }}>
            {no}
          </span>
          <Label>{title}</Label>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export default function SwapView({
  onReview,
  chartOn = false,
  onToggleChart,
  preset = null,
  onPresetConsumed,
}) {
  const th = useTheme();
  const mobile = useIsMobile();
  // `narrow` (< 1000px) gates docking the chart beside the swap — below this the
  // chart button opens the slide-up popout instead. Matches the Shell's frame
  // widening threshold so the docked panel always has room.
  const narrow = useIsMobile(999);
  const wallet = useWallet();
  const settings = useSettings();

  // ---- token catalog + venue display names (real) ----
  const [tokens, setTokens] = useState([]);
  const [sourceNames, setSourceNames] = useState({}); // sourceId -> { name, type }
  const [paySym, setPaySym] = useState("USDC");
  const [getSym, setGetSym] = useState("WDOGE");
  const [picker, setPicker] = useState(null); // 'pay' | 'get' | null

  useEffect(() => {
    let cancelled = false;
    getTokens()
      .then((body) => {
        if (cancelled) return;
        const list = body.data ?? body ?? [];
        setTokens(list);
        // Sensible default pair if the documented ones aren't present.
        const has = (s) => list.some((t) => t.symbol === s);
        if (!has(paySym)) setPaySym(list[0]?.symbol ?? "");
        if (!has(getSym)) setGetSym(list[1]?.symbol ?? list[0]?.symbol ?? "");
      })
      .catch(() => {
        /* leave empty; CTA + scan show their idle states */
      });
    getSources()
      .then((body) => {
        if (cancelled) return;
        const map = {};
        for (const s of body.data ?? body ?? []) {
          map[s.sourceId] = { name: s.displayName ?? s.sourceId, type: s.protocolType ?? "" };
        }
        setSourceNames(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pay = useMemo(() => tokens.find((t) => t.symbol === paySym) ?? null, [tokens, paySym]);
  const get = useMemo(() => tokens.find((t) => t.symbol === getSym) ?? null, [tokens, getSym]);

  // Apply a token preset requested from the Tokens view (the ⇅ "trade" button) —
  // it becomes the "pay" (sell) side, matching the design. If it collides with
  // the current "get" side, move the old pay there. Consumed once.
  useEffect(() => {
    if (!preset?.symbol) return;
    setPaySym((prevPay) => {
      if (preset.symbol === getSym) {
        setGetSym(prevPay);
      }
      return preset.symbol;
    });
    onPresetConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // ---- amount + slippage controls ----
  const [payAmt, setPayAmt] = useState("");
  // Default slippage comes from the persisted settings (Settings → trade
  // defaults); the in-swap slider below still overrides it per-trade. We seed
  // once and let the user diverge; if they haven't touched it we keep it in
  // sync with the default.
  const [slippage, setSlippage] = useState(settings.slippage);
  const [slippageTouched, setSlippageTouched] = useState(false);
  useEffect(() => {
    if (!slippageTouched) setSlippage(settings.slippage);
  }, [settings.slippage, slippageTouched]);
  const [spin, setSpin] = useState(0);
  const [routeOpen, setRouteOpen] = useState(false);
  const [showFlow, setShowFlow] = useState(false); // swap execution overlay
  const [chartPopout, setChartPopout] = useState(false); // fullscreen chart overlay

  const slippageBps = Math.round(slippage * 100);

  // ---- live balances (real, via wallet provider eth_call) ----
  const balanceTokens = useMemo(() => [pay, get].filter(Boolean), [pay, get]);
  const { balances, refresh: refreshBalances } = useTokenBalances({
    owner: wallet.address,
    chainId: wallet.chainId,
    tokens: balanceTokens,
  });

  const payBalNum = useMemo(() => {
    if (!pay || !wallet.address) return 0;
    try {
      const key = walletBalanceKey(pay.address);
      return Object.prototype.hasOwnProperty.call(balances, key)
        ? unitsToNumber(balances[key], pay.decimals)
        : 0;
    } catch {
      return 0;
    }
  }, [pay, balances, wallet.address]);

  // ---- live quote (real, debounced/polled/seq-guarded) ----
  const { quote, status, isScanning, isReady, secondsLeft, refresh } = useQuote({
    chainId: DOGEOS_CHAIN_ID,
    sellToken: pay,
    buyToken: get,
    amount: payAmt,
    slippageBps,
  });

  const amt = Number.parseFloat(payAmt) || 0;
  const overBal = wallet.address ? amt > payBalNum : false;
  const connected = wallet.isConnected;
  // Connected on the wrong network is the worst "looks fine, can't swap"
  // state: the wallet connects (eth_requestAccounts succeeds) even when the
  // user rejects the DogeOS chain switch. Surface it on the CTA instead of
  // letting the swap fail later at signing time.
  const wrongChain = connected && Boolean(wallet.chainId) && !chainIdMatchesDogeos(wallet.chainId);

  // Ranked venue list from best + alternatives (winner first).
  const rows = useMemo(() => venueRows(quote), [quote]);
  const best = rows[0] ?? null;
  const venueCount = quote ? executableRouteCount(quote) : 0;
  const outNum = best ? routeOutputNumber(best, get) : 0;
  const minRecvNum = useMemo(() => {
    if (!best || !get) return 0;
    const n = Number(minReceivedDecimal(best, get, 8));
    return Number.isFinite(n) ? n : 0;
  }, [best, get]);
  const rate = best ? effectiveRate(best, pay, get) : null;
  const saveVsNext = quote ? bestVsNextPercent(quote, get) : 0;

  const bestMeta = best ? sourceNames[best.sourceId] : null;
  const bestName = bestMeta?.name ?? best?.displayName ?? best?.sourceId ?? "scanning";
  const bestType = bestMeta?.type ?? best?.protocolType ?? best?.routeType ?? "";

  // The aggregator-scan header shows live "scanning" until a ready quote
  // lands. A failed quote (API/RPC down) must surface as a failure — not an
  // eternal scanning shimmer with a live-looking CTA. The hook keeps polling
  // every 10s, so a transient outage self-heals.
  const quoteFailed = status === "error" && amt > 0;
  const scanning = !quoteFailed && (isScanning || (amt > 0 && !isReady));
  const hasResult = isReady && Boolean(best);

  // ---- token selection ----
  const choose = (token) => {
    if (!token) return;
    if (picker === "pay") {
      if (token.symbol === getSym) setGetSym(paySym); // swap to avoid same-token
      setPaySym(token.symbol);
    } else if (picker === "get") {
      if (token.symbol === paySym) setPaySym(getSym);
      setGetSym(token.symbol);
    }
    setPicker(null);
  };

  const flip = () => {
    setSpin((s) => s + 1);
    haptic(8);
    setPaySym(getSym);
    setGetSym(paySym);
  };

  // amount slider = position-size dial (% of pay balance)
  const pctOfBal = payBalNum > 0 ? Math.max(0, Math.min(100, Math.round((amt / payBalNum) * 100))) : 0;

  const onConnect = () => wallet.connect();
  const onSwitchChain = async () => {
    const switched = await wallet.switchChain();
    if (!switched) showToast("Switch your wallet to DogeOS Chikyu Testnet to swap.", "err");
  };
  const reviewable = connected && !wrongChain && amt > 0 && !overBal && hasResult;

  // Docked chart only when toggled on AND there's room to sit beside the swap
  // (wide viewport, matches the Shell frame widening at >=1000px). On narrower
  // viewports the chart button opens the slide-up popout instead.
  const chartDocked = chartOn && !narrow;

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "stretch",
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: mobile ? "100%" : 460,
            flex: chartDocked ? "0 0 460px" : "0 1 460px",
            background: th.screen,
            borderRadius: 16,
            border: `1px solid ${th.hair}`,
            display: "flex",
            flexDirection: "column",
            boxShadow: mobile
              ? th.dark
                ? "0 12px 36px rgba(0,0,0,0.45)"
                : "0 12px 30px rgba(60,55,40,0.16)"
              : th.dark
                ? "none"
                : "inset 0 1px 0 #fff",
            overflow: "hidden",
          }}
        >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            borderBottom: `1px solid ${th.hair}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ width: 15, height: 15, background: th.accent, borderRadius: 3 }} />
            <span style={{ fontWeight: 700, fontSize: 15 }}>swap</span>
          </div>
          {/* chart toggle — wide desktop docks a panel beside the swap; narrow
              viewports open the slide-up popout (no room to dock). */}
          {(() => {
            const chartActive = narrow ? chartPopout : chartOn;
            return (
              <button
                className="tap"
                onClick={() => {
                  if (narrow) setChartPopout(true);
                  else onToggleChart?.();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "6px 11px",
                  borderRadius: 8,
                  border: `1px solid ${chartActive ? th.accent : th.hair}`,
                  background: chartActive ? th.accent : th.panelHi,
                  color: chartActive ? th.onAccent : th.inkSoft,
                  cursor: "pointer",
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 11,
                  letterSpacing: "0.05em",
                }}
              >
                <span
                  style={{ width: 7, height: 7, borderRadius: 1, background: chartActive ? th.onAccent : th.mute }}
                />
                chart
              </button>
            );
          })()}
        </div>

        {/* 01 you pay — input + token pair */}
        <Section
          no="01"
          title="you pay"
          th={th}
          mobile={mobile}
          right={
            <Label color={overBal ? th.chartDown : th.mute}>
              bal {compact(payBalNum)} ·{" "}
              <span
                onClick={() => payBalNum > 0 && setPayAmt(String(payBalNum))}
                style={{ color: th.accent, cursor: payBalNum > 0 ? "pointer" : "default" }}
              >
                max
              </span>
            </Label>
          }
        >
          <input
            value={payAmt}
            onChange={(e) => setPayAmt(sanitizeAmountInput(e.target.value))}
            inputMode="decimal"
            placeholder="0"
            style={{
              border: "none",
              background: "transparent",
              outline: "none",
              width: "100%",
              fontFamily: "'DM Mono',monospace",
              fontVariantNumeric: "tabular-nums",
              fontSize: 34,
              fontWeight: 500,
              color: overBal ? th.chartDown : th.ink,
              letterSpacing: "-0.02em",
            }}
          />
          {/* Honesty: no "≈ $USD" sublabel (no price feed). Spacer keeps rhythm. */}
          <div style={{ height: 10 }} />

          {/* token pair selector with flip */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
            <Chip token={pay} onPick={() => setPicker("pay")} th={th} />
            <button
              className="tap"
              onClick={flip}
              title="flip"
              style={{
                width: 30,
                height: 30,
                flexShrink: 0,
                borderRadius: "50%",
                background: th.ink,
                color: th.dark ? "#1c1c1c" : "#fff",
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transform: `rotate(${spin * 180}deg)`,
                transition: "transform var(--t-slow) var(--ease-spring)",
              }}
            >
              ⇄
            </button>
            <Chip token={get} onPick={() => setPicker("get")} th={th} />
          </div>
        </Section>

        {/* you receive — prominent output readout (replaces the tiny CTA
            sublabel). Honesty: no "≈ $USD" line (no price feed) — amount +
            symbol + icon only. The number follows the live quote + the flip. */}
        <div style={{ padding: mobile ? "0 18px 11px" : "0 20px 15px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: mobile ? "11px 14px" : "13px 16px",
              borderRadius: 12,
              border: `1px solid ${th.hair}`,
              background: th.panelHi,
            }}
          >
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <Label>you receive</Label>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
                {scanning ? (
                  <Skeleton w={140} h={26} r={6} />
                ) : (
                  <span
                    style={{
                      fontFamily: "'DM Mono',monospace",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: 30,
                      fontWeight: 500,
                      color: th.ink,
                      letterSpacing: "-0.02em",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {hasResult ? fmt(outNum, dpFor(outNum)) : "0"}
                  </span>
                )}
                <span
                  style={{
                    fontFamily: "'Space Grotesk',sans-serif",
                    fontSize: 15,
                    fontWeight: 600,
                    color: th.inkSoft,
                    flexShrink: 0,
                  }}
                >
                  {get?.symbol ?? ""}
                </span>
              </div>
            </div>
            <TokenIcon token={get ? decorateToken(get) : null} size={mobile ? 32 : 36} />
          </div>
        </div>

        {/* action — sits where the receive section used to be */}
        <div style={{ padding: mobile ? "12px 16px 14px" : "14px 20px 16px" }}>
          {/* freshness line — fixed height so no layout shift */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 18,
              marginBottom: 11,
            }}
          >
            {connected && amt > 0 && !overBal ? (
              <button
                className="tap"
                onClick={refresh}
                title="refresh quote"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 7,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {quoteFailed ? (
                  <Label color={th.chartDown}>quotes unavailable — tap to retry</Label>
                ) : scanning ? (
                  <>
                    <span
                      style={{
                        width: 13,
                        height: 13,
                        borderRadius: "50%",
                        border: `2px solid ${th.hair}`,
                        borderTopColor: th.accent,
                        animation: "spin 0.8s linear infinite",
                      }}
                    />
                    <Label color={th.accent}>scanning {venueCount || 0} venues…</Label>
                  </>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 16 16" style={{ transform: "rotate(-90deg)" }}>
                      <circle cx="8" cy="8" r="6.5" fill="none" stroke={th.hair} strokeWidth="2" />
                      <circle
                        cx="8"
                        cy="8"
                        r="6.5"
                        fill="none"
                        stroke={th.chartUp}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 6.5}
                        strokeDashoffset={
                          2 * Math.PI * 6.5 * (1 - Math.max(0, Math.min(1, (secondsLeft ?? 0) / quoteTtlSeconds(quote))))
                        }
                        style={{ transition: "stroke-dashoffset 1s linear" }}
                      />
                    </svg>
                    <Label color={th.chartUp}>
                      best price · refresh{secondsLeft != null ? ` in ${secondsLeft}s` : ""}
                    </Label>
                  </>
                )}
              </button>
            ) : null}
          </div>

          {(() => {
            // CTA is actionable when it connects, switches network, or reviews.
            const actionable = !connected || wrongChain || (amt > 0 && !overBal && !quoteFailed);
            return (
              <button
                className="tap"
                onClick={
                  !connected
                    ? onConnect
                    : wrongChain
                      ? onSwitchChain
                      : reviewable
                        ? () => {
                            haptic(12);
                            onReview?.();
                            setShowFlow(true);
                          }
                        : undefined
                }
                disabled={connected && !wrongChain && (amt <= 0 || overBal || quoteFailed)}
                style={{
                  width: "100%",
                  padding: "14px 0",
                  border: "none",
                  borderRadius: 12,
                  background: actionable ? th.accent : th.hair,
                  color: actionable ? th.onAccent : th.mute,
                  fontFamily: "'Space Grotesk',sans-serif",
                  fontWeight: 700,
                  fontSize: 15.5,
                  letterSpacing: "0.02em",
                  cursor: actionable ? "pointer" : "not-allowed",
                  boxShadow: actionable && !th.dark ? "0 2px 0 rgba(0,0,0,0.18)" : "none",
                  textTransform: "uppercase",
                  lineHeight: 1.1,
                }}
              >
                {/* CTA label only — the "you receive" readout above now shows the
                    output amount (no redundant "≈ {out} {sym}" sublabel here). */}
                <span style={{ whiteSpace: "nowrap" }}>
                  {!connected
                    ? "connect wallet"
                    : wrongChain
                      ? "switch to DogeOS network"
                      : overBal
                        ? "insufficient balance"
                        : amt <= 0
                          ? "enter an amount"
                          : quoteFailed
                            ? "quotes unavailable"
                            : "review swap"}
                </span>
              </button>
            );
          })()}
        </div>

        {/* amount + slippage sliders */}
        <div style={{ borderTop: `1px solid ${th.hair}`, borderBottom: `1px solid ${th.hair}` }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: mobile ? 14 : 18,
              padding: mobile ? "14px 18px" : "16px 20px",
            }}
          >
            <Slider
              label="amount"
              value={pctOfBal}
              min={0}
              max={100}
              step={1}
              accent={pctOfBal >= 100 ? th.gold : undefined}
              format={(v) => (payBalNum <= 0 ? "—" : v + "%")}
              presets={[
                { value: 25, label: "25%" },
                { value: 50, label: "50%" },
                { value: 75, label: "75%" },
                { value: 100, label: "MAX" },
              ]}
              onChange={(v) => {
                if (payBalNum <= 0) return;
                const dp = payBalNum < 10 ? 4 : 2;
                setPayAmt(v <= 0 ? "" : String(+(payBalNum * v / 100).toFixed(dp)));
              }}
            />
            <Slider
              label="slippage"
              value={slippage}
              min={0.1}
              max={50}
              step={0.1}
              accent={slippage > 20 ? th.chartDown : slippage > 5 ? th.gold : undefined}
              valueColor={slippage > 20 ? th.chartDown : slippage > 5 ? th.gold : th.ink}
              format={(v) => (v >= 49.95 ? "MAX" : v.toFixed(1) + "%")}
              presets={[
                { value: 0.5, label: "0.5%" },
                { value: 5, label: "5%" },
                { value: 25, label: "25%" },
                { value: 50, label: "MAX" },
              ]}
              onChange={(v) => {
                setSlippageTouched(true);
                setSlippage(v);
              }}
            />
          </div>
          {slippage > 5 &&
            (() => {
              const extreme = slippage > 20;
              const c = extreme ? th.chartDown : th.gold;
              return (
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 9,
                    margin: "0 20px 14px",
                    padding: "10px 12px",
                    borderRadius: 9,
                    background: th.dark
                      ? "rgba(255,77,46,0.08)"
                      : extreme
                        ? "rgba(255,77,46,0.07)"
                        : "rgba(255,207,46,0.12)",
                    border: `1px solid ${c}55`,
                  }}
                >
                  <span
                    style={{ width: 7, height: 7, borderRadius: "50%", background: c, marginTop: 5, flexShrink: 0 }}
                  />
                  <div>
                    <div className="te-label" style={{ color: c, letterSpacing: "0.12em" }}>
                      {extreme ? "gas-war mode" : "high slippage"}
                    </div>
                    <div style={{ fontSize: 11.5, color: th.inkSoft, marginTop: 3, lineHeight: 1.4 }}>
                      {extreme
                        ? "accepts almost any fill price. use only to win a contested launch — you may be sandwiched for much loss."
                        : "tx can fill up to " + slippage.toFixed(0) + "% worse than quoted. raises frontrun / MEV risk."}
                    </div>
                  </div>
                </div>
              );
            })()}
        </div>

        {/* aggregator quote scan + details */}
        <div
          style={{
            padding: mobile ? "11px 16px" : "14px 20px",
            display: "flex",
            flexDirection: "column",
            gap: mobile ? 5 : 9,
          }}
        >
          {/* best-of-N scan header (expandable route breakdown) */}
          <button
            className="tap"
            onClick={() => setRouteOpen((o) => !o)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              width: "100%",
              padding: "10px 12px",
              borderRadius: 9,
              cursor: "pointer",
              border: `1px solid ${routeOpen ? th.gold + "88" : th.hair}`,
              background: th.panelHi,
              color: th.ink,
              fontFamily: "'Space Grotesk',sans-serif",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: th.gold, flexShrink: 0 }} />
              <span
                style={{
                  fontWeight: 600,
                  fontSize: 13.5,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {hasResult ? bestName : "scanning"}
              </span>
              {hasResult && bestType ? <Label color={th.mute}>{bestType}</Label> : null}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <Label color={scanning ? th.accent : th.chartUp}>
                {scanning ? "scanning" : hasResult ? `best of ${venueCount || 1}` : "no route"}
              </Label>
              <span
                style={{
                  color: th.mute,
                  fontSize: 11,
                  transform: routeOpen ? "rotate(180deg)" : "none",
                  transition: "transform .2s var(--ease-out)",
                }}
              >
                ▾
              </span>
            </span>
          </button>

          {/* smooth expand via grid-rows 0fr→1fr */}
          <div
            style={{
              display: "grid",
              gridTemplateRows: routeOpen ? "1fr" : "0fr",
              transition: "grid-template-rows var(--t-med) var(--ease-out)",
            }}
          >
            <div style={{ overflow: "hidden", minHeight: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 0 6px" }}>
                <Label style={{ padding: "0 2px 6px" }}>
                  {quoteFailed
                    ? "quotes unavailable — retrying…"
                    : scanning
                      ? "scanning venues…"
                      : hasResult
                        ? `scanned ${venueCount || rows.length} venues${
                            rows.length > 1 ? ` · +${saveVsNext.toFixed(2)}% vs next best` : ""
                          }`
                        : amt > 0
                          ? "no executable route"
                          : "awaiting amount"}
                </Label>
                {(scanning ? rows.length ? rows : SKELETON_ROWS : rows).map((v, i) => {
                  const meta = v.sourceId ? sourceNames[v.sourceId] : null;
                  const name = meta?.name ?? v.displayName ?? v.sourceId ?? "—";
                  const type = meta?.type ?? v.protocolType ?? v.routeType ?? "";
                  const winner = i === 0 && hasResult;
                  const vOut = hasResult ? routeOutputNumber(v, get) : 0;
                  const deficit = hasResult && i > 0 ? venueDeficitPercent(v, best, get) : 0;
                  return (
                    <div
                      key={v.sourceId ? `${v.sourceId}-${i}` : `sk-${i}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "7px 10px",
                        borderRadius: 7,
                        height: 32,
                        background: winner ? (th.dark ? "rgba(255,207,46,0.10)" : "rgba(255,207,46,0.14)") : "transparent",
                        border: `1px solid ${winner ? th.gold + "66" : "transparent"}`,
                        transition: "background var(--t-med), border-color var(--t-med)",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: winner ? th.gold : th.hair,
                            flexShrink: 0,
                          }}
                        />
                        {scanning && !v.sourceId ? (
                          <Skeleton w={84} h={11} r={4} />
                        ) : (
                          <>
                            <span
                              style={{
                                fontSize: 12.5,
                                color: i === 0 ? th.ink : th.inkSoft,
                                fontWeight: i === 0 ? 600 : 400,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {name}
                            </span>
                            {type ? (
                              <Label color={th.mute} style={{ fontSize: 8 }}>
                                {type}
                              </Label>
                            ) : null}
                          </>
                        )}
                      </span>
                      {scanning ? (
                        <Skeleton w={64} h={11} r={4} />
                      ) : (
                        <span
                          className="te-num"
                          style={{
                            fontFamily: "'DM Mono',monospace",
                            fontSize: 12,
                            color: i === 0 ? th.ink : th.mute,
                            flexShrink: 0,
                          }}
                        >
                          {hasResult ? fmt(vOut, dpFor(vOut)) : "—"}
                          {i > 0 && hasResult && (
                            <span style={{ color: th.chartDown, marginLeft: 6 }}>−{deficit.toFixed(2)}%</span>
                          )}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* detail rows — REAL fields only; honesty placeholders elsewhere */}
          <DetailRow
            k="rate"
            compact={mobile}
            loading={scanning}
            v={rate ? `1 ${pay?.symbol ?? ""} = ${fmt(rate, dpFor(rate))} ${get?.symbol ?? ""}` : "—"}
          />
          {/* Atomic split route: show the per-venue input distribution. */}
          {hasResult && best?.routeType === "split" && Array.isArray(best.legs) && best.legs.length > 0 ? (
            <DetailRow
              k="split"
              compact={mobile}
              v={(() => {
                const total = best.legs.reduce((sum, leg) => sum + Number(leg.amountIn ?? 0), 0);
                if (!(total > 0)) return `${best.legs.length} legs · atomic`;
                return `${best.legs
                  .map((leg) => {
                    const pct = Math.round((Number(leg.amountIn ?? 0) / total) * 100);
                    const name = sourceNames[leg.sourceId]?.name ?? leg.sourceId;
                    return `${pct}% ${name}`;
                  })
                  .join(" + ")} · atomic`;
              })()}
            />
          ) : null}
          {/* Honesty: price impact omitted — backend computes no mid-price. */}
          <DetailRow k="price impact" compact={mobile} v="—" />
          <DetailRow
            k="min received"
            compact={mobile}
            loading={scanning}
            v={
              hasResult
                ? `${(() => {
                    const m = minReceivedDecimal(best, get, 6);
                    const mn = Number(m);
                    return Number.isFinite(mn) ? fmt(mn, dpFor(mn)) : m;
                  })()} ${get?.symbol ?? ""}`
                : "—"
            }
          />
          {/* Honesty: router fee is 0% by default — not the design's 0.15%. */}
          <DetailRow k="router fee" compact={mobile} v="0.00%" />
          <DetailRow
            k="network fee"
            compact={mobile}
            loading={scanning}
            v={
              hasResult
                ? (() => {
                    const fee = networkFeeDoge(best);
                    const gas = routeGasUnits(best);
                    if (fee == null) return "—";
                    return `${gas ? `${gas} gas · ` : ""}~${fee} Ð`;
                  })()
                : "—"
            }
          />

          {!mobile && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, paddingTop: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: th.gold }} />
              <Label color={th.mute}>settles to Dogecoin · instant finality</Label>
            </div>
          )}
        </div>
        </div>

        {/* docked chart (desktop only) — chrome only, honest empty canvas */}
        {chartDocked && (
          <div style={{ flex: "1 1 360px", minWidth: 320, display: "flex" }}>
            <ChartPanel
              pay={pay}
              get={get}
              onClose={() => onToggleChart?.()}
              onPop={() => setChartPopout(true)}
            />
          </div>
        )}
      </div>

      {/* fullscreen chart popout (desktop dialog · mobile slide-up sheet) */}
      {chartPopout && <ChartPopout pay={pay} get={get} onClose={() => setChartPopout(false)} />}

      {picker && (
        <TokenPicker
          tokens={tokens}
          excludeSymbol={picker === "pay" ? getSym : paySym}
          onPick={choose}
          onClose={() => setPicker(null)}
          balances={balances}
          owner={wallet.address}
        />
      )}

      {showFlow && (
        <SwapFlow
          pay={pay}
          get={get}
          payAmt={payAmt}
          outNum={outNum}
          minRecvNum={minRecvNum}
          slippage={slippage}
          venue={bestName}
          bestRoute={best}
          quote={quote}
          slippageBps={slippageBps}
          deadlineSeconds={settings.deadline * 60}
          sender={wallet.address}
          onRefresh={refresh}
          isScanning={scanning}
          onClose={() => setShowFlow(false)}
          onComplete={(result) => {
            showToast(
              `Swapped ${fmt(result.payAmt, 2)} ${result.paySym} → ${fmt(
                result.recv,
                result.recv < 1 ? 4 : 2,
              )} ${result.getSym}`,
              "ok",
            );
            // refresh balances now that the swap is confirmed on-chain.
            refreshBalances?.();
          }}
        />
      )}
    </>
  );
}

// Placeholder rows for the scanning skeleton (keeps the list height stable).
const SKELETON_ROWS = [{}, {}, {}];

function DetailRow({ k, v, loading, compact: isCompact }) {
  const th = useTheme();
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        height: isCompact ? 15 : 18,
      }}
    >
      <Label>{k}</Label>
      {loading ? (
        <Skeleton w={76} h={isCompact ? 10 : 12} r={4} />
      ) : (
        <span
          className="te-num"
          style={{ fontFamily: "'DM Mono',monospace", fontSize: isCompact ? 11.5 : 12.5, color: th.inkSoft }}
        >
          {v}
        </span>
      )}
    </div>
  );
}
