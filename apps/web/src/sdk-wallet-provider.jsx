import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  getChains,
  WalletConnectProvider,
  useAccount,
  useWalletConnect,
} from "@dogeos/dogeos-sdk";
import "@dogeos/dogeos-sdk/style.css";

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
  return error?.shortMessage ?? error?.message ?? String(error);
}

function DogeOSSdkWalletBridge() {
  const wallet = useWalletConnect();
  const account = useAccount();
  const switchToDogeOS = useCallback(
    () =>
      account.switchChain({
        chainType: "evm",
        chainInfo: DOGEOS_CHIKYU_TESTNET,
      }),
    [account.switchChain],
  );

  useEffect(() => {
    const bridge = {
      openModal: () => wallet.openModal(),
      disconnect: () => wallet.disconnect(),
      switchToDogeOS,
      getAddress: () => account.address ?? "",
      getChainId: () => account.chainId ?? "",
      getChainType: () => account.chainType ?? "",
      getProvider: () => account.currentProvider ?? null,
      isConnected: () => wallet.isConnected,
    };

    window.dogeosAggregatorWallet = bridge;
    publishWalletReady();
    publishWalletState({
      address: account.address ?? "",
      chainId: account.chainId ?? "",
      chainType: account.chainType ?? "",
      error: wallet.error ? String(wallet.error) : "",
      hasProvider: Boolean(account.currentProvider),
      isConnected: wallet.isConnected,
      isConnecting: wallet.isConnecting,
      walletSource: "dogeos-sdk",
    });

    return () => {
      if (window.dogeosAggregatorWallet === bridge) {
        delete window.dogeosAggregatorWallet;
      }
    };
  }, [
    account.address,
    account.chainId,
    account.chainType,
    account.currentProvider,
    switchToDogeOS,
    wallet.disconnect,
    wallet.error,
    wallet.isConnected,
    wallet.isConnecting,
    wallet.openModal,
  ]);

  useEffect(() => {
    if (!wallet.isConnected || !account.address) return undefined;
    if (account.chainType && account.chainType !== "evm") return undefined;
    if (chainIdMatchesDogeos(account.chainId)) return undefined;

    let cancelled = false;
    publishWalletState({
      address: account.address ?? "",
      chainId: account.chainId ?? "",
      chainType: account.chainType ?? "",
      error: "",
      hasProvider: Boolean(account.currentProvider),
      isConnected: wallet.isConnected,
      isConnecting: true,
      walletSource: "dogeos-sdk",
    });

    switchToDogeOS().catch((error) => {
      if (cancelled) return;
      publishWalletState({
        address: account.address ?? "",
        chainId: account.chainId ?? "",
        chainType: account.chainType ?? "",
        error: walletErrorMessage(error),
        hasProvider: Boolean(account.currentProvider),
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
    switchToDogeOS,
    wallet.isConnected,
  ]);

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
