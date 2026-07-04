// Toast.jsx — tiny transient notification system for the DogeSwap UI.
//
// A ToastHost (mounted once in Shell) listens for a window CustomEvent and
// renders a stack of auto-dismissing pills. showToast(message, kind) fires the
// event from anywhere (no prop drilling). Entrances are transform-only and
// reduced-motion safe; kinds: 'ok' | 'err' | 'info'.
//
// The whole stack is pointer-transparent (pointer-events: none on the container
// AND the pills): pills are display-only, so they must never steal taps from UI
// beneath them — QA caught the bottom tab bar being unclickable for the life of
// a toast stack (issue #14). If a pill ever grows an interactive control (e.g.
// a dismiss button), set pointer-events: auto on THAT control only.
import React, { useEffect, useState } from "react";

import { useIsMobile } from "./primitives.jsx";
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
  // Same breakpoint as Shell: when the mobile shell shows its fixed bottom tab
  // bar (~75px + safe-area inset tall), anchor the stack above it so pills
  // never cover the nav; on the desktop shell 24px off the bottom is clear.
  const mobile = useIsMobile();
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
        bottom: mobile
          ? "calc(90px + env(safe-area-inset-bottom))"
          : "calc(24px + env(safe-area-inset-bottom))",
        transform: "translateX(-50%)",
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        // Grow upward from the anchor but never past half the viewport: in
        // short landscape viewports a burst of toasts must not climb over the
        // header/nav. Oldest pills clip at the top (justify-end + hidden);
        // their 4.2s dismiss timers are untouched.
        justifyContent: "flex-end",
        maxHeight: "min(50vh, 340px)",
        overflow: "hidden",
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
              // Deliberately NO pointerEvents: "auto" here — pills are
              // display-only and must stay tap-transparent (see file header).
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
