// TokensView.jsx — the TOKENS nav section. Faithful port of the design's
// tokens-view.jsx TokensView, wired to REAL data and honest about what we lack.
//
// REAL: token catalog from /tokens (symbol/name/address/decimals/provenance),
//   verified ✓ / unverified ⚠ badge from provenance, live balances from the
//   connected wallet (eth_call via useTokenBalances), trade ⇅ jumps to the swap
//   view with that token preset as the "get" side.
// HONESTLY OMITTED: no USD column, no 7d sparkline, no %change — DogeOS testnet
//   has no price feed, so the design's "portfolio value $total", per-token price,
//   sparkline and change% are dropped cleanly (not faked). The eyebrow shows a
//   token COUNT, not a fake $ total.
import React, { useEffect, useMemo, useState } from "react";

import { useTheme } from "./theme.js";
import { Label, TokenIcon, compact, useIsMobile } from "./primitives.jsx";
import { useWallet } from "./useWallet.js";
import { useTokenBalances } from "./useTokenBalances.js";
import { getTokens } from "../lib/api.js";
import {
  decorateToken,
  filterTokens,
  compactAddress,
  trustTierLabel,
  trustTierColorKey,
} from "../lib/tokens.js";
import { unitsToNumber, walletBalanceKey } from "../lib/units.js";

export default function TokensView({ onTrade }) {
  const th = useTheme();
  const mobile = useIsMobile();
  const wallet = useWallet();

  const [tokens, setTokens] = useState([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    getTokens()
      .then((body) => {
        if (!cancelled) setTokens(body.data ?? body ?? []);
      })
      .catch(() => {
        /* leave empty — the empty state below covers it */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live balances for the whole catalog (only when connected).
  const { balances } = useTokenBalances({
    owner: wallet.address,
    chainId: wallet.chainId,
    tokens,
  });

  const balanceOf = (token) => {
    if (!token || !wallet.address) return 0;
    try {
      const key = walletBalanceKey(token.address);
      return Object.prototype.hasOwnProperty.call(balances, key)
        ? unitsToNumber(balances[key], token.decimals)
        : 0;
    } catch {
      return 0;
    }
  };

  const list = useMemo(() => filterTokens(tokens, q), [tokens, q]);
  const connected = wallet.isConnected;

  const search = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "10px 14px",
        borderRadius: 10,
        border: `1px solid ${th.hair}`,
        background: th.panelHi,
        minWidth: mobile ? 0 : 220,
        flex: mobile ? "1 1 100%" : "0 0 auto",
      }}
    >
      <span style={{ color: th.mute }}>⌕</span>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="filter tokens"
        style={{
          border: "none",
          background: "transparent",
          outline: "none",
          flex: 1,
          minWidth: 0,
          fontFamily: "'Space Grotesk',sans-serif",
          fontSize: 14,
          color: th.ink,
        }}
      />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* header — token count, NOT a fake $ total (no price feed) */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <Label>tokens on DogeOS</Label>
          <div
            className="te-num"
            style={{
              fontFamily: "'DM Mono',monospace",
              fontSize: 30,
              fontWeight: 500,
              color: th.ink,
              letterSpacing: "-0.02em",
            }}
          >
            {tokens.length || "—"}
            <span style={{ fontSize: 15, color: th.mute, marginLeft: 8 }}>
              {tokens.length === 1 ? "asset" : "assets"}
            </span>
          </div>
        </div>
        {search}
      </div>

      {/* table */}
      <div
        style={{
          background: th.screen,
          border: `1px solid ${th.hair}`,
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", padding: "10px 20px", borderBottom: `1px solid ${th.hair}` }}>
          <Label style={{ flex: 1 }}>asset</Label>
          <Label style={{ width: mobile ? 90 : 120, textAlign: "right" }}>balance</Label>
          <Label style={{ width: 60, textAlign: "right" }}>trade</Label>
        </div>

        {list.map((token) => {
          const deco = decorateToken(token);
          const bal = balanceOf(token);
          return (
            <div
              key={token.address ?? token.symbol}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "12px 20px",
                borderBottom: `1px solid ${th.hair}`,
              }}
            >
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <TokenIcon token={deco} size={34} />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 15,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {token.symbol}
                    {deco.verified ? (
                      <span title="verified" style={{ color: th.chartUp, fontSize: 11 }}>
                        ✓
                      </span>
                    ) : (
                      <span
                        title={`unverified · ${trustTierLabel(deco.trustTier)} trust — DYOR`}
                        style={{ color: th[trustTierColorKey(deco.trustTier)], fontSize: 10 }}
                      >
                        {!deco.trustTier || deco.trustTier === "low" ? "⚠" : "◆"}
                      </span>
                    )}
                    <Label color={th.mute} style={{ fontSize: 9 }}>
                      {token.name}
                    </Label>
                  </div>
                  <span
                    className="te-num"
                    style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: th.mute }}
                  >
                    {compactAddress(token.address)}
                  </span>
                </div>
              </div>
              {/* REAL balance — no USD value (no price feed) */}
              <div style={{ width: mobile ? 90 : 120, textAlign: "right" }}>
                {connected ? (
                  <div
                    className="te-num"
                    style={{ fontFamily: "'DM Mono',monospace", fontSize: 13.5, color: th.ink }}
                  >
                    {compact(bal)}
                  </div>
                ) : (
                  <span
                    className="te-num"
                    style={{ fontFamily: "'DM Mono',monospace", fontSize: 13.5, color: th.mute }}
                  >
                    —
                  </span>
                )}
              </div>
              <div style={{ width: 60, display: "flex", justifyContent: "flex-end" }}>
                <button
                  className="tap"
                  title={`trade ${token.symbol}`}
                  onClick={() => onTrade?.(token)}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    border: `1px solid ${th.hair}`,
                    background: th.panelHi,
                    color: th.accent,
                    cursor: "pointer",
                    fontSize: 15,
                    fontWeight: 700,
                  }}
                >
                  ⇅
                </button>
              </div>
            </div>
          );
        })}

        {tokens.length > 0 && list.length === 0 && (
          <div style={{ padding: 30, textAlign: "center" }}>
            <Label>No tokens match “{q}”</Label>
          </div>
        )}
        {tokens.length === 0 && (
          <div style={{ padding: 30, textAlign: "center" }}>
            <Label>loading tokens…</Label>
          </div>
        )}
      </div>

      {/* disconnected prompt — no balances without a wallet */}
      {!connected && tokens.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: "14px 16px",
            borderRadius: 12,
            border: `1px dashed ${th.hair}`,
            background: th.panelHi,
            flexWrap: "wrap",
          }}
        >
          <Label color={th.mute}>connect a wallet to see your balances</Label>
          <button
            className="tap"
            onClick={() => wallet.connect()}
            disabled={wallet.isConnecting}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              border: "none",
              background: th.accent,
              color: th.onAccent,
              cursor: "pointer",
              fontFamily: "'Space Grotesk',sans-serif",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {wallet.isConnecting ? "connecting" : "connect"}
          </button>
        </div>
      )}
    </div>
  );
}
