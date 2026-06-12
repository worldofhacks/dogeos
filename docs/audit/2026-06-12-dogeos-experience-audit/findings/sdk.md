# DogeOS SDK & Wallet Integration — Audit Findings

Audit dimension: **DogeOS SDK & wallet integration** (`@dogeos/dogeos-sdk` 3.2.0)
Date: 2026-06-12
Auditor: Senior DogeOS Protocol Engineer
Scope: `apps/web/src/{main,sdkConfig,sdk-wallet,sdk-wallet-provider,sdk-chain-switch,sdk-browser-globals,injected-wallet}`, `packages/web/src/server.mjs`, `vite.config.mjs`, `.env`, and live prod (`127.0.0.1:8080`).

---

## Overall assessment

The codebase contains a genuinely careful, type-accurate integration of `@dogeos/dogeos-sdk` 3.2.0: the pinned version matches what is installed, every imported symbol (`WalletConnectProvider`, `useWalletConnect`, `useAccount`, `useConnectors`, `getChains`, `getConnectors`) exists in the 3.2.0 type surface, the stylesheet import path is correct, `getConnectors()` results are threaded into `config.connectors` (not mistakenly handed to `connect()`), `connect()` is never called with `WalletConfig` objects, and `switchChain({ chainType: "evm", chainInfo })` is used exactly as documented. The provider config (chains under `chains.evm`, `defaultConnectChain: "evm"`, `login`, `theme`, `metadata`) is idiomatic.

The integration nonetheless has one decisive problem and several structural ones. **In production the SDK is entirely dead code:** `DOGEOS_CLIENT_ID`/`VITE_DOGEOS_CLIENT_ID` are empty in `.env`, the live `runtime-config.js` serves `"dogeosClientId":""`, and `sdk-wallet.jsx:66` gates the entire `WalletConnectProvider` behind a truthy clientId — so the 13.7 MB SDK provider chunk is built and shipped but never executed, and users get only the hand-rolled injected EIP-6963 fallback. Connect Kit, embedded wallets (email/Google/X), and mobile MyDoge via WalletConnect are all unreachable on the deployed app. Compounding this, `WalletConnectProvider` is **not** nested inside a `WagmiProvider` anywhere (no `WagmiProvider`/`createConfig`/`QueryClientProvider` exists in the app), so even when a clientId is added the documented Wagmi synchronization will silently never happen; and the live CSP is the default `frame-ancestors 'self'`, which lacks the `frame-src`/`connect-src` `tomo.inc` allowances the SDK needs — so turning on the clientId without also enabling the hardened CSP would break the embedded wallet.

Net: the *code* is well-written and faithful to the docs, but the *deployed product* is an injected-wallet app wearing an unused SDK. The injected fallback itself is a large, fragile, hand-maintained surface that re-implements wallet discovery the SDK is meant to own.

---

## Strengths

- **Version pin is honest.** `package.json` pins `@dogeos/dogeos-sdk@3.2.0` and `node_modules/@dogeos/dogeos-sdk/package.json` reports `3.2.0`. No drift. `wagmi ^2.19.5` satisfies the SDK peer dep `wagmi >=2.0.0` (verified from the SDK's `peerDependencies`).
- **API surface matches 3.2.0 exactly.** Every imported symbol resolves in the installed `dist/index.d.ts`. `useConnectors().connectors.evm?.provider` (`sdk-wallet-provider.jsx:70`) is a valid access path — `ConnectorProviders = Partial<Record<ChainTypeEnum, ConnectorProvider|null>>` and `ConnectorProvider.provider` exists (`@tomo-inc/wallet-adaptor-base`).
- **`getConnectors()` / `connect()` distinction is respected.** The single most common SDK misuse — passing `getConnectors()` `WalletConfig[]` into `connect()` — is explicitly avoided. The connect flow only ever calls `wallet.openModal()` (`useWallet.js:237`, `sdk-chain-switch.js:71`); `connect()` is never invoked. `getConnectors()` output is correctly fed to `config.connectors` (`sdk-wallet-provider.jsx:301-307`), matching the docs.
- **Config shape is idiomatic.** Chain placed under `chains.evm`, `defaultConnectChain: "evm"`, `login.basicLogins`/`socialLogins`, `theme.defaultTheme`, and `metadata` all match the documented `WalletConnectKitConfig`. `getChains()`/`getConnectors()` are loaded async with graceful fallbacks (`sdk-wallet-provider.jsx:287-312`).
- **Stylesheet import is correct.** `import "@dogeos/dogeos-sdk/style.css"` (`sdk-wallet-provider.jsx:10`) resolves via the SDK's `exports["./style.css"]` map. Imported once, at the provider module.
- **`switchChain` usage is by-the-book.** `account.switchChain({ chainType: "evm", chainInfo })` (`sdk-chain-switch.js:41`) with try/catch and a user-actionable failure message — exactly the documented pattern.
- **Lazy mount + SSR safety.** The provider is `React.lazy`-loaded and only mounted client-side under `#sdk-wallet-root`; `appUrl` guards `typeof window === "undefined"` (`sdkConfig.js:1`). This honors the SDK's browser-only constraint.
- **A hardened, SDK-aware CSP is pre-written** in `.env` (commented), including `frame-src https://dogeos.embedded-wallet.tomo.inc` and `connect-src ... https://mydoge-wallet.tomo.inc https://social-relay.tomo.inc`, with an explicit "test in staging first" note.

---

## Findings

### SDK-1 — SDK is dead code in production: clientId is empty, so Connect Kit / embedded wallets / mobile MyDoge never load
**Severity: high · Confidence: high**
**Location:** `.env:8-9`; `apps/web/src/sdk-wallet.jsx:66-69`; live `http://127.0.0.1:8080/runtime-config.js`

**Evidence.**
- `.env`: `DOGEOS_CLIENT_ID=` and `VITE_DOGEOS_CLIENT_ID=` are both empty (verified by value-length check: `len=0`).
- Live prod serves `window.DOGEOS_AGGREGATOR_CONFIG = Object.freeze({"dogeosClientId":"","walletConnectProjectId":""});` (curled from `127.0.0.1:8080/runtime-config.js`).
- The render gate: `if (!dogeConfig.clientId) { ...; return <InjectedWalletBridge />; }` (`sdk-wallet.jsx:66-69`). `dogeConfig.clientId` is `runtimeConfig.dogeosClientId || import.meta.env.VITE_DOGEOS_CLIENT_ID || ""` (`sdkConfig.js:54`), which resolves to `""`.
- Consequently `DogeOSSdkWalletProvider` (and therefore `WalletConnectProvider`) is never mounted in prod. The built chunk exists (`apps/web/dist/assets/sdk-wallet-provider-CfmhEDam.js`, **13.7 MB**) but is never imported at runtime.

**Impact.** Every SDK-only capability is unavailable to live users: the DogeOS Connect Kit modal, embedded wallets (email / Google / X social login), and **mobile MyDoge via WalletConnect**. The product silently degrades to the hand-rolled injected EIP-6963 path (desktop extensions only). All of the SDK wiring under audit is effectively untested-in-prod scaffolding. This is a product/UX gap, not a code bug — but it means the headline "DogeOS SDK integration" is not actually live.

**Recommendation.** Register the app origin at `https://sdk.dogeos.com/register`, set `DOGEOS_CLIENT_ID` (runtime, restart-only) and `VITE_DOGEOS_CLIENT_ID` (build-time), redeploy, and verify `runtime-config.js` reports a non-empty id. Add a smoke test/monitor asserting the live `runtime-config.js` clientId is non-empty so a silent regression to injected-only mode is caught. Until then, treat the SDK path as unverified against the live chain.

---

### SDK-2 — `WalletConnectProvider` is not nested inside `WagmiProvider`; documented Wagmi sync will silently never occur
**Severity: high · Confidence: high**
**Location:** `apps/web/src/main.jsx`, `apps/web/src/ui/App.jsx`, `apps/web/src/sdk-wallet-provider.jsx:314-318`; `package.json:20` (`wagmi ^2.19.5`)

**Evidence.**
- `grep -rn "WagmiProvider|createConfig|QueryClient" apps/web/src` returns **nothing** in app code. There is no `WagmiProvider`, no `createConfig`, no `QueryClientProvider` anywhere.
- `WalletConnectProvider` is rendered bare: `return (<WalletConnectProvider config={config}><DogeOSSdkWalletBridge /></WalletConnectProvider>)` (`sdk-wallet-provider.jsx:314-318`), mounted on a **separate React root** (`#sdk-wallet-root`, `sdk-wallet.jsx:78-82`) entirely disjoint from the main app root (`#root`, `main.jsx:17`).
- The docs are explicit: "The DogeOS SDK automatically detects an existing Wagmi configuration when `WalletConnectProvider` is mounted inside `WagmiProvider`" and "`WalletConnectProvider` must be nested inside `WagmiProvider`" (sdk.md, Wagmi Integration + Troubleshooting). `wagmi 2.19.5` is nonetheless a direct dependency (`package.json:20`).

**Impact.** Two consequences. (1) `wagmi` is installed as a dependency but no Wagmi config exists, so no app code can use `useAccount`/`useSendTransaction`/`useSwitchChain` against the SDK connection — the dependency is dead weight. (2) When a clientId is later added (SDK-1), the documented EVM↔Wagmi synchronization will never engage because the provider is not under a `WagmiProvider`, and — worse — the SDK runs on an isolated React root that shares no context with the app, so a future move to Wagmi hooks would require re-architecting the dual-root design. This is a latent foot-gun: the integration "looks" Wagmi-ready (dependency present) but is structurally incapable of Wagmi sync.

**Recommendation.** Either (a) remove `wagmi` from `dependencies` and document that the app deliberately uses `useAccount().currentProvider` directly (the SDK supports this — "functions independently without Wagmi synchronization"), making intent explicit; or (b) if Wagmi sync is wanted, mount one React tree with `WagmiProvider > QueryClientProvider > WalletConnectProvider > App` and drop the second root. Do not leave `wagmi` installed-but-unwired.

---

### SDK-3 — Live CSP lacks the `tomo.inc` frame-src/connect-src the embedded wallet requires; enabling clientId without the hardened CSP will break it
**Severity: medium · Confidence: high**
**Location:** `packages/api/src/httpHardening.mjs:98-105`; `.env:38` (CSP commented out); live header on `127.0.0.1:8080`

**Evidence.**
- `securityHeaders()` defaults `content-security-policy` to `contentSecurityPolicy || "frame-ancestors 'self'"` (`httpHardening.mjs:104`). `contentSecurityPolicy` comes from `process.env.CONTENT_SECURITY_POLICY` (`:98`).
- In `.env`, the `CONTENT_SECURITY_POLICY=...` line is **commented out** (`.env:38`), so it is unset.
- Live header confirms: `content-security-policy: frame-ancestors 'self'` (curled from `127.0.0.1:8080`).
- The SDK docs require, for strict-CSP environments: `frame-src 'self' https://dogeos.embedded-wallet.tomo.inc; connect-src 'self' https://mydoge-wallet.tomo.inc https://social-relay.tomo.inc;` and that the embedded wallet can load `https://dogeos.embedded-wallet.tomo.inc/embed`.

**Impact.** Today this is benign *only because* the SDK is not mounted (SDK-1). The moment a clientId is set, the default CSP (`frame-ancestors 'self'` — which under CSP semantics does not by itself block sub-resources, but the hardened policy that ops is expected to flip on *does* enumerate sources) interacts badly: if the operator turns on the hardened `CONTENT_SECURITY_POLICY` but mis-copies it, or turns on clientId but forgets the CSP entirely while a future hardening adds `default-src 'self'`, the embedded wallet iframe and tomo relays are blocked and the wallet hangs in `initializing`. The two switches (clientId, CSP) are coupled but configured independently, with no enforcement that they move together.

**Note on the pre-written CSP:** the commented policy in `.env:38` is mostly correct but has a gap — its `connect-src` lists `https://mydoge-wallet.tomo.inc https://social-relay.tomo.inc` but **omits `https://dogeos.embedded-wallet.tomo.inc`**, which the iframe will `connect` back to; `frame-src` correctly allows it but `connect-src` (and `default-src 'self'`) would block XHR/websocket from the embed origin. It also adds a broad `wss:` and `img-src ... https:` which are looser than necessary.

**Recommendation.** Couple the two switches: when `DOGEOS_CLIENT_ID` is set, default the CSP to the SDK-safe policy automatically (or fail startup if clientId is set and CSP is the clickjacking-only default). Add `https://dogeos.embedded-wallet.tomo.inc` to `connect-src`. Add a deploy-time check that the served CSP includes the tomo `frame-src`/`connect-src` whenever clientId is non-empty.

---

### SDK-4 — Hand-rolled injected EIP-6963 bridge re-implements wallet discovery the SDK owns; ~680 lines of fragile, non-idiomatic fallback
**Severity: medium · Confidence: high**
**Location:** `apps/web/src/injected-wallet.js` (678 lines); `apps/web/src/sdk-browser-globals.js`; `apps/web/src/sdk-chain-switch.js`

**Evidence.**
- `injected-wallet.js` hand-implements EIP-6963 announce/request handling, a provider cache (`WeakMap`), per-brand classification (MyDoge/MetaMask/Rainbow by `rdns`/name heuristics, `:34-100`), `wallet_switchEthereumChain`/`wallet_addEthereumChain` add-then-switch retries (`:598-642`), `eth_requestAccounts` flows, and a localStorage wallet-preference memory (`:306-322`). This duplicates what `getConnectors()` + the Connect Kit modal provide.
- `sdk-browser-globals.js` shims Node globals into the browser: `globalThis.Buffer`, `globalThis.process.{browser,env,version}` (`:1-7`). This exists because the SDK's transitive Tomo/wallet deps assume a Node-ish `process`/`Buffer`. `vite.config.mjs:123-133` reinforces this with `define: { global, "process.browser", "process.env", "process.version" }` and `buffer`/`util` aliases.
- The brand-matching is heuristic and order-dependent (`providerFromEntries` prefers MetaMask, then Rainbow, then MyDoge, then any — `:162-168`), with explicit hacks against Rainbow hijacking `window.ethereum` ("Rainbow injects both", `:551-552`; "whichever extension grabbed it", `:456-457`).

**Impact.** The injected bridge is the *only* live wallet path (per SDK-1), yet it is exactly the "custom wallet picker from SDK internals / window.ethereum" pattern the docs steer away from ("Prefer the modal-first flow rather than building custom wallet pickers"). It is brittle: brand detection by `rdns`/name substrings breaks as wallets rename or change rdns; the add-then-switch dance assumes specific 4902 semantics; the `process`/`Buffer` shims are load-bearing global mutations that can collide with other libraries and silently break on SDK dependency bumps. Maintenance burden is high and the behavior diverges from the SDK's canonical discovery.

**Recommendation.** Treat the injected bridge as a thin, clearly-bounded fallback only, and make the SDK the primary path (fix SDK-1). Once the Connect Kit is live, consider deleting the brand-classification heuristics and letting the SDK modal own multi-wallet discovery. Keep `sdk-browser-globals.js` but pin/track the Tomo deps that require it; add a comment linking the shim to the specific dependency that needs `process`/`Buffer` so a future removal is safe.

---

### SDK-5 — Two disjoint React roots bridged by `window` globals + CustomEvents instead of SDK hooks
**Severity: medium · Confidence: high**
**Location:** `apps/web/src/main.jsx:17`; `apps/web/src/sdk-wallet.jsx:78-82`; `apps/web/src/sdk-wallet-provider.jsx:123-173`; `apps/web/src/ui/useWallet.js`

**Evidence.**
- The app mounts on `#root` (`main.jsx:17`); the SDK/injected bridge mounts on a *separate* root `#sdk-wallet-root` (`sdk-wallet.jsx:78-82`).
- The bridge publishes state by writing `window.dogeosAggregatorWallet` and dispatching `dogeos:sdk-wallet-updated` / `dogeos:sdk-wallet-ready` CustomEvents (`sdk-wallet-provider.jsx:141-153`); `useWallet.js` consumes those events and reads the global getters (`useWallet.js:53-148`).
- Because events are fire-and-forget and never replayed, `useWallet.js` carries an elaborate `lastBridgeState` module-cache + `bridgeSnapshot()` reconciliation (`useWallet.js:121-148, 219-231`) to survive remounts — complexity that exists purely to paper over the two-root design.

**Impact.** The SDK's React hooks (`useWalletConnect`, `useAccount`) are deliberately confined to the second root and re-exposed to the app as a `window` object + event stream. This is non-idiomatic: it forfeits React context guarantees, forces manual state-replay reconciliation, and makes Wagmi sync (SDK-2) structurally impossible without re-architecture. Event-based bridging is also racy (the code itself notes "in case the property read races the event", `useWallet.js:152-155`). It works, but it is a self-inflicted maintenance tax and the root cause of several other findings.

**Recommendation.** Collapse to a single React tree so the app consumes `useWalletConnect()`/`useAccount()` directly (optionally under `WagmiProvider` per SDK-2). If a hard isolation boundary is genuinely required, document why and keep the bridge surface minimal and explicitly versioned.

---

### SDK-6 — Chain `name` and `nativeCurrency.name` diverge from official DogeOS metadata (`Chikyu` vs `Chikyū`)
**Severity: low · Confidence: high**
**Location:** `apps/web/src/sdkConfig.js:6-7`; `apps/web/src/injected-wallet.js:5`; `apps/web/src/sdk-chain-switch.js:8`

**Evidence.**
- App declares `name: "DogeOS Chikyu Testnet"` (no macron) at `sdkConfig.js:6`, `injected-wallet.js:5` (`chainName`), and `sdk-chain-switch.js:8`.
- Official docs and SDK reference use `"DogeOS Chikyū Testnet"` (with `ū`) throughout (sdk.md:155, :162, :479, :603, :1013). chainId is correct and verified live (`eth_chainId` → `0x5fdaf3` = 6281971).

**Impact.** Cosmetic but real: `wallet_addEthereumChain` writes `"DogeOS Chikyu Testnet"` into the user's wallet, and the Connect Kit chain label will mismatch the canonical DogeOS name once the SDK is live, fragmenting how the network appears across apps. No functional break (chainId governs resolution). `nativeCurrency.name` is `"DOGE"` which matches docs (the config-package `"DogeOS DOGE"` mismatch noted in ground truth is in `packages/config`, not in this app's `sdkConfig.js`).

**Recommendation.** Use the exact official string `"DogeOS Chikyū Testnet"` in all three locations for consistency with the SDK's own chain registry and other DogeOS apps.

---

### SDK-7 — `metadata.url` and WalletConnect projectId fall back to weak defaults; mobile/WalletConnect wallets may show wrong origin
**Severity: low · Confidence: medium**
**Location:** `apps/web/src/sdkConfig.js:1, 53-71`; `.env:12-13`

**Evidence.**
- `appUrl = window.location.origin` at runtime (`sdkConfig.js:1`), so `metadata.url` becomes whatever host the page is served from (e.g. `http://127.0.0.1:8080` behind the proxy, or the proxied origin). For SSR it is the placeholder `https://dogeos.local`.
- `walletConnectProjectId` resolves to `runtimeConfig.walletConnectProjectId || import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || undefined` (`sdkConfig.js:55-56`); `.env` has both `WALLETCONNECT_PROJECT_ID=` and `VITE_WALLETCONNECT_PROJECT_ID=` empty, so it is `undefined` and the SDK uses its shared default project id.
- Docs: "production apps should use their own WalletConnect Cloud project ID and app metadata."

**Impact.** With no WalletConnect project id, mobile MyDoge/WalletConnect connections (once clientId is set) ride the SDK's shared default project — rate-limit and branding risk, and the dApp metadata shown to wallets reflects whatever origin the page loaded from rather than a stable canonical URL. Low impact today because the SDK is not mounted (SDK-1), but it gates the very mobile-MyDoge feature the `.env` comments advertise.

**Recommendation.** Set a real `WALLETCONNECT_PROJECT_ID`/`VITE_WALLETCONNECT_PROJECT_ID` and pin `metadata.url` to the canonical public domain (e.g. `https://dogeswap.ag`, already used for `CORS_ALLOW_ORIGIN` in `.env:21`) rather than deriving it from `window.location.origin`.

---

### SDK-8 — Stale docs claim Permit2 is "ABSENT"; SDK code correctly defers typed-data but the rationale is now wrong
**Severity: info · Confidence: high**
**Location:** `apps/web/src/ui/useWallet.js:31-35`; (cross-ref) `packages/contracts/audit/DEPLOYMENT.md`, `KNOWN_ISSUES.md`

**Evidence.**
- `useWallet.js:31-35` documents: "Permit2 / eth_signTypedData_v4 frontend signing is deferred. The DogeOS SDK exposes no typed-data signing API and MyDoge support is unverified, so the live swap path keeps using on-chain ERC-20 `/approval` + eth_sendTransaction."
- Ground truth (live probe 2026-06-12): Permit2 IS deployed at canonical `0x000000000022D473030F116dDEE9F6B43aC78BA3` (getCode returns bytecode). The audit docs stating Permit2 is "ABSENT" are stale.
- SDK API surface (verified in 3.2.0 types): `useAccount()` exposes `signMessage` and `signInWithWallet` but **no** `signTypedData` — so the SDK genuinely cannot do EIP-712 typed-data signing through its account API.

**Impact.** The *decision* to keep on-chain approvals is partly justified (the SDK lacks a typed-data API), but the *stated reason* ("MyDoge support unverified" + implied Permit2 absence) is outdated now that Permit2 is live. This is a documentation-accuracy issue that could cause the team to under-invest in a Permit2 single-approval UX that is now actually viable (the contracts audit even ships in-tx Permit2 permit support per the repo's recent commits). Pure info: no runtime defect.

**Recommendation.** Update the `useWallet.js` comment and the contracts audit docs to reflect that Permit2 is deployed. If a gasless/single-approval UX is desired, note that typed-data signing must go through the injected provider's `eth_signTypedData_v4` directly (the SDK won't proxy it), and verify MyDoge supports v4.

---

## Summary table

| ID | Title | Severity | Confidence |
|----|-------|----------|------------|
| SDK-1 | SDK dead code in prod (empty clientId) | high | high |
| SDK-2 | No WagmiProvider; Wagmi sync impossible | high | high |
| SDK-3 | Live CSP lacks tomo.inc frame/connect-src | medium | high |
| SDK-4 | Hand-rolled injected bridge duplicates SDK | medium | high |
| SDK-5 | Two disjoint React roots bridged via window | medium | high |
| SDK-6 | Chain name diverges from official (Chikyu) | low | high |
| SDK-7 | Weak metadata.url / no WC projectId | low | medium |
| SDK-8 | Stale Permit2-absent rationale | info | high |
