// ActivityView.jsx — the ACTIVITY nav section. Faithful port of the design's
// activity.jsx, wired to REAL data from two sources, honestly labelled:
//
//   • LOCAL  — localStorage('doge.history'), written by the swap flow
//     (useSwapExecution → logSwapActivity). Rich: pay/get token marks,
//     {payAmt} → {recv} · {venue}, confirmed/pending/failed pill, relative time.
//   • CHAIN  — getActivity(address, limit) → real Blockscout txns for the
//     connected wallet. Blockscout txns don't carry decoded pay/get token
//     symbols, so we honestly show the tx method + status + relative time and
//     link each row to Blockscout by hash (no fabricated amounts/pairs).
//
// Both streams are merged newest-first and tagged (local · / on-chain ·).
// "clear" clears ONLY the local history (on-chain history is the wallet's own).
// Empty state: Doge mascot + microcopy + accent "start a swap".
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useTheme } from "./theme.js";
import { Label, TokenIcon, fmt, timeAgo } from "./primitives.jsx";
import { useWallet } from "./useWallet.js";
import { getTokens, getActivity, DOGEOS_BLOCKSCOUT_URL } from "../lib/api.js";
import { decorateToken } from "../lib/tokens.js";

const HISTORY_KEY = "doge.history";
const HISTORY_EVENT = "doge:history-updated";

function readLocalHistory() {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function clearLocalHistory() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(HISTORY_KEY);
    window.dispatchEvent(new Event(HISTORY_EVENT));
  } catch {
    /* non-fatal */
  }
}

// Blockscout status → our pill vocabulary.
function chainStatus(item) {
  const s = String(item?.status ?? "").toLowerCase();
  if (s === "ok" || s === "success") return "confirmed";
  if (s === "error" || s === "failed") return "failed";
  if (item?.block_number == null) return "pending";
  return "confirmed";
}

function chainTimestampMs(item) {
  const t = item?.timestamp ? Date.parse(item.timestamp) : NaN;
  return Number.isFinite(t) ? t : Date.now();
}

function txUrl(hash) {
  return `${DOGEOS_BLOCKSCOUT_URL}/tx/${hash}`;
}

function addressUrl(address) {
  return `${DOGEOS_BLOCKSCOUT_URL}/address/${address}`;
}

// Module scope (not redefined per map iteration) so React keeps the row DOM
// stable across re-renders instead of remounting every entry.
function ActivityRow({ href, style, children }) {
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" style={style}>
      {children}
    </a>
  ) : (
    <div style={style}>{children}</div>
  );
}

export default function ActivityView({ onTrade }) {
  const th = useTheme();
  const wallet = useWallet();

  const [local, setLocal] = useState(readLocalHistory);
  const [chain, setChain] = useState([]);
  const [tokens, setTokens] = useState([]);

  // Keep local history live (other tabs / the swap flow in this tab).
  useEffect(() => {
    const sync = () => setLocal(readLocalHistory());
    window.addEventListener("storage", sync);
    window.addEventListener(HISTORY_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(HISTORY_EVENT, sync);
    };
  }, []);

  // Token catalog (for the local rows' pay/get marks).
  useEffect(() => {
    let cancelled = false;
    getTokens()
      .then((body) => {
        if (!cancelled) setTokens(body.data ?? body ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Real on-chain history for the connected wallet.
  useEffect(() => {
    let cancelled = false;
    if (!wallet.address) {
      setChain([]);
      return undefined;
    }
    getActivity(wallet.address, 20)
      .then((body) => {
        if (!cancelled) setChain(Array.isArray(body.data) ? body.data : []);
      })
      .catch(() => {
        if (!cancelled) setChain([]);
      });
    return () => {
      cancelled = true;
    };
  }, [wallet.address]);

  const tokBySym = useCallback(
    (sym) => {
      const t = tokens.find((token) => token.symbol === sym);
      return t ? decorateToken(t) : { sym, glyph: sym?.[0] ?? "?", color: "#8a8779" };
    },
    [tokens],
  );

  // Merge both streams newest-first.
  const entries = useMemo(() => {
    const localRows = local.map((e, i) => ({
      key: `local-${e.hash ?? i}-${e.ts ?? i}`,
      origin: "local",
      paySym: e.paySym,
      getSym: e.getSym,
      payAmt: Number(e.payAmt) || 0,
      recv: Number(e.recv) || 0,
      venue: e.venue,
      status: e.status ?? "confirmed",
      ts: e.ts ?? Date.now(),
      hash: e.hash,
    }));
    const chainRows = chain.map((item, i) => ({
      key: `chain-${item.hash ?? i}`,
      origin: "chain",
      method: item.method,
      status: chainStatus(item),
      ts: chainTimestampMs(item),
      hash: item.hash,
      to: item.to?.hash ?? item.to ?? null,
    }));
    return [...localRows, ...chainRows].sort((a, b) => b.ts - a.ts);
  }, [local, chain]);

  const statusStyle = (s) =>
    ({
      confirmed: { c: th.chartUp, t: "confirmed" },
      pending: { c: th.gold, t: "pending" },
      failed: { c: th.chartDown, t: "failed" },
    })[s] || { c: th.mute, t: s };

  /* ---------- empty state ---------- */
  if (entries.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: "60px 24px",
          textAlign: "center",
        }}
      >
        <img
          src="/doge-mascot.png"
          alt="Doge"
          onError={(e) => {
            e.currentTarget.style.display = "none";
            e.currentTarget.nextSibling.style.display = "flex";
          }}
          style={{ width: 84, height: 84, objectFit: "contain", borderRadius: 18, opacity: 0.92 }}
        />
        <span
          style={{
            display: "none",
            width: 84,
            height: 84,
            borderRadius: 18,
            background: th.gold,
            color: "#1E1405",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 40,
          }}
        >
          Ð
        </span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>no swaps yet</div>
          <Label
            style={{ marginTop: 6, display: "block", textTransform: "none", letterSpacing: 0, fontSize: 12.5 }}
          >
            such empty. your completed swaps will show up here
          </Label>
        </div>
        <button
          className="tap"
          onClick={() => onTrade?.()}
          style={{
            marginTop: 4,
            padding: "11px 20px",
            borderRadius: 10,
            border: "none",
            background: th.accent,
            color: th.onAccent,
            cursor: "pointer",
            fontFamily: "'Space Grotesk',sans-serif",
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          start a swap
        </button>
      </div>
    );
  }

  /* ---------- populated ---------- */
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <Label>recent activity</Label>
          <div style={{ fontWeight: 700, fontSize: 18, marginTop: 2 }}>
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </div>
        </div>
        {local.length > 0 && (
          <button
            className="tap"
            onClick={() => {
              clearLocalHistory();
              setLocal([]);
            }}
            style={{
              padding: "8px 13px",
              borderRadius: 8,
              border: `1px solid ${th.hair}`,
              background: th.panelHi,
              color: th.inkSoft,
              cursor: "pointer",
              fontFamily: "'DM Mono',monospace",
              fontSize: 11,
              letterSpacing: "0.04em",
            }}
          >
            clear
          </button>
        )}
      </div>

      <div
        style={{
          background: th.screen,
          border: `1px solid ${th.hair}`,
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        {entries.map((e, i) => {
          const st = statusStyle(e.status);
          const last = i === entries.length - 1;
          const rowStyle = {
            display: "flex",
            alignItems: "center",
            gap: 13,
            padding: "13px 18px",
            borderBottom: last ? "none" : `1px solid ${th.hair}`,
            textDecoration: "none",
            color: th.ink,
          };
          // Row is a Blockscout link when we have a tx hash, else a plain div.
          const rowHref = e.hash ? txUrl(e.hash) : null;

          const statusBlock = (
            <div
              style={{
                textAlign: "right",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 4,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.c }} />
                <Label color={st.c}>{st.t}</Label>
              </span>
              <span className="te-label" style={{ color: th.mute }}>
                {timeAgo(e.ts)}
              </span>
            </div>
          );

          if (e.origin === "local") {
            const pay = tokBySym(e.paySym);
            const get = tokBySym(e.getSym);
            return (
              <ActivityRow key={e.key} href={rowHref} style={rowStyle}>
                <div style={{ position: "relative", width: 46, height: 30, flexShrink: 0 }}>
                  <span style={{ position: "absolute", left: 0, top: 2 }}>
                    <TokenIcon token={pay} size={26} />
                  </span>
                  <span
                    style={{
                      position: "absolute",
                      right: 0,
                      bottom: 2,
                      outline: `2px solid ${th.screen}`,
                      borderRadius: "50%",
                    }}
                  >
                    <TokenIcon token={get} size={26} />
                  </span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 7 }}>
                    {e.paySym} → {e.getSym}
                    <Label color={th.mute} style={{ fontSize: 8 }}>
                      local
                    </Label>
                  </div>
                  <span
                    className="te-num"
                    style={{ fontFamily: "'DM Mono',monospace", fontSize: 11.5, color: th.mute }}
                  >
                    {fmt(e.payAmt, e.payAmt < 1 ? 4 : 2)} → {fmt(e.recv, e.recv < 1 ? 4 : 2)}
                    {e.venue ? ` · ${e.venue}` : ""}
                  </span>
                </div>
                {statusBlock}
              </ActivityRow>
            );
          }

          // on-chain (Blockscout) row — honest: method + status + time, link out.
          return (
            <ActivityRow key={e.key} href={rowHref} style={rowStyle}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  flexShrink: 0,
                  background: th.panelHi,
                  border: `1px solid ${th.hair}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: th.mute,
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 14,
                }}
              >
                ⛓
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.method || "transaction"}
                  </span>
                  <Label color={th.mute} style={{ fontSize: 8 }}>
                    on-chain
                  </Label>
                </div>
                <span
                  className="te-num"
                  style={{ fontFamily: "'DM Mono',monospace", fontSize: 11.5, color: th.mute }}
                >
                  {e.hash ? `${e.hash.slice(0, 8)}…${e.hash.slice(-6)}` : "—"}
                </span>
              </div>
              {statusBlock}
            </ActivityRow>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, flexWrap: "wrap" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: th.gold }} />
        <Label color={th.mute}>settled on Dogecoin · </Label>
        <a
          href={wallet.address ? addressUrl(wallet.address) : DOGEOS_BLOCKSCOUT_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: th.accent, textDecoration: "none", fontSize: 11, fontFamily: "'DM Mono',monospace" }}
        >
          view on Blockscout ↗
        </a>
      </div>
    </div>
  );
}
