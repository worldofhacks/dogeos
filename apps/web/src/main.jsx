// main.jsx — React entry. Mounts the DogeSwap shell and keeps the lazy
// `dogeos:load-sdk-wallet` → import("./sdk-wallet.jsx") wiring so the existing
// wallet bridge mounts on demand (the useWallet hook dispatches the load event).
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./ui/App.jsx";
import "./styles/global.css";

let sdkWalletImportPromise = null;
function loadDogeosSdkWallet() {
  sdkWalletImportPromise ??= import("./sdk-wallet.jsx");
  return sdkWalletImportPromise;
}
window.addEventListener("dogeos:load-sdk-wallet", loadDogeosSdkWallet);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
