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
  // HYBRID: mount the lightweight injected EIP-6963 bridge by default so a browser wallet
  // (MyDoge / MetaMask) connects INSTANTLY and never loads the ~13.7MB Connect Kit chunk.
  // The app's own look-alike modal (ConnectKitModal.jsx) is the chooser. Swap to the real SDK
  // Connect Kit only on demand — when the user picks email / social / WalletConnect, which
  // genuinely need the SDK — via the `dogeos:load-sdk-social` event (useWallet.startSocial()).
  // No clientId => injected only (the SDK can't mount), same graceful fallback as before.
  const [mode, setMode] = useState("injected");

  useEffect(() => {
    if (!dogeConfig.clientId) {
      noticeInjectedFallbackOnce();
      return undefined;
    }
    const onLoadSdk = () => setMode("sdk");
    window.addEventListener("dogeos:load-sdk-social", onLoadSdk);

    // Background-warm the SDK Connect Kit module on idle so the email/social handoff is smooth:
    // download + parse the heavy chunk while the user reads the page (off the first-paint path).
    // It only PRE-LOADS the module — React.lazy reuses it, so the later mount is fast and never
    // opens the modal on its own. Skipped on Save-Data connections.
    let warmHandle;
    const saveData =
      typeof navigator !== "undefined" && navigator.connection && navigator.connection.saveData;
    if (!saveData) {
      const warm = () => {
        import("./sdk-wallet-provider.jsx").catch(() => {});
      };
      warmHandle = window.requestIdleCallback
        ? window.requestIdleCallback(warm, { timeout: 4000 })
        : window.setTimeout(warm, 2500);
    }

    return () => {
      window.removeEventListener("dogeos:load-sdk-social", onLoadSdk);
      if (warmHandle != null) {
        if (window.cancelIdleCallback) window.cancelIdleCallback(warmHandle);
        else window.clearTimeout(warmHandle);
      }
    };
  }, []);

  if (mode === "injected") return <InjectedWalletBridge />;

  return (
    <React.Suspense fallback={null}>
      <DogeOSSdkWalletProvider openOnReady />
    </React.Suspense>
  );
}

const rootElement = document.querySelector("#sdk-wallet-root");

if (rootElement) {
  createRoot(rootElement).render(<DogeOSSdkWalletRoot />);
}
