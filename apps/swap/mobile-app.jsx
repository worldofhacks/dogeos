/* global React, IOSDevice,
          Icons, TokenGlyph, SourceMark, SOURCES, Logo, DogeMark, DogeMascot, DogeSilhouette, Wordmark,
          TOKENS, SwapInput, SwapArrow, NetworkButton, WalletButton, WalletDrawer, SettingsPopover, Toggle,
          RoutePanel, TokenSelector, ReviewSwapModal, TxStepper */
// mobile-app.jsx — Mobile-first DogeOS Swap shell.
// Renders the swap surface inside an iOS device frame, with playful
// DogeOS-flavored background decoration (3D-style sticker slots the user fills).

const { useState, useEffect, useMemo, useRef } = React;

/* ============================================================
   FLOATING EMOJI — drop-shadowed Unicode glyph with drift
   ============================================================ */
function FloatGlyph({ glyph, size = 84, top, left, right, bottom, rotate = 0, delay = 0, opacity = 1, hueShift = 0 }) {
  return (
    <div style={{
      position: 'absolute', top, left, right, bottom,
      fontSize: size, lineHeight: 1,
      fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", emoji',
      transform: `rotate(${rotate}deg)`,
      filter: `drop-shadow(0 18px 26px oklch(0 0 0 / 0.45)) drop-shadow(0 6px 12px oklch(0.62 0.19 35 / 0.30)) hue-rotate(${hueShift}deg)`,
      animation: `glyphFloat ${7 + (delay * 1.7) % 5}s ease-in-out ${delay}s infinite`,
      opacity,
      userSelect: 'none', pointerEvents: 'none',
      zIndex: 1,
    }}>
      {glyph}
    </div>
  );
}

/* ============================================================
   MOBILE SWAP CARD (390-wide)
   ============================================================ */
function MobileSwapCard({ scenario, pay, recv, onAmount, onSelectPay, onSelectRecv, onSwap, arrowRot, settings, conn, onConnect, onReview, route, selectedSource, walletBalance, tokenBalances }) {
  const showTx = ['approve', 'signing', 'pending', 'confirmed', 'error'].includes(scenario);
  return (
    <div className="card" style={{
      padding: 20,
      borderRadius: 24,
      background: 'var(--surface)',
      border: '1px solid var(--border-soft)',
      boxShadow: 'var(--shadow-2), 0 1px 0 oklch(1 0 0 / 0.04) inset',
    }}>
      {showTx ? (
        <MobileTxView scenario={scenario} pay={pay} recv={recv}/>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
            <SwapInput
              kind="pay"
              token={pay.sym}
              amount={pay.amount}
              usd={usdFor(pay)}
              balance={balanceFor(pay.sym, walletBalance, tokenBalances)}
              onAmount={onAmount}
              onSelect={onSelectPay}
              max={() => onAmount(rawBalance(pay.sym, walletBalance, tokenBalances))}
            />
            <SwapArrow onClick={onSwap} rotating={arrowRot}/>
            <SwapInput
              kind="receive"
              token={recv.sym}
              amount={scenario === 'loading' ? '' : recv.amount}
              usd={scenario === 'loading' ? '' : usdFor(recv)}
              balance={balanceFor(recv.sym, walletBalance, tokenBalances)}
              onSelect={onSelectRecv}
              loading={scenario === 'loading'}
            />
          </div>

          {scenario === 'route-found' && (
            <MobileRouteStrip route={route} selectedSource={selectedSource} pay={pay} recv={recv}/>
          )}

          <div style={{ marginTop: 14 }}>
            <MobilePrimaryCTA conn={conn} scenario={scenario} route={route}
              onConnect={onConnect} onReview={onReview}
              hasAmount={!!pay.amount && pay.amount !== '0'}/>
          </div>
        </>
      )}
    </div>
  );
}

/* ============================================================
   MOBILE ROUTE STRIP — playful subtitle
   ============================================================ */
function MobileRouteStrip({ route, selectedSource, pay, recv }) {
  const s = route.sources.find(x => x.id === selectedSource) || route.sources[0];
  if (!s) return null;
  const others = route.sources.filter(x => x.status !== 'skip').length;
  return (
    <div style={{
      marginTop: 14, padding: '12px 14px',
      background: 'var(--surface-2)', borderRadius: 16,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <SourceMark id={s.id} size={26}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {SOURCES[s.id].name} <span className="mono" style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 500 }}>{SOURCES[s.id].ver}</span>
          <span className="pill gold" style={{ height: 18, padding: '0 7px', fontSize: 10.5 }}>BEST</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
          live route · <span className="mono">{others}</span> source scored · gas <span className="mono tnum">{s.gasUsd}</span>
        </div>
      </div>
      <Icons.ChevronR size={14}/>
    </div>
  );
}

/* ============================================================
   MOBILE PRIMARY CTA — Big, friendly, gold rim
   ============================================================ */
function MobilePrimaryCTA({ conn, scenario, route, onConnect, onReview, hasAmount }) {
  if (!conn.connected) {
    return (
      <button className="btn btn-primary" onClick={onConnect} style={{
        width: '100%', padding: '18px 20px', fontSize: 16, borderRadius: 20,
        boxShadow: 'var(--shadow-glow), 0 1px 0 oklch(1 0 0 / 0.20) inset',
      }}>
        <Icons.Wallet size={18}/> Connect wallet
      </button>
    );
  }
  if (conn.wrongNetwork) {
    return (
      <button className="btn" style={{
        width: '100%', padding: '18px 20px', fontSize: 16, borderRadius: 20,
        background: 'var(--danger)', color: 'var(--primary-fg)',
      }}><Icons.Alert size={18}/> Switch to Chikyu</button>
    );
  }
  if (!hasAmount) {
    return (
      <button className="btn" disabled style={{
        width: '100%', padding: '18px 20px', fontSize: 16, borderRadius: 20,
        background: 'var(--surface-3)', color: 'var(--muted)',
      }}>Enter an amount</button>
    );
  }
  if (scenario === 'loading') {
    return (
      <button className="btn" disabled style={{
        width: '100%', padding: '18px 20px', fontSize: 16, borderRadius: 20,
        background: 'var(--surface-3)', color: 'var(--muted)',
      }}>
        <span className="dot pulse" style={{ background: 'var(--muted)', boxShadow: 'none' }}/>
        Reading live liquidity…
      </button>
    );
  }
  if (route?.state === 'error' || !route?.sources?.some((source) => source.executable && source.transaction)) {
    return (
      <button className="btn" disabled style={{
        width: '100%', padding: '18px 20px', fontSize: 16, borderRadius: 20,
        background: 'var(--surface-3)', color: route?.state === 'error' ? 'var(--danger)' : 'var(--muted)',
      }}>No executable live route</button>
    );
  }
  return (
    <button className="btn btn-primary" onClick={onReview} style={{
      width: '100%', padding: '18px 20px', fontSize: 16, borderRadius: 20,
      boxShadow: 'var(--shadow-glow), 0 1px 0 oklch(1 0 0 / 0.20) inset',
    }}>
      Review swap <Icons.ChevronR size={16}/>
    </button>
  );
}

/* ============================================================
   MOBILE TX VIEW — compact stepper
   ============================================================ */
function MobileTxView({ scenario, pay, recv }) {
  const needsApproval = pay.sym !== 'DOGE';
  const status = (() => {
    if (scenario === 'approve')   return { current: 'approve' };
    if (scenario === 'signing')   return { current: 'sign' };
    if (scenario === 'pending')   return { current: 'confirming' };
    if (scenario === 'confirmed') return { current: 'done' };
    if (scenario === 'error')     return { current: 'error', failAt: needsApproval ? 2 : 1 };
    return { current: 'sign' };
  })();

  return (
    <div>
      <TxStepper status={status} needsApproval={needsApproval}/>

      <div style={{
        marginTop: 18, padding: '16px 14px',
        background: 'var(--surface-2)', borderRadius: 16,
        display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center',
      }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>From</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <TokenGlyph symbol={pay.sym} size={22}/>
            <div style={{ minWidth: 0 }}>
              <div className="mono tnum" style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pay.amount}</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{pay.sym}</div>
            </div>
          </div>
        </div>
        <div style={{ color: 'var(--muted)' }}>
          {scenario === 'confirmed' ? <Icons.Check size={16}/> : <Icons.ChevronR size={16}/>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>To</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
            <div style={{ textAlign: 'right', minWidth: 0 }}>
              <div className="mono tnum" style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{recv.amount}</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{recv.sym}</div>
            </div>
            <TokenGlyph symbol={recv.sym} size={22}/>
          </div>
        </div>
      </div>

      <MobileStatusLine scenario={scenario}/>
    </div>
  );
}

function MobileStatusLine({ scenario }) {
  const lines = {
    approve:   { title: 'Open your wallet',     body: 'Approve the spend to continue.',          kind: 'info'    },
    signing:   { title: 'Sign in your wallet',  body: 'Confirm the swap to broadcast it.',        kind: 'info'    },
    pending:   { title: 'On-chain · ~14s',      body: <>tx <span className="mono">0x5249…d832</span> waiting</>, kind: 'info' },
    confirmed: { title: 'Swap complete', body: 'Confirmed on Chikyu.', kind: 'success' },
    error:     { title: 'Reverted',             body: 'Slippage breach. Re-quote and retry.',     kind: 'error'   },
  };
  const l = lines[scenario]; if (!l) return null;
  const palette = {
    info:    { bg: 'var(--primary-soft)', fg: 'var(--primary)', mood: 'thinking' },
    success: { bg: 'var(--success-soft)', fg: 'var(--success)', mood: 'success'  },
    error:   { bg: 'var(--danger-soft)',  fg: 'var(--danger)',  mood: 'sad'      },
  }[l.kind];
  return (
    <div style={{
      marginTop: 14, background: palette.bg, color: palette.fg,
      borderRadius: 16, padding: '14px 14px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ width: 44, height: 44, flexShrink: 0 }}><DogeMascot size={50} mood={palette.mood}/></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{l.title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{l.body}</div>
      </div>
    </div>
  );
}

/* ============================================================
   MOBILE TOP BAR (inside iOS frame)
   ============================================================ */
function MobileTopBar({ conn, address = '0x00B6...07E4', walletLabel = '', onWalletClick, onConnectClick }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '6px 4px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <DogeMark size={28}/>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 0, lineHeight: 1 }}>DogeOS Swap</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }} className="mono">CHIKYU TESTNET · v0.4.2</div>
        </div>
      </div>
      <button onClick={conn.connected ? onWalletClick : onConnectClick} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: conn.connected ? '6px 10px 6px 6px' : '8px 12px',
        background: conn.connected ? 'var(--surface-2)' : 'var(--primary)',
        color: conn.connected ? 'var(--text)' : 'var(--primary-fg)',
        border: '1px solid ' + (conn.connected ? 'var(--border-soft)' : 'transparent'),
        borderRadius: 999, fontSize: 12, fontWeight: 600,
      }}>
        {conn.connected ? (
          <>
            <span style={{
              width: 18, height: 18, borderRadius: '50%',
              background: 'linear-gradient(135deg, oklch(0.62 0.19 35), oklch(0.82 0.14 84))',
            }}/>
            <span className="mono">{address}</span>
          </>
        ) : (
          <><Icons.Wallet size={13}/> Connect</>
        )}
      </button>
    </div>
  );
}

/* ============================================================
   MOBILE TITLE — eyebrow + big header + doge-speak subtitle
   ============================================================ */
function MobileHeading({ scenario }) {
  const headings = {
    disconnected:  { eyebrow: 'CONNECT WALLET', title: 'Swap on Chikyu', sub: 'Live quotes are ready before execution.' },
    'wrong-network': { eyebrow: 'WRONG NETWORK', title: 'Switch to Chikyu', sub: 'You must to be on Chikyu testnet.' },
    idle:          { eyebrow: 'READY',         title: 'Swap on Chikyu',       sub: 'Enter an amount to begin.' },
    loading:       { eyebrow: 'SCANNING',      title: 'Reading routes',        sub: 'Checking live Chikyu liquidity.' },
    'route-found': { eyebrow: 'ROUTE READY',   title: 'Best route found',      sub: 'Executable routes include wallet calldata.' },
    approve:       { eyebrow: 'APPROVE',       title: 'Approve the spend',     sub: 'One-time wallet sign.' },
    signing:       { eyebrow: 'SIGN',          title: 'Sign the swap',         sub: 'Open your wallet to confirm.' },
    pending:       { eyebrow: 'BROADCASTING',  title: 'Confirming',            sub: 'Waiting for Chikyu finality.' },
    confirmed:     { eyebrow: 'COMPLETE',      title: 'Swap complete',         sub: 'Confirmed on-chain.' },
    error:         { eyebrow: 'REVERTED',      title: 'Try again',             sub: 'Route reverted on confirm.' },
    review:        { eyebrow: 'REVIEW',        title: 'Confirm your swap',     sub: 'Last look before signing.' },
  };
  const h = headings[scenario] || headings.idle;
  return (
    <div style={{ padding: '0 4px 14px' }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{h.eyebrow}</div>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: 0, lineHeight: 1.1 }}>{h.title}</h1>
      <div style={{ marginTop: 6, fontSize: 13, color: 'var(--muted)' }}>{h.sub}</div>
    </div>
  );
}

/* ============================================================
   MOBILE STAGE — wraps screen contents in IOSDevice with decorations
   ============================================================ */
function MobileStage({ children, scenarioRailValue, setScenario, bgShowDoge, preview = false }) {
  return (
    <div style={{
      minHeight: '100vh', position: 'relative',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '24px 16px 56px',
      background: 'transparent',
    }}>
      {/* DECORATIVE BACKDROP — playful 3D collage */}
      {bgShowDoge && <MobileBackdrop/>}

      {/* SCENARIO RAIL (designer chips) */}
      {preview && (
        <div style={{ width: '100%', maxWidth: 920, marginBottom: 18, position: 'relative', zIndex: 3 }}>
          <MobileScenarioRail value={scenarioRailValue} onChange={setScenario}/>
        </div>
      )}

      <div style={{ position: 'relative', zIndex: 3 }}>
        {children}
      </div>
    </div>
  );
}

function MobileBackdrop() {
  return (
    <div aria-hidden="true" style={{
      position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1, overflow: 'hidden',
    }}>
      {/* warm wash — kept subtle */}
      <div style={{
        position: 'absolute', inset: 0,
        background:
          'radial-gradient(900px 600px at 18% 14%, oklch(0.82 0.14 84 / 0.10), transparent 65%),' +
          'radial-gradient(900px 600px at 84% 84%, oklch(0.62 0.19 35 / 0.12), transparent 65%),' +
          'var(--bg)',
      }}/>

      {/* dot grid — fades in/out toward edges */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(circle at 1px 1px, oklch(1 0 0 / 0.04) 1px, transparent 0) 0 0 / 32px 32px',
        maskImage: 'radial-gradient(ellipse at center, black 25%, transparent 80%)',
      }}/>

      {/* FLOATING EMOJI COLLAGE — Unicode glyphs, tilted, drifting */}
      <FloatGlyph glyph="💎" size={90}  top="14%"  left="6%"    rotate={-6}  delay={1.2}/>
      <FloatGlyph glyph="🔥" size={68}  top="36%"  right="6%"   rotate={-12} delay={3.6}/>
      <FloatGlyph glyph="💎" size={56}  bottom="22%" right="9%" rotate={10}  delay={0.6} opacity={0.85}/>
      <FloatGlyph glyph="🔥" size={64}  bottom="14%" left="9%"  rotate={14}  delay={2.4} opacity={0.85}/>

      <style>{`
        @keyframes glyphFloat {
          0%, 100% { translate: 0 0; }
          50%      { translate: 0 -12px; }
        }
      `}</style>
    </div>
  );
}

/* ============================================================
   SCENARIO RAIL (kept compact for mobile-first)
   ============================================================ */
const SCENARIOS_M = [
  { v: 'disconnected',  label: 'Disconnected' },
  { v: 'wrong-network', label: 'Wrong net' },
  { v: 'idle',          label: 'Idle' },
  { v: 'loading',       label: 'Loading' },
  { v: 'route-found',   label: 'Route' },
  { v: 'review',        label: 'Review' },
  { v: 'approve',       label: 'Approve' },
  { v: 'signing',       label: 'Sign' },
  { v: 'pending',       label: 'Pending' },
  { v: 'confirmed',     label: 'Confirmed' },
  { v: 'error',         label: 'Reverted' },
];
function MobileScenarioRail({ value, onChange }) {
  return (
    <div style={{
      background: 'color-mix(in oklab, var(--bg) 72%, transparent)',
      border: '1px solid var(--border-soft)',
      borderRadius: 999,
      padding: 5,
      display: 'flex', gap: 4, overflowX: 'auto', whiteSpace: 'nowrap',
      backdropFilter: 'blur(12px)',
      boxShadow: 'var(--shadow-2)',
    }}>
      <span className="eyebrow" style={{ alignSelf: 'center', padding: '0 8px 0 10px', flexShrink: 0 }}>STATE</span>
      {SCENARIOS_M.map((s) => (
        <button key={s.v} onClick={() => onChange(s.v)} className="mono" style={{
          padding: '6px 10px', borderRadius: 999,
          background: value === s.v ? 'var(--primary)' : 'transparent',
          color: value === s.v ? 'var(--primary-fg)' : 'var(--text-2)',
          fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
          textTransform: 'uppercase', flexShrink: 0,
        }}>{s.label}</button>
      ))}
    </div>
  );
}

/* ============================================================
   HELPERS (duplicated for the mobile-app scope)
   ============================================================ */
function balanceFor(sym, walletBalance, tokenBalances = {}) {
  const live = tokenBalances?.[sym];
  if (live) return compactTokenAmount(live.balanceFormatted);
  if (sym === 'DOGE' && walletBalance) return walletBalance;
  const t = TOKENS.find(x => x.sym === sym);
  return t?.bal || '0';
}
function rawBalance(sym, walletBalance, tokenBalances = {}) {
  const live = tokenBalances?.[sym];
  if (live) return live.balanceFormatted;
  if (sym === 'DOGE' && walletBalance) return walletBalance.replace(/,/g, '');
  const t = TOKENS.find(x => x.sym === sym);
  return (t?.bal || '0').replace(/,/g, '');
}
function compactTokenAmount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  if (numeric > 0 && numeric < 0.0001) return '<0.0001';
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: numeric >= 1 ? 4 : 8,
  });
}
function usdFor({ sym, amount }) {
  const value = String(amount || '0');
  if (!value || value === '0') return `0 ${sym}`;
  return `${value} ${sym} · Chikyu`;
}

Object.assign(window, { MobileStage, MobileTopBar, MobileHeading, MobileSwapCard, MobileScenarioRail, MobileBackdrop, FloatGlyph });
