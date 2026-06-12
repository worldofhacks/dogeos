# Ecosystem Fit & "Would DogeOS Feature This" — Audit Findings

**Audit date:** 2026-06-12
**Auditor role:** Head of Ecosystem, DogeOS
**Subject:** DogeSwap (production, `main`) — non-custodial DEX aggregator for DogeOS Chikyū Testnet
**Decision being made:** Should DogeOS proudly feature/back DogeSwap, and what must change first?

---

## Overall Assessment

DogeSwap is, on the merits, the single most credible DogeOS-native dApp I have reviewed: it is genuinely a *DogeOS* product, not a generic EVM fork pointed at our RPC. It uses the official `@dogeos/dogeos-sdk` as its primary wallet layer, ships only the official faucet token set (WDOGE/USDC/USDT/WETH/LBTC/USD1) as defaults with explicit provenance, accounts for our signature DOGE-denominated data/finality fee in route scoring, deep-links activity to our Blockscout, and is admirably neutral — it routes to *competitors'* venues (MuchFi V2/V3, Barkswap Algebra) and explicitly refuses to operate first-party liquidity. That neutrality is exactly what an ecosystem wants featured.

But it is **not yet featureable** without changes, and two classes of problems would actively embarrass DogeOS if we put our logo next to it today. First, the app makes **demonstrably false claims about our chain** in user-facing copy — "instant finality via PWR Chain" (a different blockchain entirely), "settles to Dogecoin · instant finality," "10,000+ TPS," and "withdrawals: instant" — all of which contradict our own docs (~300 TPS, ~3s blocks, finality only after a proof + withdrawal-fulfillment on Dogecoin that takes up to 4 hours). Second, the live deployment's **trust posture is weaker than its own documentation claims**: the fund-touching `DogeSwapRouter` is owned and guarded by a single EOA (`owner == guardian == 0xE659…`, owner has no code so it is not the timelock), the documented TimelockController handover was scheduled but never accepted (`pendingOwner == 0xf3410B…`), the router is **unverified on Blockscout**, and the audit docs still say Permit2 is "ABSENT" when it is in fact live.

My recommendation: **conditional go.** This deserves grant/co-marketing attention because the architecture and discipline are real. But before any featuring, default-swap placement, or "audited" framing: fix the false chain claims (1 day), complete the timelock handover OR stop describing it as done, verify the router on Blockscout, and refresh the stale audit docs. These are days of work, not months — which is itself a strong signal.

---

## Strengths (genuinely well done — these matter for the ecosystem case)

1. **It is a real DogeOS-native product, not a reskinned generic aggregator.** The whole liquidity-discovery and adapter-certification discipline (`docs/dogeos-testnet-liquidity-discovery.md`) is built around *what is actually deployed on DogeOS* — MuchFi and Barkswap — with confidence levels, selector/relationship evidence, and runtime simulation before signing. This is the opposite of "fork 1inch, change the chain ID."

2. **Official DogeOS SDK is the primary wallet layer.** `apps/web/src/sdk-wallet-provider.jsx` wires `@dogeos/dogeos-sdk` (`WalletConnectProvider`, `getChains`, `getConnectors`, `useWalletConnect`) as the single Connect Kit chooser for all wallets including mobile MyDoge via WalletConnect, with an injected fallback only when no `clientId` is provisioned. This is exactly the integration DogeOS wants to showcase.

3. **Official faucet token set used as the curated default, with provenance.** `packages/config/src/tokens.mjs` ships exactly WDOGE/LBTC/WETH/USD1/USDC/USDT, each tagged `provenance: "dogeos-faucet-rpc-validated"`, and the API serves only this list as defaults (`packages/api/src/handler.mjs:450`). The token policy (curated defaults, unverified-token warnings) is documented and disciplined.

4. **Neutral, ecosystem-positive routing.** `docs/dex-aggregator-business-model.md:13-21` explicitly bans first-party venues, AMM forks, platform LP, and routing bias. It routes users to *competitors'* DEXes scored purely on net executable output. For an ecosystem, a credible neutral aggregator that lifts every DEX is more valuable than another walled-garden DEX.

5. **DogeOS-specific fee model is respected.** The aggregator computes the DOGE-denominated data/finality fee via the Scroll-derived `L1GasPriceOracle` and folds it into net-route scoring (`packages/aggregator/src/fees/`, surfaced in `apps/web/src/lib/quote.js:97-112`). Most generic aggregators would score on `gas * gasPrice` only and misrank routes on our chain. This is a real differentiator handled correctly.

6. **Blockscout is the canonical explorer everywhere it matters.** Activity rows deep-link to `…/tx/{hash}` and `…/address/{addr}` (`apps/web/src/ui/ActivityView.jsx:61-66`), the SDK chain config names "DogeOS Blockscout" (`apps/web/src/sdkConfig.js:9-14`), and the verification subsystem queries the Blockscout REST API for contract/ABI provenance.

7. **Honesty discipline in the trade UI.** The swap panel deliberately shows "price impact —" and "router fee 0.00%" rather than fabricating numbers (`apps/web/src/ui/SwapView.jsx:929-946`), and refuses to invent USD sublabels without a price feed. This restraint is rare and trust-building.

---

## Findings

### ECOSYSTEM-1 — User-facing copy makes false claims about DogeOS, including referencing a different blockchain ("PWR Chain")
- **Severity:** high
- **Confidence:** high
- **Location:** `apps/web/src/ui/SettingsView.jsx:245`, `:260-263`, `:32-39`; `apps/web/src/ui/SwapView.jsx:966`; `apps/web/src/ui/ActivityView.jsx:405`
- **Evidence:**
  - `SettingsView.jsx:245` — `<Row label="throughput" hint="instant finality via PWR Chain">`. **PWR Chain is an unrelated third-party blockchain project**; DogeOS has nothing to do with it. This is a copy-paste leak from another template and is the kind of error that, screenshotted, makes the chain look unserious.
  - `SettingsView.jsx:32-38` — `NETWORK = { … tps: "10,000+" … }`, rendered as `{NETWORK.tps} TPS`. Official docs (live-fetched 2026-06-12, https://docs.dogeos.com/en/developers) state **"~300 transactions per second."** "10,000+" overstates real throughput by ~33×.
  - `SwapView.jsx:966` — `settles to Dogecoin · instant finality`. Per `networks.md` and docs, finality is reached **only after a proof and a withdrawal-fulfillment transaction completes on Dogecoin** — explicitly not instant; the docs do not even use the word "finality" loosely. Max reorg depth is documented at 17 blocks.
  - `SettingsView.jsx:260-263` — `deposits / withdrawals … "free · instant"`. The official bridge docs say withdrawals **"can take up to 4 hours."** Calling that "instant" is materially misleading.
- **Impact:** If DogeOS features this app, every one of these claims becomes, by association, an *official-looking* statement about our chain. "Instant finality" and "10,000+ TPS" are exactly the over-promises that invite ridicule and erode developer trust; the "PWR Chain" reference looks like the team doesn't know what chain they built on. This is the single biggest reputational blocker to featuring.
- **Recommendation:** Replace all four with doc-accurate copy before any featuring: throughput "~300 TPS"; remove "PWR Chain" entirely; finality "settles to Dogecoin after ZK proof + L1 verification" (and drop "instant"); withdrawals "bridge withdrawals can take up to ~4h." Add a lightweight test asserting these strings match `networks.md` values so they cannot regress.

### ECOSYSTEM-2 — Fund-touching router is governed by a single EOA (owner == guardian); documented Timelock+Safe handover never completed
- **Severity:** high
- **Confidence:** high
- **Location:** live `DogeSwapRouter` `0xa3158549f38400F355aDf20C92DA1769620Aa35A`; `packages/contracts/audit/DEPLOYMENT.md:158-205`; `packages/contracts/audit/KNOWN_ISSUES.md:72-80`
- **Evidence (live reads, 2026-06-12, RPC `https://rpc.testnet.dogeos.com`):**
  - `owner()` → `0xE659A8d3745b1355CA47B3d92925997Ef93a2873`
  - `guardian()` → `0xE659A8d3745b1355CA47B3d92925997Ef93a2873` (**owner == guardian — the same key**)
  - `cast code 0xE659…` → `0x` (**owner is an EOA, not the TimelockController**)
  - `pendingOwner()` → `0xf3410B762Db55aA3CBAfaa5707899b3d3A7F1773` — i.e. the timelock from `DEPLOYMENT.md:152` is the *pending* owner; `acceptOwnership()` (the §6a handover) was never executed.
  - `DEPLOYMENT.md` and `KNOWN_ISSUES.md §7` describe the intended end-state as Timelock (24–48h delay) + founder Safe, with guardian a separate pause-only hot key. The live state collapses all of that into one EOA.
- **Impact:** The router moves user funds (it is the execution path for routed and split swaps). With one EOA as both owner and guardian, that key can pause, set fees, set caps, and call `rescue()` with no timelock and no multisig. If DogeOS features this as "audited / production-hardened," we are vouching for a governance posture that does not match the audit package's own claims. A single compromised key is a one-step incident.
- **Recommendation:** Either (a) complete the documented handover — `timelock.acceptOwnership()` via the Safe and split the guardian to a distinct pause-only key — before any "production" or "featured" framing; or (b) if this is intentionally a testnet single-operator setup, say so plainly in the UI and docs and drop the Timelock/Safe language. Do not feature with audit docs that describe governance the chain state contradicts.

### ECOSYSTEM-3 — DogeSwapRouter is unverified on Blockscout
- **Severity:** high
- **Confidence:** high
- **Location:** live router `0xa3158549f38400F355aDf20C92DA1769620Aa35A`; Blockscout REST
- **Evidence:** `GET https://blockscout.testnet.dogeos.com/api/v2/addresses/0xa315…` returns `{is_contract: true, is_verified: false, name: null}`. The deploy runbook intends `--verify --verifier blockscout` (`DEPLOYMENT.md:138-144`), but the live contract has no verified source. Ironically, DogeSwap's *own* discovery docs repeatedly demand that the venues it integrates (MuchFi, Barkswap) verify their contracts on Blockscout for "integration confidence" — yet its own first-party router is unverified.
- **Impact:** A featured app whose core fund-moving contract is unverified is a transparency failure DogeOS would have to defend. Users (and we) cannot read the bytecode's source, confirm the audited code is what's deployed, or inspect the public read functions. This undercuts the entire "verification discipline" pitch.
- **Recommendation:** Verify the router (and registry) on Blockscout, surface a "verified ✓ on Blockscout" link in the UI's Advanced/provenance card, and link it from the README. This is a prerequisite for any "audited" or "transparent" claim.

### ECOSYSTEM-4 — Audit/deploy docs are stale: claim Permit2 "ABSENT" when it is live
- **Severity:** medium
- **Confidence:** high
- **Location:** `packages/contracts/audit/KNOWN_ISSUES.md:56-62`; `packages/contracts/audit/DEPLOYMENT.md:23-44`
- **Evidence:** `KNOWN_ISSUES.md §5`: "canonical Permit2 … is **absent** on DogeOS testnet (`eth_getCode` → `0x`)." `DEPLOYMENT.md` CRITICAL section: "Permit2 is **ABSENT** on DogeOS testnet and **must** be deployed." Live read 2026-06-12: `cast code 0x000000000022D473030F116dDEE9F6B43aC78BA3` returns bytecode (`0x60406080…`) — **Permit2 is deployed at the canonical address.** The single-approval split-swap permit flow (commits `504d56c`, `80ca6e6`) depends on this and works precisely because Permit2 is present.
- **Impact:** A grants/partnership reviewer reading the audit package would conclude a critical dependency is missing and the stack is "broken" per the doc's own wording. Stale "critical-path" docs make the whole audit package look unmaintained and erode confidence in the rest of its claims (which are otherwise rigorous).
- **Recommendation:** Update `KNOWN_ISSUES.md §5` and the `DEPLOYMENT.md` CRITICAL section to record Permit2 as live (with the live `getCode` evidence and date). Re-audit the doc set for other staleness before submitting for any grant review.

### ECOSYSTEM-5 — Config advertises a WebSocket RPC that does not exist; chain name/native-currency name diverge from official docs
- **Severity:** medium
- **Confidence:** high
- **Location:** `packages/config/src/chains.mjs:3-11`
- **Evidence:**
  - `wsRpcUrls: ["wss://ws.rpc.testnet.dogeos.com"]` — an HTTPS GET to that host returns 404 and **no WebSocket endpoint appears anywhere in the official DogeOS docs** (`networks.md`: "No WebSocket RPC URL is documented on any page"). The canonical config asserts an endpoint the chain does not document.
  - `name: "DogeOS Chikyu Testnet"` (no macron) and `nativeCurrency.name: "DogeOS DOGE"` vs official "DogeOS Chikyū Testnet" and native currency name "DOGE" (`networks.md`, https://docs.dogeos.com/en/sdk). The SDK config in `apps/web/src/sdkConfig.js:7` uses the cleaner `{ name: "DOGE" }` but still `"DogeOS Chikyu Testnet"`.
- **Impact:** The phantom WS URL is a latent rough edge — if any future feature (live block/price streaming) wires it up, it fails silently against a featured app. The naming divergence is cosmetic but, for an app DogeOS would *feature as canonical*, it should match the brand exactly (macron, "DOGE"). It also signals the config was authored from secondhand notes rather than the live docs.
- **Recommendation:** Remove `wsRpcUrls` (or mark it explicitly "unconfirmed / not documented") until DogeOS publishes a WS endpoint. Align `name` to "DogeOS Chikyū Testnet" and `nativeCurrency.name` to "DOGE" to match official docs.

### ECOSYSTEM-6 — The DogeOS data/finality fee differentiator is computed but hidden from users
- **Severity:** low
- **Confidence:** high
- **Location:** `apps/web/src/ui/SwapView.jsx:947-961`; `apps/web/src/lib/quote.js:97-112`
- **Evidence:** The backend correctly computes `feeEstimate.totalFeeWei = gasUnits*gasPrice + dataFinalityFee`, but the UI collapses it into one row labeled "network fee" (`SwapView.jsx:948`) shown as "{gas} gas · ~{fee} Ð". The DogeOS-specific component — the Data and Finality fee that covers posting calldata to Ethereum DA + updating the Dogecoin bridge — is never named or broken out. Grep of the UI finds no "data fee," "finality fee," or "L1 fee" line shown to users.
- **Impact:** This is a *missed showcase*, not a bug. DogeOS's fee model (execution fee + data/finality fee, DOGE-denominated) is a genuine architectural differentiator vs generic L2s. An aggregator that *names and breaks it out* would teach users what makes DogeOS different and demonstrate the chain's transparency. Folding it into a generic "network fee" makes DogeOS look like any other EVM L2.
- **Recommendation:** Add an expandable fee breakdown: "execution fee" + "data & finality fee (DogeOS)" with a one-line tooltip ("posted to Ethereum DA + Dogecoin bridge"). This is a cheap, high-leverage way to make the chain's economics legible and is exactly the kind of native-feature surfacing that justifies featuring.

### ECOSYSTEM-7 — Mainnet-readiness and adoption-lever gaps (testnet-only, no public repo/license, token rows not explorer-linked)
- **Severity:** info
- **Confidence:** high
- **Location:** `README.md:75`; repo root (no `LICENSE`); `package.json:3` (`"private": true`); `apps/web/src/ui/TokensView.jsx`
- **Evidence:**
  - README closes with "**Testnet only.** Not externally audited — do not put real funds behind it." DogeOS itself has no mainnet (`networks.md`: "Mainnet is not yet launched"), so testnet-only is expected — but featuring framing must say "testnet preview," not imply production.
  - No `LICENSE` file at repo root; `package.json` is `private: true` with no `repository` field. "Open source" cannot be claimed today — there is no public license grant. The README's run instructions reference a generic `<this-repo-url>`.
  - `TokensView.jsx` shows token addresses (`compactAddress`) but does **not** deep-link them to Blockscout `/token/{addr}` or `/address/{addr}` — only the Activity view links out. Token-level explorer links are a low-cost ecosystem-fit win.
- **Impact:** These are not blockers but they shape *how* DogeOS can feature it and *which* growth levers are available. Without a license/public repo, DogeOS can't point developers at it as a reference integration or fund it as open-source infra. Without token-row explorer links, the Tokens tab under-uses our explorer.
- **Recommendation:** For adoption: (a) add an OSI license and a public repo if DogeOS wants to feature it as a reference DogeOS-SDK integration / grant it as open infra; (b) deep-link token rows to Blockscout; (c) frame any featuring as "testnet preview." Levers DogeOS can pull once ECOSYSTEM-1..4 are fixed: default-swap placement in the testnet portal "featured dApps" slot, a co-marketing post pairing the neutral-aggregator story with MuchFi/Barkswap, and a grant tied to verifying contracts + mainnet hardening.

---

## Go / No-Go Verdict

**Conditional GO — feature after a short, well-scoped hardening pass.** The product's bones are exactly what DogeOS should want representing the chain: native SDK, official tokens, neutral routing that lifts competing DEXes, correct DOGE-fee accounting, Blockscout-first, and disciplined honesty in the trade UI.

**Must change before featuring (blockers):**
1. Fix the false chain claims — remove "PWR Chain," correct TPS to ~300, drop "instant finality" / "instant withdrawals" (ECOSYSTEM-1).
2. Complete the Timelock+Safe handover and split the guardian key, OR stop describing governance as hardened (ECOSYSTEM-2).
3. Verify the router/registry on Blockscout (ECOSYSTEM-3).
4. Refresh the stale audit docs (Permit2 is live, not absent) (ECOSYSTEM-4).

**Should change for a stronger showcase:** drop/qualify the phantom WS endpoint and fix the chain-name macron (ECOSYSTEM-5); break out the DogeOS data/finality fee in the UI (ECOSYSTEM-6); add a license + public repo + token-row explorer links and "testnet preview" framing (ECOSYSTEM-7).

None of these is a multi-month effort. The fact that the blockers are copy fixes, one governance transaction, a verification command, and a doc refresh — against an otherwise genuinely DogeOS-native, well-architected app — is itself the strongest argument that DogeSwap is worth backing.
