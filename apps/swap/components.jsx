/* global React */
// components.jsx — Reusable primitives for the DogeOS Swap UI.
//   Icons, token glyphs, source chips, modal shell, tooltip, etc.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ============================================================
   ICONS — stroke-based, line-weight 1.6, 20px viewbox
   ============================================================ */
const I = (props) => (
  <svg width={props.size || 18} height={props.size || 18} viewBox="0 0 20 20" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {props.children}
  </svg>
);
const Icons = {
  Chevron:    (p) => <I {...p}><path d="M5 8 L10 13 L15 8"/></I>,
  ChevronR:   (p) => <I {...p}><path d="M7 5 L13 10 L7 15"/></I>,
  ChevronL:   (p) => <I {...p}><path d="M13 5 L7 10 L13 15"/></I>,
  ArrowDown:  (p) => <I {...p}><path d="M10 4 L10 16 M5 11 L10 16 L15 11"/></I>,
  Swap:       (p) => <I {...p}><path d="M7 4 L7 16 M4 13 L7 16 L10 13 M13 16 L13 4 M10 7 L13 4 L16 7"/></I>,
  Settings:   (p) => <I {...p}><circle cx="10" cy="10" r="2.4"/><path d="M10 1.6 L10 4 M10 16 L10 18.4 M18.4 10 L16 10 M4 10 L1.6 10 M16 4 L14.2 5.8 M5.8 14.2 L4 16 M16 16 L14.2 14.2 M5.8 5.8 L4 4"/></I>,
  Search:     (p) => <I {...p}><circle cx="9" cy="9" r="5"/><path d="M13 13 L17 17"/></I>,
  Close:      (p) => <I {...p}><path d="M5 5 L15 15 M15 5 L5 15"/></I>,
  Check:      (p) => <I {...p}><path d="M4 10 L8 14 L16 6"/></I>,
  Info:       (p) => <I {...p}><circle cx="10" cy="10" r="7.5"/><path d="M10 9 L10 14 M10 6.2 L10 6.4"/></I>,
  Alert:      (p) => <I {...p}><path d="M10 3 L18 16 L2 16 Z"/><path d="M10 9 L10 12 M10 14 L10 14.2"/></I>,
  External:   (p) => <I {...p}><path d="M9 4 H16 V11 M16 4 L9 11 M14 12 V16 H4 V6 H8"/></I>,
  Copy:       (p) => <I {...p}><rect x="7" y="3" width="10" height="13" rx="2"/><path d="M13 16 V17 H3 V6 H4"/></I>,
  Refresh:    (p) => <I {...p}><path d="M3 8 A7 7 0 0 1 16 7 M17 3 V7 H13 M17 12 A7 7 0 0 1 4 13 M3 17 V13 H7"/></I>,
  Wallet:     (p) => <I {...p}><rect x="2.5" y="5" width="15" height="11" rx="2"/><path d="M13 10.5 H15"/><path d="M15 5 V3 H3 V5"/></I>,
  Plus:       (p) => <I {...p}><path d="M10 4 V16 M4 10 H16"/></I>,
  Route:      (p) => <I {...p}><circle cx="4" cy="5" r="1.6"/><circle cx="16" cy="15" r="1.6"/><path d="M4 7 V10 Q4 12 6 12 H10 Q14 12 14 14 L14 14"/></I>,
  Gas:        (p) => <I {...p}><rect x="4" y="4" width="8" height="13" rx="1.5"/><path d="M5 8 H11"/><path d="M12 7 L15 7 V14 Q15 16 17 15"/></I>,
  Shield:     (p) => <I {...p}><path d="M10 2 L16 5 V10 Q16 15 10 18 Q4 15 4 10 V5 Z"/><path d="M7 10 L9 12 L13 8"/></I>,
  Time:       (p) => <I {...p}><circle cx="10" cy="10" r="7"/><path d="M10 6 V10 L13 12"/></I>,
  Lightning:  (p) => <I {...p}><path d="M11 2 L4 11 H9 L8 18 L16 9 H11 Z"/></I>,
  Sparkle:    (p) => <I {...p}><path d="M10 3 L11.4 8.6 L17 10 L11.4 11.4 L10 17 L8.6 11.4 L3 10 L8.6 8.6 Z"/></I>,
  Menu:       (p) => <I {...p}><path d="M3 6 H17 M3 10 H17 M3 14 H17"/></I>,
  Network:    (p) => <I {...p}><circle cx="10" cy="10" r="7.5"/><path d="M2.5 10 H17.5 M10 2.5 Q14 6 14 10 Q14 14 10 17.5 Q6 14 6 10 Q6 6 10 2.5"/></I>,
  Doc:        (p) => <I {...p}><path d="M5 2 H13 L16 5 V18 H5 Z"/><path d="M13 2 V5 H16 M7 9 H14 M7 12 H14 M7 15 H11"/></I>,
};

/* ============================================================
   TOKEN GLYPH — colored circles with mono initials.
   ============================================================ */
const TOKEN_PALETTE = {
  DOGE:  { bg: 'oklch(0.78 0.14 75)',  fg: 'oklch(0.18 0.02 60)', label: 'Ð' },
  WDOGE: { bg: 'oklch(0.62 0.12 60)',  fg: 'oklch(0.98 0.01 80)', label: 'wÐ' },
  USDC:  { bg: 'oklch(0.62 0.14 240)', fg: 'oklch(0.98 0.01 80)', label: '$' },
  USDT:  { bg: 'oklch(0.62 0.14 165)', fg: 'oklch(0.98 0.01 80)', label: '₮' },
  USD1:  { bg: 'oklch(0.64 0.13 190)', fg: 'oklch(0.98 0.01 80)', label: 'U1' },
  LBTC:  { bg: 'oklch(0.64 0.12 45)',  fg: 'oklch(0.98 0.01 80)', label: 'LB' },
  WBTC:  { bg: 'oklch(0.66 0.15 50)',  fg: 'oklch(0.98 0.01 80)', label: '₿' },
  WETH:  { bg: 'oklch(0.50 0.07 270)', fg: 'oklch(0.98 0.01 80)', label: 'Ξ' },
  BARK:  { bg: 'oklch(0.62 0.16 320)', fg: 'oklch(0.98 0.01 80)', label: 'BK' },
  CHIKYU:{ bg: 'oklch(0.70 0.13 140)', fg: 'oklch(0.18 0.02 60)', label: 'CK' },
  MUCH:  { bg: 'oklch(0.62 0.19 35)',  fg: 'oklch(0.98 0.01 80)', label: 'M' },
  SHIB:  { bg: 'oklch(0.58 0.16 30)',  fg: 'oklch(0.98 0.01 80)', label: 'S' },
  PEPE:  { bg: 'oklch(0.70 0.16 145)', fg: 'oklch(0.18 0.02 60)', label: 'P' },
  DAI:   { bg: 'oklch(0.76 0.14 80)',  fg: 'oklch(0.18 0.02 60)', label: '◈' },
};
function TokenGlyph({ symbol, size = 28 }) {
  const t = TOKEN_PALETTE[symbol] || { bg:'var(--surface-3)', fg:'var(--text)', label: symbol?.[0] };
  return (
    <span style={{
      display: 'inline-grid', placeItems: 'center',
      width: size, height: size, borderRadius: '50%',
      background: t.bg, color: t.fg,
      fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: Math.round(size * 0.46),
      letterSpacing: 0,
      boxShadow: 'inset 0 0 0 1px oklch(0 0 0 / 0.12), inset 0 1px 0 oklch(1 0 0 / 0.10)',
      flexShrink: 0,
    }}>{t.label}</span>
  );
}

/* ============================================================
   SOURCE / DEX BRAND TILE
   ============================================================ */
const SOURCES = {
  muchfi_v2:  { name: 'MuchFi',   ver: 'V2', mark: 'M', color: 'var(--src-muchfi2)' },
  muchfi_v3:  { name: 'MuchFi',   ver: 'V3', mark: 'M', color: 'var(--src-muchfi3)' },
  barkswap:   { name: 'Barkswap', ver: 'Algebra', mark: 'B', color: 'var(--src-barkswap)' },
};
function SourceMark({ id, size = 22 }) {
  const s = SOURCES[id]; if (!s) return null;
  return (
    <span style={{
      width: size, height: size, borderRadius: 7,
      display: 'inline-grid', placeItems: 'center',
      background: s.color, color: 'oklch(0.12 0.01 60)',
      fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: size * 0.5,
      boxShadow: 'inset 0 0 0 1px oklch(0 0 0 / 0.15)',
      flexShrink: 0,
    }}>{s.mark}</span>
  );
}

/* ============================================================
   TOOLTIP (lightweight)
   ============================================================ */
function Tooltip({ children, content, side = 'top' }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
      {open && (
        <span style={{
          position: 'absolute',
          bottom: side === 'top' ? 'calc(100% + 8px)' : 'auto',
          top: side === 'bottom' ? 'calc(100% + 8px)' : 'auto',
          left: '50%', transform: 'translateX(-50%)',
          background: 'oklch(0.12 0.012 60)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '6px 10px',
          fontSize: 11.5, lineHeight: 1.4,
          whiteSpace: 'nowrap', zIndex: 200,
          boxShadow: '0 8px 24px -8px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
        }}>{content}</span>
      )}
    </span>
  );
}

/* ============================================================
   MODAL SHELL
   ============================================================ */
function Modal({ open, onClose, children, width = 480, label }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-label={label}>
      <div className="modal" style={{ width, maxWidth: 'calc(100vw - 32px)' }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/* ============================================================
   TOP NAV — shared header for prototype + frames
   ============================================================ */
function TopNav({ active = 'prototype', children }) {
  return (
    <header className="topnav">
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <Logo size={26} height={17} color="var(--text)"/>
        <span className="pill" title="Testnet">
          <span className="dot gold" style={{ width: 6, height: 6, boxShadow: 'none' }}/>
          Chikyu&nbsp;Testnet
        </span>
      </div>

      <nav className="tab-switch" aria-label="View">
        <a href="./" aria-current={active === 'prototype' ? 'page' : undefined}>
          <Icons.Lightning size={14}/> Swap
        </a>
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {children}
      </div>
    </header>
  );
}

/* ============================================================
   MOBILE BOTTOM SHEET — sliding-up modal for mobile contexts
   ============================================================ */
function MobileSheet({ open, onClose, children, label, maxHeight = '88vh' }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else if (mounted) {
      setVisible(false);
      const id = setTimeout(() => setMounted(false), 280);
      return () => clearTimeout(id);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!mounted) return null;
  return (
    <>
      <div onClick={onClose} aria-hidden="true" style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'oklch(0.10 0.01 60 / 0.55)',
        backdropFilter: 'blur(6px)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 240ms var(--ease-out)',
      }}/>
      <div role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()} style={{
        position: 'fixed', left: '50%', bottom: 0,
        transform: visible
          ? 'translateX(-50%) translateY(0)'
          : 'translateX(-50%) translateY(100%)',
        transition: 'transform 320ms var(--ease-out)',
        width: 'min(440px, 100vw)',
        maxHeight,
        background: 'var(--surface)',
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: '1px solid var(--border)',
        boxShadow: '0 -24px 60px -12px oklch(0 0 0 / 0.5)',
        zIndex: 61,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
      }}>
        <div style={{ padding: '10px 0 2px', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ width: 44, height: 5, borderRadius: 99, background: 'var(--surface-3)' }}/>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {children}
        </div>
      </div>
    </>
  );
}

Object.assign(window, { Icons, TokenGlyph, SourceMark, SOURCES, TOKEN_PALETTE, Tooltip, Modal, MobileSheet, TopNav });
