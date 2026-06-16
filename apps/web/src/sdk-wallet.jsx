import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "./sdk-browser-globals.js";
import { createInjectedWalletBridge, detectInjectedProvider } from "./injected-wallet.js";
import { dogeConfig } from "./sdkConfig.js";

const SDK_WALLET_EVENT = "dogeos:sdk-wallet-updated";
const SDK_WALLET_READY_EVENT = "dogeos:sdk-wallet-ready";
const missingClientIdMessage =
  "DogeOS SDK client ID is not configured; injected wallet fallback is enabled.";
const injectedFallbackNotice =
  "DogeOS SDK clientId not set (DOGEOS_CLIENT_ID) — using injected wallet fallback; set it to enable the DogeOS Connect Kit (MyDoge + WalletConnect).";
let injectedFallbackNoticeLogged = false;

function noticeInjectedFallbackOnce() {
  if (injectedFallbackNoticeLogged) return;
  injectedFallbackNoticeLogged = true;
  // eslint-disable-next-line no-console
  console.info(injectedFallbackNotice);
}

const injectedFastPathNotice =
  "DogeOS: injected EVM wallet detected — connecting it directly and skipping the Connect Kit chunk.";
let injectedFastPathNoticeLogged = false;

function noticeInjectedFastPathOnce() {
  if (injectedFastPathNoticeLogged) return;
  injectedFastPathNoticeLogged = true;
  // eslint-disable-next-line no-console
  console.info(injectedFastPathNotice);
}

const DogeOSSdkWalletProvider = React.lazy(() => import("./sdk-wallet-provider.jsx"));

function publishWalletState(detail) {
  window.dispatchEvent(new CustomEvent(SDK_WALLET_EVENT, { detail }));
}

function publishWalletReady() {
  window.dispatchEvent(new Event(SDK_WALLET_READY_EVENT));
}

function InjectedWalletBridge() {
  useEffect(() => {
    const bridge = createInjectedWalletBridge({
      missingClientIdMessage,
      publishWalletReady,
      publishWalletState,
    });

    window.dogeosAggregatorWallet = bridge;
    bridge.initialize();

    return () => {
      if (window.dogeosAggregatorWallet === bridge) {
        delete window.dogeosAggregatorWallet;
      }
      bridge.destroy();
    };
  }, []);

  return null;
}

function DogeOSSdkWalletRoot() {
  // Bridge selection (useWallet() routes connect() on the bridge's `walletSource`, so both work):
  //   • no clientId               -> injected EIP-6963 bridge (the only option).
  //   • clientId + injected wallet -> injected FAST-PATH: connect MyDoge/MetaMask directly via
  //                                   window.ethereum/EIP-6963 and NEVER load the ~13.7MB Connect
  //                                   Kit chunk. This is the "fast MyDoge" path.
  //   • clientId + no injected     -> DogeOS Connect Kit (WalletConnect + embedded email/Google/X),
  //                                   which is exactly what a wallet-less visitor needs to onboard.
  //
  // Trade-off: a visitor who HAS a browser wallet but wants email/social login gets their wallet
  // instead of the modal. That is the standard "you have a wallet, use it" pattern; wallet-less
  // visitors still get the full Connect Kit.
  const [mode, setMode] = useState(dogeConfig.clientId ? "detecting" : "injected");

  useEffect(() => {
    if (!dogeConfig.clientId) {
      noticeInjectedFallbackOnce();
      return undefined;
    }
    let cancelled = false;
    // window.ethereum is detected synchronously; EIP-6963-only wallets (e.g. MyDoge Link) get a
    // short announcement window. Either way the decision happens during the on-load warm, well
    // before the user clicks Connect.
    detectInjectedProvider(window, { timeoutMs: 500 }).then((hasInjected) => {
      if (cancelled) return;
      if (hasInjected) noticeInjectedFastPathOnce();
      setMode(hasInjected ? "injected" : "sdk");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode === "detecting") return null; // brief; nothing usable to render until a bridge is chosen
  if (mode === "injected") return <InjectedWalletBridge />;

  return (
    <React.Suspense fallback={null}>
      <DogeOSSdkWalletProvider />
    </React.Suspense>
  );
}

const rootElement = document.querySelector("#sdk-wallet-root");

if (rootElement) {
  createRoot(rootElement).render(<DogeOSSdkWalletRoot />);
}
