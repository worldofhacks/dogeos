import "./app.js";

let sdkWalletImportPromise = null;

function loadDogeosSdkWallet() {
  sdkWalletImportPromise ??= import("./sdk-wallet.jsx");
  return sdkWalletImportPromise;
}

window.addEventListener("dogeos:load-sdk-wallet", loadDogeosSdkWallet);

function hasDogeosClientId() {
  const runtimeConfig = window.DOGEOS_AGGREGATOR_CONFIG ?? {};
  return Boolean(runtimeConfig.dogeosClientId || import.meta.env.VITE_DOGEOS_CLIENT_ID);
}

function scheduleIdleSdkWalletLoad() {
  if (!hasDogeosClientId()) return;

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(loadDogeosSdkWallet, { timeout: 2_500 });
  } else {
    window.setTimeout(loadDogeosSdkWallet, 2_500);
  }
}

window.addEventListener("dogeos:quote-ready", scheduleIdleSdkWalletLoad, { once: true });
