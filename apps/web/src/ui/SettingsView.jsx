// SettingsView.jsx — the SETTINGS nav section. Faithful port of the design's
// settings.jsx (trade defaults / appearance / network cards), EXTENDED with a
// new collapsible "advanced" card that surfaces the REAL backend provenance the
// design has no home for (GET /verification + GET /intelligence).
//
// Wiring:
//   • trade defaults (slippage / gas / deadline / expert) persist via useSettings
//     and feed the swap: SwapView reads default slippage, SwapFlow reads the
//     deadline. The in-swap slider still overrides slippage per-trade.
//   • appearance (dark + accent) wires to useTheme() through useSettings (the
//     Shell builds the theme from these and persists them).
//   • network reads live block/gas from getChainStatus() where available, with
//     documented DogeOS facts as the static frame.
//   • advanced is REAL backend data: classified venue intelligence (active /
//     read-only / watchlist / rejected) + per-source ABI/contract provenance +
//     the verification summary. Compact + expandable; secondary by design.
import React, { useEffect, useMemo, useState } from "react";

import { useTheme, ACCENTS } from "./theme.js";
import { Label, Seg, useIsMobile } from "./primitives.jsx";
import { useSettings, GAS_PRESETS, gasTier } from "./useSettings.js";
import {
  getChainStatus,
  getIntelligence,
  getVerification,
  DOGEOS_CHAIN_ID,
  DOGEOS_BLOCKSCOUT_URL,
  DOGEOS_FAUCET_URL,
} from "../lib/api.js";

// Documented DogeOS network facts (docs.dogeos.com + testnet config).
const NETWORK = {
  name: "DogeOS",
  chainId: DOGEOS_CHAIN_ID,
  security: "Dogecoin PoW",
  tps: "10,000+",
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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
      <div>
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
    expert,
    setExpert,
    dark,
    setDark,
    accent,
    setAccent,
  } = settings;

  // Live chain status for the network card (block / gas) — documented facts frame.
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
  const gasPriceWei = chainStatus?.gasPriceWei;
  const gasGwei =
    gasPriceWei != null && Number.isFinite(Number(gasPriceWei))
      ? (Number(gasPriceWei) / 1e9).toFixed(2)
      : null;

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
        <Row
          label="slippage tolerance"
          hint="default for new swaps — the in-swap slider still overrides per-trade. raise it to win contested launches"
        >
          <Seg
            value={slippage}
            options={[0.5, 5, 25, 50]}
            onChange={setSlippage}
            fmt={(v) => (v >= 50 ? "MAX" : v + "%")}
          />
        </Row>
        <Row label="gas speed" hint="priority fee on DogeOS — fine-tune on the swap dial">
          <Seg
            value={gasTier(gas)}
            options={["eco", "normal", "fast"]}
            onChange={(tier) => setGas(GAS_PRESETS[tier])}
          />
        </Row>
        <Row label="tx deadline" hint="cancel if not confirmed in time">
          <Seg value={deadline} options={[10, 20, 30]} onChange={setDeadline} fmt={(v) => v + "m"} />
        </Row>
        <Row label="expert mode" hint="allow high price impact, skip confirms">
          <Toggle on={expert} onClick={() => setExpert(!expert)} />
        </Row>
      </Card>

      {/* ---------- appearance ---------- */}
      <Card title="appearance">
        <Row label="dark panel" hint="charcoal device shell">
          <Toggle on={dark} onClick={() => setDark(!dark)} />
        </Row>
        <Row label="accent" hint="signal color across the app">
          <div style={{ display: "flex", gap: 8 }}>
            {ACCENTS.map((c) => (
              <button
                key={c}
                className="tap"
                onClick={() => setAccent(c)}
                title={c}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: c,
                  cursor: "pointer",
                  border: accent === c ? `2px solid ${th.ink}` : `2px solid ${th.hair}`,
                  boxShadow: accent === c ? `0 0 0 2px ${th.panel}` : "none",
                }}
              />
            ))}
          </div>
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
        <Row label="chain id" hint="add to your EVM wallet">
          <span className="te-num" style={mono(th, th.inkSoft)}>
            {NETWORK.chainId}
          </span>
        </Row>
        <Row label="secured by" hint="state anchored to Dogecoin via ZK proofs">
          <span className="te-num" style={mono(th, th.inkSoft)}>
            {NETWORK.security}
          </span>
        </Row>
        <Row label="throughput" hint="instant finality via PWR Chain">
          <span className="te-num" style={mono(th, th.inkSoft)}>
            {NETWORK.tps} TPS
          </span>
        </Row>
        <Row label="latest block" hint="live from the DogeOS RPC">
          <span className="te-num" style={mono(th, blockNumber != null ? th.chartUp : th.mute)}>
            {blockNumber != null ? `#${Number(blockNumber).toLocaleString("en-US")}` : "—"}
          </span>
        </Row>
        <Row label="gas price" hint="live base priority fee">
          <span className="te-num" style={mono(th, gasGwei != null ? th.inkSoft : th.mute)}>
            {gasGwei != null ? `${gasGwei} gwei` : "—"}
          </span>
        </Row>
        <Row label="deposits / withdrawals" hint="free deposits · instant withdrawals">
          <span className="te-num" style={mono(th, th.chartUp)}>
            free · instant
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

      {/* ---------- advanced (NEW) — real verification + intelligence ---------- */}
      <AdvancedCard />
    </div>
  );
}

/* ---------- advanced: REAL /verification + /intelligence provenance ---------- */
function AdvancedCard() {
  const th = useTheme();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [intel, setIntel] = useState(null);
  const [verification, setVerification] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  // Lazy-fetch when first expanded (this is secondary data).
  useEffect(() => {
    if (!open || loaded) return undefined;
    let cancelled = false;
    Promise.allSettled([getIntelligence(), getVerification()]).then(([i, v]) => {
      if (cancelled) return;
      if (i.status === "fulfilled") setIntel(i.value.data ?? i.value);
      if (v.status === "fulfilled") setVerification(v.value.data ?? v.value);
      if (i.status === "rejected" && v.status === "rejected") {
        setError("provenance feed unavailable");
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  const summary = intel?.summary;
  const checkedAt = verification?.checkedAt;
  const verSummary = verification?.summary;

  // Bucket label + the matching classified source array from intelligence.
  const groups = useMemo(() => {
    if (!intel) return [];
    return [
      { key: "active", label: "active · executable", color: th.chartUp, items: intel.activeExecutable ?? [] },
      { key: "readonly", label: "read-only · quote", color: th.gold, items: intel.readOnlyQuote ?? [] },
      { key: "watchlist", label: "watchlist", color: th.inkSoft, items: intel.watchlistCandidates ?? [] },
      { key: "rejected", label: "rejected", color: th.chartDown, items: intel.rejectedSurfaces ?? [] },
    ];
  }, [intel, th]);

  return (
    <div
      style={{
        background: th.screen,
        border: `1px solid ${th.hair}`,
        borderRadius: 16,
        overflow: "hidden",
        gridColumn: mobile ? "auto" : "1 / -1",
      }}
    >
      <button
        className="tap"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          padding: "13px 18px",
          borderBottom: open ? `1px solid ${th.hair}` : "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: th.ink,
          fontFamily: "'Space Grotesk',sans-serif",
        }}
      >
        <span style={{ width: 12, height: 12, background: th.accent, borderRadius: 3 }} />
        <Label color={th.inkSoft} style={{ fontSize: 11 }}>
          advanced · source provenance
        </Label>
        {summary ? (
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <Label color={th.chartUp}>{summary.activeExecutable} active</Label>
            <span
              style={{
                color: th.mute,
                fontSize: 11,
                transform: open ? "rotate(180deg)" : "none",
                transition: "transform .2s var(--ease-out)",
              }}
            >
              ▾
            </span>
          </span>
        ) : (
          <span
            style={{
              marginLeft: "auto",
              color: th.mute,
              fontSize: 11,
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform .2s var(--ease-out)",
            }}
          >
            ▾
          </span>
        )}
      </button>

      {/* smooth expand via grid-rows 0fr→1fr */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows var(--t-med) var(--ease-out)",
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            {!loaded && <Label>loading provenance…</Label>}
            {loaded && error && <Label color={th.chartDown}>{error}</Label>}

            {loaded && !error && (
              <>
                {/* verification banner */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "10px 12px",
                    borderRadius: 9,
                    background: th.panelHi,
                    border: `1px solid ${th.hair}`,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: verSummary?.hasBlockingMismatch ? th.chartDown : th.chartUp,
                    }}
                  />
                  <div style={{ fontSize: 12.5, color: th.inkSoft, lineHeight: 1.4, flex: 1, minWidth: 0 }}>
                    {verSummary?.hasBlockingMismatch
                      ? "verification found a blocking mismatch"
                      : verification?.summary?.live === false
                        ? verification?.summary?.reason ?? "static registry snapshot"
                        : "all checked sources match their on-chain bytecode"}
                  </div>
                  {checkedAt && (
                    <span className="te-num" style={{ ...mono(th, th.mute), fontSize: 10.5 }}>
                      {new Date(checkedAt).toLocaleString("en-US")}
                    </span>
                  )}
                </div>

                {/* classified buckets */}
                {groups.map((g) => (
                  <div key={g.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: g.color }} />
                      <Label color={g.color}>{g.label}</Label>
                      <Label color={th.mute}>· {g.items.length}</Label>
                    </div>
                    {g.items.length === 0 ? (
                      <Label color={th.mute} style={{ paddingLeft: 14 }}>
                        none
                      </Label>
                    ) : (
                      g.items.map((item) => (
                        <SourceRow key={item.sourceId ?? item.surfaceId} item={item} group={g.key} />
                      ))
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// A single source / surface — compact summary line + expandable evidence.
function SourceRow({ item, group }) {
  const th = useTheme();
  const [open, setOpen] = useState(false);

  const isRejected = group === "rejected";
  const contracts = item.contracts;
  const abi = item.abi;

  // Compact one-line provenance summary (counts / ABI provenance / reason).
  const line = isRejected
    ? item.category ?? "rejected"
    : contracts
      ? `${contracts.routers}R · ${contracts.quoters}Q · ${contracts.pools}P · ${contracts.executableRouters} exec`
      : item.protocolType ?? "";

  return (
    <div
      style={{
        border: `1px solid ${th.hair}`,
        borderRadius: 9,
        background: th.panel,
        marginLeft: 14,
        overflow: "hidden",
      }}
    >
      <button
        className="tap"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 11px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: th.ink,
          fontFamily: "'Space Grotesk',sans-serif",
          textAlign: "left",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 12.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.displayName ?? item.sourceId ?? item.surfaceId}
        </span>
        {(item.protocolType || isRejected) && (
          <Label color={th.mute} style={{ fontSize: 8 }}>
            {isRejected ? item.category : item.protocolType}
          </Label>
        )}
        <span
          className="te-num"
          style={{ marginLeft: "auto", fontFamily: "'DM Mono',monospace", fontSize: 10.5, color: th.mute, flexShrink: 0 }}
        >
          {line}
        </span>
        <span
          style={{
            color: th.mute,
            fontSize: 10,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .2s var(--ease-out)",
            flexShrink: 0,
          }}
        >
          ▾
        </span>
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows var(--t-med) var(--ease-out)",
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div
            style={{
              padding: "2px 11px 11px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              borderTop: `1px solid ${th.hair}`,
            }}
          >
            {/* rejected surface: reason + evidence */}
            {isRejected && (
              <>
                {item.reason && (
                  <div style={{ fontSize: 11.5, color: th.inkSoft, lineHeight: 1.4, paddingTop: 6 }}>
                    {item.reason}
                  </div>
                )}
                {(item.evidence ?? []).map((ev, i) => (
                  <div key={i} style={{ display: "flex", gap: 7, fontSize: 11, color: th.mute, lineHeight: 1.4 }}>
                    <span style={{ color: th.chartDown }}>·</span>
                    {ev}
                  </div>
                ))}
              </>
            )}

            {/* active / read-only / watchlist: contracts + abi + liquidity */}
            {!isRejected && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, paddingTop: 6 }}>
                <EvidenceRow k="status" v={item.status ?? "—"} />
                {item.execution && (
                  <EvidenceRow
                    k="execution"
                    v={item.execution.enabled ? "enabled" : item.execution.reason ?? "disabled"}
                    color={item.execution.enabled ? th.chartUp : th.mute}
                  />
                )}
                {contracts && (
                  <EvidenceRow
                    k="contracts"
                    v={`${contracts.total} total · ${contracts.routers} router · ${contracts.quoters} quoter · ${contracts.pools} pool`}
                  />
                )}
                {item.liquidity && (
                  <EvidenceRow
                    k="liquidity"
                    v={`${item.liquidity.livePoolCount}/${item.liquidity.totalPoolCount} live${
                      item.liquidity.pairs?.length ? ` · ${item.liquidity.pairs.slice(0, 3).join(", ")}` : ""
                    }`}
                  />
                )}
                {abi && (
                  <EvidenceRow
                    k="abi proof"
                    v={[
                      abi.blockscoutAbiAvailable ? "blockscout" : null,
                      abi.adapterAbiArtifactVerified ? "adapter-artifact" : null,
                      abi.venueAbiArtifactVerified ? "venue-artifact" : null,
                      ...(abi.provenance ?? []).filter((p) => p && p !== "none"),
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  />
                )}
                {item.supportedPairs?.length ? (
                  <EvidenceRow k="pairs" v={item.supportedPairs.join(", ")} />
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EvidenceRow({ k, v, color }) {
  const th = useTheme();
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
      <Label style={{ flexShrink: 0 }}>{k}</Label>
      <span
        className="te-num"
        style={{
          fontFamily: "'DM Mono',monospace",
          fontSize: 11,
          color: color ?? th.inkSoft,
          textAlign: "right",
          wordBreak: "break-word",
        }}
      >
        {v}
      </span>
    </div>
  );
}
