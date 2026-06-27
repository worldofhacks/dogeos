// ActivityView.jsx — the ACTIVITY nav section. Faithful port of the design's
// activity.jsx, wired to REAL data from two sources, honestly labelled:
//
//   • LOCAL  — localStorage('doge.history'), written by the swap flow
//     (useSwapExecution → logSwapActivity). Rich: pay/get token marks,
//     {payAmt} → {recv} · {venue}, confirmed/pending/failed pill, relative time.
//   • CHAIN  — getActivity(address, limit) → real Blockscout txns for the
//     connected wallet, FILTERED to swaps only (method contains "swap", or the
//     tx targets a known venue/aggregator router from /sources). Approvals,
//     transfers and other on-chain actions are not shown. Blockscout txns
//     don't carry decoded pay/get token symbols, so we honestly show the tx
//     method + status + relative time and link each row to Blockscout by hash.
//
// Both streams are merged newest-first and tagged (local · / on-chain ·); a
// swap that exists in both (same tx hash) renders once, as the richer local row.
// "clear" clears ONLY the local history (on-chain history is the wallet's own).
// Empty state: Doge mascot + microcopy + accent "start a swap".
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useTheme } from "./theme.js";
import { Label, TokenIcon, fmt, timeAgo } from "./primitives.jsx";
import { useWallet } from "./useWallet.js";
import { getTokens, getActivity, getSources, DOGEOS_BLOCKSCOUT_URL } from "../lib/api.js";
import { decorateToken } from "../lib/tokens.js";

const HISTORY_KEY = "doge.history";
const HISTORY_EVENT = "doge:history-updated";

// Fetch the server max, then filter to swaps client-side (a 20-tx page of
// mixed activity could leave just a couple of swaps).
const ACTIVITY_FETCH_LIMIT = 50;

// Module-level stale-while-revalidate caches: switching to this tab renders
// the last known data instantly and refreshes in the background, instead of
// re-paying token catalog + Blockscout latency on every visit.
let tokensCache = null; //            token list
let routersCache = null; //           Set<lowercase router address> from /sources
let activityCache = { address: "", items: null }; // last chain fetch per wallet
let swapLegsCache = { address: "", legs: null }; // tx hash → pay/get legs

// Swaps-only filter for the on-chain stream. A tx is a swap when its decoded
// method says so, or when it targets a known venue/aggregator router (the
// DogeSwapRouter's method is "execute", which alone doesn't say "swap").
// Until /sources arrives (routers === null) we accept "execute"/"multicall"
// so router swaps aren't missing from the first paint.
function isSwapTransaction(item, routers) {
  const method = String(item?.method ?? "").toLowerCase();
  if (method.includes("swap")) return true;
  const to = String(item?.to?.hash ?? item?.to ?? "").toLowerCase();
  if (routers) return routers.has(to);
  return method === "execute" || method === "multicall";
}

// Reconstruct each swap's pay/get legs from the wallet's Blockscout token
// transfers (CORS-open API): per tx hash, the user's outgoing transfer is the
// pay side and the incoming one is the get side. Amounts are summed per token
// (split routes move the same pair through several venues in one tx).
function tokenTransfersUrl(address) {
  return `${DOGEOS_BLOCKSCOUT_URL}/api/v2/addresses/${address}/token-transfers`;
}

function transferAmount(total) {
  const value = Number(total?.value);
  const decimals = Number(total?.decimals ?? 18);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value / 10 ** (Number.isFinite(decimals) ? decimals : 18);
}

// Map: lowercase tx hash → { pay: {token, amount}, get: {token, amount} }
function indexSwapLegsByTx(transfers, address) {
  const user = String(address ?? "").toLowerCase();
  const byTx = new Map();
  for (const item of Array.isArray(transfers) ? transfers : []) {
    const hash = String(item?.transaction_hash ?? item?.tx_hash ?? "").toLowerCase();
    const token = item?.token;
    if (!hash || !token?.symbol) continue;
    const from = String(item?.from?.hash ?? "").toLowerCase();
    const to = String(item?.to?.hash ?? "").toLowerCase();
    const side = from === user ? "pay" : to === user ? "get" : null;
    if (!side) continue;
    const legs = byTx.get(hash) ?? { pay: new Map(), get: new Map() };
    const key = String(token.address ?? token.symbol).toLowerCase();
    const prior = legs[side].get(key) ?? { token, amount: 0 };
    prior.amount += transferAmount(item.total);
    legs[side].set(key, prior);
    byTx.set(hash, legs);
  }
  // Collapse each side to its dominant token (by amount moved).
  const resolved = new Map();
  for (const [hash, legs] of byTx) {
    const top = (sideMap) =>
      [...sideMap.values()].sort((a, b) => b.amount - a.amount)[0] ?? null;
    resolved.set(hash, { pay: top(legs.pay), get: top(legs.get) });
  }
  return resolved;
}

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
  // Seed every stream from the module caches so a revisit paints instantly.
  const [chain, setChain] = useState(() =>
    activityCache.address === wallet.address && activityCache.items ? activityCache.items : [],
  );
  const [chainLoaded, setChainLoaded] = useState(
    () => activityCache.address === wallet.address && activityCache.items != null,
  );
  const [tokens, setTokens] = useState(() => tokensCache ?? []);
  const [routers, setRouters] = useState(() => routersCache);

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

  // Token catalog (for the local rows' pay/get marks) — cached across visits.
  useEffect(() => {
    let cancelled = false;
    getTokens()
      .then((body) => {
        const list = body.data ?? body ?? [];
        tokensCache = list;
        if (!cancelled) setTokens(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Venue/aggregator router addresses (for the swaps-only filter) — cached.
  useEffect(() => {
    if (routersCache) return undefined;
    let cancelled = false;
    getSources()
      .then((body) => {
        const sources = body.data ?? body ?? [];
        const set = new Set(
          sources.map((s) => String(s.router ?? "").toLowerCase()).filter((a) => a.startsWith("0x")),
        );
        routersCache = set;
        if (!cancelled) setRouters(set);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Token transfers per swap tx (pay/get legs for the on-chain rows) — cached.
  const [swapLegs, setSwapLegs] = useState(() =>
    swapLegsCache.address === wallet.address ? swapLegsCache.legs : null,
  );
  useEffect(() => {
    let cancelled = false;
    if (!wallet.address) {
      setSwapLegs(null);
      return undefined;
    }
    fetch(tokenTransfersUrl(wallet.address))
      .then((r) => r.json())
      .then((body) => {
        const legs = indexSwapLegsByTx(body?.items, wallet.address);
        swapLegsCache = { address: wallet.address, legs };
        if (!cancelled) setSwapLegs(legs);
      })
      .catch(() => {
        /* legs are an enrichment — rows fall back to the method layout */
      });
    return () => {
      cancelled = true;
    };
  }, [wallet.address]);

  // Real on-chain history for the connected wallet — stale-while-revalidate.
  useEffect(() => {
    let cancelled = false;
    if (!wallet.address) {
      setChain([]);
      setChainLoaded(true);
      return undefined;
    }
    const cached = activityCache.address === wallet.address && activityCache.items;
    if (cached) {
      setChain(activityCache.items);
      setChainLoaded(true);
    } else {
      setChainLoaded(false);
    }
    getActivity(wallet.address, ACTIVITY_FETCH_LIMIT)
      .then((body) => {
        const items = Array.isArray(body.data) ? body.data : [];
        activityCache = { address: wallet.address, items };
        if (!cancelled) {
          setChain(items);
          setChainLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setChainLoaded(true);
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

  // Token mark for an on-chain leg: prefer the catalog entry (brand color /
  // logo) by address, else decorate the Blockscout token info directly.
  const tokForLeg = useCallback(
    (info, sym) => {
      const addr = String(info?.address ?? "").toLowerCase();
      const fromCatalog = addr
        ? tokens.find((token) => String(token.address ?? "").toLowerCase() === addr)
        : null;
      if (fromCatalog) return decorateToken(fromCatalog);
      if (info?.symbol) {
        return decorateToken({ symbol: info.symbol, address: info.address, icon_url: info.icon_url });
      }
      return tokBySym(sym);
    },
    [tokens, tokBySym],
  );

  // Merge both streams newest-first: chain rows filtered to swaps only, and
  // any swap already in local history (same tx hash) renders once as the
  // richer local row instead of twice.
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
    const localHashes = new Set(localRows.map((e) => String(e.hash ?? "").toLowerCase()).filter(Boolean));
    const chainRows = chain
      .filter((item) => isSwapTransaction(item, routers))
      .filter((item) => !localHashes.has(String(item.hash ?? "").toLowerCase()))
      .map((item, i) => {
        // Pay/get legs from the wallet's token transfers; a DOGE-in swap has
        // no outgoing ERC-20 transfer, so the native tx value is the pay side.
        const legs = swapLegs?.get(String(item.hash ?? "").toLowerCase()) ?? null;
        let pay = legs?.pay ?? null;
        const get = legs?.get ?? null;
        const nativeIn = Number(item.value);
        if (!pay && Number.isFinite(nativeIn) && nativeIn > 0) {
          pay = { token: { symbol: "DOGE" }, amount: nativeIn / 1e18 };
        }
        return {
          key: `chain-${item.hash ?? i}`,
          origin: "chain",
          method: item.method,
          status: chainStatus(item),
          ts: chainTimestampMs(item),
          hash: item.hash,
          to: item.to?.hash ?? item.to ?? null,
          paySym: pay?.token?.symbol,
          getSym: get?.token?.symbol,
          payAmt: pay?.amount ?? 0,
          recv: get?.amount ?? 0,
          payTokenInfo: pay?.token ?? null,
          getTokenInfo: get?.token ?? null,
        };
      });
    return [...localRows, ...chainRows].sort((a, b) => b.ts - a.ts);
  }, [local, chain, routers, swapLegs]);

  const statusStyle = (s) =>
    ({
      confirmed: { c: th.chartUp, t: "confirmed" },
      pending: { c: th.gold, t: "pending" },
      failed: { c: th.chartDown, t: "failed" },
    })[s] || { c: th.mute, t: s };

  /* ---------- first-load state (nothing cached yet) ---------- */
  if (entries.length === 0 && !chainLoaded) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: "60px 24px",
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: `2px solid ${th.hair}`,
            borderTopColor: th.accent,
            animation: "ds-spin 0.8s linear infinite",
          }}
        />
        <Label color={th.mute}>loading your swaps…</Label>
      </div>
    );
  }

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
          <Label>recent swaps</Label>
          <div style={{ fontWeight: 700, fontSize: 18, marginTop: 2 }}>
            {entries.length} {entries.length === 1 ? "swap" : "swaps"}
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

          // Token-pair layout whenever both legs are known — local history rows
          // and on-chain rows enriched from the wallet's token transfers.
          if (e.paySym && e.getSym) {
            const pay =
              e.origin === "local" ? tokBySym(e.paySym) : tokForLeg(e.payTokenInfo, e.paySym);
            const get =
              e.origin === "local" ? tokBySym(e.getSym) : tokForLeg(e.getTokenInfo, e.getSym);
            const amounts =
              e.payAmt > 0 || e.recv > 0
                ? `${fmt(e.payAmt, e.payAmt < 1 ? 4 : 2)} → ${fmt(e.recv, e.recv < 1 ? 4 : 2)}`
                : null;
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
                      {e.origin === "local" ? "local" : "on-chain"}
                    </Label>
                  </div>
                  <span
                    className="te-num"
                    style={{ fontFamily: "'DM Mono',monospace", fontSize: 11.5, color: th.mute }}
                  >
                    {amounts ?? (e.hash ? `${e.hash.slice(0, 8)}…${e.hash.slice(-6)}` : "—")}
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
