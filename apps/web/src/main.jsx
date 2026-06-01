import "./app.js";

let sdkWalletImportPromise = null;

function loadDogeosSdkWallet() {
  sdkWalletImportPromise ??= import("./sdk-wallet.jsx");
  return sdkWalletImportPromise;
}

window.addEventListener("dogeos:load-sdk-wallet", loadDogeosSdkWallet);
