(function attachDogeOSWalletConnectors(global) {
  const root = global || {};
  const DOGE_PROVIDER_PATTERNS = [
    /dogeos/i,
    /mydoge/i,
  ];

  function hasRequest(provider) {
    return Boolean(provider && typeof provider.request === 'function');
  }

  function providerInfo(provider) {
    return provider?.info || {};
  }

  function labelForProvider(provider, fallback) {
    const info = providerInfo(provider);
    if (info.name) return info.name;
    if (provider?.isDogeOS) return 'DogeOS Wallet';
    if (provider?.isMyDoge || provider?.isMydoge) return 'MyDoge Wallet';
    if (provider?.isMetaMask) return 'MetaMask';
    if (provider?.isCoinbaseWallet) return 'Coinbase Wallet';
    return fallback || 'Injected wallet';
  }

  function providerPriority(entry) {
    const provider = entry.provider;
    const info = providerInfo(provider);
    const identity = [
      entry.label,
      info.name,
      info.rdns,
      provider?.isDogeOS ? 'dogeos' : '',
      provider?.isMyDoge || provider?.isMydoge ? 'mydoge' : '',
    ].filter(Boolean).join(' ');

    if (/dogeos/i.test(identity)) return 100;
    if (/mydoge/i.test(identity)) return 90;
    if (DOGE_PROVIDER_PATTERNS.some((pattern) => pattern.test(identity))) return 80;
    return 10;
  }

  function collectProvider(out, seen, provider, fallbackLabel, info) {
    if (!hasRequest(provider) || seen.has(provider)) return;
    seen.add(provider);
    out.push({
      provider,
      label: (info || providerInfo(provider)).name || labelForProvider(provider, fallbackLabel),
      info: info || providerInfo(provider),
    });
  }

  function discoverInjectedProviders(win) {
    const source = win || root;
    const providers = [];
    const seen = new Set();
    const eip6963 = Array.isArray(source.__dogeosEip6963Providers) ? source.__dogeosEip6963Providers : [];

    for (const announced of eip6963) {
      collectProvider(providers, seen, announced?.provider, announced?.info?.name || 'Injected wallet', announced?.info);
    }

    collectProvider(providers, seen, source.dogeos?.ethereum, 'DogeOS Wallet');
    collectProvider(providers, seen, source.myDoge?.ethereum, 'MyDoge Wallet');
    collectProvider(providers, seen, source.mydoge?.ethereum, 'MyDoge Wallet');
    collectProvider(providers, seen, source.doge?.ethereum, 'Doge Wallet');

    const ethereum = source.ethereum;
    const embedded = Array.isArray(ethereum?.providers) ? ethereum.providers : [];
    for (const provider of embedded) {
      collectProvider(providers, seen, provider, 'Injected wallet');
    }
    collectProvider(providers, seen, ethereum, 'Injected wallet');

    return providers.sort((a, b) => providerPriority(b) - providerPriority(a));
  }

  function choosePreferredProvider(providers) {
    const list = Array.isArray(providers) ? providers.filter((entry) => hasRequest(entry?.provider)) : [];
    if (!list.length) return null;
    return [...list].sort((a, b) => providerPriority(b) - providerPriority(a))[0] || null;
  }

  root.DogeOSWalletConnectors = {
    choosePreferredProvider,
    discoverInjectedProviders,
    labelForProvider,
  };
})(typeof window !== 'undefined' ? window : globalThis);
