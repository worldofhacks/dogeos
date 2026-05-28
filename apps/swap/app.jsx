/* global React, useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakToggle, TweakRadio, TweakSelect, TweakColor, TweakButton,
          Logo, DogeMark, DogeMascot, DogeSilhouette, Wordmark,
          Icons, TokenGlyph, SourceMark, SOURCES, TOKEN_PALETTE, Modal, Tooltip, TopNav,
          TOKENS, SwapInput, SwapArrow, NetworkButton, WalletButton, SettingsPopover, Toggle,
          RoutePanel, TokenSelector, ReviewSwapModal, TxStepper */
// app.jsx — DogeOS Swap interactive prototype. State machine + scenarios + Tweaks.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

const DOGEOS_CHAIN_ID_DEC = 6281971;
const DOGEOS_CHAIN_ID_HEX = '0x5fdaf3';
const DOGEOS_RPC_URL = 'https://rpc.testnet.dogeos.com';
const DOGEOS_RPC_PROXY_URL = '/rpc/dogeos';
const DOGEOS_BLOCKSCOUT_URL = 'https://blockscout.testnet.dogeos.com';
const DOGEOS_DOCS_URL = 'https://github.com/worldofhacks/dogeos/tree/dogeos-dex-v1-security/docs/dexv3';
const DOGEOS_SOURCES_URL = 'https://github.com/worldofhacks/dogeos/blob/dogeos-dex-v1-security/docs/dogeos-testnet-dex-map.md';
const CANARY_TX_URL = `${DOGEOS_BLOCKSCOUT_URL}/tx/0x5249ba34c3a021a243d01ade3080575f86d3eeaeb98423c86236d37db744d832`;
const PROJECT_WALLET_ADDRESS = '0x00B6F77d55967669Ea37f47Fc469FF47782007E4';
const WEI_PER_DOGE = 1000000000000000000n;
const DEFAULT_VIEW_MODE = window.innerWidth < 760 ? 'mobile' : 'desktop';
const ENABLE_DESIGN_PREVIEW = new URLSearchParams(window.location.search).get('preview') === '1';

/* ============================================================
   TWEAK DEFAULTS
   ============================================================ */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  theme: 'dark',
  density: 'airy',
  radiusScale: 1.2,
  accent: '#C2410C',
  fontPair: 'inter+jet',
  bgTexture: 'doge3d',
  routeLayout: 'inline',
  mascotVisible: true,
  scenario: 'route-found',
  viewMode: DEFAULT_VIEW_MODE,
}/*EDITMODE-END*/;

const ACCENT_PRESETS = {
  '#C2410C': { primary: 'oklch(0.62 0.19 35)', hover: 'oklch(0.67 0.19 35)', press: 'oklch(0.56 0.19 35)', soft: 'oklch(0.32 0.10 35)' },
  '#D97706': { primary: 'oklch(0.65 0.16 55)', hover: 'oklch(0.70 0.16 55)', press: 'oklch(0.59 0.16 55)', soft: 'oklch(0.33 0.09 55)' },
  '#F0B429': { primary: 'oklch(0.78 0.15 78)', hover: 'oklch(0.82 0.15 78)', press: 'oklch(0.72 0.15 78)', soft: 'oklch(0.38 0.10 78)' },
};

const FONT_PAIRS = {
  'inter+jet':  { sans: "'Inter Tight', system-ui, sans-serif", mono: "'JetBrains Mono', ui-monospace, monospace", display: "'Inter Tight', system-ui, sans-serif" },
  'space+plex': { sans: "'Space Grotesk', system-ui, sans-serif", mono: "'IBM Plex Mono', monospace", display: "'Space Grotesk', system-ui, sans-serif" },
  'general+plex': { sans: "'General Sans', system-ui, sans-serif", mono: "'IBM Plex Mono', monospace", display: "'General Sans', system-ui, sans-serif" },
  'plex+plex':  { sans: "'IBM Plex Sans', system-ui, sans-serif", mono: "'IBM Plex Mono', monospace", display: "'IBM Plex Sans', system-ui, sans-serif" },
};

/* ============================================================
   APP
   ============================================================ */
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply tweaks as CSS vars + attrs on <html>
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', t.theme);
    root.setAttribute('data-density', t.density);
    root.style.setProperty('--r-scale', String(t.radiusScale));
    const acc = ACCENT_PRESETS[t.accent] || ACCENT_PRESETS['#C2410C'];
    root.style.setProperty('--primary', acc.primary);
    root.style.setProperty('--primary-hover', acc.hover);
    root.style.setProperty('--primary-press', acc.press);
    root.style.setProperty('--primary-soft', acc.soft);
    const fp = FONT_PAIRS[t.fontPair] || FONT_PAIRS['inter+jet'];
    root.style.setProperty('--font-sans', fp.sans);
    root.style.setProperty('--font-mono', fp.mono);
    root.style.setProperty('--font-display', fp.display);
  }, [t.theme, t.density, t.radiusScale, t.accent, t.fontPair]);

  // ---- SCENARIO is a one-click way to jump to a state for review ---
  // scenario values match the State spec exactly:
  //  disconnected, wrong-network, idle, loading, route-found, review, approve, signing, pending, confirmed, quote-only, error
  const [scenario, setScenarioRaw] = useState(t.scenario || 'connected');
  useEffect(() => { setScenarioRaw(t.scenario || 'connected'); }, [t.scenario]);

  // ---- CORE STATE -------------
  const [pay, setPay]         = useState({ sym: 'DOGE',  amount: '1' });
  const [recv, setRecv]       = useState({ sym: 'USDC',  amount: '0.1203' });
  const [picker, setPicker]   = useState(null); // 'pay' | 'recv' | null
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({ slippage: 0.5, auto: true, deadline: '20', mev: true, expert: false });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [routeExpanded, setRouteExpanded] = useState(true);
  const [selectedSource, setSelectedSource] = useState('muchfi_v2');
  const [arrowRot, setArrowRot] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletAddress, setWalletAddress] = useState(PROJECT_WALLET_ADDRESS);
  const [liveStatus, setLiveStatus] = useState({
    blockNumber: 5200125,
    balanceDoge: '42.068782673100144711',
    loading: true,
  });
  const activeWalletAddress = walletAddress || PROJECT_WALLET_ADDRESS;
  const compactWalletBalance = liveStatus.balanceDoge ? formatCompactDoge(liveStatus.balanceDoge) : '';

  useEffect(() => {
    let active = true;
    setLiveStatus((prev) => ({ ...prev, loading: true }));
    readRpcStatus(activeWalletAddress)
      .then((next) => { if (active) setLiveStatus({ ...next, loading: false }); })
      .catch(() => { if (active) setLiveStatus((prev) => ({ ...prev, loading: false })); });
    return () => { active = false; };
  }, [activeWalletAddress]);

  // derived: connection state from scenario
  const conn = useMemo(() => {
    if (scenario === 'disconnected') return { connected: false, wrongNetwork: false };
    if (scenario === 'wrong-network') return { connected: true, wrongNetwork: true };
    return { connected: true, wrongNetwork: false };
  }, [scenario]);

  // derived: route data based on scenario
  const route = useMemo(() => buildRouteData(scenario, pay, recv, selectedSource), [scenario, pay, recv, selectedSource]);

  // open modals based on scenarios
  useEffect(() => {
    setReviewOpen(scenario === 'review');
  }, [scenario]);

  /* ---- ACTIONS ---- */
  const setScenario = (s) => { setScenarioRaw(s); setTweak('scenario', s); };

  const handleSwapDirection = () => {
    setArrowRot((r) => !r);
    setPay({ sym: recv.sym, amount: pay.amount });
    setRecv({ sym: pay.sym, amount: recv.amount });
  };

  const handleConnect = async () => {
    const provider = window.ethereum;
    if (!provider?.request) {
      setScenario('idle');
      return;
    }
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const [account] = accounts || [];
      if (account) setWalletAddress(account);
      const chainId = await provider.request({ method: 'eth_chainId' });
      setScenario(chainId === DOGEOS_CHAIN_ID_HEX ? 'idle' : 'wrong-network');
    } catch {
      setScenario('disconnected');
    }
  };
  const handleSwitchNetwork = async () => {
    const provider = window.ethereum;
    if (!provider?.request) {
      setScenario('idle');
      return;
    }
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: DOGEOS_CHAIN_ID_HEX }],
      });
      setScenario('idle');
    } catch (error) {
      if (error?.code === 4902) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: DOGEOS_CHAIN_ID_HEX,
            chainName: 'DogeOS Chikyu Testnet',
            nativeCurrency: { name: 'DogeOS DOGE', symbol: 'DOGE', decimals: 18 },
            rpcUrls: [DOGEOS_RPC_URL],
            blockExplorerUrls: [DOGEOS_BLOCKSCOUT_URL],
          }],
        });
        setScenario('idle');
      }
    }
  };
  const handleReview = () => setScenario('review');
  const handleConfirm = () => {
    // This handoff UI exercises the state machine before live router tx assembly is wired.
    setScenario('approve');
    setTimeout(() => setScenario('signing'), 1500);
    setTimeout(() => setScenario('pending'), 3000);
    setTimeout(() => setScenario('confirmed'), 6500);
  };
  const handleReset = () => { setScenario('idle'); };

  const handlePickToken = (sym) => {
    if (picker === 'pay') setPay((p) => ({ ...p, sym }));
    if (picker === 'recv') setRecv((r) => ({ ...r, sym }));
    setPicker(null);
  };
  const handleAmount = (v) => {
    setPay((p) => ({ ...p, amount: v }));
    // Refresh the route preview while the live quote service is being wired in.
    if (!v || v === '0') {
      setRecv((r) => ({ ...r, amount: '0' }));
      setScenario('idle');
      return;
    }
    setScenario('loading');
    setTimeout(() => {
      const num = parseFloat(v.replace(/,/g, '')) || 0;
      setRecv((r) => ({ ...r, amount: (num * 0.12028).toFixed(4) }));
      setScenario('route-found');
    }, 900);
  };

  const showApproval = scenario === 'review' && pay.sym !== 'DOGE';

  /* ============================================================
     MOBILE BRANCH — primary view
     ============================================================ */
  if (t.viewMode === 'mobile') {
    const mobileDeviceWidth = Math.min(402, Math.max(320, window.innerWidth - 32));
    const mobileDeviceHeight = Math.min(874, Math.max(720, window.innerHeight - 48));
    return (
      <div className="app bg-flat" style={{ minHeight: '100vh', position: 'relative' }}>
        <MobileStage
          scenarioRailValue={scenario}
          setScenario={setScenario}
          bgShowDoge={t.bgTexture !== 'flat'}
          preview={ENABLE_DESIGN_PREVIEW}
        >
          <IOSDevice dark={t.theme === 'dark'} title="" width={mobileDeviceWidth} height={mobileDeviceHeight}>
            <div style={{
              padding: '8px 16px 40px',
              display: 'flex', flexDirection: 'column', gap: 8,
              minHeight: '100%',
              background: 'var(--bg)',
              color: 'var(--text)',
              overflowY: 'auto',
              height: '100%',
              scrollbarGutter: 'stable both-edges',
            }}>
              <MobileTopBar conn={conn}
                onWalletClick={() => setWalletOpen(true)}
                onConnectClick={handleConnect}/>
              <MobileHeading scenario={scenario}/>
              <MobileSwapCard
                scenario={scenario}
                pay={pay} recv={recv}
                onAmount={handleAmount}
                onSelectPay={() => setPicker('pay')}
                onSelectRecv={() => setPicker('recv')}
                onSwap={handleSwapDirection}
                arrowRot={arrowRot}
                settings={settings}
                conn={conn}
                onConnect={handleConnect}
                onReview={handleReview}
                route={route}
                selectedSource={selectedSource}
                walletBalance={compactWalletBalance}
              />

              {/* Mobile route panel under the card */}
              {route.state !== 'idle' && conn.connected && !conn.wrongNetwork &&
                !['approve','signing','pending','confirmed','error'].includes(scenario) && (
                <RoutePanel
                  data={route}
                  expanded={routeExpanded}
                  onToggle={() => setRouteExpanded((v) => !v)}
                  onSelectSource={(id) => {
                    const s = route.sources.find(x => x.id === id);
                    if (!s || !s.executable) return;
                    setSelectedSource(id);
                  }}
                  paymentSym={pay.sym} receiveSym={recv.sym} layout="inline"
                />
              )}

              <div style={{ flex: 1 }}/>

              <div style={{
                marginTop: 8, padding: '10px 4px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontSize: 10.5, color: 'var(--muted)',
              }}>
                <span className="mono">{formatBlockLabel(liveStatus.blockNumber)} · live RPC</span>
                <span className="mono">v0.4.2-test</span>
              </div>
            </div>
          </IOSDevice>
        </MobileStage>

        {/* MODALS — overlay the whole viewport */}
        <TokenSelector
          open={picker !== null}
          onClose={() => setPicker(null)}
          onPick={handlePickToken}
          excludeSym={picker === 'pay' ? recv.sym : pay.sym}
          mobile
        />
        <ReviewSwapModal
          open={reviewOpen && conn.connected && !conn.wrongNetwork}
          onClose={() => setScenario('route-found')}
          onConfirm={handleConfirm}
          payment={{ sym: pay.sym, amount: pay.amount, usd: usdFor(pay) }}
          receive={{ sym: recv.sym, amount: recv.amount, usd: usdFor(recv) }}
          route={selectedRouteDetails(route, pay, recv)}
          settings={settings}
          needsApproval={showApproval}
          mobile
        />
        <WalletDrawer
          open={walletOpen && conn.connected}
          onClose={() => setWalletOpen(false)}
          onDisconnect={() => { setWalletOpen(false); setScenario('disconnected'); }}
          address={shortAddress(activeWalletAddress)}
          tokens={TOKENS}
        />
        {ENABLE_DESIGN_PREVIEW && <DesignTweaks t={t} setTweak={setTweak}/>}
      </div>
    );
  }

  /* ============================================================
     DESKTOP BRANCH — legacy wide layout
     ============================================================ */
  return (
    <div className={'app bg-' + (t.bgTexture === 'doge3d' ? 'flat' : t.bgTexture)} style={{ minHeight: '100vh', position: 'relative' }}>
      {/* 3D doge background */}
      {t.bgTexture === 'doge3d' && <DogeBackground/>}

      {/* background corner doge silhouette (suppressed when doge3d active) */}
      {t.mascotVisible && t.bgTexture !== 'doge3d' && (
        <div style={{
          position: 'fixed', right: -40, bottom: -50, zIndex: 0, pointerEvents: 'none',
          animation: 'drift 8s ease-in-out infinite',
        }}>
          <DogeSilhouette size={260} color="var(--text)" opacity={t.theme === 'dark' ? 0.04 : 0.06}/>
        </div>
      )}

      <TopNav active="prototype">
        <NetworkButton wrong={conn.wrongNetwork} onClick={() => conn.wrongNetwork && handleSwitchNetwork()}/>
        <WalletButton
          connected={conn.connected}
          address={shortAddress(activeWalletAddress)}
          balance={liveStatus.balanceDoge ? `${formatCompactDoge(liveStatus.balanceDoge)} DOGE` : 'Chikyu wallet'}
          onClick={() => conn.connected ? setWalletOpen(true) : handleConnect()}
        />
      </TopNav>

      {ENABLE_DESIGN_PREVIEW && <ScenarioRail value={scenario} onChange={setScenario}/>}

      <main style={{
        position: 'relative', zIndex: 1,
        display: 'grid', placeItems: 'start center',
        padding: '40px 32px 120px',
      }}>
        <div style={{
          width: '100%',
          maxWidth: t.routeLayout === 'sidebar' ? 1040 : 520,
          display: 'grid',
          gridTemplateColumns: t.routeLayout === 'sidebar' ? '520px 1fr' : '1fr',
          gap: 28,
          alignItems: 'start',
        }}>
          {/* LEFT: swap card OR tx confirmation */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SwapHero
              scenario={scenario}
              pay={pay} recv={recv}
              onAmount={handleAmount}
              onSelectPay={() => setPicker('pay')}
              onSelectRecv={() => setPicker('recv')}
              onSwap={handleSwapDirection}
              arrowRot={arrowRot}
              settingsOpen={settingsOpen}
              setSettingsOpen={setSettingsOpen}
              settings={settings}
              setSettings={setSettings}
              connected={conn.connected}
              wrongNetwork={conn.wrongNetwork}
              onConnect={handleConnect}
              onSwitch={handleSwitchNetwork}
              onReview={handleReview}
              onReset={handleReset}
              mascotVisible={t.mascotVisible}
              route={route}
              selectedSource={selectedSource}
              walletBalance={compactWalletBalance}
            />

            {t.routeLayout === 'inline' && route.state !== 'idle' && conn.connected && !conn.wrongNetwork && (
              <RoutePanel
                data={route}
                expanded={routeExpanded}
                onToggle={() => setRouteExpanded((v) => !v)}
                onSelectSource={(id) => {
                  const s = route.sources.find(x => x.id === id);
                  if (!s || !s.executable) return;
                  setSelectedSource(id);
                }}
                paymentSym={pay.sym}
                receiveSym={recv.sym}
                layout="inline"
              />
            )}
          </div>

          {/* RIGHT: sidebar route panel */}
          {t.routeLayout === 'sidebar' && (
            <div style={{ position: 'sticky', top: 96 }}>
              {route.state !== 'idle' && conn.connected && !conn.wrongNetwork ? (
                <RoutePanel
                  data={route}
                  expanded={true}
                  onToggle={() => {}}
                  onSelectSource={(id) => {
                    const s = route.sources.find(x => x.id === id);
                    if (!s || !s.executable) return;
                    setSelectedSource(id);
                  }}
                  paymentSym={pay.sym} receiveSym={recv.sym}
                  layout="sidebar"
                />
              ) : <RoutePanelPlaceholder/>}
            </div>
          )}
        </div>

        <Footnotes liveStatus={liveStatus}/>
      </main>

      {/* MODALS */}
      <TokenSelector
        open={picker !== null}
        onClose={() => setPicker(null)}
        onPick={handlePickToken}
        excludeSym={picker === 'pay' ? recv.sym : pay.sym}
      />
      <ReviewSwapModal
        open={reviewOpen && conn.connected && !conn.wrongNetwork}
        onClose={() => setScenario('route-found')}
        onConfirm={handleConfirm}
        payment={{ sym: pay.sym, amount: pay.amount, usd: usdFor(pay) }}
        receive={{ sym: recv.sym, amount: recv.amount, usd: usdFor(recv) }}
        route={selectedRouteDetails(route, pay, recv)}
        settings={settings}
        needsApproval={showApproval}
      />

      <WalletDrawer
        open={walletOpen && conn.connected}
        onClose={() => setWalletOpen(false)}
        onDisconnect={() => { setWalletOpen(false); setScenario('disconnected'); }}
        address={shortAddress(activeWalletAddress)}
        tokens={TOKENS}
      />

      {ENABLE_DESIGN_PREVIEW && <DesignTweaks t={t} setTweak={setTweak}/>}
    </div>
  );
}

/* ============================================================
   DESKTOP DECORATIVE BACKDROP — floating emoji collage
   ============================================================ */
function DogeBackground() {
  return (
    <div aria-hidden="true" style={{
      position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background:
          'radial-gradient(1100px 700px at 22% 14%, oklch(0.82 0.14 84 / 0.10), transparent 60%),' +
          'radial-gradient(1100px 700px at 82% 82%, oklch(0.62 0.19 35 / 0.12), transparent 60%),' +
          'var(--bg)',
      }}/>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(circle at 1px 1px, oklch(1 0 0 / 0.04) 1px, transparent 0) 0 0 / 36px 36px',
        maskImage: 'radial-gradient(ellipse at center, black 22%, transparent 78%)',
      }}/>

      <FloatGlyph glyph="💎" size={100} top="14%"  left="6%"    rotate={-6}  delay={1.2}/>
      <FloatGlyph glyph="🔥" size={80}  top="36%"  right="6%"   rotate={-12} delay={3.6}/>
      <FloatGlyph glyph="💎" size={64}  bottom="22%" right="9%" rotate={10}  delay={0.6} opacity={0.85}/>
      <FloatGlyph glyph="🔥" size={76}  bottom="14%" left="9%"  rotate={14}  delay={2.4} opacity={0.85}/>
    </div>
  );
}


function SwapHero(props) {
  const { scenario, pay, recv, onAmount, onSelectPay, onSelectRecv, onSwap, arrowRot,
          settingsOpen, setSettingsOpen, settings, setSettings,
          connected, wrongNetwork, onConnect, onSwitch, onReview, onReset,
          mascotVisible, route, selectedSource, walletBalance } = props;

  // Status row above the card
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 4px' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>DOGEOS · DEX AGGREGATOR</div>
          <h1 style={{
            margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: 0,
            color: 'var(--text)',
            display: 'flex', alignItems: 'baseline', gap: 10,
          }}>
            Swap on Chikyu
            <span className="mono" style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>v0.4.2-test</span>
          </h1>
        </div>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setSettingsOpen((s) => !s)} className="btn btn-ghost btn-sm" style={{
            background: settingsOpen ? 'var(--surface-3)' : 'var(--surface-2)',
          }}>
            <Icons.Settings size={15}/>
          </button>
          <SettingsPopover open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} setSettings={setSettings}/>
        </div>
      </div>

      {/* The swap card itself */}
      <div className="card" style={{ padding: 'var(--pad-card, 24px)' }}>
        {/* in pending/confirmed/approve/signing — show the TX panel instead of inputs */}
        {(scenario === 'approve' || scenario === 'signing' || scenario === 'pending' || scenario === 'confirmed' || scenario === 'error') ? (
          <TxView scenario={scenario} pay={pay} recv={recv} onReset={onReset} selectedSource={selectedSource} mascotVisible={mascotVisible}/>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-stack, 12px)', position: 'relative' }}>
              <SwapInput
                kind="pay"
                token={pay.sym}
                amount={pay.amount}
                usd={usdFor(pay)}
                balance={balanceFor(pay.sym, walletBalance)}
                onAmount={onAmount}
                onSelect={onSelectPay}
                max={() => onAmount(rawBalance(pay.sym, walletBalance))}
              />
              <SwapArrow onClick={onSwap} rotating={arrowRot}/>
              <SwapInput
                kind="receive"
                token={recv.sym}
                amount={scenario === 'loading' ? '' : recv.amount}
                usd={scenario === 'loading' ? '' : usdFor(recv)}
                balance={balanceFor(recv.sym, walletBalance)}
                onSelect={onSelectRecv}
                loading={scenario === 'loading'}
              />
            </div>

            {/* Below-the-card detail strip */}
            {scenario === 'route-found' && (
              <RouteSummaryStrip route={route} pay={pay} recv={recv} selectedSource={selectedSource}/>
            )}

            {/* Primary CTA */}
            <div style={{ marginTop: 18 }}>
              <PrimaryCTA
                connected={connected}
                wrongNetwork={wrongNetwork}
                scenario={scenario}
                onConnect={onConnect}
                onSwitch={onSwitch}
                onReview={onReview}
                hasAmount={!!pay.amount && pay.amount !== '0'}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   ROUTE SUMMARY STRIP — under the swap card on "route-found"
   ============================================================ */
function RouteSummaryStrip({ route, pay, recv, selectedSource }) {
  const s = route.sources.find(x => x.id === selectedSource) || route.sources[0];
  return (
    <div style={{
      marginTop: 18, padding: '12px 14px',
      background: 'var(--surface-2)', borderRadius: 12,
      display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12,
      alignItems: 'center',
    }}>
      <SourceMark id={s.id} size={20}/>
      <div style={{ fontSize: 12.5, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>{SOURCES[s.id].name} {SOURCES[s.id].ver}</span>
        <span style={{ color: 'var(--muted)' }}>· <span className="mono">{s.hops}-hop</span> via</span>
        <span className="mono" style={{ color: 'var(--text-2)' }}>{s.path?.join(' → ') || `${pay.sym} → ${recv.sym}`}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11.5, color: 'var(--muted)' }}>
        <span><Icons.Gas size={12}/> <span className="mono tnum" style={{ color: 'var(--text-2)' }}>{s.gasUsd}</span></span>
        <span>impact <span className="mono tnum" style={{ color: 'var(--success)' }}>0.08%</span></span>
        <span>min recv <span className="mono tnum" style={{ color: 'var(--text-2)' }}>{(parseFloat(recv.amount) * 0.995).toFixed(4)} {recv.sym}</span></span>
      </div>
    </div>
  );
}

/* ============================================================
   PRIMARY CTA
   ============================================================ */
function PrimaryCTA({ connected, wrongNetwork, scenario, onConnect, onSwitch, onReview, hasAmount }) {
  if (!connected) return <button className="btn btn-primary btn-xl" style={{ width: '100%' }} onClick={onConnect}><Icons.Wallet size={18}/> Connect wallet to swap</button>;
  if (wrongNetwork) return <button className="btn btn-xl" style={{ width: '100%', background: 'var(--danger)', color: 'var(--primary-fg)' }} onClick={onSwitch}><Icons.Alert size={18}/> Switch to Chikyu</button>;
  if (!hasAmount) return <button className="btn btn-xl" style={{ width: '100%', background: 'var(--surface-3)', color: 'var(--muted)' }} disabled>Enter an amount</button>;
  if (scenario === 'loading') return <button className="btn btn-xl" style={{ width: '100%', background: 'var(--surface-3)', color: 'var(--muted)' }} disabled><span className="dot pulse" style={{ background: 'var(--muted)', boxShadow: 'none' }}/> Finding best route…</button>;
  return <button className="btn btn-primary btn-xl" style={{ width: '100%' }} onClick={onReview}>Review swap <Icons.ChevronR size={16}/></button>;
}

/* ============================================================
   TX VIEW (approve / signing / pending / confirmed / error)
   ============================================================ */
function TxView({ scenario, pay, recv, onReset, selectedSource, mascotVisible }) {
  const needsApproval = pay.sym !== 'DOGE';
  const status = (() => {
    if (scenario === 'approve')    return { current: 'approve' };
    if (scenario === 'signing')    return { current: needsApproval ? 'sign' : 'sign' };
    if (scenario === 'pending')    return { current: 'confirming' };
    if (scenario === 'confirmed')  return { current: 'done' };
    if (scenario === 'error')      return { current: 'error', failAt: 1 };
    return { current: 'sign' };
  })();

  return (
    <div>
      <TxStepper status={status} needsApproval={needsApproval}/>

      {/* visual block */}
      <div style={{
        marginTop: 22,
        padding: '22px 18px',
        background: 'var(--surface-2)',
        borderRadius: 14,
        display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center',
      }}>
        <div style={{ textAlign: 'left' }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>From</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TokenGlyph symbol={pay.sym} size={28}/>
            <div>
              <div className="mono tnum" style={{ fontSize: 18, fontWeight: 600 }}>{pay.amount}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{pay.sym}</div>
            </div>
          </div>
        </div>
        <div style={{ color: 'var(--muted)', display: 'grid', placeItems: 'center' }}>
          {scenario === 'confirmed' ? <Icons.Check size={18}/> : <Icons.ChevronR size={18}/>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>To</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
            <div style={{ textAlign: 'right' }}>
              <div className="mono tnum" style={{ fontSize: 18, fontWeight: 600 }}>{recv.amount}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{recv.sym}</div>
            </div>
            <TokenGlyph symbol={recv.sym} size={28}/>
          </div>
        </div>
      </div>

      {/* status messages */}
      <div style={{ marginTop: 16 }}>
        {scenario === 'approve' && <StatusBlock title="Approve in your wallet" body={`Sign the ${pay.sym} spend approval to continue.`} kind="info" mascot={mascotVisible}/>}
        {scenario === 'signing' && <StatusBlock title="Sign in your wallet" body="Open your wallet to sign the swap transaction." kind="info" mascot={mascotVisible}/>}
        {scenario === 'pending' && <StatusBlock title="Confirming on-chain"
          body={<>Tx submitted. Waiting for Chikyu validators. <a href={CANARY_TX_URL} className="mono" style={{ color: 'var(--primary)' }} target="_blank" rel="noreferrer">0x5249…d832 <Icons.External size={10}/></a></>}
          kind="info" mascot={mascotVisible}/>}
        {scenario === 'confirmed' && <StatusBlock title="Swap complete" body={<>Received <span className="mono tnum" style={{ color: 'var(--text)' }}>{recv.amount} {recv.sym}</span> in canary block <span className="mono">#5,184,451</span>.</>} kind="success" mascot={mascotVisible}/>}
        {scenario === 'error' && <StatusBlock title="Transaction reverted" body="The route reverted on-chain — likely a slippage breach. Re-quote and try again." kind="error" mascot={mascotVisible}/>}
      </div>

      {/* CTAs */}
      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        {scenario === 'confirmed' && (
          <>
            <button className="btn btn-ghost btn-lg" style={{ flex: 1 }} onClick={onReset}>Swap again</button>
            <a className="btn btn-outline btn-lg" style={{ flex: 1, textDecoration: 'none' }} href={CANARY_TX_URL} target="_blank" rel="noreferrer"><Icons.External size={14}/> View on explorer</a>
          </>
        )}
        {scenario === 'error' && (
          <>
            <button className="btn btn-ghost btn-lg" style={{ flex: 1 }} onClick={onReset}>Re-quote</button>
            <button className="btn btn-outline btn-lg" style={{ flex: 1 }}><Icons.Doc size={14}/> View receipt</button>
          </>
        )}
        {(scenario === 'approve' || scenario === 'signing' || scenario === 'pending') && (
          <button className="btn btn-outline btn-lg" style={{ flex: 1 }} onClick={onReset}>Cancel</button>
        )}
      </div>
    </div>
  );
}

function StatusBlock({ title, body, kind = 'info', mascot }) {
  const palette = {
    info:    { bg: 'var(--primary-soft)', fg: 'var(--primary)', mood: 'thinking' },
    success: { bg: 'var(--success-soft)', fg: 'var(--success)', mood: 'success' },
    error:   { bg: 'var(--danger-soft)',  fg: 'var(--danger)',  mood: 'sad' },
  }[kind];
  return (
    <div style={{
      background: palette.bg, color: palette.fg,
      borderRadius: 14, padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 14,
    }}>
      {mascot && (
        <div style={{ flexShrink: 0, width: 56, height: 56, margin: -4 }}>
          <DogeMascot size={64} mood={palette.mood}/>
        </div>
      )}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: 0 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3 }}>{body}</div>
      </div>
    </div>
  );
}

/* ============================================================
   SCENARIO RAIL
   ============================================================ */
const SCENARIOS = [
  { v: 'disconnected',  label: 'Disconnected' },
  { v: 'wrong-network', label: 'Wrong network' },
  { v: 'idle',          label: 'Idle' },
  { v: 'loading',       label: 'Quote loading' },
  { v: 'route-found',   label: 'Route found' },
  { v: 'quote-only',    label: 'Quote-only' },
  { v: 'review',        label: 'Review swap' },
  { v: 'approve',       label: 'Approve' },
  { v: 'signing',       label: 'Signing' },
  { v: 'pending',       label: 'Tx pending' },
  { v: 'confirmed',     label: 'Confirmed' },
  { v: 'error',         label: 'Reverted' },
];
function ScenarioRail({ value, onChange }) {
  return (
    <div style={{
      position: 'sticky', top: 64, zIndex: 18,
      background: 'color-mix(in oklab, var(--bg) 78%, transparent)',
      backdropFilter: 'blur(10px)',
      borderBottom: '1px solid var(--border-soft)',
      padding: '10px 28px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="eyebrow" style={{ marginRight: 6 }}>State preview</span>
        {SCENARIOS.map((s) => (
          <button key={s.v} onClick={() => onChange(s.v)} className="mono" style={{
            padding: '5px 10px', borderRadius: 999,
            background: value === s.v ? 'var(--primary)' : 'var(--surface-2)',
            color: value === s.v ? 'var(--primary-fg)' : 'var(--text-2)',
            border: '1px solid ' + (value === s.v ? 'transparent' : 'var(--border-soft)'),
            fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
            textTransform: 'uppercase',
            transition: 'background var(--t-fast)',
          }}>{s.label}</button>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   ROUTE PANEL PLACEHOLDER (used in sidebar mode when idle)
   ============================================================ */
function RoutePanelPlaceholder() {
  return (
    <div className="card" style={{ padding: 28, textAlign: 'center' }}>
      <div style={{ width: 100, margin: '0 auto 12px' }}>
        <DogeMascot size={100} mood="idle"/>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Awaiting an amount</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
        Enter what you want to swap and DogeOS will scan all liquidity sources for the best route.
      </div>
    </div>
  );
}

/* ============================================================
   FOOTNOTES
   ============================================================ */
function Footnotes({ liveStatus }) {
  return (
    <div style={{ width: '100%', maxWidth: 1040, marginTop: 64, color: 'var(--muted)', fontSize: 12 }}>
      <div className="divider"/>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 4px', alignItems: 'center' }}>
        <span className="mono">
          block <span style={{ color: 'var(--text-2)' }}>{formatBlockNumber(liveStatus?.blockNumber)}</span>
          {' '}· DogeOS Chikyu RPC
        </span>
        <span style={{ display: 'flex', gap: 18 }}>
          <a href={DOGEOS_DOCS_URL} style={{ color: 'inherit' }}>Docs</a>
          <a href={DOGEOS_SOURCES_URL} style={{ color: 'inherit' }}>Sources</a>
          <a href="#status" style={{ color: 'inherit' }}>Status</a>
          <a href={DOGEOS_BLOCKSCOUT_URL} style={{ color: 'inherit' }}>Explorer</a>
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   DESIGN TWEAKS
   ============================================================ */
function DesignTweaks({ t, setTweak }) {
  return (
    <TweaksPanel title="DogeOS — Tweaks">
      <TweakSection label="View"/>
      <TweakRadio label="Layout" value={t.viewMode} options={['mobile', 'desktop']} onChange={(v) => setTweak('viewMode', v)}/>

      <TweakSection label="Theme"/>
      <TweakRadio label="Mode" value={t.theme} options={['dark', 'light']} onChange={(v) => setTweak('theme', v)}/>
      <TweakColor label="Accent" value={t.accent}
        options={['#C2410C', '#D97706', '#F0B429']}
        onChange={(v) => setTweak('accent', v)}/>
      <TweakSelect label="Background" value={t.bgTexture}
        options={[
          { value: 'doge3d', label: 'Emoji collage (default)' },
          { value: 'aurora', label: 'Aurora glow' },
          { value: 'dots',   label: 'Dot grid' },
          { value: 'grain',  label: 'Subtle grain' },
          { value: 'flat',   label: 'Flat' },
        ]}
        onChange={(v) => setTweak('bgTexture', v)}/>

      <TweakSection label="Layout"/>
      <TweakRadio label="Density" value={t.density} options={['compact', 'balanced', 'airy']} onChange={(v) => setTweak('density', v)}/>
      <TweakSlider label="Radius scale" value={t.radiusScale} min={0.6} max={1.6} step={0.1} unit="×" onChange={(v) => setTweak('radiusScale', v)}/>
      <TweakRadio label="Route panel" value={t.routeLayout} options={['inline', 'sidebar']} onChange={(v) => setTweak('routeLayout', v)}/>

      <TweakSection label="Type"/>
      <TweakSelect label="Pairing" value={t.fontPair}
        options={[
          { value: 'inter+jet',   label: 'Inter Tight + JetBrains Mono' },
          { value: 'space+plex',  label: 'Space Grotesk + IBM Plex Mono' },
          { value: 'general+plex',label: 'General Sans + IBM Plex Mono' },
          { value: 'plex+plex',   label: 'IBM Plex Sans + Plex Mono' },
        ]}
        onChange={(v) => setTweak('fontPair', v)}/>

      <TweakSection label="Brand"/>
      <TweakToggle label="Doge mascot in states" value={t.mascotVisible} onChange={(v) => setTweak('mascotVisible', v)}/>

      <TweakSection label="State preview"/>
      <TweakSelect label="Scenario" value={t.scenario}
        options={SCENARIOS.map(s => ({ value: s.v, label: s.label }))}
        onChange={(v) => setTweak('scenario', v)}/>
    </TweaksPanel>
  );
}

/* ============================================================
   HELPERS
   ============================================================ */
function balanceFor(sym, walletBalance) {
  if (sym === 'DOGE' && walletBalance) return walletBalance;
  const t = TOKENS.find(x => x.sym === sym);
  return t?.bal || '0';
}
function rawBalance(sym, walletBalance) {
  if (sym === 'DOGE' && walletBalance) return walletBalance.replace(/,/g, '');
  const t = TOKENS.find(x => x.sym === sym);
  return (t?.bal || '0').replace(/,/g, '');
}
function usdFor({ sym, amount }) {
  const num = parseFloat(String(amount).replace(/,/g, '')) || 0;
  const prices = { DOGE: 0.1207, WDOGE: 0.1207, USDC: 1, USDT: 1, DAI: 1, WBTC: 65000, WETH: 3340, BARK: 0.42, CHIKYU: 0.01, MUCH: 0.83, SHIB: 0.00002, PEPE: 0.0000094 };
  const v = num * (prices[sym] || 0);
  if (!v) return '$0.00';
  return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildRouteData(scenario, pay, recv, selectedSource) {
  if (scenario === 'disconnected' || scenario === 'wrong-network' || scenario === 'idle') {
    return { state: 'idle', sources: [] };
  }
  if (scenario === 'loading') {
    return { state: 'loading', sources: [] };
  }
  // route-found and all post-quote scenarios
  const base = parseFloat(String(recv.amount).replace(/,/g, '')) || 0;
  const isQuoteOnly = scenario === 'quote-only';
  const bestId = isQuoteOnly ? 'muchfi_v3' : (selectedSource || 'muchfi_v2');

  const sources = [
    { id: 'muchfi_v2', status: 'ok', quote: fmt(base * 1.0000) + ' ' + recv.sym, delta: 0.00, gasUsd: '$0.04', hops: 1, share: 100, executable: true,  selected: bestId === 'muchfi_v2', path: [pay.sym, recv.sym] },
    { id: 'muchfi_v3', status: 'ok', quote: fmt(base * 1.0014) + ' ' + recv.sym, delta: 0.14, gasUsd: '$0.06', hops: 1, share: null, executable: false, selected: bestId === 'muchfi_v3', path: [pay.sym, recv.sym], note: 'quote-only' },
    { id: 'barkswap',  status: 'ok', quote: fmt(base * 0.9986) + ' ' + recv.sym, delta: -0.14, gasUsd: '$0.05', hops: 2, share: null, executable: false, selected: bestId === 'barkswap',  path: [pay.sym, 'WDOGE', recv.sym], note: 'quote-only' },
  ];
  return { state: 'found', bestId, sources };
}
function fmt(n) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
function selectedRouteDetails(route, pay, recv) {
  const s = route.sources.find(x => x.selected) || route.sources[0] || {};
  const num = parseFloat(String(recv.amount).replace(/,/g, '')) || 0;
  const payNum = parseFloat(String(pay.amount).replace(/,/g, '')) || 1;
  return {
    id: s.id || 'muchfi_v2',
    hops: s.hops || 1,
    rate: (num / payNum).toFixed(6),
    minReceive: (num * 0.995).toFixed(4),
    priceImpact: '0.08',
    gasUsd: s.gasUsd || '$0.05',
  };
}

async function readRpcStatus(address) {
  const balanceReq = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getBalance',
    params: [address, 'latest'],
  };
  const blockReq = {
    jsonrpc: '2.0',
    id: 2,
    method: 'eth_blockNumber',
    params: [],
  };
  const body = JSON.stringify([balanceReq, blockReq]);
  let response = await fetch(DOGEOS_RPC_PROXY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  if (!response.ok && response.status === 404) {
    response = await fetch(DOGEOS_RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  }
  if (!response.ok) throw new Error('DogeOS RPC request failed');
  const payload = await response.json();
  const byId = Object.fromEntries(payload.map((item) => [item.id, item]));
  if (byId[1]?.error || byId[2]?.error) throw new Error('DogeOS RPC returned an error');
  return {
    balanceDoge: formatWeiAsDoge(BigInt(byId[1].result)),
    blockNumber: Number(BigInt(byId[2].result)),
  };
}

function formatWeiAsDoge(value) {
  const whole = value / WEI_PER_DOGE;
  const fraction = (value % WEI_PER_DOGE).toString().padStart(18, '0').replace(/0+$/u, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function formatCompactDoge(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function shortAddress(address) {
  if (!address) return '0x0000…0000';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatBlockNumber(blockNumber) {
  if (!blockNumber) return 'syncing';
  return `#${blockNumber.toLocaleString()}`;
}

function formatBlockLabel(blockNumber) {
  return blockNumber ? `block #${blockNumber.toLocaleString()}` : 'syncing block';
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
