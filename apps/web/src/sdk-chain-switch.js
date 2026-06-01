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

export async function openDogeosSdkWalletModal({ openModal, chainInfo, globalObject } = {}) {
  if (typeof openModal !== "function") {
    throw new Error("DogeOS SDK wallet modal is unavailable.");
  }

  try {
    await switchInjectedProviderToDogeOS(globalObject);
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
  }

  try {
    return await openModal();
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;

    const injectedConnection = await connectInjectedProviderToDogeOS(globalObject).catch((connectError) => {
      if (isUnknownChainError(connectError)) return null;
      throw connectError;
    });
    if (injectedConnection) return injectedConnection;

    throw new Error(dogeosSdkSwitchFailureMessage(chainInfo));
  }
}
