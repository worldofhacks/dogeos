// SettingsView.jsx — the SETTINGS nav section. Faithful port of the design's
// settings.jsx (trade defaults / appearance / network cards).
//
// Wiring:
//   • trade defaults (slippage / gas / deadline) persist via useSettings
//     and feed the swap: SwapView reads default slippage, SwapFlow reads the
//     deadline. The in-swap slider still overrides slippage per-trade.
//   • appearance (dark panel) wires to useTheme() through useSettings (the
//     Shell builds the theme from these and persists them).
//   • network reads the live latest block from getChainStatus() where
//     available, with documented DogeOS facts as the static frame.
import React, { useEffect, useState } from "react";

import { useTheme } from "./theme.js";
import { Label, Seg } from "./primitives.jsx";
import {
  useSettings,
  GAS_PRESETS,
  gasTier,
  SLIPPAGE_PRESETS,
  MAX_SLIPPAGE_PERCENT,
  clampSlippagePercent,
} from "./useSettings.js";
import { sanitizeAmountInput } from "../lib/units.js";
import {
  getChainStatus,
  DOGEOS_BLOCKSCOUT_URL,
  DOGEOS_FAUCET_URL,
} from "../lib/api.js";

// Documented DogeOS network facts (docs.dogeos.com + testnet config).
const NETWORK = {
  name: "DogeOS",
  explorer: DOGEOS_BLOCKSCOUT_URL,
  faucet: DOGEOS_FAUCET_URL,
};

function Toggle({ on, onClick }) {
  const th = useTheme();
  return (
    <button
      className="tap"
      onClick={onClick}
      style={{
        width: 46,
        height: 26,
        borderRadius: 999,
        border: "none",
        cursor: "pointer",
        position: "relative",
        background: on ? th.accent : th.hair,
        transition: "background .15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 23 : 3,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#fff",
          transition: "left .15s",
          boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
        }}
      />
    </button>
  );
}

function Card({ title, right, children }) {
  const th = useTheme();
  return (
    <div style={{ background: th.screen, border: `1px solid ${th.hair}`, borderRadius: 16, overflow: "hidden" }}>
      <div
        style={{
          padding: "13px 18px",
          borderBottom: `1px solid ${th.hair}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ width: 12, height: 12, background: th.accent, borderRadius: 3 }} />
        <Label color={th.inkSoft} style={{ fontSize: 11 }}>
          {title}
        </Label>
        {right ? <span style={{ marginLeft: "auto" }}>{right}</span> : null}
      </div>
      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>
    </div>
  );
}

function Row({ label, hint, children }) {
  const th = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: th.ink }}>{label}</div>
        {hint && (
          <Label
            style={{ marginTop: 3, display: "block", textTransform: "none", letterSpacing: 0, fontSize: 11.5 }}
          >
            {hint}
          </Label>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function mono(th, color) {
  return { fontFamily: "'DM Mono',monospace", fontSize: 12.5, color: color ?? th.inkSoft };
}

export default function SettingsView() {
  const th = useTheme();
  const settings = useSettings();

  const {
    slippage,
    setSlippage,
    gas,
    setGas,
    deadline,
    setDeadline,
    dark,
    setDark,
  } = settings;

  // Custom-slippage text mirror so the input accepts free typing; presets cap
  // at 5%, the input is the expert gate up to MAX_SLIPPAGE_PERCENT.
  const [slipText, setSlipText] = useState(String(slippage));
  const applySlippage = (value) => {
    const clamped = clampSlippagePercent(value);
    setSlippage(clamped);
    setSlipText(String(clamped));
  };

  // Live chain status for the network card (latest block).
  const [chainStatus, setChainStatus] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getChainStatus()
      .then((body) => {
        if (!cancelled) setChainStatus(body.data ?? body);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const blockNumber = chainStatus?.blockNumber;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
        gap: 16,
        alignItems: "start",
      }}
    >
      {/* ---------- trade defaults ---------- */}
      <Card title="trade defaults">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: th.ink }}>slippage tolerance</div>
            <Label
              style={{ marginTop: 3, display: "block", textTransform: "none", letterSpacing: 0, fontSize: 11.5 }}
            >
              {`default for new swaps — the in-swap control still overrides per-trade. presets cap at 5%; type a custom value (up to ${MAX_SLIPPAGE_PERCENT}%) for volatile launches — higher = more frontrun / MEV risk`}
            </Label>
          </div>
          <div style={{ display: "flex", gap: 7, alignItems: "stretch" }}>
            {SLIPPAGE_PRESETS.map((p) => {
              const active = Math.abs(slippage - p) < 0.0001;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => applySlippage(p)}
                  style={{
                    flex: 1,
                    padding: "6px 0",
                    borderRadius: 9,
                    cursor: "pointer",
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 12,
                    color: active ? th.ink : th.mute,
                    background: active
                      ? th.dark
                        ? "rgba(255,207,46,0.14)"
                        : "rgba(255,207,46,0.16)"
                      : "transparent",
                    border: `1px solid ${active ? th.gold + "88" : th.hair}`,
                    transition: "background 120ms, border-color 120ms",
                  }}
                >
                  {p}%
                </button>
              );
            })}
            <div style={{ position: "relative", width: 88, flexShrink: 0 }}>
              <input
                inputMode="decimal"
                value={slipText}
                title={`custom slippage — up to ${MAX_SLIPPAGE_PERCENT}%`}
                aria-label="custom slippage percent"
                placeholder="custom"
                onChange={(e) => {
                  const cleaned = sanitizeAmountInput(e.target.value);
                  setSlipText(cleaned);
                  const v = Number.parseFloat(cleaned);
                  if (Number.isFinite(v)) setSlippage(clampSlippagePercent(v));
                }}
                onBlur={() => setSlipText(String(slippage))}
                style={{
                  width: "100%",
                  padding: "6px 20px 6px 10px",
                  borderRadius: 9,
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 12,
                  textAlign: "right",
                  color: th.ink,
                  background: "transparent",
                  border: `1px solid ${th.hair}`,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 12,
                  color: th.mute,
                  pointerEvents: "none",
                }}
              >
                %
              </span>
            </div>
          </div>
        </div>
        <Row
          label="gas speed"
          hint="sequencer tip, scaled to the live DogeOS base fee — normal adds ~50%, fast ~200%. higher gets ordered first under congestion"
        >
          <Seg
            value={gasTier(gas)}
            options={["eco", "normal", "fast"]}
            onChange={(tier) => setGas(GAS_PRESETS[tier])}
          />
        </Row>
        <Row label="tx deadline" hint="cancel if not confirmed in time">
          <Seg value={deadline} options={[10, 20, 30]} onChange={setDeadline} fmt={(v) => v + "m"} />
        </Row>
      </Card>

      {/* ---------- appearance ---------- */}
      <Card title="appearance">
        <Row label="dark panel" hint="charcoal device shell">
          <Toggle on={dark} onClick={() => setDark(!dark)} />
        </Row>
      </Card>

      {/* ---------- network ---------- */}
      <Card title="network">
        <Row label={NETWORK.name + " Chikyū"} hint="EVM L2 testnet · gas paid in DOGE">
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: th.gold }} />
            <Label color={th.gold}>testnet</Label>
          </span>
        </Row>
        <Row label="latest block" hint="live from the DogeOS RPC">
          <span className="te-num" style={mono(th, blockNumber != null ? th.chartUp : th.mute)}>
            {blockNumber != null ? `#${Number(blockNumber).toLocaleString("en-US")}` : "—"}
          </span>
        </Row>
        <Row label="explorer" hint="blockscout.testnet.dogeos.com">
          <a
            href={NETWORK.explorer}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...mono(th, th.accent), textDecoration: "none" }}
          >
            open ↗
          </a>
        </Row>
        <Row label="faucet" hint="get testnet DOGE + tokens">
          <a
            href={NETWORK.faucet}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...mono(th, th.accent), textDecoration: "none" }}
          >
            open ↗
          </a>
        </Row>
      </Card>
    </div>
  );
}
