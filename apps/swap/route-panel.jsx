/* global React, Icons, TokenGlyph, SourceMark, SOURCES, Modal, Tooltip, TOKENS */
// route-panel.jsx — Route intelligence + token selector modal + review modal + tx timeline.

const { useState, useEffect, useMemo, useRef } = React;

/* ============================================================
   ROUTE INTELLIGENCE PANEL
   ============================================================ */
// Shape: {
//   state: 'idle' | 'loading' | 'found',
//   bestId, sources: [{ id, status, quote, gasUsd, hops, share, selected, executable }]
// }
function RoutePanel({ data, expanded, onToggle, onSelectSource, paymentSym, receiveSym, layout = 'inline' }) {
  // layout: 'inline' (sits under swap card) | 'sidebar' (right column) | 'floating' (drawer)
  if (data.state === 'idle') return null;

  return (
    <div className="card" style={{
      padding: 0,
      overflow: 'hidden',
      borderRadius: 'var(--r-4)',
      animation: 'slidein var(--t-slow) var(--ease-out)',
    }}>
      <button onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', padding: '14px 18px',
        textAlign: 'left',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 8,
            background: 'var(--primary-soft)', color: 'var(--primary)',
          }}>
            <Icons.Route size={14}/>
          </span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {data.state === 'loading' ? 'Scanning routes…' : data.state === 'error' ? 'No live route' : 'Route intelligence'}
          </span>
          {data.state === 'found' && (
            <span className="pill ok" style={{ marginLeft: 6 }}>
              <span className="dot ok" style={{ width: 6, height: 6, boxShadow: 'none' }}/>
              {data.sources.filter(s => s.status !== 'skip').length} sources
            </span>
          )}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {data.state === 'loading' && <span style={{ color: 'var(--muted)', fontSize: 12 }} className="mono">scanning</span>}
          <Icons.Chevron size={14}/>
        </span>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border-soft)' }}>
          {data.state === 'loading' && <RouteLoadingList/>}
          {data.state === 'found' && (
            <RouteFoundList sources={data.sources} bestId={data.bestId}
              onSelectSource={onSelectSource}
              paymentSym={paymentSym} receiveSym={receiveSym}/>
          )}
          {data.state === 'error' && (
            <div style={{ padding: 16, fontSize: 12.5, color: 'var(--muted)' }}>
              {data.error || 'No executable Chikyu testnet route is available for this pair yet.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RouteLoadingList() {
  const items = ['muchfi_v2'];
  return (
    <div style={{ padding: 8 }}>
      {items.map((id, i) => (
        <div key={id} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 12px', borderRadius: 10,
        }}>
          <SourceMark id={id} size={22}/>
          <span style={{ fontSize: 13, color: 'var(--text-2)', flex: 1 }}>
            {SOURCES[id].name} <span className="mono" style={{ color: 'var(--muted)' }}>{SOURCES[id].ver}</span>
          </span>
          <div className="shimmer" style={{ width: 84, height: 12 }}/>
          <div className="shimmer" style={{ width: 36, height: 12, animationDelay: `${i * 100}ms` }}/>
        </div>
      ))}
    </div>
  );
}

function RouteFoundList({ sources, bestId, onSelectSource, paymentSym, receiveSym }) {
  return (
    <div style={{ padding: 8 }}>
      {sources.map((s) => (
        <SourceRow key={s.id} s={s} best={s.id === bestId}
          onSelect={() => onSelectSource?.(s.id)}
          paymentSym={paymentSym} receiveSym={receiveSym}/>
      ))}
      <div style={{
        margin: '10px 4px 4px',
        padding: '10px 12px',
        background: 'var(--surface-2)',
        borderRadius: 10,
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 11.5, color: 'var(--muted)',
      }}>
        <Icons.Info size={13}/>
        <span>Rows are built from live Chikyu RPC reads. Executable routes include wallet transaction calldata.</span>
      </div>
    </div>
  );
}

function SourceRow({ s, best, onSelect, paymentSym, receiveSym }) {
  const isExec = s.executable;
  const isSkip = s.status === 'skip';
  const isSel  = s.selected;
  return (
    <button onClick={!isSkip ? onSelect : undefined} style={{
      width: '100%', textAlign: 'left',
      display: 'grid',
      gridTemplateColumns: '22px 1fr auto auto',
      alignItems: 'center', gap: 12,
      padding: '12px 12px',
      borderRadius: 10,
      background: isSel ? 'var(--primary-soft)' : 'transparent',
      border: '1px solid ' + (isSel ? 'transparent' : 'transparent'),
      transition: 'background var(--t-fast)',
      opacity: isSkip ? 0.5 : 1,
      cursor: isSkip ? 'default' : 'pointer',
    }} onMouseEnter={(e) => { if (!isSel && !isSkip) e.currentTarget.style.background = 'var(--surface-2)'; }}
       onMouseLeave={(e) => { if (!isSel && !isSkip) e.currentTarget.style.background = 'transparent'; }}>
      <SourceMark id={s.id} size={22}/>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
          {SOURCES[s.id].name}
          <span className="mono" style={{ color: 'var(--muted)', fontWeight: 500, fontSize: 11 }}>{SOURCES[s.id].ver}</span>
          {best && <span className="pill gold" style={{ height: 18, padding: '0 7px', fontSize: 10.5 }}>BEST</span>}
          {!isExec && !isSkip && <span className="pill" style={{ height: 18, padding: '0 7px', fontSize: 10.5, background: 'var(--surface-3)' }}>quote-only</span>}
          {isSkip && <span className="pill bad" style={{ height: 18, padding: '0 7px', fontSize: 10.5 }}>no liq</span>}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
          {s.hops ? <span><span className="mono">{s.hops}</span>·hop</span> : null}
          {s.hops ? <span style={{ opacity: 0.4 }}>•</span> : null}
          <span>gas <span className="mono tnum">{s.gasUsd}</span></span>
          {s.share && <><span style={{ opacity: 0.4 }}>•</span><span><span className="mono tnum">{s.share}%</span> split</span></>}
        </div>
      </div>

      <div style={{ textAlign: 'right' }}>
        <div className="mono tnum" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {s.quote}
        </div>
        <div className="mono" style={{ fontSize: 11, color: s.delta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
          {s.delta >= 0 ? '+' : ''}{s.delta?.toFixed(2)}%
        </div>
      </div>

      <div style={{ width: 18, display: 'grid', placeItems: 'center', color: isSel ? 'var(--primary)' : 'var(--muted-2)' }}>
        {isSel ? <Icons.Check size={16}/> : <Icons.ChevronR size={14}/>}
      </div>
    </button>
  );
}

/* ============================================================
   TOKEN SELECTOR MODAL
   ============================================================ */
function TokenSelector({ open, onClose, onPick, excludeSym, mobile }) {
  const [q, setQ] = useState('');
  useEffect(() => { if (open) setQ(''); }, [open]);
  const fav = useMemo(() => TOKENS.filter(t => t.fav && t.sym !== excludeSym), [excludeSym]);
  const list = useMemo(() => {
    const Q = q.trim().toLowerCase();
    return TOKENS.filter(t => t.sym !== excludeSym).filter(t =>
      !Q || t.sym.toLowerCase().includes(Q) || t.name.toLowerCase().includes(Q));
  }, [q, excludeSym]);

  const Shell = mobile ? MobileSheet : Modal;
  return (
    <Shell open={open} onClose={onClose} width={460} label="Select token">
      <div style={{ padding: '20px 20px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>Select a token</span>
          <button onClick={onClose} style={{ color: 'var(--muted)' }}><Icons.Close size={16}/></button>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--surface-2)', border: '1px solid var(--border-soft)',
          borderRadius: 12, padding: '10px 12px',
        }}>
          <Icons.Search size={16}/>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or paste 0x address"
            style={{ flex: 1, background: 'transparent', border: 0, outline: 'none', color: 'var(--text)', fontSize: 14 }}/>
        </div>

        {/* favorites */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
          {fav.map(t => (
            <button key={t.sym} onClick={() => onPick?.(t.sym)} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '6px 12px 6px 6px', borderRadius: 999,
              background: 'var(--surface-2)', border: '1px solid var(--border-soft)',
              fontSize: 13, fontWeight: 600,
            }}>
              <TokenGlyph symbol={t.sym} size={20}/>
              {t.sym}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '10px 8px 16px', maxHeight: 380, overflowY: 'auto', marginTop: 6 }}>
        <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }} className="mono">
          {q ? `Results · ${list.length}` : 'All tokens'}
        </div>
        {list.map(t => (
          <button key={t.sym} onClick={() => onPick?.(t.sym)} style={{
            display: 'flex', alignItems: 'center', gap: 12, width: '100%',
            padding: '10px 12px', borderRadius: 12, textAlign: 'left',
            background: 'transparent', transition: 'background var(--t-fast)',
          }} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
             onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <TokenGlyph symbol={t.sym} size={32}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t.sym}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.name}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="mono tnum" style={{ fontSize: 13, color: 'var(--text-2)' }}>{t.bal}</div>
              <div className="mono tnum" style={{ fontSize: 11, color: 'var(--muted)' }}>{t.usd}</div>
            </div>
          </button>
        ))}
        {list.length === 0 && (
          <div style={{ padding: '32px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            No tokens match “{q}”.
          </div>
        )}
      </div>
    </Shell>
  );
}

/* ============================================================
   REVIEW SWAP MODAL
   ============================================================ */
function ReviewSwapModal({ open, onClose, onConfirm, payment, receive, route, settings, needsApproval, mobile }) {
  const Shell = mobile ? MobileSheet : Modal;
  return (
    <Shell open={open} onClose={onClose} width={460} label="Review swap">
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>Review swap</span>
          <button onClick={onClose} style={{ color: 'var(--muted)' }}><Icons.Close size={16}/></button>
        </div>

        {/* Pay → Receive summary */}
        <div style={{
          background: 'var(--surface-2)',
          borderRadius: 14,
          padding: 16,
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          gap: 12,
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>You pay</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <TokenGlyph symbol={payment.sym} size={26}/>
              <div>
                <div className="mono tnum" style={{ fontSize: 18, fontWeight: 600 }}>{payment.amount}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{payment.usd}</div>
              </div>
            </div>
          </div>
          <div style={{ color: 'var(--muted)', display: 'grid', placeItems: 'center' }}>
            <Icons.ChevronR size={18}/>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>You receive</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
              <div style={{ textAlign: 'right' }}>
                <div className="mono tnum" style={{ fontSize: 18, fontWeight: 600 }}>{receive.amount}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{receive.usd}</div>
              </div>
              <TokenGlyph symbol={receive.sym} size={26}/>
            </div>
          </div>
        </div>

        {/* details */}
        <div style={{
          marginTop: 16, border: '1px solid var(--border-soft)', borderRadius: 14,
        }}>
          {[
            ['Route', <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <SourceMark id={route.id} size={18}/>{SOURCES[route.id].name} {SOURCES[route.id].ver}
              <span className="mono" style={{ color: 'var(--muted)' }}>· {route.hops}-hop</span>
            </span>],
            ['Rate', <span className="mono tnum">1 {payment.sym} = {route.rate} {receive.sym}</span>],
            ['Min received', <span className="mono tnum">{route.minReceive} {receive.sym}</span>],
            ['Quote status', <span className="mono tnum" style={{ color: 'var(--success)' }}>{route.status || 'live'}</span>],
            ['Network fee', <span className="mono tnum">{route.gasUsd}</span>],
            ['Max slippage', <span className="mono tnum">{settings.auto ? 'Auto · ' : ''}{settings.slippage}%</span>],
            ['MEV protection', settings.mev ? <span style={{ color: 'var(--success)' }}>On</span> : <span style={{ color: 'var(--muted)' }}>Off</span>],
          ].map((row, i, arr) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 14px',
              borderBottom: i < arr.length - 1 ? '1px solid var(--border-soft)' : 'none',
              fontSize: 12.5,
            }}>
              <span style={{ color: 'var(--muted)' }}>{row[0]}</span>
              <span style={{ color: 'var(--text)' }}>{row[1]}</span>
            </div>
          ))}
        </div>

        {needsApproval && (
          <div style={{
            marginTop: 14,
            background: 'var(--warning-soft)', color: 'var(--warning)',
            borderRadius: 12, padding: 12,
            display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5,
          }}>
            <Icons.Shield size={16}/>
            <span>You'll be asked to approve <span className="mono">{payment.sym}</span> spending once before this swap executes.</span>
          </div>
        )}

        <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 18 }} onClick={onConfirm}>
          {needsApproval ? 'Approve & swap' : 'Confirm swap'}
        </button>
        <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11.5, color: 'var(--muted)' }} className="mono">
          quote refreshes in 14s
        </div>
      </div>
    </Shell>
  );
}

/* ============================================================
   TRANSACTION TIMELINE STEPPER
   ============================================================ */
//  steps: ['approve', 'sign', 'confirming', 'done']
//  status: { current: 'approve' | 'sign' | 'confirming' | 'done' | 'error', tx?: '0x..' }
function TxStepper({ status, needsApproval }) {
  const steps = needsApproval
    ? [
      { key: 'approve',    label: 'Approve',    hint: 'sign in wallet' },
      { key: 'sign',       label: 'Sign swap',  hint: 'sign in wallet' },
      { key: 'confirming', label: 'Confirming', hint: 'on-chain' },
      { key: 'done',       label: 'Done',       hint: '' },
    ]
    : [
      { key: 'sign',       label: 'Sign swap',  hint: 'sign in wallet' },
      { key: 'confirming', label: 'Confirming', hint: 'on-chain' },
      { key: 'done',       label: 'Done',       hint: '' },
    ];
  const order = steps.map(s => s.key);
  const idx = order.indexOf(status.current);
  const errored = status.current === 'error';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: steps.map(() => '1fr').join(' '),
      gap: 0,
      background: 'var(--surface-2)',
      borderRadius: 14,
      padding: '14px 4px',
      position: 'relative',
    }}>
      {steps.map((s, i) => {
        const state = errored ? (i <= status.failAt ? (i === status.failAt ? 'error' : 'done') : 'idle')
          : (i < idx ? 'done' : i === idx ? 'active' : 'idle');
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
            {/* node */}
            <div style={{ flexShrink: 0, padding: '0 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: '100%' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: state === 'done' ? 'var(--success)' :
                            state === 'active' ? 'var(--primary)' :
                            state === 'error' ? 'var(--danger)' : 'var(--surface-3)',
                color: state === 'idle' ? 'var(--muted-2)' : 'oklch(0.98 0.01 80)',
                display: 'grid', placeItems: 'center',
                boxShadow: state === 'active' ? 'var(--shadow-glow)' : 'none',
                transition: 'all var(--t-med)',
              }}>
                {state === 'done' && <Icons.Check size={14}/>}
                {state === 'active' && (
                  <svg width="14" height="14" viewBox="0 0 14 14" className="spin">
                    <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2"/>
                    <path d="M 7 2 A 5 5 0 0 1 12 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
                  </svg>
                )}
                {state === 'idle' && <span className="mono" style={{ fontSize: 11, fontWeight: 600 }}>{i + 1}</span>}
                {state === 'error' && <Icons.Close size={14}/>}
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: state === 'idle' ? 'var(--muted)' : 'var(--text)', letterSpacing: 0 }}>{s.label}</div>
                {s.hint && state !== 'idle' && state !== 'done' && (
                  <div style={{ fontSize: 10.5, color: 'var(--muted)' }} className="mono">{s.hint}</div>
                )}
              </div>
            </div>
            {/* connector */}
            {i < steps.length - 1 && (
              <div style={{
                flex: 1, height: 2, marginTop: -22,
                background: i < idx || (errored && i < status.failAt) ? 'var(--success)' : 'var(--surface-3)',
                transition: 'background var(--t-med)',
              }}/>
            )}
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { RoutePanel, TokenSelector, ReviewSwapModal, TxStepper });
