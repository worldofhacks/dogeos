// ConnectKitModal.jsx — lightweight look-alike of the DogeOS (Tomo) Connect Kit modal.
//
// Why this exists: the real SDK modal is a ~13.7MB chunk that parses for >1s on first
// load. This modal opens INSTANTLY (it's plain app code) and:
//   • connects a detected browser wallet (MyDoge / MetaMask) via the injected bridge with
//     NO SDK chunk — the fast path;
//   • hands off to the real SDK Connect Kit (lazy-loaded) for email / social / mobile
//     (WalletConnect), which inherently need the SDK.
// It mirrors the SDK modal's layout (social-first, "Or connect a wallet" toggle, teal
// primary) so the experience looks consistent whichever path the user takes.
import React, { useState } from "react";

// SDK Connect Kit primary (Tomo theme) — kept in sync with sdkConfig.js theme.primary.
const TEAL = "#0d9488";
const TEAL_SOFT = "#5cc2b8";

function XLogo() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001 6.19 5.238 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

// Self-contained SMIL spinner (no global CSS / keyframes needed).
export function Spinner({ size = 18, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <circle cx="12" cy="12" r="9" stroke={color} strokeOpacity="0.22" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke={color} strokeWidth="3" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.7s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

function SocialButton({ label, icon, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      className="tap"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        padding: "13px 14px",
        borderRadius: 14,
        border: `1.5px solid ${hover ? TEAL : "#e7e7e9"}`,
        background: hover ? "#f0fbf9" : "#ffffff",
        color: "#101014",
        cursor: "pointer",
        fontFamily: "'Space Grotesk',sans-serif",
        fontWeight: 600,
        fontSize: 15,
        transition: "border-color .12s, background .12s",
      }}
    >
      <span style={{ display: "flex", color: "#101014" }}>{icon}</span>
      {label}
    </button>
  );
}

export default function ConnectKitModal({ open, loading = false, wallets = [], onClose, onPickWallet, onStartSocial }) {
  const [view, setView] = useState("home"); // "home" (social) | "wallets"
  const [email, setEmail] = useState("");
  if (!open) return null;

  const submitEmail = (e) => {
    e.preventDefault();
    onStartSocial?.("email");
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(17,17,20,0.45)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
      }}
    >
      <div
        className="anim-rise"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Connect"
        style={{
          width: "100%",
          maxWidth: 430,
          background: "#ffffff",
          color: "#101014",
          borderRadius: 20,
          boxShadow: "0 24px 60px rgba(0,0,0,0.32)",
          overflow: "hidden",
          fontFamily: "'Space Grotesk',sans-serif",
        }}
      >
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 22px 6px" }}>
          <span style={{ fontWeight: 700, fontSize: 19, color: "#101014" }}>
            {loading ? "Opening sign-in…" : view === "home" ? "Log in or sign up" : "Connect a wallet"}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {!loading && (
              <button
                className="tap"
                onClick={() => setView(view === "home" ? "wallets" : "home")}
                style={{
                  border: "none",
                  background: "transparent",
                  color: TEAL,
                  cursor: "pointer",
                  fontFamily: "'Space Grotesk',sans-serif",
                  fontWeight: 600,
                  fontSize: 13.5,
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  padding: 0,
                }}
              >
                {view === "home" ? "Or connect a wallet ›" : "‹ Back"}
              </button>
            )}
            <button
              className="tap"
              onClick={onClose}
              aria-label="Close"
              style={{ border: "none", background: "transparent", color: "#9a9aa2", cursor: "pointer", fontSize: 17, lineHeight: 1, padding: 2 }}
            >
              ✕
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: "28px 22px 40px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            <span style={{ color: TEAL }}><Spinner size={34} /></span>
            <span style={{ color: "#6a6a72", fontSize: 14.5 }}>Loading sign-in options…</span>
          </div>
        ) : (
        <div style={{ padding: "16px 22px 18px" }}>
          {view === "home" ? (
            <>
              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                <SocialButton label="Twitter" icon={<XLogo />} onClick={() => onStartSocial?.("x")} />
                <SocialButton label="Google" icon={<GoogleLogo />} onClick={() => onStartSocial?.("google")} />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "22px 0 18px" }}>
                <div style={{ flex: 1, height: 1, background: "#ececef" }} />
                <span style={{ color: "#9a9aa2", fontSize: 13 }}>or continue with</span>
                <div style={{ flex: 1, height: 1, background: "#ececef" }} />
              </div>

              <form onSubmit={submitEmail}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "15px 16px",
                    borderRadius: 13,
                    border: "1px solid #ececef",
                    background: "#f4f4f6",
                    color: "#101014",
                    fontFamily: "'Space Grotesk',sans-serif",
                    fontSize: 15,
                    outline: "none",
                  }}
                />
                <button
                  type="submit"
                  className="tap lift"
                  style={{
                    width: "100%",
                    marginTop: 16,
                    padding: "14px",
                    borderRadius: 13,
                    border: "none",
                    background: TEAL_SOFT,
                    color: "#ffffff",
                    cursor: "pointer",
                    fontFamily: "'Space Grotesk',sans-serif",
                    fontWeight: 700,
                    fontSize: 15,
                  }}
                >
                  Continue
                </button>
              </form>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              {wallets.length === 0 && (
                <div style={{ color: "#6a6a72", fontSize: 13.5, padding: "4px 2px 10px" }}>
                  No browser wallet detected. Install MyDoge, or use WalletConnect / email login below.
                </div>
              )}
              {wallets.map((w, i) => (
                <button
                  key={`${w.rdns || w.label}-${i}`}
                  className="tap lift"
                  onClick={() => onPickWallet?.(w.preference)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "14px 15px",
                    borderRadius: 13,
                    border: "1px solid #ececef",
                    background: "#fbfbfc",
                    color: "#101014",
                    cursor: "pointer",
                    fontFamily: "'Space Grotesk',sans-serif",
                    fontWeight: 600,
                    fontSize: 15,
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      background: w.preference === "mydoge" ? "#FED70B" : "#eef0f3",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      flexShrink: 0,
                    }}
                  >
                    {w.preference === "mydoge" ? "🐕" : "🦊"}
                  </span>
                  <span style={{ flex: 1 }}>{w.label}</span>
                  <span style={{ color: "#16a34a", fontSize: 12.5, fontWeight: 600 }}>installed</span>
                </button>
              ))}
              <button
                className="tap"
                onClick={() => onStartSocial?.("walletconnect")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "14px 15px",
                  borderRadius: 13,
                  border: "1px dashed #d8d8dc",
                  background: "#ffffff",
                  color: "#101014",
                  cursor: "pointer",
                  fontFamily: "'Space Grotesk',sans-serif",
                  fontWeight: 600,
                  fontSize: 15,
                  textAlign: "left",
                }}
              >
                <span style={{ width: 30, height: 30, borderRadius: 9, background: "#3b99fc", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>📱</span>
                <span style={{ flex: 1 }}>WalletConnect / mobile</span>
                <span style={{ color: "#9a9aa2", fontSize: 15 }}>›</span>
              </button>
            </div>
          )}

          {/* footer */}
          <div style={{ textAlign: "center", marginTop: 22 }}>
            <div style={{ color: "#9a9aa2", fontSize: 12.5, lineHeight: 1.5 }}>
              By connecting, you agree to our{" "}
              <span style={{ color: TEAL, fontWeight: 600 }}>Terms of Service</span> &amp;{" "}
              <span style={{ color: TEAL, fontWeight: 600 }}>Privacy Policy.</span>
            </div>
            <div style={{ color: "#b6b6bc", fontSize: 12, marginTop: 9 }}>Powered by DogeOS</div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
