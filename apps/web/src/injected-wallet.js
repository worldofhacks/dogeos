const DOGEOS_CHAIN_ID = 6_281_971;
const DOGEOS_CHAIN_ID_HEX = `0x${DOGEOS_CHAIN_ID.toString(16)}`;
const DOGEOS_CHAIN_PARAMS = Object.freeze({
  chainId: DOGEOS_CHAIN_ID_HEX,
  chainName: "DogeOS Chikyu Testnet",
  nativeCurrency: { name: "DOGE", symbol: "DOGE", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.dogeos.com"],
  blockExplorerUrls: ["https://blockscout.testnet.dogeos.com"],
});

function defaultWindow() {
  return typeof window === "undefined" ? undefined : window;
}

function injectedProvider(globalObject = defaultWindow()) {
  const ethereum = globalObject?.ethereum;
  if (!ethereum) return null;

  if (Array.isArray(ethereum.providers) && ethereum.providers.length > 0) {
    return (
      ethereum.providers.find((provider) => provider.isMetaMask) ??
      ethereum.providers.find((provider) => provider.request) ??
      ethereum.providers[0]
    );
  }

  return ethereum.request ? ethereum : null;
}

function firstErrorCode(error) {
  return error?.code ?? error?.data?.originalError?.code ?? error?.data?.code;
}

function errorMessage(error, fallback) {
  return error?.shortMessage ?? error?.message ?? fallback;
}

function isUnknownChainError(error) {
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

  const noWalletMessage =
    "No wallet provider is available. Configure DOGEOS_CLIENT_ID on the web server, VITE_DOGEOS_CLIENT_ID for Vite builds, or install/unlock an EVM wallet to connect through the injected fallback.";

  function currentProvider() {
    provider = injectedProvider(globalObject);
    attachProviderEvents(provider);
    return provider;
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
      ...overrides,
    });
  }

  async function refreshState() {
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

  async function switchToDogeOS() {
    const activeProvider = currentProvider();
    if (!activeProvider?.request) return false;

    const switched = await switchInjectedProviderToDogeOS(globalObject, { currentChainId: chainId });
    chainId = switched ? DOGEOS_CHAIN_ID_HEX : await readChainId(activeProvider);
    publish();
    return switched && chainIdMatchesDogeOS(chainId);
  }

  const bridge = {
    async openModal() {
      const activeProvider = currentProvider();
      if (!activeProvider?.request) {
        publish({ error: noWalletMessage, hasProvider: false });
        throw new Error(noWalletMessage);
      }

      isConnecting = true;
      publish();
      try {
        address = firstAccount(await activeProvider.request({ method: "eth_requestAccounts" }));
        chainId = await readChainId(activeProvider);
        if (!chainIdMatchesDogeOS(chainId)) {
          const switched = await switchToDogeOS();
          if (!switched) {
            throw new Error("Switch wallet to DogeOS Chikyu Testnet before connecting.");
          }
        }
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
      publish();
    },
    switchToDogeOS,
    getAddress: () => address,
    getChainId: () => chainId,
    getChainType: () => "evm",
    getProvider: () => currentProvider(),
    isConnected: () => Boolean(address),
    initialize() {
      currentProvider();
      publishWalletReady?.();
      void refreshState();
    },
    destroy() {
      detachProviderEvents();
    },
  };

  return bridge;
}

export async function switchInjectedProviderToDogeOS(globalObject = defaultWindow(), { currentChainId } = {}) {
  const activeProvider = injectedProvider(globalObject);
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

    await activeProvider.request({
      method: "wallet_addEthereumChain",
      params: [DOGEOS_CHAIN_PARAMS],
    });
  }

  const chainIdAfterAdd = await readChainId(activeProvider).catch(() => "");
  if (chainIdMatchesDogeOS(chainIdAfterAdd)) return true;

  await activeProvider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: DOGEOS_CHAIN_ID_HEX }],
  });

  const finalChainId = await readChainId(activeProvider).catch(() => "");
  return chainIdMatchesDogeOS(finalChainId);
}
