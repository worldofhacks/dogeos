// useWallet.js — React hook wrapping the existing SDK wallet bridge.
//
// The bridge (sdk-wallet.jsx / sdk-wallet-provider.jsx / injected-wallet.js) is
// lazy-loaded by dispatching `dogeos:load-sdk-wallet`. Once ready it sets
// `window.dogeosAggregatorWallet` (with openModal/disconnect/isConnected/
// getProvider) and fires `dogeos:sdk-wallet-ready`. State updates arrive via the
// `dogeos:sdk-wallet-updated` event (detail: address, chainId, walletLabel,
// isConnecting, error, ...). This hook does NOT modify any wallet file — it only
// consumes those events, mirroring how app.js drives the legacy DOM UI.
//
// SDK-first: connect() opens the DogeOS Connect Kit modal, which is itself the
// wallet chooser (MyDoge / MetaMask / Rainbow / WalletConnect) when a clientId
// is provisioned, and the injected EIP-6963 bridge otherwise. No per-wallet
// preference is passed — the modal is the chooser.
//
// NOTE: Permit2 / eth_signTypedData_v4 frontend signing is deferred. The DogeOS
// SDK exposes no typed-data signing API and MyDoge support is unverified, so the
// live swap path keeps using on-chain ERC-20 `/approval` + eth_sendTransaction.
// getProvider() (→ useAccount().currentProvider EIP-1193) backs execute.js and
// useTokenBalances and must remain intact.
import { useCallback, useEffect, useState } from "react";

const SDK_WALLET_EVENT = "dogeos:sdk-wallet-updated";
const SDK_WALLET_READY_EVENT = "dogeos:sdk-wallet-ready";
const LOAD_SDK_WALLET_EVENT = "dogeos:load-sdk-wallet";

let sdkWalletReadyPromise = null;

function sdkWallet() {
  return (typeof window !== "undefined" && window.dogeosAggregatorWallet) || null;
}

// Ask the lazy bridge to mount and resolve once it exposes openModal.
function loadSdkWallet() {
  const existing = sdkWallet();
  if (existing?.openModal) return Promise.resolve(existing);

  sdkWalletReadyPromise ??= new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener(SDK_WALLET_READY_EVENT, handleReady);
      sdkWalletReadyPromise = null;
      reject(new Error("DogeOS SDK wallet did not load."));
    }, 10_000);

    function handleReady() {
      window.clearTimeout(timeout);
      window.removeEventListener(SDK_WALLET_READY_EVENT, handleReady);
      const readyWallet = sdkWallet();
      if (readyWallet?.openModal) {
        resolve(readyWallet);
      } else {
        sdkWalletReadyPromise = null;
        reject(new Error("DogeOS SDK wallet is unavailable."));
      }
    }

    window.addEventListener(SDK_WALLET_READY_EVENT, handleReady);
    window.dispatchEvent(new Event(LOAD_SDK_WALLET_EVENT));
  });

  return sdkWalletReadyPromise;
}

// Warm the bridge without opening the modal (e.g. to restore a session).
function preloadSdkWallet() {
  if (typeof window === "undefined") return;
  if (sdkWallet()?.openModal || sdkWalletReadyPromise) return;
  window.dispatchEvent(new Event(LOAD_SDK_WALLET_EVENT));
}

const EMPTY = {
  address: "",
  chainId: "",
  walletLabel: "",
  walletSource: "",
  isConnecting: false,
  error: "",
};

export function useWallet() {
  const [state, setState] = useState(EMPTY);

  // Subscribe to bridge updates + warm the lazy loader on mount.
  useEffect(() => {
    function onUpdate(event) {
      const detail = event.detail ?? {};
      setState({
        address: detail.address ?? "",
        chainId: detail.chainId ?? "",
        walletLabel: detail.walletLabel ?? "",
        walletSource: detail.walletSource ?? "",
        isConnecting: Boolean(detail.isConnecting),
        error: detail.error ?? "",
      });
    }

    window.addEventListener(SDK_WALLET_EVENT, onUpdate);
    preloadSdkWallet();

    return () => window.removeEventListener(SDK_WALLET_EVENT, onUpdate);
  }, []);

  const connect = useCallback(async () => {
    const wallet = await loadSdkWallet();
    if (!wallet?.openModal) {
      throw new Error("DogeOS SDK wallet is still loading.");
    }
    if (state.address || wallet.isConnected?.()) return;
    // No per-wallet preference: the Connect Kit modal is the chooser. When the
    // SDK isn't mounted, the injected bridge's openModal() handles selection.
    await wallet.openModal();
  }, [state.address]);

  const disconnect = useCallback(async () => {
    const wallet = sdkWallet();
    if (!wallet?.disconnect) return;
    await wallet.disconnect();
    setState((s) => ({ ...EMPTY, walletSource: s.walletSource }));
  }, []);

  return {
    address: state.address,
    chainId: state.chainId,
    walletLabel: state.walletLabel,
    isConnected: Boolean(state.address),
    isConnecting: state.isConnecting,
    error: state.error,
    connect,
    disconnect,
  };
}
