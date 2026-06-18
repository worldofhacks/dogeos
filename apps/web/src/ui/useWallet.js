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
// Connect behaviour depends on whether a DogeOS SDK clientId is provisioned:
//
//   • clientId SET → the SDK Connect Kit is mounted (sdk-wallet-provider.jsx)
//     and its modal is the single chooser for ALL wallets (MyDoge / MetaMask /
//     Rainbow / WalletConnect). connect() just calls openModal() with no
//     preference — the modal is the chooser. (Mobile MyDoge via WalletConnect
//     also requires the clientId.)
//
//   • clientId NOT set (the default — no DOGEOS_CLIENT_ID / VITE_DOGEOS_CLIENT_ID)
//     → only the injected EIP-6963 bridge (injected-wallet.js) is active. The
//     Connect Kit never mounts. connect() therefore drives the injected bridge
//     directly: it defaults to MyDoge, falls back to a minimal chooser when
//     several injected wallets are present, and surfaces a CLEAR toast on
//     failure (e.g. MyDoge not detected) instead of failing silently.
//
// Previously connect() always called openModal() with NO preference. In injected
// mode that made the generic resolver prefer MetaMask/Rainbow over MyDoge, and —
// worse — every rejection was an unhandled promise (no toast, nothing rendered),
// so "connect MyDoge" appeared to do nothing. That is the bug this fixes.
//
// NOTE: Permit2 / eth_signTypedData_v4 frontend signing is deferred. The DogeOS
// SDK exposes no typed-data signing API and MyDoge support is unverified, so the
// live swap path keeps using on-chain ERC-20 `/approval` + eth_sendTransaction.
// getProvider() (→ useAccount().currentProvider EIP-1193) backs execute.js and
// useTokenBalances and must remain intact.
import { useCallback, useEffect, useState } from "react";

import { showToast } from "./Toast.jsx";

const INJECTED_HELP =
  "MyDoge not detected. Install MyDoge to connect.";

// Default injected preference when no clientId is set: target MyDoge directly so
// a single click connects the Dogecoin-native wallet the user expects.
const DEFAULT_INJECTED_PREFERENCE = "mydoge";

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
    // The Connect Kit provider is a large chunk (the SDK pulls in the full
    // WalletConnect/Reown + multi-chain adapter graph), so allow a generous
    // window before giving up — a 10s cap was firing mid-load on slower
    // connections, surfacing a spurious error and tempting a re-click that
    // stacked a second load on top of the first (the "~30s to connect" report).
    const timeout = window.setTimeout(() => {
      window.removeEventListener(SDK_WALLET_READY_EVENT, handleReady);
      sdkWalletReadyPromise = null;
      reject(new Error("DogeOS wallet kit is taking longer than usual to load. Check your connection and try again."));
    }, 45_000);

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

function stateFromDetail(detail = {}) {
  return {
    address: detail.address ?? "",
    chainId: detail.chainId ?? "",
    walletLabel: detail.walletLabel ?? "",
    walletSource: detail.walletSource ?? "",
    isConnecting: Boolean(detail.isConnecting),
    error: detail.error ?? "",
  };
}

// The bridges publish state as events but never replay them, so a hook
// instance mounted AFTER a publish (Shell remounts views with key={view})
// would start disconnected while the wallet is connected. Remember the last
// published state at module scope — shared by every instance — and fall back
// to the bridge's synchronous getters for anything published before this
// module loaded.
let lastBridgeState = null;

if (typeof window !== "undefined") {
  window.addEventListener(SDK_WALLET_EVENT, (event) => {
    lastBridgeState = stateFromDetail(event.detail ?? {});
  });
}

function bridgeSnapshot() {
  const wallet = sdkWallet();
  if (!wallet) return null;
  try {
    const address = wallet.getAddress?.() ?? "";
    if (!address) return null;
    return {
      ...EMPTY,
      address,
      chainId: wallet.getChainId?.() ?? "",
      walletSource: wallet.walletSource ?? "",
    };
  } catch {
    return null;
  }
}

function knownWalletState() {
  return lastBridgeState ?? bridgeSnapshot();
}

// True when the bridge is the injected EIP-6963 fallback (no clientId). The
// bridge tags itself via `walletSource`; we also accept the last published state
// as a fallback signal in case the property read races the event.
function isInjectedBridge(wallet, lastSource) {
  return wallet?.walletSource === "injected" || lastSource === "injected";
}

// Connect through the injected bridge with a concrete preference, mapping a
// "no provider" rejection to the actionable help toast. Returns the address.
async function connectInjected(wallet, preference) {
  return wallet.openModal({ walletPreference: preference });
}

export function useWallet() {
  // Seed from the last known bridge state so a remount (tab switch) keeps the
  // live connection instead of resetting to disconnected.
  const [state, setState] = useState(() => knownWalletState() ?? EMPTY);
  // Minimal chooser state for injected-only mode with multiple wallets. The
  // Shell renders <WalletChooser> from this; selecting an option resolves it.
  const [chooser, setChooser] = useState(null); // { wallets: [...] } | null
  // True while connect() is awaiting the lazy SDK wallet chunk (and the ensuing
  // handshake). The bridge only publishes `isConnecting` once it is mounted, so
  // without this the button stayed clickable during the multi-second chunk load
  // and a second click stacked another connect attempt.
  const [preparing, setPreparing] = useState(false);

  // Subscribe to bridge updates + warm the lazy loader on mount.
  useEffect(() => {
    function onUpdate(event) {
      setState(stateFromDetail(event.detail ?? {}));
    }

    window.addEventListener(SDK_WALLET_EVENT, onUpdate);
    preloadSdkWallet();

    // Re-sync anything published between the initial-state seed and this
    // subscription (the module-level listener above saw it; we may not have).
    const known = knownWalletState();
    if (known) setState(known);

    return () => window.removeEventListener(SDK_WALLET_EVENT, onUpdate);
  }, []);

  // Drive the injected connection for a chosen preference, toasting on failure.
  const runInjectedConnect = useCallback(async (wallet, preference) => {
    try {
      await connectInjected(wallet, preference);
    } catch (error) {
      // The bridge already published its detailed error to state; the toast is
      // the visible, actionable summary so the click never fails silently. For
      // the MyDoge "no provider found" case we show the concise install/clientId
      // help; other failures (user rejection, chain switch) keep their message.
      const message = error?.message || error?.shortMessage || "";
      const myDogeNotFound =
        preference === "mydoge" && /MyDoge|client ID|injected MyDoge|did not announce/i.test(message);
      showToast(myDogeNotFound || !message ? INJECTED_HELP : message, "err");
      throw error;
    }
  }, []);

  const connect = useCallback(
    async (preference) => {
      if (state.address) return;
      setPreparing(true);
      try {
        let wallet;
        try {
          wallet = await loadSdkWallet();
        } catch (error) {
          showToast(error?.message || INJECTED_HELP, "err");
          return;
        }
        if (!wallet?.openModal) {
          showToast("DogeOS wallet is still loading. Try again in a moment.", "err");
          return;
        }
        if (wallet.isConnected?.()) {
          // The bridge is already connected but this hook instance missed the event (fresh
          // mount). Resync from the live getters instead of doing nothing.
          const known = bridgeSnapshot() ?? knownWalletState();
          if (known?.address) {
            setState(known);
            return;
          }
        }

        // SDK mode (clientId set): the DogeOS Connect Kit modal is the single chooser for ALL
        // connections (MyDoge / MetaMask / WalletConnect / email / Google / X). It is pre-mounted,
        // so openModal() opens instantly.
        if (!isInjectedBridge(wallet, state.walletSource)) {
          try {
            await wallet.openModal();
          } catch (error) {
            showToast(error?.message || "Wallet connection failed.", "err");
          }
          return;
        }

        // No clientId: injected-only fallback. Default to MyDoge; show the minimal chooser when
        // several supported wallets are present.
        const explicit = typeof preference === "string" && preference;
        let target = explicit || DEFAULT_INJECTED_PREFERENCE;
        if (!explicit) {
          const wallets = wallet.listInjectedWallets?.() ?? [];
          if (wallets.length > 1) {
            setChooser({ wallets });
            return;
          }
          if (wallets.length === 1) {
            target = wallets[0].preference;
          }
        }
        await runInjectedConnect(wallet, target).catch(() => {});
      } finally {
        setPreparing(false);
      }
    },
    [state.address, state.walletSource, runInjectedConnect],
  );

  // Resolve the chooser: connect the user's explicitly selected injected wallet.
  // The preference is passed through as-is; the chooser only lists supported
  // brands so it is always a concrete preference key.
  const chooseWallet = useCallback(
    async (preference) => {
      setChooser(null);
      const wallet = sdkWallet();
      if (!wallet?.openModal) {
        showToast(INJECTED_HELP, "err");
        return;
      }
      await runInjectedConnect(wallet, preference ?? "").catch(() => {});
    },
    [runInjectedConnect],
  );

  const cancelChooser = useCallback(() => setChooser(null), []);

  // Ask the wallet to switch to DogeOS Chikyu. Resolves false when the wallet
  // refuses (user rejection / unsupported), so callers can surface a toast.
  // The bridge republishes chainId after a successful switch, which resyncs
  // every hook instance.
  const switchChain = useCallback(async () => {
    const wallet = sdkWallet();
    if (!wallet?.switchToDogeOS) return false;
    try {
      return (await wallet.switchToDogeOS()) !== false;
    } catch {
      return false;
    }
  }, []);

  const disconnect = useCallback(async () => {
    const wallet = sdkWallet();
    if (!wallet?.disconnect) return;
    await wallet.disconnect();
    // The bridge publishes the disconnect (updating the module-level cache),
    // but clear it defensively so a remount can never resurrect a stale
    // connected state.
    lastBridgeState = null;
    setState((s) => ({ ...EMPTY, walletSource: s.walletSource }));
  }, []);

  return {
    address: state.address,
    chainId: state.chainId,
    walletLabel: state.walletLabel,
    isConnected: Boolean(state.address),
    isConnecting: Boolean(state.isConnecting) || preparing,
    error: state.error,
    connect,
    disconnect,
    switchChain,
    // Injected-only wallet chooser (null unless multiple injected wallets exist
    // and no clientId is set). The Shell renders <WalletChooser> from these.
    chooser,
    chooseWallet,
    cancelChooser,
  };
}
