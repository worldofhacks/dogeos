// Shell.jsx — the DogeSwap app shell: device frame, header lockup, nav, testnet
// pill, connect chip, provenance footer, and overlay-slot scaffolding.
// Faithfully ported from the design's shell.jsx. The four views render as
// placeholder panels (filled in by later tasks); the overlay slots are stubs.
import React, { useEffect, useMemo, useState } from "react";

import { ThemeCtx, makeTheme } from "./theme.js";
import { Label, useIsMobile, haptic, truncateAddress } from "./primitives.jsx";
import { useWallet } from "./useWallet.js";
import { useSettings } from "./useSettings.js";
import SwapView from "./SwapView.jsx";
import TokensView from "./TokensView.jsx";
import ActivityView from "./ActivityView.jsx";
import SettingsView from "./SettingsView.jsx";
import { ToastHost } from "./Toast.jsx";
import WalletChooser from "./WalletChooser.jsx";
import { getChainStatus, DOGEOS_CHAIN_ID } from "../lib/api.js";

const NAV_ITEMS = [
  ["swap", "01"],
  ["tokens", "02"],
  ["activity", "03"],
  ["settings", "04"],
];

/* corner screw on the desktop bezel */
function Screw({ pos, theme }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: `radial-gradient(circle at 35% 30%, ${theme.dark ? "#444" : "#fff"}, ${theme.dark ? "#222" : "#c4c2b8"})`,
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)",
        ...pos,
      }}
    />
  );
}

/* crisp line icons for the mobile tab bar */
function TabIcon({ name, active }) {
  const sw = active ? 1.9 : 1.7;
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: sw,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  if (name === "swap")
    return (
      <svg {...common}>
        <path d="M7 4v15" />
        <path d="M4 7l3-3 3 3" />
        <path d="M17 20V5" />
        <path d="M20 17l-3 3-3-3" />
      </svg>
    );
  if (name === "tokens")
    return (
      <svg {...common}>
        <circle cx="9" cy="9" r="5" />
        <circle cx="15.5" cy="15.5" r="5" />
      </svg>
    );
  if (name === "activity")
    return (
      <svg {...common}>
        <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
      </svg>
    );
  return (
    // settings — mixer sliders
    <svg {...common}>
      <line x1="4" y1="8" x2="20" y2="8" />
      <circle cx="15" cy="8" r="2.4" fill="currentColor" stroke="none" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="9" cy="16" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function Shell() {
  // Theme is driven by persisted settings (Settings view → appearance card).
  const settings = useSettings();
  const theme = useMemo(() => makeTheme(settings.dark, settings.accent), [settings.dark, settings.accent]);

  const [view, setView] = useState("swap");
  const mobile = useIsMobile();
  const wallet = useWallet();

  // A token preset requested from Tokens/Activity → jump to swap. SwapView reads
  // `swapPreset` (the buy/"get" token) and clears it once consumed.
  const [swapPreset, setSwapPreset] = useState(null);
  const goSwapWith = (token) => {
    setSwapPreset(token ?? null);
    setView("swap");
    haptic(6);
  };

  // Docked-chart toggle (the SwapView header chart button flips this; SwapView
  // renders the chart panel/popout since it owns the live pay/get pair). When the
  // chart is docked on a wide desktop viewport while on the swap view, the device
  // frame widens to make room (matches the design's side-by-side layout).
  const [chartPop, setChartPop] = useState(false);
  const [vw, setVw] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const f = () => setVw(window.innerWidth);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const sideBySide = chartPop && vw >= 1000 && view === "swap";

  // Live chain status for the footer (chain id / latest block).
  const [chainStatus, setChainStatus] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getChainStatus()
      .then((body) => {
        if (!cancelled) setChainStatus(body.data ?? body);
      })
      .catch(() => {
        /* footer falls back to the documented chain id */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chainId = chainStatus?.chainId ?? chainStatus?.expectedChainId ?? DOGEOS_CHAIN_ID;

  // connect chip: disconnected = accent "connect"; connected = pill + gold dot +
  // truncated address (click disconnects).
  const connectChip = wallet.isConnected ? (
    <button
      className="tap"
      onClick={() => wallet.disconnect()}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 12px",
        borderRadius: 999,
        border: `1px solid ${theme.hair}`,
        background: theme.panelHi,
        color: theme.ink,
        cursor: "pointer",
        fontFamily: "'DM Mono',monospace",
        fontSize: 12.5,
      }}
    >
      <span style={{ width: 18, height: 18, borderRadius: "50%", background: theme.gold }} />
      {truncateAddress(wallet.address)}
    </button>
  ) : (
    <button
      className="tap"
      onClick={() => wallet.connect()}
      disabled={wallet.isConnecting}
      style={{
        padding: "9px 16px",
        borderRadius: 999,
        border: "none",
        background: theme.accent,
        color: theme.onAccent,
        cursor: "pointer",
        fontFamily: "'Space Grotesk',sans-serif",
        fontWeight: 700,
        fontSize: 13,
        boxShadow: theme.dark ? "none" : "0 2px 0 rgba(0,0,0,0.16)",
      }}
    >
      {wallet.isConnecting ? "connecting" : "connect"}
    </button>
  );

  // Render the active view.
  const renderView = () => {
    if (view === "tokens") return <TokensView onTrade={goSwapWith} />;
    if (view === "activity") return <ActivityView onTrade={() => goSwapWith(null)} />;
    if (view === "settings") return <SettingsView />;
    return (
      <SwapView
        chartOn={chartPop}
        onToggleChart={() => setChartPop((v) => !v)}
        preset={swapPreset}
        onPresetConsumed={() => setSwapPreset(null)}
      />
    );
  };

  const content = (
    <div key={view} className="anim-rise" style={{ padding: mobile ? "16px 14px 0" : "clamp(14px,2vw,22px)" }}>
      {renderView()}
    </div>
  );

  // Overlay slots. The SwapFlow execution modal + chart panel/popout render
  // inside SwapView (it owns the live quote/route/balances/pair). The ToastHost
  // lives here so confirmed-swap toasts render above the whole shell. The
  // WalletChooser appears only in the injected (no-clientId) path when several
  // injected wallets are present and the user hasn't picked one.
  const overlays = (
    <>
      <ToastHost />
      <WalletChooser
        chooser={wallet.chooser}
        onChoose={(preference) => wallet.chooseWallet(preference)}
        onCancel={() => wallet.cancelChooser()}
      />
    </>
  );

  // ===== MOBILE: edge-to-edge, sticky frosted header, fixed bottom tab bar =====
  if (mobile) {
    return (
      <ThemeCtx.Provider value={theme}>
        <div
          style={{
            minHeight: "100vh",
            background: theme.bg,
            color: theme.ink,
            fontFamily: "'Space Grotesk',sans-serif",
            transition: "background .2s",
          }}
        >
          {/* sticky frosted header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 18px calc(14px + env(safe-area-inset-top))",
              paddingTop: "max(14px, env(safe-area-inset-top))",
              position: "sticky",
              top: 0,
              zIndex: 20,
              background: theme.dark ? "rgba(22,21,15,0.72)" : "rgba(231,229,221,0.72)",
              backdropFilter: "blur(16px) saturate(1.4)",
              WebkitBackdropFilter: "blur(16px) saturate(1.4)",
              borderBottom: `1px solid ${theme.hair}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  background: theme.gold,
                  color: "#1E1405",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 16,
                  boxShadow: "inset 0 0 0 1.5px rgba(0,0,0,0.06)",
                }}
              >
                Ð
              </span>
              <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em" }}>
                Doge<span style={{ color: theme.accent }}>Swap</span>
              </span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "3px 8px",
                  borderRadius: 999,
                  background: theme.dark ? "rgba(255,207,46,0.14)" : "rgba(255,207,46,0.18)",
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: theme.gold }} />
                <span className="te-label" style={{ color: theme.dark ? theme.gold : "#9a7d12", fontSize: 8 }}>
                  testnet
                </span>
              </span>
            </div>
            <div style={{ marginLeft: "auto" }}>{connectChip}</div>
          </div>

          {/* content + provenance footer */}
          <div style={{ padding: "16px 14px", paddingBottom: "calc(94px + env(safe-area-inset-bottom))" }}>
            <div key={view} className="anim-rise">
              {renderView()}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "20px 16px 6px",
                flexWrap: "wrap",
              }}
            >
              <Label color={theme.mute}>DogeOS Chikyū · chain {chainId}</Label>
              <span style={{ width: 3, height: 3, borderRadius: "50%", background: theme.mute }} />
              <Label color={theme.mute}>secured by Dogecoin PoW</Label>
            </div>
          </div>

          {/* fixed bottom tab bar */}
          <div
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 90,
              display: "flex",
              gap: 2,
              padding: "7px 8px calc(9px + env(safe-area-inset-bottom))",
              background: theme.dark ? "rgba(22,21,15,0.82)" : "rgba(244,243,238,0.86)",
              backdropFilter: "blur(18px) saturate(1.5)",
              WebkitBackdropFilter: "blur(18px) saturate(1.5)",
              borderTop: `1px solid ${theme.hair}`,
            }}
          >
            {NAV_ITEMS.map(([k]) => {
              const on = view === k;
              return (
                <button
                  key={k}
                  className="tap"
                  onClick={() => {
                    setView(k);
                    haptic(6);
                  }}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    padding: "7px 0 5px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    color: on ? theme.accent : theme.mute,
                    position: "relative",
                  }}
                >
                  {/* active top indicator */}
                  <span
                    style={{
                      position: "absolute",
                      top: -7,
                      width: on ? 26 : 0,
                      height: 3,
                      borderRadius: 3,
                      background: theme.accent,
                      transition: "width var(--t-med) var(--ease-spring)",
                    }}
                  />
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 52,
                      height: 32,
                      borderRadius: 11,
                      background: on
                        ? theme.dark
                          ? "rgba(255,77,46,0.18)"
                          : "rgba(255,77,46,0.12)"
                        : "transparent",
                      transition:
                        "background var(--t-med) var(--ease-out), transform var(--t-med) var(--ease-spring)",
                      transform: on ? "translateY(-1px)" : "none",
                    }}
                  >
                    <TabIcon name={k} active={on} />
                  </span>
                  <span className="te-label" style={{ color: on ? theme.accent : theme.mute, fontSize: 8.5 }}>
                    {k}
                  </span>
                </button>
              );
            })}
          </div>

          {overlays}
        </div>
      </ThemeCtx.Provider>
    );
  }

  // ===== DESKTOP: device shell with bezel + corner screws =====
  const header = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "13px 18px",
        borderBottom: `1px solid ${theme.hair}`,
        flexWrap: "wrap",
        background: theme.panel,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span
          style={{
            width: 24,
            height: 24,
            background: theme.gold,
            color: "#1E1405",
            borderRadius: 7,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 15,
            boxShadow: "inset 0 0 0 1.5px rgba(0,0,0,0.06)",
          }}
        >
          Ð
        </span>
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>
          Doge<span style={{ color: theme.accent }}>Swap</span>
        </span>
        <span className="te-label" style={{ color: theme.mute }}>
          aggregator
        </span>
      </div>

      {/* desktop inline numbered nav */}
      <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
        {NAV_ITEMS.map(([k, n]) => (
          <button
            key={k}
            className="tap"
            onClick={() => setView(k)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
              borderRadius: 8,
              border: `1px solid ${view === k ? theme.hairHi : "transparent"}`,
              background: view === k ? theme.panelHi : "transparent",
              color: view === k ? theme.ink : theme.mute,
              cursor: "pointer",
              fontFamily: "'Space Grotesk',sans-serif",
              fontWeight: 600,
              fontSize: 13.5,
              textTransform: "capitalize",
            }}
          >
            <span className="te-label te-num" style={{ color: view === k ? theme.accent : theme.mute }}>
              {n}
            </span>
            {k}
          </button>
        ))}
      </div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9 }}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 11px",
            borderRadius: 999,
            border: `1px solid ${theme.hair}`,
            background: theme.panelHi,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: theme.gold }} />
          <span className="te-label" style={{ color: theme.inkSoft }}>
            testnet
          </span>
        </span>
        {connectChip}
      </div>
    </div>
  );

  return (
    <ThemeCtx.Provider value={theme}>
      <div
        style={{
          minHeight: "100vh",
          background: theme.bg,
          color: theme.ink,
          fontFamily: "'Space Grotesk',sans-serif",
          padding: "clamp(10px, 3vw, 30px)",
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
          transition: "background .2s",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: sideBySide ? 1180 : 820,
            background: theme.shell,
            borderRadius: 26,
            padding: "clamp(8px,1.4vw,15px)",
            position: "relative",
            boxShadow: theme.dark ? "0 20px 50px rgba(0,0,0,0.5)" : "0 18px 44px rgba(60,55,40,0.16)",
            transition: "max-width .35s var(--ease-out)",
          }}
        >
          <Screw pos={{ top: 9, left: 9 }} theme={theme} />
          <Screw pos={{ top: 9, right: 9 }} theme={theme} />
          <Screw pos={{ bottom: 9, left: 9 }} theme={theme} />
          <Screw pos={{ bottom: 9, right: 9 }} theme={theme} />

          <div
            style={{
              background: theme.panel,
              borderRadius: 18,
              border: `1px solid ${theme.hair}`,
              overflow: "hidden",
            }}
          >
            {header}
            {content}
          </div>

          {/* provenance footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: "12px 6px 4px",
              flexWrap: "wrap",
            }}
          >
            <Label color={theme.mute}>DogeOS Chikyū Testnet · chain {chainId}</Label>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: theme.mute }} />
            <Label color={theme.mute}>secured by Dogecoin PoW</Label>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: theme.mute }} />
            <Label color={theme.mute}>ZK-anchored · 10,000+ TPS</Label>
          </div>
        </div>

        {overlays}
      </div>
    </ThemeCtx.Provider>
  );
}
