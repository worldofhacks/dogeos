const DOGEOS_CHAIN_ID = 6_281_971;
const DOGEOS_CHAIN_ID_HEX = `0x${DOGEOS_CHAIN_ID.toString(16)}`;
const DOGEOS_CHAIN_PARAMS = Object.freeze({
  chainId: DOGEOS_CHAIN_ID_HEX,
  chainName: "DogeOS Chikyu Testnet",
  nativeCurrency: { name: "DOGE", symbol: "DOGE", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.dogeos.com"],
  blockExplorerUrls: ["https://blockscout.testnet.dogeos.com"],
});
const EIP6963_ANNOUNCE_EVENT = "eip6963:announceProvider";
const EIP6963_REQUEST_EVENT = "eip6963:requestProvider";
const EIP6963_DISCOVERY_TIMEOUT_MS = 300;
const eip6963ProviderCache = new WeakMap();

function defaultWindow() {
  return typeof window === "undefined" ? undefined : window;
}

function walletPreferenceLabel(walletPreference) {
  if (walletPreference === "metamask") return "MetaMask";
  if (walletPreference === "rainbow") return "Rainbow Wallet";
  if (walletPreference === "mydoge") return "MyDoge Link";
  return "Injected wallet";
}

function providerRdns(provider, info) {
  return String(info?.rdns ?? provider?.info?.rdns ?? provider?.rdns ?? "").toLowerCase();
}

function providerName(provider, info) {
  return String(info?.name ?? provider?.info?.name ?? provider?.name ?? "").toLowerCase();
}

function providerLooksLikeRainbow(provider, info) {
  const rdns = providerRdns(provider, info);
  const name = providerName(provider, info);
  return Boolean(provider?.isRainbow) || rdns.includes("rainbow") || name.includes("rainbow");
}

function providerStronglyMatchesPreference(provider, walletPreference, info) {
  if (!provider?.request) return false;
  const rdns = providerRdns(provider, info);
  const name = providerName(provider, info);
  if (walletPreference === "metamask") {
    return !providerLooksLikeRainbow(provider, info) && (rdns.includes("metamask") || name.includes("metamask"));
  }
  if (walletPreference === "rainbow") {
    return providerLooksLikeRainbow(provider, info);
  }
  if (walletPreference === "mydoge") {
    return (
      rdns.includes("mydoge") ||
      rdns.includes("dogelink") ||
      rdns.includes("dogeos") ||
      name.includes("mydoge") ||
      name.includes("doge link") ||
      name.includes("dogelink") ||
      name.includes("dogeos")
    );
  }
  return true;
}

// Best-effort classification of a discovered provider into a known preference
// key (so the UI chooser can label/route entries). Used only for the injected
// fallback chooser; defaults to "" (generic injected) when unrecognised.
function classifyProviderPreference(provider, info) {
  if (providerStronglyMatchesPreference(provider, "mydoge", info)) return "mydoge";
  if (providerLooksLikeRainbow(provider, info)) return "rainbow";
  if (providerStronglyMatchesPreference(provider, "metamask", info)) return "metamask";
  return "";
}

function providerMatchesPreference(provider, walletPreference, info, { strongOnly = false } = {}) {
  if (!provider?.request) return false;
  if (strongOnly) return providerStronglyMatchesPreference(provider, walletPreference, info);
  const rdns = providerRdns(provider, info);
  const name = providerName(provider, info);
  if (walletPreference === "metamask") {
    if (providerLooksLikeRainbow(provider, info)) return false;
    if (rdns) return rdns.includes("metamask");
    if (name.includes("metamask")) return true;
    return Boolean(provider.isMetaMask) && !provider.isRainbow;
  }
  if (walletPreference === "rainbow") {
    return providerLooksLikeRainbow(provider, info);
  }
  if (walletPreference === "mydoge") {
    return (
      rdns.includes("mydoge") ||
      rdns.includes("dogelink") ||
      rdns.includes("dogeos") ||
      name.includes("mydoge") ||
      name.includes("doge link") ||
      name.includes("dogelink") ||
      name.includes("dogeos")
    );
  }
  return true;
}

function eip6963Entries(globalObject) {
  if (!globalObject || typeof globalObject !== "object") return [];
  return eip6963ProviderCache.get(globalObject) ?? [];
}

function rememberEip6963Provider(globalObject, detail) {
  if (!globalObject || typeof globalObject !== "object" || !detail?.provider?.request) return;

  const entries = eip6963ProviderCache.get(globalObject) ?? [];
  const key = detail.info?.uuid ?? detail.info?.rdns ?? detail.info?.name ?? "";
  const existingIndex = entries.findIndex((entry) =>
    entry.provider === detail.provider ||
    (key && (entry.info?.uuid === key || entry.info?.rdns === key || entry.info?.name === key))
  );
  const entry = { info: detail.info ?? {}, provider: detail.provider };
  if (existingIndex >= 0) entries[existingIndex] = entry;
  else entries.push(entry);
  eip6963ProviderCache.set(globalObject, entries);
}

function injectedProviderEntries(globalObject = defaultWindow()) {
  const ethereum = globalObject?.ethereum;
  const entries = [];

  if (ethereum) {
    if (Array.isArray(ethereum.providers) && ethereum.providers.length > 0) {
      entries.push(...ethereum.providers.map((provider) => ({ provider, info: provider.info ?? {} })));
    } else if (ethereum.request) {
      entries.push({ provider: ethereum, info: ethereum.info ?? {} });
    }
  }

  for (const entry of eip6963Entries(globalObject)) {
    const existingIndex = entries.findIndex((candidate) => candidate.provider === entry.provider);
    if (existingIndex >= 0) {
      entries[existingIndex] = {
        ...entries[existingIndex],
        info: { ...entries[existingIndex].info, ...entry.info },
      };
    } else {
      entries.push(entry);
    }
  }

  return entries;
}

function requestProviderEntries(globalObject = defaultWindow()) {
  return injectedProviderEntries(globalObject).filter((entry) => entry.provider?.request);
}

function providerFromEntries(entries, walletPreference = "", { strongOnly = false } = {}) {
  if (walletPreference) {
    return (
      entries.find((entry) =>
        providerMatchesPreference(entry.provider, walletPreference, entry.info, { strongOnly })
      )?.provider ?? null
    );
  }

  return (
    entries.find((entry) => providerMatchesPreference(entry.provider, "metamask", entry.info, { strongOnly }))?.provider ??
    entries.find((entry) => providerMatchesPreference(entry.provider, "rainbow", entry.info, { strongOnly }))?.provider ??
    entries.find((entry) => providerMatchesPreference(entry.provider, "mydoge", entry.info, { strongOnly }))?.provider ??
    entries.find((entry) => entry.provider?.request)?.provider ??
    null
  );
}

function injectedProvider(globalObject = defaultWindow(), walletPreference = "", options = {}) {
  return providerFromEntries(injectedProviderEntries(globalObject), walletPreference, options);
}

function createEip6963RequestEvent(globalObject) {
  if (typeof globalObject?.Event === "function") {
    return new globalObject.Event(EIP6963_REQUEST_EVENT);
  }
  if (typeof Event === "function") {
    return new Event(EIP6963_REQUEST_EVENT);
  }
  return { type: EIP6963_REQUEST_EVENT };
}

async function requestEip6963Provider(
  globalObject = defaultWindow(),
  walletPreference = "",
  { skipInitialCache = false, strongOnly = false } = {},
) {
  if (!globalObject?.addEventListener || !globalObject?.dispatchEvent) return null;

  const cached = skipInitialCache ? null : injectedProvider(globalObject, walletPreference, { strongOnly });
  if (cached) return cached;

  return new Promise((resolve) => {
    let done = false;
    let timeoutId;

    function finish(provider = injectedProvider(globalObject, walletPreference, { strongOnly })) {
      if (done) return;
      done = true;
      if (timeoutId) {
        if (globalObject.clearTimeout) globalObject.clearTimeout(timeoutId);
        else clearTimeout(timeoutId);
      }
      globalObject.removeEventListener?.(EIP6963_ANNOUNCE_EVENT, handleAnnouncement);
      resolve(provider ?? null);
    }

    function handleAnnouncement(event) {
      rememberEip6963Provider(globalObject, event?.detail);
      const provider = injectedProvider(globalObject, walletPreference, { strongOnly });
      if (provider) finish(provider);
    }

    globalObject.addEventListener(EIP6963_ANNOUNCE_EVENT, handleAnnouncement);
    timeoutId = (globalObject.setTimeout ?? setTimeout)(() => finish(), EIP6963_DISCOVERY_TIMEOUT_MS);
    globalObject.dispatchEvent(createEip6963RequestEvent(globalObject));
  });
}

async function resolveInjectedProvider(globalObject = defaultWindow(), walletPreference = "") {
  if (!walletPreference) {
    return injectedProvider(globalObject, walletPreference) ?? requestEip6963Provider(globalObject, walletPreference);
  }

  const immediateStrongProvider = injectedProvider(globalObject, walletPreference, { strongOnly: true });
  if (immediateStrongProvider) return immediateStrongProvider;

  const announcedStrongProvider = await requestEip6963Provider(globalObject, walletPreference, {
    skipInitialCache: true,
    strongOnly: true,
  });
  if (announcedStrongProvider) return announcedStrongProvider;

  const announcedProviderCount = eip6963Entries(globalObject).filter((entry) => entry.provider?.request).length;
  const looseProvider = injectedProvider(globalObject, walletPreference);
  if (announcedProviderCount > 0 && looseProvider) {
    const looseEntry = injectedProviderEntries(globalObject).find((entry) => entry.provider === looseProvider);
    if (!providerStronglyMatchesPreference(looseProvider, walletPreference, looseEntry?.info)) return null;
  }

  return looseProvider;
}

function firstErrorCode(error) {
  return error?.code ?? error?.data?.originalError?.code ?? error?.data?.code;
}

function errorMessage(error, fallback) {
  if (typeof error === "string") return error;
  return error?.shortMessage ?? error?.message ?? fallback;
}

export function isUnknownChainError(error) {
  const message = errorMessage(error, "").toLowerCase();
  return (
    firstErrorCode(error) === 4902 ||
    /chain id not supported/.test(message) ||
    /chain not (configured|supported|added)/.test(message) ||
    /unsupported chain/.test(message) ||
    /unrecognized chain/.test(message) ||
    /unknown chain/.test(message)
  );
}

async function readChainId(provider) {
  return provider?.request ? String(await provider.request({ method: "eth_chainId" })) : "";
}

function parseChainId(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" && /^eip155:\d+$/i.test(value)) {
    return BigInt(value.split(":")[1]);
  }
  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
}

function chainIdMatchesDogeOS(value) {
  return parseChainId(value) === BigInt(DOGEOS_CHAIN_ID);
}

function firstAccount(accounts) {
  return Array.isArray(accounts) && accounts[0] ? String(accounts[0]) : "";
}

export function createInjectedWalletBridge({
  missingClientIdMessage,
  publishWalletReady,
  publishWalletState,
  globalObject = defaultWindow(),
} = {}) {
  let provider = injectedProvider(globalObject);
  let attachedProvider = null;
  let address = "";
  let chainId = "";
  let isConnecting = false;

  // Remember the user's wallet choice across reloads so the extension that
  // happens to own window.ethereum (typically Rainbow) can never hijack a
  // user who explicitly picked MetaMask/MyDoge.
  const WALLET_PREFERENCE_STORAGE_KEY = "doge.walletPreference";
  function readStoredWalletPreference() {
    try {
      return globalObject?.localStorage?.getItem(WALLET_PREFERENCE_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  }
  function storeWalletPreference(preference) {
    try {
      if (preference) globalObject?.localStorage?.setItem(WALLET_PREFERENCE_STORAGE_KEY, preference);
      else globalObject?.localStorage?.removeItem(WALLET_PREFERENCE_STORAGE_KEY);
    } catch {
      /* storage unavailable — preference just won't survive reloads */
    }
  }
  let selectedWalletPreference = readStoredWalletPreference();
  let walletLabel = selectedWalletPreference
    ? walletPreferenceLabel(selectedWalletPreference)
    : "Injected wallet";

  const noWalletMessage =
    "No wallet provider is available. Configure DOGEOS_CLIENT_ID on the web server, VITE_DOGEOS_CLIENT_ID for Vite builds, or install/unlock an EVM wallet to connect through the injected fallback.";
  const missingMyDogeMessage =
    missingClientIdMessage || "MyDoge Link requires a configured DogeOS SDK client ID.";

  function providerUnavailableMessage(walletPreference) {
    if (walletPreference === "mydoge") {
      return [
        "MyDoge Link needs a DogeOS SDK client ID or an injected MyDoge Link provider.",
        "Set DOGEOS_CLIENT_ID or VITE_DOGEOS_CLIENT_ID for the SDK modal.",
        missingMyDogeMessage,
        "The installed extension did not announce a MyDoge EVM provider on this page.",
      ].join(" ");
    }
    if (walletPreference === "metamask") {
      return "MetaMask provider is not available. Install or unlock MetaMask, then connect again.";
    }
    if (walletPreference === "rainbow") {
      return "Rainbow Wallet provider is not available. Install or unlock Rainbow Wallet, then connect again.";
    }
    return noWalletMessage;
  }

  function currentProvider(walletPreference = selectedWalletPreference) {
    const currentEntry = injectedProviderEntries(globalObject).find((entry) => entry.provider === provider);
    if (
      provider?.request &&
      (!walletPreference ||
        providerStronglyMatchesPreference(provider, walletPreference, currentEntry?.info) ||
        (eip6963Entries(globalObject).length === 0 &&
          providerMatchesPreference(provider, walletPreference, currentEntry?.info)))
    ) {
      attachProviderEvents(provider);
      return provider;
    }

    const strongProvider = injectedProvider(globalObject, walletPreference, { strongOnly: Boolean(walletPreference) });
    const looseProvider = strongProvider ?? injectedProvider(globalObject, walletPreference);
    if (walletPreference && eip6963Entries(globalObject).length > 0 && looseProvider && !strongProvider) {
      provider = null;
      detachProviderEvents();
      return provider;
    }

    provider = looseProvider;
    attachProviderEvents(provider);
    return provider;
  }

  function canAutoSelectProvider() {
    return Boolean(selectedWalletPreference) || requestProviderEntries(globalObject).length <= 1;
  }

  function publish(overrides = {}) {
    publishWalletState?.({
      address,
      chainId,
      chainType: "evm",
      error: "",
      hasProvider: Boolean(provider?.request),
      isConnected: Boolean(address),
      isConnecting,
      walletSource: "injected",
      walletPreference: selectedWalletPreference,
      walletLabel,
      ...overrides,
    });
  }

  async function refreshState() {
    if (!canAutoSelectProvider()) {
      provider = null;
      address = "";
      chainId = "";
      publish({ hasProvider: requestProviderEntries(globalObject).length > 0 });
      return;
    }

    const activeProvider = currentProvider();
    if (!activeProvider?.request) {
      address = "";
      chainId = "";
      publish({ error: noWalletMessage, hasProvider: false });
      return;
    }

    try {
      const [accounts, nextChainId] = await Promise.all([
        activeProvider.request({ method: "eth_accounts" }),
        readChainId(activeProvider),
      ]);
      address = firstAccount(accounts);
      chainId = nextChainId;
      publish();
    } catch (error) {
      publish({ error: errorMessage(error, "Injected wallet state could not be read.") });
    }
  }

  function handleAccountsChanged(accounts) {
    address = firstAccount(accounts);
    publish();
  }

  function handleChainChanged(nextChainId) {
    chainId = String(nextChainId ?? "");
    publish();
  }

  function detachProviderEvents() {
    if (!attachedProvider?.removeListener) return;
    attachedProvider.removeListener("accountsChanged", handleAccountsChanged);
    attachedProvider.removeListener("chainChanged", handleChainChanged);
    attachedProvider = null;
  }

  function attachProviderEvents(nextProvider) {
    if (!nextProvider || attachedProvider === nextProvider) return;
    detachProviderEvents();
    attachedProvider = nextProvider;
    if (typeof nextProvider.on === "function") {
      nextProvider.on("accountsChanged", handleAccountsChanged);
      nextProvider.on("chainChanged", handleChainChanged);
    }
  }

  // EIP-6963 wallets announce themselves at page load and on request — but
  // only if someone is listening. Without a persistent listener the provider
  // cache stayed empty, listInjectedWallets() saw only window.ethereum
  // (whichever extension grabbed it), the multi-wallet chooser never
  // appeared, and users were forced into that wallet.
  function handleEip6963Announce(event) {
    rememberEip6963Provider(globalObject, event?.detail);
    // A late announcement can unblock auto-reconnect for a stored preference
    // (e.g. MetaMask announces just after initialize() already ran).
    if (!provider && !isConnecting && canAutoSelectProvider()) void refreshState();
  }

  function startEip6963Discovery() {
    if (!globalObject?.addEventListener || !globalObject?.dispatchEvent) return;
    globalObject.addEventListener(EIP6963_ANNOUNCE_EVENT, handleEip6963Announce);
    globalObject.dispatchEvent(createEip6963RequestEvent(globalObject));
  }

  async function switchToDogeOS({ walletPreference = selectedWalletPreference } = {}) {
    const activeProvider = currentProvider(walletPreference);
    if (!activeProvider?.request) return false;

    const switched = await switchInjectedProviderToDogeOS(globalObject, {
      currentChainId: chainId,
      provider: activeProvider,
      walletPreference,
    });
    chainId = switched ? DOGEOS_CHAIN_ID_HEX : await readChainId(activeProvider);
    publish();
    return switched && chainIdMatchesDogeOS(chainId);
  }

  const bridge = {
    // Identifies this as the injected EIP-6963 fallback bridge (no clientId).
    // The UI reads this synchronously to route connect() to the injected path
    // (with a wallet preference / chooser) vs. the SDK Connect Kit modal.
    walletSource: "injected",
    async openModal({ walletPreference = "" } = {}) {
      selectedWalletPreference = walletPreference;
      walletLabel = walletPreferenceLabel(walletPreference);
      const activeProvider = await resolveInjectedProvider(globalObject, walletPreference);
      provider = activeProvider;
      attachProviderEvents(provider);
      if (!activeProvider?.request) {
        const message = providerUnavailableMessage(walletPreference);
        publish({ error: message, hasProvider: false });
        throw new Error(message);
      }

      isConnecting = true;
      publish();
      try {
        address = firstAccount(await activeProvider.request({ method: "eth_requestAccounts" }));
        chainId = await readChainId(activeProvider);
        if (!chainIdMatchesDogeOS(chainId)) {
          const switched = await switchToDogeOS({ walletPreference });
          if (!switched) {
            throw new Error("Switch wallet to DogeOS Chikyu Testnet before connecting.");
          }
        }
        // Persist the user's choice so reloads reconnect THIS wallet. When
        // connect ran without an explicit preference, classify the provider
        // that actually answered so the choice still sticks.
        if (!selectedWalletPreference) {
          const activeEntry = injectedProviderEntries(globalObject).find(
            (entry) => entry.provider === activeProvider,
          );
          selectedWalletPreference = classifyProviderPreference(activeProvider, activeEntry?.info);
          if (selectedWalletPreference) walletLabel = walletPreferenceLabel(selectedWalletPreference);
        }
        storeWalletPreference(selectedWalletPreference);
        isConnecting = false;
        publish();
        return address;
      } catch (error) {
        isConnecting = false;
        publish({ error: errorMessage(error, "Injected wallet connection failed.") });
        throw error;
      }
    },
    async disconnect() {
      address = "";
      isConnecting = false;
      selectedWalletPreference = "";
      walletLabel = "Injected wallet";
      storeWalletPreference("");
      publish();
    },
    switchToDogeOS,
    // Enumerate the injected EIP-1193 providers discovered on the page (window
    // .ethereum[.providers] + EIP-6963 announcements), each tagged with a known
    // preference key + display label. The UI uses this to decide between a
    // direct MyDoge connect and a minimal chooser when several wallets exist.
    listInjectedWallets() {
      const seenProviders = new Set();
      const seenBrands = new Set();
      const wallets = [];
      // EIP-6963 entries (authoritative rdns/name) first, so the info-less
      // window.ethereum duplicate of the SAME wallet dedupes away instead of
      // listing the wallet twice (Rainbow injects both).
      const entries = [...requestProviderEntries(globalObject)].sort(
        (left, right) =>
          Number(Boolean(providerRdns(right.provider, right.info))) -
          Number(Boolean(providerRdns(left.provider, left.info))),
      );
      for (const entry of entries) {
        if (seenProviders.has(entry.provider)) continue;
        seenProviders.add(entry.provider);
        const preference = classifyProviderPreference(entry.provider, entry.info);
        const brandKey = preference || providerRdns(entry.provider, entry.info);
        if (brandKey && seenBrands.has(brandKey)) continue;
        if (brandKey) seenBrands.add(brandKey);
        wallets.push({
          preference,
          label: entry.info?.name || walletPreferenceLabel(preference),
          rdns: providerRdns(entry.provider, entry.info),
        });
      }
      return wallets;
    },
    getAddress: () => address,
    getChainId: () => chainId,
    getChainType: () => "evm",
    getProvider: () => {
      if (!provider) currentProvider();
      return provider;
    },
    isConnected: () => Boolean(address),
    initialize() {
      // Listen + ask for EIP-6963 announcements BEFORE any provider
      // selection, so every installed wallet is known to the chooser.
      startEip6963Discovery();
      if (canAutoSelectProvider()) currentProvider();
      publishWalletReady?.();
      void refreshState();
    },
    destroy() {
      globalObject?.removeEventListener?.(EIP6963_ANNOUNCE_EVENT, handleEip6963Announce);
      detachProviderEvents();
    },
  };

  return bridge;
}

export async function switchInjectedProviderToDogeOS(
  globalObject = defaultWindow(),
  { currentChainId, provider, walletPreference = "" } = {},
) {
  const activeProvider = provider?.request ? provider : await resolveInjectedProvider(globalObject, walletPreference);
  if (!activeProvider?.request) return false;

  const startingChainId = currentChainId ?? (await readChainId(activeProvider).catch(() => ""));
  if (chainIdMatchesDogeOS(startingChainId)) return true;

  try {
    await activeProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: DOGEOS_CHAIN_ID_HEX }],
    });
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;

    try {
      await activeProvider.request({
        method: "wallet_addEthereumChain",
        params: [DOGEOS_CHAIN_PARAMS],
      });
    } catch (addError) {
      if (isUnknownChainError(addError)) return false;
      throw addError;
    }
  }

  const chainIdAfterAdd = await readChainId(activeProvider).catch(() => "");
  if (chainIdMatchesDogeOS(chainIdAfterAdd)) return true;

  try {
    await activeProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: DOGEOS_CHAIN_ID_HEX }],
    });
  } catch (switchError) {
    if (isUnknownChainError(switchError)) return false;
    throw switchError;
  }

  const finalChainId = await readChainId(activeProvider).catch(() => "");
  return chainIdMatchesDogeOS(finalChainId);
}

export async function connectInjectedProviderToDogeOS(
  globalObject = defaultWindow(),
  { provider, walletPreference = "" } = {},
) {
  const activeProvider = provider?.request ? provider : await resolveInjectedProvider(globalObject, walletPreference);
  if (!activeProvider?.request) return null;

  const accounts = await activeProvider.request({ method: "eth_requestAccounts" });
  let chainId = await readChainId(activeProvider);

  if (!chainIdMatchesDogeOS(chainId)) {
    const switched = await switchInjectedProviderToDogeOS(globalObject, {
      currentChainId: chainId,
      provider: activeProvider,
      walletPreference,
    });
    if (!switched) return null;
    chainId = await readChainId(activeProvider).catch(() => DOGEOS_CHAIN_ID_HEX);
  }

  if (!chainIdMatchesDogeOS(chainId)) return null;

  const address = firstAccount(accounts);
  if (!address) return null;

  return {
    address,
    chainId,
    chainType: "evm",
    provider: activeProvider,
    walletPreference,
    walletLabel: walletPreferenceLabel(walletPreference),
  };
}
