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
  // HYBRID: the lightweight injected EIP-6963 bridge is always mounted and owns the wallet by
  // default, so a browser wallet (MyDoge / MetaMask) connects INSTANTLY via the look-alike modal
  // (ConnectKitModal.jsx) with no SDK chunk. Separately, when a clientId is set, we PRE-MOUNT the
  // real SDK Connect Kit in the background on idle in `standby` (it fully initializes — chains,
  // WalletConnect, embedded wallet — but does NOT grab the active wallet or open its modal). So
  // when the user picks email / social / WalletConnect, the handoff just OPENS an already-ready
  // modal instead of mounting + re-initializing the SDK (which read as a "reload"). The SDK only
  // becomes the active wallet once the user actually connects through it.
  // No clientId => injected only (the SDK can't mount), same graceful fallback as before.
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
        : window.setTimeout(mountSdk, 2500);
    }
    // If the user reaches the social path before idle fired, mount the SDK immediately.
    const onLoadSdk = () => setSdkMounted(true);
    window.addEventListener("dogeos:load-sdk-social", onLoadSdk);

    return () => {
      window.removeEventListener("dogeos:load-sdk-social", onLoadSdk);
      if (handle != null) {
        if (window.cancelIdleCallback) window.cancelIdleCallback(handle);
        else window.clearTimeout(handle);
      }
    };
  }, []);

  return (
    <>
      <InjectedWalletBridge />
      {dogeConfig.clientId && sdkMounted && (
        <React.Suspense fallback={null}>
          <DogeOSSdkWalletProvider standby />
        </React.Suspense>
      )}
    </>
  );
}

const rootElement = document.querySelector("#sdk-wallet-root");

if (rootElement) {
  createRoot(rootElement).render(<DogeOSSdkWalletRoot />);
}
