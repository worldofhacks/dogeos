// Toast.jsx — tiny transient notification system for the DogeSwap UI.
//
// A ToastHost (mounted once in Shell) listens for a window CustomEvent and
// renders a stack of auto-dismissing pills. showToast(message, kind) fires the
// event from anywhere (no prop drilling). Entrances are transform-only and
// reduced-motion safe; kinds: 'ok' | 'err' | 'info'.
import React, { useEffect, useState } from "react";

import { useTheme } from "./theme.js";

const TOAST_EVENT = "dogeos:toast";

// Fire a toast from anywhere (components, hooks, lib code).
export function showToast(message, kind = "info") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message, kind } }));
}

let toastSeq = 0;

export function ToastHost() {
  const th = useTheme();
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    function onToast(event) {
      const { message, kind } = event.detail ?? {};
      if (!message) return;
      const id = ++toastSeq;
      setToasts((list) => [...list, { id, message, kind }]);
      setTimeout(() => {
        setToasts((list) => list.filter((t) => t.id !== id));
      }, 4200);
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: "calc(24px + env(safe-area-inset-bottom))",
        transform: "translateX(-50%)",
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        pointerEvents: "none",
        width: "max-content",
        maxWidth: "92vw",
      }}
    >
      {toasts.map((t) => {
        const accent =
          t.kind === "ok" ? th.chartUp : t.kind === "err" ? th.chartDown : th.accent;
        return (
          <div
            key={t.id}
            className="anim-rise"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "11px 16px",
              borderRadius: 12,
              background: th.dark ? "rgba(29,29,25,0.96)" : "rgba(28,28,28,0.95)",
              color: "#f1efe6",
              border: `1px solid ${accent}66`,
              boxShadow: "0 12px 36px rgba(0,0,0,0.34)",
              fontFamily: "'Space Grotesk',sans-serif",
              fontSize: 13.5,
              fontWeight: 600,
              pointerEvents: "auto",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: accent,
                flexShrink: 0,
              }}
            />
            {t.message}
          </div>
        );
      })}
    </div>
  );
}
