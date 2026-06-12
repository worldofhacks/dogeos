// WalletChooser.jsx — minimal injected-wallet picker.
//
// Only used in the no-clientId injected fallback path, and only when MORE THAN
// ONE injected EIP-6963 wallet is present on the page (otherwise connect() goes
// straight to MyDoge). When a DOGEOS_CLIENT_ID is provisioned the DogeOS Connect
// Kit modal is the chooser instead and this never renders.
//
// Driven entirely by useWallet(): `wallet.chooser` holds the discovered wallet
// list, `wallet.chooseWallet(preference)` connects the picked wallet, and
// `wallet.cancelChooser()` dismisses. Mounted once in Shell alongside ToastHost.
import React from "react";

import { useTheme } from "./theme.js";
import { Label } from "./primitives.jsx";

export default function WalletChooser({ chooser, onChoose, onCancel }) {
  const th = useTheme();
  if (!chooser) return null;
  const wallets = chooser.wallets ?? [];

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      <div
        className="anim-rise"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Choose a wallet"
        style={{
          width: "100%",
          maxWidth: 340,
          background: th.panel,
          borderRadius: 16,
          border: `1px solid ${th.hair}`,
          boxShadow: "0 18px 44px rgba(0,0,0,0.34)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: `1px solid ${th.hair}`,
          }}
        >
          <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 15 }}>
            connect a wallet
          </span>
          <button
            className="tap"
            onClick={onCancel}
            aria-label="Close"
            style={{
              border: "none",
              background: "transparent",
              color: th.mute,
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12 }}>
          {wallets.map((w, i) => (
            <button
              key={`${w.rdns || w.label}-${i}`}
              className="tap lift"
              onClick={() => onChoose(w.preference)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 11,
                border: `1px solid ${th.hair}`,
                background: th.panelHi,
                color: th.ink,
                cursor: "pointer",
                fontFamily: "'Space Grotesk',sans-serif",
                fontWeight: 600,
                fontSize: 14,
                textAlign: "left",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: w.preference === "mydoge" ? th.gold : th.accent,
                  flexShrink: 0,
                }}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.label}</span>
            </button>
          ))}
        </div>

        <div style={{ padding: "0 16px 14px" }}>
          <Label color={th.mute}>
            Don’t see MyDoge? Install it.
          </Label>
        </div>
      </div>
    </div>
  );
}
