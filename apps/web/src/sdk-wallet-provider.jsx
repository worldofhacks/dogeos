import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getChains,
  getConnectors,
  WalletConnectProvider,
  useAccount,
  useConnectors,
  useWalletConnect,
} from "@dogeos/dogeos-sdk";
import "@dogeos/dogeos-sdk/style.css";

import {
  dogeosSdkSwitchFailureMessage,
  openDogeosSdkWalletModal,
  switchDogeosSdkAccountToChain,
} from "./sdk-chain-switch.js";
import {
  connectInjectedProviderToDogeOS,
  isUnknownChainError,
  switchInjectedProviderToDogeOS,
} from "./injected-wallet.js";
import {
  DOGEOS_CHIKYU_TESTNET,
  dogeConfig,
  mergeDogeosChains,
  mergeDogeosConnectors,
} from "./sdkConfig.js";

const SDK_WALLET_EVENT = "dogeos:sdk-wallet-updated";
const SDK_WALLET_READY_EVENT = "dogeos:sdk-wallet-ready";

function publishWalletState(detail) {
  window.dispatchEvent(new CustomEvent(SDK_WALLET_EVENT, { detail }));
}

function publishWalletReady() {
  window.dispatchEvent(new Event(SDK_WALLET_READY_EVENT));
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

function chainIdMatchesDogeos(value) {
  return parseChainId(value) === BigInt(DOGEOS_CHIKYU_TESTNET.id);
}

function walletErrorMessage(error) {
  if (isUnknownChainError(error)) return dogeosSdkSwitchFailureMessage(DOGEOS_CHIKYU_TESTNET);
  return error?.shortMessage ?? error?.message ?? String(error);
}

function isEvmAddress(value) {
  return /^0x[0-9a-f]{40}$/i.test(String(value ?? ""));
}

function DogeOSSdkWalletBridge({ openOnReady = false }) {
  const wallet = useWalletConnect();
  const account = useAccount();
  // When the provider was lazy-mounted because the user asked for email/social/WalletConnect,
  // auto-open the real Connect Kit modal once the SDK is ready (one-shot).
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!openOnReady || autoOpenedRef.current) return;
    if (typeof wallet.openModal !== "function" || wallet.isConnected) return;
    autoOpenedRef.current = true;
    wallet.openModal();
  }, [openOnReady, wallet.openModal, wallet.isConnected]);
  const { connectors, currentProvider: connectorCurrentProvider } = useConnectors();
  const [injectedFallback, setInjectedFallback] = useState(null);
  const connectorEvmProvider = connectors ? connectors.evm?.provider : null;
  const accountLooksEvm = !account.chainType || account.chainType === "evm" || isEvmAddress(account.address);
  const sdkEvmProvider = accountLooksEvm
    ? account.currentProvider ?? connectorCurrentProvider ?? connectorEvmProvider
    : connectorEvmProvider;
  const sdkEvmAddress = accountLooksEvm && isEvmAddress(account.address) ? account.address : "";
  const activeAddress = injectedFallback?.address ?? sdkEvmAddress;
  const activeChainId = injectedFallback?.chainId ?? account.chainId ?? "";
  const activeChainType = injectedFallback?.chainType ?? (sdkEvmProvider ? "evm" : account.chainType ?? "");
  const activeProvider = injectedFallback?.provider ?? sdkEvmProvider ?? null;
  const walletSource = injectedFallback ? "injected" : "dogeos-sdk";
  const walletLabel = injectedFallback?.walletLabel ?? account.currentWallet?.info?.name ?? "MyDoge Link";
  const isConnected = Boolean(injectedFallback?.address) || wallet.isConnected;
  const isConnecting = injectedFallback ? false : wallet.isConnecting;
  const walletError = injectedFallback ? "" : wallet.error ? walletErrorMessage(wallet.error) : "";
  const switchToDogeOS = useCallback(async () => {
    if (injectedFallback?.provider) {
      const switched = await switchInjectedProviderToDogeOS(window, {
        provider: injectedFallback.provider,
        walletPreference: injectedFallback.walletPreference,
      });
      if (!switched) return false;
      const refreshed = await connectInjectedProviderToDogeOS(window, {
        provider: injectedFallback.provider,
        walletPreference: injectedFallback.walletPreference,
      }).catch(() => null);
      if (refreshed) setInjectedFallback(refreshed);
      return true;
    }

    return switchDogeosSdkAccountToChain({ switchChain: account.switchChain }, DOGEOS_CHIKYU_TESTNET);
  }, [account.switchChain, injectedFallback]);
  // SDK-first: this component only mounts when a clientId is provisioned, so the
  // DogeOS Connect Kit modal is the single chooser for ALL wallets (MyDoge,
  // MetaMask, Rainbow, WalletConnect). We always call wallet.openModal() and let
  // the modal present the wallet list — no per-wallet injected shortcuts here.
  // openDogeosSdkWalletModal only drops to the injected path if openModal is
  // unavailable or throws an unknown-chain error.
  const openDogeosWalletModal = useCallback(async () => {
    const result = await openDogeosSdkWalletModal({
      chainInfo: DOGEOS_CHIKYU_TESTNET,
      openModal: wallet.openModal,
    });

    if (result?.provider) {
      setInjectedFallback(result);
      return result.address;
    }

    setInjectedFallback(null);
    return result;
  }, [wallet.openModal]);

  useEffect(() => {
    const bridge = {
      openModal: openDogeosWalletModal,
      disconnect: async () => {
        setInjectedFallback(null);
        return wallet.disconnect();
      },
      switchToDogeOS,
      // In SDK mode the DogeOS Connect Kit modal is the single chooser for ALL
      // wallets, so there is no separate injected chooser to surface here.
      listInjectedWallets: () => [],
      getAddress: () => activeAddress,
      getChainId: () => activeChainId,
      getChainType: () => activeChainType,
      getProvider: () => activeProvider,
      isConnected: () => isConnected,
    };

    window.dogeosAggregatorWallet = bridge;
    publishWalletReady();
    publishWalletState({
      address: activeAddress,
      chainId: activeChainId,
      chainType: activeChainType,
      error: walletError,
      hasProvider: Boolean(activeProvider),
      isConnected,
      isConnecting,
      walletLabel,
      walletSource,
    });

    return () => {
      if (window.dogeosAggregatorWallet === bridge) {
        delete window.dogeosAggregatorWallet;
      }
    };
  }, [
    activeAddress,
    activeChainId,
    activeChainType,
    activeProvider,
    isConnected,
    isConnecting,
    openDogeosWalletModal,
    switchToDogeOS,
    wallet.disconnect,
    walletError,
    walletLabel,
    walletSource,
  ]);

  useEffect(() => {
    if (injectedFallback) return undefined;
    if (!wallet.isConnected) return undefined;
    if (!account.address && !connectorEvmProvider && !activeProvider) return undefined;
    if (activeChainType === "evm" && chainIdMatchesDogeos(account.chainId)) return undefined;

    let cancelled = false;
    publishWalletState({
      address: activeAddress,
      chainId: account.chainId ?? "",
      chainType: activeChainType || "evm",
      error: "",
      hasProvider: Boolean(activeProvider || connectorEvmProvider),
      isConnected: wallet.isConnected,
      isConnecting: true,
      walletSource: "dogeos-sdk",
      walletLabel,
    });

    switchToDogeOS()
      .then(() => {
        if (cancelled) return;
        publishWalletState({
          address: activeAddress,
          chainId: DOGEOS_CHIKYU_TESTNET.id,
          chainType: "evm",
          error: "",
          hasProvider: Boolean(activeProvider || connectorEvmProvider),
          isConnected: wallet.isConnected,
          isConnecting: false,
          walletSource: "dogeos-sdk",
          walletLabel,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        publishWalletState({
          address: activeAddress,
          chainId: account.chainId ?? "",
          chainType: activeChainType,
          error: walletErrorMessage(error),
          hasProvider: Boolean(activeProvider || connectorEvmProvider),
          isConnected: wallet.isConnected,
          isConnecting: false,
          walletSource: "dogeos-sdk",
          walletLabel,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    account.address,
    account.chainId,
    account.chainType,
    account.currentProvider,
    activeAddress,
    activeChainType,
    activeProvider,
    connectorEvmProvider,
    injectedFallback,
    switchToDogeOS,
    wallet.isConnected,
    walletLabel,
  ]);

  useEffect(() => {
    const provider = injectedFallback?.provider;
    if (!provider || typeof provider.on !== "function") return undefined;

    function handleAccountsChanged(accounts) {
      setInjectedFallback((current) => {
        if (current?.provider !== provider) return current;
        const address = Array.isArray(accounts) && accounts[0] ? String(accounts[0]) : "";
        return { ...current, address };
      });
    }

    function handleChainChanged(chainId) {
      setInjectedFallback((current) => {
        if (current?.provider !== provider) return current;
        return { ...current, chainId: String(chainId ?? "") };
      });
    }

    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("chainChanged", handleChainChanged);

    return () => {
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
      provider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [injectedFallback?.provider]);

  return null;
}

export default function DogeOSSdkWalletProvider({ openOnReady = false }) {
  const [chains, setChains] = useState(() => dogeConfig.chains);
  // Connectors MUST be sourced from getConnectors() (see sdkConfig.js); until
  // resolved we pass dogeConfig.connectors (undefined) so the SDK loads its own.
  const [connectors, setConnectors] = useState(() => dogeConfig.connectors);
  const config = useMemo(
    () => ({
      ...dogeConfig,
      chains: chains ?? dogeConfig.chains,
      connectors: connectors ?? dogeConfig.connectors,
    }),
    [chains, connectors],
  );

  useEffect(() => {
    let active = true;

    getChains()
      .then((sdkChains) => {
        if (active) setChains(mergeDogeosChains(sdkChains));
      })
      .catch(() => {
        if (active) setChains(dogeConfig.chains);
      });

    // Without connectors the Connect Kit modal renders no wallets, so populate
    // config.connectors from getConnectors(). On failure we leave it undefined
    // and let the SDK fall back to whatever connectors it bundles itself.
    getConnectors()
      .then((sdkConnectors) => {
        if (active) setConnectors(mergeDogeosConnectors(sdkConnectors));
      })
      .catch(() => {
        if (active) setConnectors(dogeConfig.connectors);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <WalletConnectProvider config={config}>
      <DogeOSSdkWalletBridge openOnReady={openOnReady} />
    </WalletConnectProvider>
  );
}
