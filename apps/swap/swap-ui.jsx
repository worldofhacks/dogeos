/* global React, Icons, TokenGlyph, SourceMark, SOURCES, Modal, Tooltip, DogeMascot, DogeSilhouette, Logo, DogeMark */
// swap-ui.jsx — Swap card, route panel, token selector, settings popover,
// wallet/network button, transaction timeline. Driven by the App's state machine.

const { useState, useEffect, useRef, useMemo } = React;

/* ============================================================
   DATA
   ============================================================ */
const TOKENS = [
  { sym: 'DOGE',   name: 'Dogecoin',           bal: 'live',        usd: 'Chikyu',   fav: true,  chain: 'Chikyu' },
  { sym: 'WDOGE',  name: 'Wrapped Doge',       bal: '—',           usd: 'on-chain', fav: true,  chain: 'Chikyu' },
  { sym: 'USDC',   name: 'USD Coin',           bal: '—',           usd: 'on-chain', fav: true,  chain: 'Chikyu' },
  { sym: 'USDT',   name: 'Tether',             bal: '—',           usd: 'on-chain', fav: false, chain: 'Chikyu' },
  { sym: 'USD1',   name: 'World Liberty USD',  bal: '—',           usd: 'on-chain', fav: false, chain: 'Chikyu' },
  { sym: 'WETH',   name: 'Wrapped Ethereum',   bal: '—',           usd: 'on-chain', fav: false, chain: 'Chikyu' },
  { sym: 'LBTC',   name: 'Lombard Staked BTC', bal: '—',           usd: 'on-chain', fav: false, chain: 'Chikyu' },
];

/* ============================================================
   SWAP INPUT CARD
   ============================================================ */
function SwapInput({ kind, token, amount, usd, balance, onAmount, onSelect, disabled, focused, max, loading }) {
  // kind: 'pay' | 'receive'
  const showSkeleton = loading && kind === 'receive';

  // Auto-scale amount font to keep long numbers from feeling crowded.
  const amountStr = String(amount ?? '');
  const len = amountStr.length || 1;
  const amountFontSize =
    len <= 5  ? '40px' :
    len <= 8  ? '34px' :
    len <= 11 ? '28px' :
                '23px';

  return (
    <div style={{
      background: kind === 'pay' ? 'var(--surface-2)' : 'var(--bg-soft)',
      border: '1px solid ' + (focused ? 'var(--border-strong)' : 'var(--border-soft)'),
      borderRadius: 'var(--r-4)',
      padding: 'var(--pad-card, 24px)',
      transition: 'border-color var(--t-fast)',
      position: 'relative',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span className="eyebrow">{kind === 'pay' ? 'You pay' : 'You receive'}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {balance != null && (
            <>Balance <span className="mono tnum" style={{ color: 'var(--text-2)' }}>{balance}</span> {token}{' '}
              {max && (
                <button className="btn btn-xs" style={{
                  marginLeft: 6, padding: '3px 7px', borderRadius: 6,
                  background: 'var(--primary-soft)', color: 'var(--primary)', fontWeight: 600,
                }} onClick={max}>MAX</button>
              )}
            </>
          )}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {showSkeleton ? (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="shimmer" style={{ height: 36, width: '60%', borderRadius: 8 }}/>
          </div>
        ) : (
          <input
            value={amount}
            onChange={(e) => onAmount?.(e.target.value)}
            disabled={disabled || kind === 'receive'}
            placeholder="0"
            inputMode="decimal"
            style={{
              flex: 1, minWidth: 0,
              background: 'transparent', border: 0, outline: 'none',
              fontFamily: 'var(--font-mono)',
              fontSize: amountFontSize,
              fontWeight: 500, letterSpacing: 0,
              color: amount && amount !== '0' ? 'var(--text)' : 'var(--muted-2)',
              fontVariantNumeric: 'tabular-nums',
              padding: 0,
              transition: 'font-size var(--t-fast)',
            }}
          />
        )}
        <button onClick={onSelect} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--surface)',
          border: '1px solid var(--border-soft)',
          borderRadius: 999,
          padding: '8px 14px 8px 8px',
          color: 'var(--text)', fontWeight: 600, fontSize: 15,
          letterSpacing: 0,
          transition: 'background var(--t-fast), border-color var(--t-fast)',
          flexShrink: 0,
        }} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-3)'}
           onMouseLeave={(e) => e.currentTarget.style.background = 'var(--surface)'}>
          <TokenGlyph symbol={token} size={26}/>
          {token}
          <Icons.Chevron size={14}/>
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--muted)', minHeight: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
        {showSkeleton ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--muted)' }} className="mono">
            <svg width="11" height="11" viewBox="0 0 14 14" className="spin">
              <circle cx="7" cy="7" r="5" fill="none" stroke="var(--primary)" strokeOpacity="0.35" strokeWidth="2"/>
              <path d="M 7 2 A 5 5 0 0 1 12 7" stroke="var(--primary)" strokeWidth="2" fill="none" strokeLinecap="round"/>
            </svg>
            reading live Chikyu route
          </span>
        ) : (
          <span className="mono tnum">{usd}</span>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   SWAP ARROW (between cards)
   ============================================================ */
function SwapArrow({ onClick, rotating }) {
  return (
    <div style={{
      position: 'relative', height: 0, display: 'flex', justifyContent: 'center',
    }}>
      <button onClick={onClick} aria-label="Swap direction" style={{
        position: 'absolute', top: -22, zIndex: 2,
        width: 44, height: 44, borderRadius: 14,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        color: 'var(--text)',
        display: 'grid', placeItems: 'center',
        boxShadow: 'var(--shadow-2)',
        transition: 'transform var(--t-med) var(--ease-out), background var(--t-fast)',
        transform: rotating ? 'rotate(180deg)' : 'none',
      }} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
         onMouseLeave={(e) => e.currentTarget.style.background = 'var(--surface)'}>
        <Icons.Swap size={18}/>
      </button>
    </div>
  );
}

/* ============================================================
   WALLET / NETWORK BUTTON
   ============================================================ */
function NetworkButton({ wrong = false, onClick }) {
  return (
    <button onClick={onClick} className="btn" style={{
      background: wrong ? 'var(--danger-soft)' : 'var(--surface-2)',
      color: wrong ? 'var(--danger)' : 'var(--text)',
      border: '1px solid ' + (wrong ? 'transparent' : 'var(--border-soft)'),
      borderRadius: 999, padding: '8px 14px', fontWeight: 500, fontSize: 13,
    }}>
      {wrong ? <Icons.Alert size={14}/> : <span className="dot gold" style={{ width: 8, height: 8, boxShadow: 'none' }}/>}
      {wrong ? 'Wrong network' : 'Chikyu'}
      <Icons.Chevron size={12}/>
    </button>
  );
}
function WalletButton({ connected, address = '0x00B6…07E4', balance = '42.0688 DOGE', onClick }) {
  if (!connected) {
    return (
      <button onClick={onClick} className="btn btn-primary">
        <Icons.Wallet size={16}/> Connect wallet
      </button>
    );
  }
  return (
    <button onClick={onClick} className="btn btn-ghost" style={{ borderRadius: 999, padding: '7px 14px 7px 8px' }}>
      <span style={{
        width: 22, height: 22, borderRadius: '50%',
        background: 'linear-gradient(135deg, oklch(0.62 0.19 35), oklch(0.82 0.14 84))',
        display: 'inline-block',
      }}/>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}>
        <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{address}</span>
        <span style={{ fontSize: 10.5, color: 'var(--muted)' }} className="mono tnum">{balance}</span>
      </span>
    </button>
  );
}

/* ============================================================
   WALLET DRAWER — Uniswap-style slide-out right pane
   ============================================================ */
function WalletDrawer({
  open,
  onClose,
  onDisconnect,
  address = '0x00B6...07E4',
  fullAddress = '',
  walletLabel = '',
  nativeBalance = '',
  blockNumber = null,
  tokens = [],
  activity = [],
}) {
  const [tab, setTab] = useState('tokens'); // 'tokens' | 'activity'
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  // Enter / exit animation
  useEffect(() => {
    if (open) {
      setMounted(true);
      // next frame
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else if (mounted) {
      setVisible(false);
      const id = setTimeout(() => setMounted(false), 260);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  const heldTokens = tokens.filter(t => parseFloat((t.bal || '0').replace(/,/g, '')) > 0);
  const balanceLabel = nativeBalance ? `${formatDrawerAmount(nativeBalance)} DOGE` : 'No live balance';
  const explorerHref = fullAddress
    ? `https://blockscout.testnet.dogeos.com/address/${fullAddress}`
    : 'https://blockscout.testnet.dogeos.com';

  return (
    <>
      {/* SCRIM */}
      <div onClick={onClose} aria-hidden="true" style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'oklch(0.10 0.01 60 / 0.55)',
        backdropFilter: 'blur(6px)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 240ms var(--ease-out)',
      }}/>

      {/* DRAWER */}
      <aside role="dialog" aria-label="Wallet" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 61,
        width: 'min(420px, 92vw)',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        boxShadow: '-24px 0 60px -16px oklch(0 0 0 / 0.5)',
        transform: visible ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 280ms var(--ease-out)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* HEADER */}
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{
                width: 40, height: 40, borderRadius: '50%',
                background: 'linear-gradient(135deg, oklch(0.62 0.19 35), oklch(0.82 0.14 84))',
                boxShadow: 'inset 0 0 0 1px oklch(0 0 0 / 0.12)',
              }}/>
              <div>
                <button onClick={() => {
                  if (fullAddress) navigator.clipboard?.writeText(fullAddress);
                  setCopied(true); setTimeout(() => setCopied(false), 1400);
                }} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600,
                  color: 'var(--text)',
                }}>
                  {address}
                  {copied ? <Icons.Check size={13}/> : <Icons.Copy size={13}/>}
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, fontSize: 11, color: 'var(--muted)' }}>
                  <span className="dot gold" style={{ width: 6, height: 6, boxShadow: 'none' }}/>
                  <span>{walletLabel || 'Injected wallet'}</span>
                  <span style={{ opacity: 0.4 }}>·</span>
                  <a href={explorerHref} target="_blank" rel="noreferrer" style={{ color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    Explorer <Icons.External size={10}/>
                  </a>
                </div>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{
              width: 32, height: 32, borderRadius: 8,
              display: 'grid', placeItems: 'center', color: 'var(--muted)',
              background: 'var(--surface-2)', border: '1px solid var(--border-soft)',
            }}>
              <Icons.Close size={14}/>
            </button>
          </div>

          {/* BALANCE */}
          <div style={{ marginTop: 22, paddingBottom: 18, borderBottom: '1px solid var(--border-soft)' }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>NET WORTH · TESTNET</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className="mono tnum" style={{ fontSize: 34, fontWeight: 600, letterSpacing: 0, color: 'var(--text)' }}>
                {balanceLabel}
              </span>
              <span className="mono tnum" style={{ fontSize: 13, color: 'var(--muted)' }}>
                live RPC
              </span>
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }}>
                <Icons.Plus size={14}/> Fund testnet
              </button>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }}>
                <Icons.External size={14}/> Receive
              </button>
            </div>
          </div>
        </div>

        {/* TABS */}
        <div style={{ padding: '0 20px', borderBottom: '1px solid var(--border-soft)', display: 'flex', gap: 4 }}>
          <DrawerTab active={tab === 'tokens'}   onClick={() => setTab('tokens')}>
            Tokens <span className="mono" style={{ color: 'var(--muted)', marginLeft: 4 }}>{heldTokens.length}</span>
          </DrawerTab>
          <DrawerTab active={tab === 'activity'} onClick={() => setTab('activity')}>
            Activity <span className="mono" style={{ color: 'var(--muted)', marginLeft: 4 }}>{activity.length}</span>
          </DrawerTab>
        </div>

        {/* TAB BODY */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {tab === 'tokens' && <TokensTab tokens={heldTokens}/>}
          {tab === 'activity' && <ActivityTab items={activity}/>}
        </div>

        {/* FOOTER */}
        <div style={{
          padding: '14px 20px', borderTop: '1px solid var(--border-soft)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'var(--bg-soft)',
        }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }} className="mono">
            block <span style={{ color: 'var(--text-2)' }}>{blockNumber ? `#${Number(blockNumber).toLocaleString()}` : 'pending'}</span>
          </span>
          <button onClick={onDisconnect} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            color: 'var(--danger)',
            background: 'transparent', border: '1px solid transparent',
            padding: '7px 12px', borderRadius: 8,
            fontSize: 13, fontWeight: 600,
            transition: 'background var(--t-fast)',
          }} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--danger-soft)'}
             onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Icons.Close size={13}/> Disconnect
          </button>
        </div>
      </aside>
    </>
  );
}

function DrawerTab({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '12px 4px',
      fontSize: 13, fontWeight: 600,
      color: active ? 'var(--text)' : 'var(--muted)',
      borderBottom: '2px solid ' + (active ? 'var(--primary)' : 'transparent'),
      marginBottom: -1,
      transition: 'color var(--t-fast)',
      marginRight: 18,
    }}>{children}</button>
  );
}

function formatDrawerAmount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value || '0');
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: numeric >= 1 ? 2 : 0,
    maximumFractionDigits: numeric >= 1 ? 6 : 10,
  });
}

function TokensTab({ tokens }) {
  if (!tokens.length) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
        No tokens held yet. <a href="#" style={{ color: 'var(--primary)' }}>Fund this testnet wallet</a> to start swapping.
      </div>
    );
  }
  return (
    <div style={{ padding: 8 }}>
      {tokens.map((t) => (
        <div key={t.sym} style={{
          display: 'grid', gridTemplateColumns: '36px 1fr auto', alignItems: 'center', gap: 12,
          padding: '10px 12px', borderRadius: 10,
        }}>
          <TokenGlyph symbol={t.sym} size={32}/>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
              {t.sym}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{t.name}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="mono tnum" style={{ fontSize: 13, fontWeight: 600 }}>{t.bal}</div>
            <div className="mono tnum" style={{ fontSize: 11, color: 'var(--muted)' }}>{t.usd}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityTab({ items }) {
  return (
    <div style={{ padding: 8 }}>
      {items.map((a, i) => <ActivityRow key={i} a={a}/>)}
      <div style={{ textAlign: 'center', padding: '14px 0 8px', fontSize: 11.5, color: 'var(--muted)' }} className="mono">
        end of recent activity
      </div>
    </div>
  );
}

function ActivityRow({ a }) {
  const stateColor = a.status === 'confirmed' ? 'var(--success)'
                   : a.status === 'reverted'  ? 'var(--danger)'
                   : 'var(--warning)';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12,
      padding: '12px', borderRadius: 12,
      alignItems: 'center',
    }}>
      {/* glyph */}
      <div style={{ position: 'relative' }}>
        {a.kind === 'swap' && (
          <div style={{ position: 'relative', width: 36, height: 36 }}>
            <span style={{ position: 'absolute', left: 0, top: 0 }}><TokenGlyph symbol={a.pay.sym} size={22}/></span>
            <span style={{ position: 'absolute', right: 0, bottom: 0 }}><TokenGlyph symbol={a.recv.sym} size={22}/></span>
          </div>
        )}
        {a.kind === 'approve' && (
          <div style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', borderRadius: 10, color: 'var(--warning)' }}>
            <Icons.Shield size={18}/>
          </div>
        )}
        {a.kind === 'receive' && (
          <div style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', borderRadius: 10, color: 'var(--success)' }}>
            <Icons.ArrowDown size={18}/>
          </div>
        )}
      </div>

      {/* body */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
          {a.kind === 'swap'    && <>Swap <span className="mono tnum">{a.pay.amount}</span> {a.pay.sym} → <span className="mono tnum">{a.recv.amount}</span> {a.recv.sym}</>}
          {a.kind === 'approve' && <>Approve <span className="mono">{a.pay.sym}</span> spender</>}
          {a.kind === 'receive' && <>Received <span className="mono tnum">{a.recv.amount}</span> {a.recv.sym}</>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
          <span style={{ color: stateColor, textTransform: 'capitalize' }} className="mono">{a.status}</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{a.when}</span>
          {a.source && <><span style={{ opacity: 0.4 }}>·</span><span>via {SOURCES[a.source]?.name || a.source}</span></>}
        </div>
      </div>

      {/* external */}
      <a href="#tx" style={{ color: 'var(--muted)', display: 'grid', placeItems: 'center', width: 28, height: 28 }}>
        <Icons.External size={14}/>
      </a>
    </div>
  );
}

/* ============================================================
   SETTINGS POPOVER (slippage / deadline / mev)
   ============================================================ */
function SettingsPopover({ open, onClose, settings, setSettings }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.(); };
    setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);
  if (!open) return null;
  const slip = settings.slippage;
  return (
    <div ref={ref} style={{
      position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 320,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 16, padding: 18, zIndex: 30,
      boxShadow: 'var(--shadow-3)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Settings</span>
        <button onClick={onClose} style={{ color: 'var(--muted)' }}><Icons.Close size={14}/></button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Max slippage</span>
            <Tooltip content="Max price movement tolerated"><span style={{ color: 'var(--muted)' }}><Icons.Info size={13}/></span></Tooltip>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[0.1, 0.5, 1.0].map(v => (
              <button key={v} onClick={() => setSettings({ ...settings, slippage: v, auto: false })}
                className="mono tnum" style={{
                flex: 1, padding: '8px 0', borderRadius: 8,
                background: !settings.auto && slip === v ? 'var(--primary-soft)' : 'var(--surface-2)',
                color: !settings.auto && slip === v ? 'var(--primary)' : 'var(--text-2)',
                border: '1px solid var(--border-soft)', fontSize: 12.5, fontWeight: 600,
              }}>{v.toFixed(1)}%</button>
            ))}
            <button onClick={() => setSettings({ ...settings, auto: true })}
              className="mono" style={{
              padding: '8px 12px', borderRadius: 8,
              background: settings.auto ? 'var(--primary-soft)' : 'var(--surface-2)',
              color: settings.auto ? 'var(--primary)' : 'var(--text-2)',
              border: '1px solid var(--border-soft)', fontSize: 12.5, fontWeight: 600,
            }}>Auto</button>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 8 }}>Tx deadline</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input value={settings.deadline} onChange={(e) => setSettings({ ...settings, deadline: e.target.value })}
              className="mono tnum" style={{
              flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border-soft)',
              borderRadius: 8, padding: '8px 12px', color: 'var(--text)', fontSize: 13,
              outline: 'none',
            }}/>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>minutes</span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>MEV protection</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Route via private mempool</div>
          </div>
          <Toggle on={settings.mev} onChange={(v) => setSettings({ ...settings, mev: v })}/>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Expert mode</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>High-slippage warnings off</div>
          </div>
          <Toggle on={settings.expert} onChange={(v) => setSettings({ ...settings, expert: v })}/>
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange?.(!on)} aria-pressed={on} style={{
      width: 36, height: 20, borderRadius: 999,
      background: on ? 'var(--primary)' : 'var(--surface-3)',
      position: 'relative', transition: 'background var(--t-fast)',
      flexShrink: 0,
    }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%',
        background: 'white',
        transition: 'left var(--t-fast) var(--ease-out)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
      }}/>
    </button>
  );
}

Object.assign(window, { TOKENS, SwapInput, SwapArrow, NetworkButton, WalletButton, WalletDrawer, SettingsPopover, Toggle });
