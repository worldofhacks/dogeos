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
  "MyDoge not detected. Install MyDoge, or set DOGEOS_CLIENT_ID to enable the in-app DogeOS Connect Kit (MyDoge + WalletConnect).";

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
      let wallet;
      try {
        wallet = await loadSdkWallet();
      } catch (error) {
        showToast(error?.message || INJECTED_HELP, "err");
        return;
      }
      if (!wallet?.openModal) {
        showToast("DogeOS SDK wallet is still loading. Try again in a moment.", "err");
        return;
      }
      if (state.address) return;
      if (wallet.isConnected?.()) {
        // The bridge is already connected but this hook instance missed the
        // event (fresh mount). Resync local state instead of silently doing
        // nothing — a dead connect button with no feedback is unrecoverable.
        const known = knownWalletState();
        if (known?.address) setState(known);
        return;
      }

      // SDK mode (clientId set): the Connect Kit modal is the chooser. No
      // per-wallet preference — openModal() presents the full wallet list.
      if (!isInjectedBridge(wallet, state.walletSource)) {
        try {
          await wallet.openModal();
        } catch (error) {
          showToast(error?.message || "Wallet connection failed.", "err");
        }
        return;
      }

      // Injected mode (no clientId). Pick the preference:
      //   • explicit preference (from the chooser) wins;
      //   • >1 injected wallet present → show the minimal chooser;
      //   • exactly 1 present → connect that wallet (whatever it is);
      //   • 0 present → attempt MyDoge, which yields the clear "MyDoge not
      //     detected" help toast since nothing answered EIP-6963.
      const explicit = typeof preference === "string" && preference;
      let target = explicit || DEFAULT_INJECTED_PREFERENCE;
      if (!explicit) {
        const wallets = wallet.listInjectedWallets?.() ?? [];
        if (wallets.length > 1) {
          setChooser({ wallets });
          return;
        }
        if (wallets.length === 1) {
          // Single wallet: connect it directly so a lone non-MyDoge wallet still
          // connects instead of erroring with "MyDoge not detected". An empty
          // preference ("" — unrecognised brand) means "the only injected
          // provider", which the bridge's generic resolver handles.
          target = wallets[0].preference;
        }
      }
      await runInjectedConnect(wallet, target).catch(() => {});
    },
    [state.address, state.walletSource, runInjectedConnect],
  );

  // Resolve the chooser: connect the user's explicitly selected injected wallet.
  // The preference is passed through as-is (incl. "" for an unrecognised brand,
  // which the bridge resolves to that injected provider).
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
    isConnecting: state.isConnecting,
    error: state.error,
    connect,
    disconnect,
    // Injected-only wallet chooser (null unless multiple injected wallets exist
    // and no clientId is set). The Shell renders <WalletChooser> from these.
    chooser,
    chooseWallet,
    cancelChooser,
  };
}
