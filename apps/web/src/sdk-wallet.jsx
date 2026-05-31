import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";

import { createInjectedWalletBridge } from "./injected-wallet.js";
import { dogeConfig } from "./sdkConfig.js";

const SDK_WALLET_EVENT = "dogeos:sdk-wallet-updated";
const SDK_WALLET_READY_EVENT = "dogeos:sdk-wallet-ready";
const missingClientIdMessage =
  "DogeOS SDK client ID is not configured; injected wallet fallback is enabled.";
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
  if (!dogeConfig.clientId) {
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
