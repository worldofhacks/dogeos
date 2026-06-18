import React, { useEffect, useState } from "react";
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
  // SDK-only: with a clientId the real DogeOS Connect Kit is the single chooser for ALL connections
  // (MyDoge, MetaMask, WalletConnect, email/Google/X). It is PRE-MOUNTED in the background on idle so
  // it is fully initialized and the Connect modal opens instantly — no mount/re-init on click. No
  // clientId => the injected EIP-6963 bridge fallback (the SDK can't mount without one).
  const [sdkMounted, setSdkMounted] = useState(false);

  useEffect(() => {
    if (!dogeConfig.clientId) {
      noticeInjectedFallbackOnce();
      return undefined;
    }
    // Pre-mount the SDK in the background on idle (off the first-paint path). Skip on Save-Data.
    let handle;
    const saveData =
      typeof navigator !== "undefined" && navigator.connection && navigator.connection.saveData;
    const mountSdk = () => setSdkMounted(true);
    if (!saveData) {
      handle = window.requestIdleCallback
        ? window.requestIdleCallback(mountSdk, { timeout: 4000 })
        : window.setTimeout(mountSdk, 2000);
    }
    // Mount immediately if the user reaches Connect before idle fired (useWallet warms via this event).
    const onIntent = () => setSdkMounted(true);
    window.addEventListener("dogeos:load-sdk-wallet", onIntent);

    return () => {
      window.removeEventListener("dogeos:load-sdk-wallet", onIntent);
      if (handle != null) {
        if (window.cancelIdleCallback) window.cancelIdleCallback(handle);
        else window.clearTimeout(handle);
      }
    };
  }, []);

  if (!dogeConfig.clientId) return <InjectedWalletBridge />;
  if (!sdkMounted) return null;

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
