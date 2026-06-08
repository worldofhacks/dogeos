import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const appRoot = resolve(import.meta.dirname, "../../../apps/web/src");
const repoRoot = resolve(import.meta.dirname, "../../..");

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

test("static web app serves the React shell that boots the DogeSwap app", async () => {
  const [html, main, app, globalCss, sdkWallet, sdkWalletProvider, sdkChainSwitch, injectedWallet, sdkConfig, packageJson] =
    await Promise.all([
      readFile(resolve(appRoot, "index.html"), "utf8"),
      readFile(resolve(appRoot, "main.jsx"), "utf8"),
      readFile(resolve(appRoot, "ui/App.jsx"), "utf8"),
      readFile(resolve(appRoot, "styles/global.css"), "utf8"),
      readOptional(resolve(appRoot, "sdk-wallet.jsx")),
      readOptional(resolve(appRoot, "sdk-wallet-provider.jsx")),
      readOptional(resolve(appRoot, "sdk-chain-switch.js")),
      readOptional(resolve(appRoot, "injected-wallet.js")),
      readOptional(resolve(appRoot, "sdkConfig.js")),
      readFile(resolve(repoRoot, "package.json"), "utf8"),
    ]);
  const packageBody = JSON.parse(packageJson);

  // The shell is a minimal HTML document: a React mount point plus the entry
  // module and runtime-config script. The legacy vanilla markup (swap-form,
  // route tables, chain-status grid, sliders, etc.) now lives in React
  // components and must NOT be hand-authored into index.html anymore.
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<title>DogeSwap[^<]*DogeOS<\/title>/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /id="sdk-wallet-root"/);
  assert.match(html, /src="\/runtime-config\.js"/);
  assert.match(html, /<script type="module" src="\/main\.jsx">/);
  assert.match(html, /fonts\.googleapis\.com/);
  assert.match(html, /family=Space\+Grotesk/);
  assert.match(html, /rel="icon" href="\/favicon\.svg"/);
  // The vanilla view layer is gone — no static aggregator DOM should remain.
  assert.doesNotMatch(html, /id="swap-form"/);
  assert.doesNotMatch(html, /id="route-table"/);
  assert.doesNotMatch(html, /id="chain-status-panel"/);
  assert.doesNotMatch(html, /id="slippage-slider"/);
  assert.doesNotMatch(html, /app\.js/);
  assert.doesNotMatch(html, /styles\.css/);

  // The entry module mounts the React tree and keeps the lazy SDK-wallet wiring.
  assert.match(main, /import App from "\.\/ui\/App\.jsx"/);
  assert.match(main, /import "\.\/styles\/global\.css"/);
  assert.match(main, /ReactDOM\.createRoot\(document\.getElementById\("root"\)\)/);
  assert.match(main, /<App \/>/);
  assert.match(main, /import\("\.\/sdk-wallet\.jsx"\)/);
  assert.match(main, /dogeos:load-sdk-wallet/);
  assert.doesNotMatch(main, /import "\.\/app\.js"/);
  assert.doesNotMatch(main, /import "\.\/sdk-wallet\.jsx"/);

  // App.jsx is the composed root that wires the views together.
  assert.match(app, /export default function App/);

  // The new design-system stylesheet supersedes the deleted styles.css.
  assert.match(globalCss, /:root/);
  assert.doesNotMatch(globalCss, /purple|violet|#7c3aed/i);

  // The wallet bridge files are unchanged by this cleanup but still part of the
  // shipped shell, so keep the live wiring under test.
  assert.doesNotMatch(sdkWallet, /@dogeos\/dogeos-sdk/);
  assert.match(sdkWallet, /import\("\.\/sdk-wallet-provider\.jsx"\)/);
  assert.match(sdkWallet, /createInjectedWalletBridge/);
  assert.match(sdkWallet, /injected wallet fallback is enabled/);
  assert.match(sdkWallet, /dogeos:sdk-wallet-ready/);
  assert.match(injectedWallet, /export function createInjectedWalletBridge/);
  assert.match(injectedWallet, /globalObject\?\.ethereum/);
  assert.match(injectedWallet, /eth_requestAccounts/);
  assert.match(injectedWallet, /eth_accounts/);
  assert.match(injectedWallet, /eth_chainId/);
  assert.match(injectedWallet, /wallet_switchEthereumChain/);
  assert.match(injectedWallet, /wallet_addEthereumChain/);
  assert.match(injectedWallet, /walletSource:\s*"injected"/);
  assert.match(sdkWalletProvider, /@dogeos\/dogeos-sdk/);
  assert.match(sdkWalletProvider, /@dogeos\/dogeos-sdk\/style\.css/);
  assert.match(sdkWalletProvider, /useConnectors/);
  assert.match(sdkWalletProvider, /switchDogeosSdkAccountToChain/);
  assert.match(sdkWalletProvider, /switchInjectedProviderToDogeOS/);
  assert.match(sdkWalletProvider, /chainIdMatchesDogeos/);
  assert.match(sdkWalletProvider, /openDogeosWalletModal/);
  assert.match(sdkWalletProvider, /walletSource:\s*"dogeos-sdk"/);
  assert.match(sdkChainSwitch, /isUnknownChainError/);
  assert.match(sdkChainSwitch, /switchInjectedProviderToDogeOS/);
  assert.match(sdkChainSwitch, /Chain Id not supported|was not accepted/);
  assert.match(sdkConfig, /VITE_DOGEOS_CLIENT_ID/);
  assert.match(sdkConfig, /DOGEOS_AGGREGATOR_CONFIG/);
  assert.match(sdkConfig, /dogeosClientId/);
  assert.match(sdkConfig, /defaultConnectChain:\s*"evm"/);

  // Build/runtime contract that the shell depends on.
  assert.equal(packageBody.dependencies["@dogeos/dogeos-sdk"], "3.2.0");
  assert.equal(packageBody.dependencies.wagmi, "^2.19.5");
  assert.equal(packageBody.dependencies.react, "^18.3.1");
  assert.equal(packageBody.dependencies["react-dom"], "^18.3.1");
  assert.equal(packageBody.devDependencies.typescript, "^5.9.3");
  assert.equal(packageBody.devDependencies.vite, "^6.4.2");
  assert.equal(packageBody.scripts["build:web"], "vite build");
  assert.match(packageBody.scripts["start:web"], /--env-file-if-exists=\.env/);
});
