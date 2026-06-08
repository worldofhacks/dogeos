import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";

import "./sdk-browser-globals.js";
import { createInjectedWalletBridge } from "./injected-wallet.js";
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
  // When no clientId is provisioned the DogeOS Connect Kit cannot mount, so we
  // keep the EIP-6963 injected bridge as the graceful fallback (MyDoge still
  // connects via window.ethereum — see useWallet.connect()). With a clientId we
  // mount the SDK provider and the Connect Kit modal becomes the primary chooser
  // for all wallets (and unlocks mobile MyDoge via WalletConnect).
  //
  // To provision the clientId set DOGEOS_CLIENT_ID (or VITE_DOGEOS_CLIENT_ID) in
  // .env / the environment. It is read at runtime in packages/web/src/server.mjs
  // and at build time in vite.config.mjs, then surfaced via sdkConfig.js
  // (dogeConfig.clientId) / window.DOGEOS_AGGREGATOR_CONFIG.dogeosClientId.
  if (!dogeConfig.clientId) {
    noticeInjectedFallbackOnce();
    return <InjectedWalletBridge />;
  }

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
