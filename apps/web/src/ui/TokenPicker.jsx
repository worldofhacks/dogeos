// TokenPicker.jsx — token selection overlay opened by the pay/get chips.
// Ported from the design's tokens-view.jsx (Modal + ModalHead + TokenRow +
// TokenPicker). Honesty: no USD price, no 7d change, no sparkline (no price
// feed) — we show the user's REAL wallet balance per token instead. Verified
// badge comes from the documented token provenance.
import React, { useEffect, useRef, useState } from "react";

import { useTheme } from "./theme.js";
import { Label, TokenIcon, useIsMobile, compact } from "./primitives.jsx";
import { decorateToken, filterTokens, compactAddress } from "../lib/tokens.js";
import { unitsToNumber, walletBalanceKey } from "../lib/units.js";
import { scanToken } from "../lib/api.js";
import { addCustomToken } from "../lib/customTokens.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function Modal({ children, onClose, width = 420 }) {
  const th = useTheme();
  const mobile = useIsMobile();
  const sheetRef = useRef(null);
  const dragRef = useRef({ y0: 0, dy: 0 });
  const [closing, setClosing] = useState(false);

  const close = () => {
    setClosing(true);
    setTimeout(onClose, 240);
  };

  // drag-to-dismiss on the mobile sheet handle
  const onHandleDown = (e) => {
    if (!mobile) return;
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
        zIndex: 150,
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
          maxHeight: mobile ? "90vh" : "88vh",
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
        {mobile && (
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
        <ModalHead title="select token" onClose={close} />
        {children}
      </div>
    </div>
  );
}

function ModalHead({ title, onClose }) {
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
    </div>
  );
}

function balanceText(token, balances, owner) {
  if (!owner) return null;
  let key;
  try {
    key = walletBalanceKey(token.address);
  } catch {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(balances, key)) return null;
  return compact(unitsToNumber(balances[key], token.decimals));
}

function TokenRow({ token, onClick, disabled, balances, owner }) {
  const th = useTheme();
  const deco = decorateToken(token);
  const bal = balanceText(token, balances, owner);
  return (
    <button
      className="tap"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        textAlign: "left",
        padding: "11px 20px",
        border: "none",
        borderBottom: `1px solid ${th.hair}`,
        background: "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        color: th.ink,
        fontFamily: "'Space Grotesk',sans-serif",
      }}
    >
      <TokenIcon token={deco} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{token.symbol}</span>
          {deco.verified ? (
            <span title="verified" style={{ color: th.chartUp, fontSize: 12 }}>
              ✓
            </span>
          ) : (
            <span title="unverified — trade with care" style={{ color: th.chartDown, fontSize: 11 }}>
              ⚠
            </span>
          )}
          <Label color={th.mute}>{token.name}</Label>
        </div>
        <span
          className="te-num"
          style={{ fontFamily: "'DM Mono',monospace", fontSize: 10.5, color: th.mute }}
        >
          {compactAddress(token.address)}
        </span>
      </div>
      {/* Honesty: real wallet balance (or nothing) — no USD/sparkline. */}
      <div style={{ textAlign: "right", minWidth: 56 }}>
        {bal != null ? (
          <div
            className="te-num"
            style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: th.ink }}
          >
            {bal}
          </div>
        ) : null}
      </div>
    </button>
  );
}

export default function TokenPicker({ tokens, excludeSymbol, onPick, onImport, onClose, balances = {}, owner = "" }) {
  const th = useTheme();
  const [q, setQ] = useState("");
  const list = filterTokens(tokens, q);
  const quickSyms = ["DOGE", "USDC", "WDOGE", "WETH", "LBTC"];
  const quick = quickSyms.map((s) => tokens.find((t) => t.symbol === s)).filter(Boolean);

  // Paste-to-import: when the query is a contract address not already in the
  // list, scan it on-chain (metadata + pools across every venue) and offer it.
  const trimmed = q.trim();
  const isAddress = ADDRESS_RE.test(trimmed);
  const known = isAddress
    ? tokens.some((t) => String(t.address).toLowerCase() === trimmed.toLowerCase())
    : false;
  const [scan, setScan] = useState({ status: "idle", token: null, pools: [], error: "" });

  useEffect(() => {
    if (!isAddress || known) {
      setScan({ status: "idle", token: null, pools: [], error: "" });
      return undefined;
    }
    let cancelled = false;
    setScan({ status: "loading", token: null, pools: [], error: "" });
    scanToken(trimmed)
      .then((res) => {
        if (cancelled) return;
        if (!res.routable) {
          setScan({ status: "error", token: res.token, pools: [], error: "No liquidity pools found on any venue." });
        } else {
          setScan({ status: "found", token: res.token, pools: res.pools ?? [], error: "" });
        }
      })
      .catch((err) => {
        if (!cancelled) setScan({ status: "error", token: null, pools: [], error: err?.message || "Not a valid token." });
      });
    return () => {
      cancelled = true;
    };
  }, [trimmed, isAddress, known]);

  const importToken = (token, pools) => {
    addCustomToken(token);
    onImport?.(token, pools);
    onPick({ ...token, custom: true });
  };

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: "16px 20px 12px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "11px 14px",
            borderRadius: 10,
            border: `1px solid ${th.hair}`,
            background: th.panelHi,
          }}
        >
          <span style={{ color: th.mute }}>⌕</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search name or paste address"
            style={{
              border: "none",
              background: "transparent",
              outline: "none",
              flex: 1,
              fontFamily: "'Space Grotesk',sans-serif",
              fontSize: 14,
              color: th.ink,
            }}
          />
        </div>
        {quick.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 12 }}>
            {quick.map((t) => {
              const dis = t.symbol === excludeSymbol;
              const deco = decorateToken(t);
              return (
                <button
                  key={t.symbol}
                  className="tap"
                  onClick={dis ? undefined : () => onPick(t)}
                  disabled={dis}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 11px 6px 6px",
                    borderRadius: 999,
                    border: `1px solid ${th.hair}`,
                    background: th.panelHi,
                    color: th.ink,
                    cursor: dis ? "not-allowed" : "pointer",
                    opacity: dis ? 0.4 : 1,
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "'Space Grotesk',sans-serif",
                  }}
                >
                  <TokenIcon token={deco} size={20} />
                  {t.symbol}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ overflowY: "auto", borderTop: `1px solid ${th.hair}` }}>
        {list.map((t) => (
          <TokenRow
            key={t.address}
            token={t}
            disabled={t.symbol === excludeSymbol}
            onClick={() => onPick(t)}
            balances={balances}
            owner={owner}
          />
        ))}
        {/* Paste-an-address import flow */}
        {isAddress && !known && (
          <div style={{ padding: "14px 18px" }}>
            {scan.status === "loading" && <Label>scanning venues for pools…</Label>}
            {scan.status === "error" && (
              <Label color={th.chartDown}>
                {scan.token ? `${scan.token.symbol}: ` : ""}{scan.error}
              </Label>
            )}
            {scan.status === "found" && (
              <button
                className="tap"
                onClick={() => importToken(scan.token, scan.pools)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "11px 12px",
                  borderRadius: 12,
                  border: `1px solid ${th.accent}`,
                  background: th.panelHi,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <TokenIcon token={decorateToken(scan.token)} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: th.ink }}>
                    {scan.token.symbol}{" "}
                    <span style={{ color: th.mute, fontWeight: 400, fontSize: 12 }}>{scan.token.name}</span>
                  </div>
                  <span className="te-num" style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: th.mute }}>
                    {compactAddress(scan.token.address)} ·{" "}
                    {new Set(scan.pools.map((p) => p.sourceId)).size} venue
                    {new Set(scan.pools.map((p) => p.sourceId)).size === 1 ? "" : "s"}
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: "'Space Grotesk',sans-serif",
                    fontWeight: 700,
                    fontSize: 12,
                    color: th.accent,
                    textTransform: "uppercase",
                  }}
                >
                  import
                </span>
              </button>
            )}
          </div>
        )}
        {list.length === 0 && !(isAddress && !known) && (
          <div style={{ padding: 30, textAlign: "center" }}>
            <Label>no tokens match “{q}”</Label>
          </div>
        )}
      </div>
    </Modal>
  );
}
