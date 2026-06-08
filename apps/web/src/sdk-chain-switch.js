import {
  connectInjectedProviderToDogeOS,
  isUnknownChainError,
  switchInjectedProviderToDogeOS,
} from "./injected-wallet.js";

function chainLabel(chainInfo) {
  const name = chainInfo?.name || "DogeOS Chikyu Testnet";
  const id = chainInfo?.id ?? 6_281_971;
  return `${name} (${id})`;
}

export function dogeosSdkSwitchFailureMessage(chainInfo) {
  return `${chainLabel(chainInfo)} was not accepted by the connected wallet. Add DogeOS Chikyu Testnet with RPC https://rpc.testnet.dogeos.com and chain ID 6281971, then connect again.`;
}

async function tryInjectedDogeosSwitch(globalObject) {
  try {
    return await switchInjectedProviderToDogeOS(globalObject);
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
    return false;
  }
}

async function tryInjectedDogeosConnection(globalObject, walletPreference = "") {
  try {
    return await connectInjectedProviderToDogeOS(globalObject, { walletPreference });
  } catch (error) {
    if (isUnknownChainError(error)) return null;
    throw error;
  }
}

export async function switchDogeosSdkAccountToChain(account, chainInfo, { globalObject } = {}) {
  if (typeof account?.switchChain !== "function") {
    throw new Error("DogeOS SDK wallet account cannot switch EVM chains.");
  }

  try {
    const switched = await account.switchChain({
      chainType: "evm",
      chainInfo,
    });
    if (switched) return true;
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
  }

  if (await tryInjectedDogeosSwitch(globalObject)) return true;

  throw new Error(dogeosSdkSwitchFailureMessage(chainInfo));
}

// SDK-first connect path. The DogeOS Connect Kit modal (openModal) is the single
// chooser for ALL wallets — MyDoge, MetaMask, Rainbow, WalletConnect — and lists
// them itself from config.connectors. We call openModal() directly with no
// "try injected MyDoge first" shortcut and no per-wallet preference branching.
// The injected EIP-6963 path is used ONLY as a true fallback: when openModal is
// unavailable (SDK not mounted / no clientId) or it throws an unknown-chain
// error. A null return means the SDK modal handled the connection.
export async function openDogeosSdkWalletModal({ openModal, chainInfo, globalObject, walletPreference = "" } = {}) {
  if (typeof openModal !== "function") {
    // SDK modal not available — fall back to the injected provider directly.
    const injectedConnection = await tryInjectedDogeosConnection(globalObject, walletPreference);
    if (injectedConnection) return injectedConnection;
    throw new Error("DogeOS SDK wallet modal is unavailable.");
  }

  try {
    return await openModal();
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;

    const injectedConnection = await tryInjectedDogeosConnection(globalObject, walletPreference);
    if (injectedConnection) return injectedConnection;

    throw new Error(dogeosSdkSwitchFailureMessage(chainInfo));
  }
}
