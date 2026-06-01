import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  getChains,
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
import { DOGEOS_CHIKYU_TESTNET, dogeConfig, mergeDogeosChains } from "./sdkConfig.js";

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

function DogeOSSdkWalletBridge() {
  const wallet = useWalletConnect();
  const account = useAccount();
  const { connectors, currentProvider: connectorCurrentProvider } = useConnectors();
  const [injectedFallback, setInjectedFallback] = useState(null);
  const connectorEvmProvider = connectors ? connectors.evm?.provider : null;
  const activeAddress = injectedFallback?.address ?? account.address ?? "";
  const activeChainId = injectedFallback?.chainId ?? account.chainId ?? "";
  const activeChainType = injectedFallback?.chainType ?? account.chainType ?? "";
  const activeProvider =
    injectedFallback?.provider ?? account.currentProvider ?? connectorCurrentProvider ?? connectorEvmProvider ?? null;
  const walletSource = injectedFallback ? "injected" : "dogeos-sdk";
  const isConnected = Boolean(injectedFallback?.address) || wallet.isConnected;
  const isConnecting = injectedFallback ? false : wallet.isConnecting;
  const walletError = injectedFallback ? "" : wallet.error ? walletErrorMessage(wallet.error) : "";
  const switchToDogeOS = useCallback(async () => {
    if (injectedFallback?.provider) {
      const switched = await switchInjectedProviderToDogeOS();
      if (!switched) return false;
      const refreshed = await connectInjectedProviderToDogeOS().catch(() => null);
      if (refreshed) setInjectedFallback(refreshed);
      return true;
    }

    return switchDogeosSdkAccountToChain({ switchChain: account.switchChain }, DOGEOS_CHIKYU_TESTNET);
  }, [account.switchChain, injectedFallback]);
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
    walletSource,
  ]);

  useEffect(() => {
    if (injectedFallback) return undefined;
    if (!wallet.isConnected || !account.address) return undefined;
    if (account.chainType && account.chainType !== "evm") return undefined;
    if (chainIdMatchesDogeos(account.chainId)) return undefined;

    let cancelled = false;
    publishWalletState({
      address: account.address ?? "",
      chainId: account.chainId ?? "",
      chainType: account.chainType ?? "",
      error: "",
      hasProvider: Boolean(activeProvider),
      isConnected: wallet.isConnected,
      isConnecting: true,
      walletSource: "dogeos-sdk",
    });

    switchToDogeOS()
      .then(() => {
        if (cancelled) return;
        publishWalletState({
          address: account.address ?? "",
          chainId: DOGEOS_CHIKYU_TESTNET.id,
          chainType: account.chainType ?? "evm",
          error: "",
          hasProvider: Boolean(activeProvider),
          isConnected: wallet.isConnected,
          isConnecting: false,
          walletSource: "dogeos-sdk",
        });
      })
      .catch((error) => {
        if (cancelled) return;
        publishWalletState({
          address: account.address ?? "",
          chainId: account.chainId ?? "",
          chainType: account.chainType ?? "",
          error: walletErrorMessage(error),
          hasProvider: Boolean(activeProvider),
          isConnected: wallet.isConnected,
          isConnecting: false,
          walletSource: "dogeos-sdk",
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
    activeProvider,
    injectedFallback,
    switchToDogeOS,
    wallet.isConnected,
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

export default function DogeOSSdkWalletProvider() {
  const [chains, setChains] = useState(() => dogeConfig.chains);
  const config = useMemo(() => ({ ...dogeConfig, chains: chains ?? dogeConfig.chains }), [chains]);

  useEffect(() => {
    let active = true;

    getChains()
      .then((sdkChains) => {
        if (active) setChains(mergeDogeosChains(sdkChains));
      })
      .catch(() => {
        if (active) setChains(dogeConfig.chains);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <WalletConnectProvider config={config}>
      <DogeOSSdkWalletBridge />
    </WalletConnectProvider>
  );
}
