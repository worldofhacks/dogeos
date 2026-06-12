# DogeOS Experience Audit — Dimension: User Flows & Frontend UX

Date: 2026-06-12
Auditor: Head of Ecosystem, DogeOS
Scope: End-to-end user journey of DogeSwap (apps/web) — land → connect → wrong-network → get tokens → select tokens → quote → approve → swap → result — judged against the ethskills `frontend-ux` mandatory patterns and DogeOS user expectations. Source read from `apps/web/src` and the shipped `apps/web/dist` bundle; cross-checked against the live prod server on `127.0.0.1:8080` and live chain reads.

---

## Overall Assessment

This is, frankly, one of the most polished and *honest* dApp frontends I have reviewed in the DogeOS ecosystem. The four-state CTA flow (connect → switch network → enter amount / insufficient balance → review swap) is implemented correctly in the **same button slot** — the exact pattern the ethskills qa skill calls ship-blocking and that most AI-built dApps get wrong. The team went out of its way to be honest about what the testnet cannot support (no USD price feed, no price-impact mid-price) rather than faking numbers, and they label those omissions explicitly. Wrong-network is surfaced in two places (the header chip turns red, the CTA becomes "switch to DogeOS network"), receipt polling is real, error mapping is thorough and friendly (faucet links on insufficient-DOGE), the success/error states are distinct, pending is non-dismissible with an escape hatch, and the branding (custom favicon, doge mascot, "much swap. very done.") is DogeOS-native and delightful.

The problems are concentrated in three areas. First and most serious for an ecosystem feature decision: **production ships with no DogeOS SDK clientId** (`runtime-config.js` returns `dogeosClientId:""` live), so the DogeOS Connect Kit modal never mounts and the app silently runs the injected-only fallback — meaning **mobile MyDoge via WalletConnect, and the email/social embedded wallet logins the SDK config advertises, do not work in prod.** For a DogeOS-native swap, MyDoge-on-mobile is table stakes. Second, the **success screen never links the confirmed transaction to Blockscout** — `exec.hash` is captured but never rendered as a `/tx/` link, breaking the "see your result on the explorer" expectation and the ethskills trust-signal rule. Third, there are **no copy-to-clipboard / explorer affordances on the connected address**, and the success "received" value is an estimate not the actual on-chain delta.

Net: the *desktop, browser-extension* experience is excellent and trustworthy. The *mobile and embedded-wallet* experience — the one most Dogecoin community users will arrive with — is degraded by a missing prod config, and the post-swap moment under-delivers on explorer/receipt trust signals. These are fixable without redesign. I would back this for featuring **conditional on** provisioning the clientId for prod and adding the success-screen explorer link.

---

## Strengths (genuinely well done)

- **Correct four-state CTA in a single slot.** `SwapView.jsx:602-656` branches the *same* primary button through: not-connected → "connect wallet" (`onConnect`), wrong-chain → "switch to DogeOS network" (`onSwitchChain`), over-balance → "insufficient balance" (disabled), zero-amount → "enter an amount" (disabled), quote-failed → "quotes unavailable" (disabled), ready → "review swap". The wrong-network check precedes the amount/approval checks (`wrongChain` computed at `SwapView.jsx:260`). This is exactly the pattern the qa skill marks ship-blocking, and the header *also* surfaces wrong-network (the connect chip turns red, `Shell.jsx:142-172`) — belt and suspenders. Most teams fail this; DogeSwap nails it.
- **Connect is a button, never passive text.** Both the header chip (`Shell.jsx:144-193`) and the Tokens empty-balance prompt (`TokensView.jsx:264-282`) render a real clickable Connect button. No `<p>please connect your wallet</p>` anti-pattern anywhere.
- **Honest about missing data instead of faking it.** No fabricated USD totals, no fake price-impact, no fake sparklines. The code comments and the UI both say so (`SwapView.jsx:16, 442, 929`; `TokensView.jsx:8-11`). Price-impact renders "—" with a comment that the backend computes no mid-price. This is the right call for trust on a feed-less testnet.
- **Real, friendly contract-error translation.** `execute.js:93-132` maps router reverts (INSUFFICIENT_OUTPUT_AMOUNT, EXPIRED, paused, permit/allowance, balance), wallet rejection, and native-DOGE funding shortfalls to human copy — with a faucet URL on the funding case, and a clickable faucet link rendered on faucet errors in the modal (`SwapFlow.jsx:488-504`). No raw selectors leak.
- **Pending state is non-dismissible with a cancel escape hatch.** `SwapFlow.jsx:331` (`dismissible = !exec.isPending`) plus the explicit cancel button (`SwapFlow.jsx:624-640`) and the 120s wallet-response timeout (`execute.js:191-229`) mean a stuck/unanswered wallet never spins forever — a real bug class the team pre-empted.
- **Quote freshness + expiry guard.** Debounced (250ms), polled (10s), sequence-guarded, abortable quote loop (`useQuote.js`), plus a per-quote TTL countdown on the review screen that flips "confirm swap · Ns" to a gold "↻ quote expired · refresh" (`SwapFlow.jsx:280-314, 644-693`). Users never sign a stale quote unknowingly.
- **Real verification badges + provenance.** Tokens show ✓/⚠ from `/tokens` `provenance` (live: all six carry `dogeos-faucet-rpc-validated`, `TokensView.jsx:173-181`), and Settings → advanced surfaces real `/verification` + `/intelligence` venue classification (`SettingsView.jsx:294-334`).
- **Single-approval Permit2 path is real and live.** `execute.js:336-453` signs an EIP-712 PermitSingle (gasless) for split routes with a graceful on-chain `Permit2.approve` fallback for wallets lacking `eth_signTypedData_v4`. Permit2 is confirmed deployed on DogeOS at the canonical address, so this path is exercisable.
- **DogeOS-native branding and copy.** Custom gold-Ð favicon (`favicon.svg`, present in dist), doge mascot on success/empty states (`doge-mascot.png`, 127KB, shipped in dist), tab title "DogeSwap — swap aggregator on DogeOS", "much swap. very done." / "such empty." microcopy, testnet pill, "settles to Dogecoin · instant finality". This feels like it belongs on DogeOS.
- **Accessibility/motion hygiene.** Transform-only entrance animations that never leave content invisible if a frame stalls, full `prefers-reduced-motion` support (`global.css:87-104`), `inputMode="decimal"` on the amount field, safe-area insets for mobile notches, haptic feedback.
- **Mobile-responsive by construction.** Distinct mobile shell (sticky frosted header, fixed bottom tab bar, bottom-sheet modals with drag-to-dismiss) vs desktop device frame, gated by `useIsMobile` (`Shell.jsx:233-406`, `SwapFlow.jsx:29-128`).

---

## Findings

### UX-1 — Production ships with no DogeOS SDK clientId: Connect Kit modal, mobile MyDoge (WalletConnect), and embedded email/social logins are all silently disabled
- **Severity:** high
- **Confidence:** high
- **Location:** Live `GET /runtime-config.js` (served by `packages/web/src/server.mjs:46-61`); `.env` `DOGEOS_CLIENT_ID`; gating in `sdk-wallet.jsx:66-76`; `useWallet.js` injected branch `205-269`.
- **Evidence:** Live probe of the prod server returns `window.DOGEOS_AGGREGATOR_CONFIG = Object.freeze({"dogeosClientId":"","walletConnectProjectId":""});`. The prod `.env` has `DOGEOS_CLIENT_ID=` (empty) and `WALLETCONNECT_PROJECT_ID=` (empty). In `sdk-wallet.jsx:66-69`, `if (!dogeConfig.clientId) { noticeInjectedFallbackOnce(); return <InjectedWalletBridge />; }` — so with no clientId the `DogeOSSdkWalletProvider` (the Connect Kit) never mounts, and `connect()` drives only the EIP-6963 injected bridge defaulting to MyDoge (`useWallet.js:45, 250-266`). The SDK config *advertises* `login.basicLogins: ["email","externalWallets"]`, `socialLogins: [{google},{x}]`, and WalletConnect (`sdkConfig.js:72-75`), and the code comments repeatedly state mobile MyDoge requires the clientId (`useWallet.js:16-17`). None of that is reachable in prod.
- **Impact:** A DogeOS user on a phone — the dominant Dogecoin-community device — cannot connect mobile MyDoge via WalletConnect, and cannot use email/social embedded wallets. They are silently funneled to a desktop browser extension or nothing. The fallback is functional on desktop but the *advertised* connect surface is absent, and the only signal is a `console.info`. For a chain that ships a first-party SDK precisely to make MyDoge/WalletConnect/embedded onboarding easy, shipping it disabled is the single biggest gap between "good desktop dApp" and "best DogeOS experience."
- **Recommendation:** Provision `DOGEOS_CLIENT_ID` (and ideally `WALLETCONNECT_PROJECT_ID`) in the prod environment and restart (runtime-injected, no rebuild needed per `.env` notes). Verify `runtime-config.js` then serves a non-empty clientId and the Connect Kit modal mounts. As a stopgop until provisioned, surface a visible (not console-only) banner that mobile/embedded wallets need configuration, so the degraded mode is at least honest to the user.

### UX-2 — Success screen never links the confirmed transaction to Blockscout
- **Severity:** high
- **Confidence:** high
- **Location:** `SwapFlow.jsx:380-446` (success stage) and `696-700` (success CTA); hash captured at `useSwapExecution.js:90-97` / `SwapFlow.jsx:303` but unused in render.
- **Evidence:** The success stage renders the mascot, "much swap. very done.", and "received ~X SYM (est.)", then a single "done" button (`SwapFlow.jsx:696-700`). It never renders `exec.hash`. Grep of the shipped bundle confirms `blockscout.testnet.dogeos.com` appears only in the Activity view, not adjacent to the success copy ("much swap. very done." is present; no `/tx/` link near it). `api.js:9` defines `DOGEOS_BLOCKSCOUT_URL` and `ActivityView.jsx:61-63` has a ready `txUrl(hash)` helper — the building block exists but is not wired into the success modal.
- **Impact:** The post-swap moment is the highest-trust touchpoint, and DogeOS's own getting-started guide steers users to verify activity on Blockscout (`https://blockscout.testnet.dogeos.com`). After a swap, the user has no one-click way to see their transaction on-chain; they must leave, go to Activity, find the row, and click out (and only the *latest* local row is reliably theirs). This violates the ethskills trust-signal expectation that results link to the explorer, and it makes a successful swap feel less verifiable than it actually is.
- **Recommendation:** On the success stage, render the tx hash truncated with a "view on Blockscout ↗" link to `${DOGEOS_BLOCKSCOUT_URL}/tx/${exec.hash}` (and optionally the approval hash). The toast on `onComplete` (`SwapView.jsx:1016-1024`) could likewise carry the link. Trivial change, large trust payoff.

### UX-3 — No copy-to-clipboard or explorer link on the connected wallet address
- **Severity:** medium
- **Confidence:** high
- **Location:** `Shell.jsx:144-172` (connect chip); `primitives.jsx:27-31` (`truncateAddress`).
- **Evidence:** The connected chip shows a gold dot + truncated address and its only action is `onClick={() => wallet.disconnect()}` (`Shell.jsx:146`). Grep for `clipboard`/`navigator.clipboard`/`copy` across `src/ui/` finds no clipboard usage anywhere. There is no avatar/blockie, no copy button, no "view address on Blockscout" affordance for the connected account (the Activity footer links the address, `ActivityView.jsx:406-413`, but the header chip does not).
- **Impact:** ethskills Rule 3 requires displayed addresses to support copy-to-clipboard and explorer linking. A user who wants to copy their address (to fund from the faucet, to share, to verify) cannot do it from the header; clicking the address *disconnects* them — a surprising and destructive default for the most prominent address in the UI. This is a common, low-effort trust/utility miss.
- **Recommendation:** Split the chip into address (copy-to-clipboard on click, with a transient "copied" tick) + a small caret/menu for disconnect and "view on Blockscout". Keep disconnect explicit rather than the default click action. A blockie/identicon would add visual identity per the same rule.

### UX-4 — No "get tokens" / faucet entry point in the primary flow; faucet is buried in Settings and only appears reactively on a failed swap
- **Severity:** medium
- **Confidence:** high
- **Location:** Faucet linked at `SettingsView.jsx:275-284` and reactively at `SwapFlow.jsx:488-504`; nothing in `SwapView.jsx` / `TokensView.jsx` / `Shell.jsx`.
- **Evidence:** `grep faucet` across the UI shows the faucet URL surfaced only in (a) Settings → network card and (b) the swap error modal when the error already matches `/faucet/i`. A connected user with zero DOGE sees "insufficient balance" on the CTA (`SwapView.jsx:648`) with no link to get tokens; they only discover the faucet *after* attempting a swap and hitting the insufficient-DOGE error, or by hunting through Settings. There is no proactive "you have no balance — get testnet DOGE" prompt, and no bridge guidance at all (DogeOS docs document a bridge at `portal.testnet.dogeos.com/bridge`).
- **Impact:** First-run is the make-or-break moment for ecosystem adoption. A new user lands, connects, has no tokens, and the UI dead-ends at "insufficient balance" / empty Tokens balances with no obvious next step. DogeOS's getting-started flow is explicitly faucet-first; the dApp should mirror that. Burying it in Settings under-serves exactly the user DogeOS most wants to convert.
- **Recommendation:** When connected with zero balance of the pay token (or zero DOGE for gas), show an inline "Get testnet DOGE →" link to `https://faucet.testnet.dogeos.com` near the CTA and in the Tokens empty-balance state. Consider a one-line "Need DOGE? Use the faucet · Bridging? See the bridge" helper in the header or first-visit hint.

### UX-5 — Success "received" is the pre-trade estimate, not the actual on-chain output
- **Severity:** low
- **Confidence:** high
- **Location:** `SwapFlow.jsx:442-444`; value flows `outNum` → `confirm()` `recv: outNum` (`SwapFlow.jsx:316-328`) → `useSwapExecution.run` `recv` → `state.recv`; receipt is fetched but not decoded for output (`execute.js:264-289, 468`).
- **Evidence:** The success line reads `received ~{fmt(exec.recv,...)} {symbol} (est.)` and the code comment admits "exec.recv is the pre-trade estimate — the fill can differ within slippage". `executeSwap` returns a `receipt` but never parses Transfer/output logs to compute the realized amount; the success number is the quote estimate.
- **Impact:** The team is honest (the "(est.)" qualifier is present), so this is low severity — but on a successful swap the user is shown an estimate, not what actually landed. With high slippage the real fill can be materially lower, and the displayed "received" can overstate it. The DogeSwapRouter is described as measuring the output delta and enforcing min-out, so the realized amount is on-chain and decodable.
- **Recommendation:** Decode the realized output from the swap receipt (router emits the settled amount, or read the buy-token balance delta) and show the actual received amount on success, dropping "(est.)". Falls back gracefully to the estimate if decoding fails.

### UX-6 — Chain naming and metadata diverge from official DogeOS docs (wallet add-chain shows "DogeOS Chikyu Testnet")
- **Severity:** low
- **Confidence:** high
- **Location:** `sdkConfig.js:6` (`name: "DogeOS Chikyu Testnet"`), `injected-wallet.js:5` (`chainName: "DogeOS Chikyu Testnet"`).
- **Evidence:** Both the SDK chain config and the `wallet_addEthereumChain` params name the chain "DogeOS Chikyu Testnet" (no ū). Official DogeOS docs and the in-repo getting-started reference use "DogeOS Chikyū Testnet". When the injected wallet prompts the user to *add* the network, MetaMask will persist "DogeOS Chikyu Testnet" — visibly inconsistent with the chain name DogeOS uses everywhere else (and with the app's own footer, `Shell.jsx:555`, which correctly uses "Chikyū"). RPC/chainId/explorer/symbol/decimals in the add-chain params are otherwise correct (chainId 6281971, rpc `rpc.testnet.dogeos.com`, explorer `blockscout.testnet.dogeos.com`, DOGE 18) and match live ground truth.
- **Impact:** Cosmetic but trust-relevant: a DogeOS-native app that writes a slightly-wrong chain name into the user's wallet looks careless, and the mismatch between the add-chain name and the official portal's name can make a cautious user second-guess whether they added the *right* network.
- **Recommendation:** Use "DogeOS Chikyū Testnet" consistently in `sdkConfig.js` and `injected-wallet.js` to match the official portal and docs.

### UX-7 — No pre-publish social/Open Graph metadata; no description meta
- **Severity:** low
- **Confidence:** high
- **Location:** `apps/web/src/index.html` and `apps/web/dist/index.html` `<head>` (lines 3-13).
- **Evidence:** The served head contains only `charset`, `viewport`, `title`, favicon, and font preconnects. Grep for `og:`/`twitter:`/`description`/`theme-color`/`apple-touch` in the dist HTML returns nothing. There is no Open Graph image/title/description and no meta description.
- **Impact:** ethskills Rule 8 (pre-publish metadata) requires OG/Twitter title+description and an absolute, reachable OG image before production release. Without them, every share of the DogeSwap URL (Discord, X — exactly where DogeOS community lives) unfurls as a bare link with no preview card, undercutting discoverability for a flagship ecosystem dApp. The good news: a brandable mascot (`/doge-mascot.png`) and favicon already exist to source an OG image from.
- **Recommendation:** Add `og:title`, `og:description`, `og:image` (absolute `https://` URL on the live domain), `og:url`, `twitter:card=summary_large_image`, `twitter:title/description/image`, a `<meta name="description">`, and `theme-color`. Generate a 1200×630 OG card from the doge mascot + gold brand mark.

### UX-8 — Theme is user-selectable light/dark but ignores system `prefers-color-scheme` on first load (defaults to light)
- **Severity:** low
- **Confidence:** medium
- **Location:** `Shell.jsx:92-94` (theme from persisted settings); `useSettings.js` default; `theme.js:13-48`.
- **Evidence:** The Shell builds the theme from `settings.dark`/`settings.accent` and the whole page background is driven by theme tokens (`Shell.jsx:237-243, 502-513`) — so this is *not* the ethskills "hardcoded dark wrapper" anti-pattern (Rule 6 is satisfied: backgrounds are semantic, theme is coherent, and a real light/dark toggle exists in Settings). However, the persisted default does not seed from `window.matchMedia('(prefers-color-scheme: dark)')`, so a system-dark user gets a light page until they manually toggle.
- **Impact:** Minor first-impression friction for dark-mode-preferring users (a large share of crypto users). Not a correctness bug — the toggle works and the theme system is otherwise exemplary.
- **Recommendation:** On first load (no persisted preference), seed `settings.dark` from `prefers-color-scheme`. Keep the explicit toggle as the override.

### UX-9 — Single shared execution status for the approve→swap sequence (acceptable here, but note the difference from the two-button approval pattern)
- **Severity:** info
- **Confidence:** high
- **Location:** `useSwapExecution.js:24-119`; `SwapFlow.jsx:331-366`.
- **Evidence:** The flow uses one `exec.status` machine (idle → approving → swapping → success/error) inside a *modal*, with `isPending` driving non-dismissibility and the cancel button. Because approval and swap are sequential steps inside one user-confirmed flow (not two independent re-en-able buttons), the ethskills "two-state approval lock (`approvalSubmitting` + `approveCooldown`) to prevent double-submit" concern is structurally avoided: the confirm button is replaced by the pending spinner, `runningRef` guards re-entry (`useSwapExecution.js:46-47`), and the user cannot click "approve" twice. Receipt is awaited before advancing (`execute.js:436, 468`), so there is no confirm→cache gap exposed as a clickable button.
- **Impact:** None — this is a correct design for a modal aggregator flow; I note it only so reviewers don't flag the absence of `approveCooldown` as a defect. It is not applicable to this architecture.
- **Recommendation:** No change. (If the flow is ever refactored to in-page buttons instead of a modal, re-introduce the two-state approval lock.)

---

## Summary Scorecard (ethskills frontend-ux / qa mapping)

| Rule / Check | Status |
|---|---|
| Connect shows a button, not text | PASS |
| Wrong-network in primary CTA slot (not only header) | PASS (both) |
| One button at a time (connect→network→approve→action) | PASS |
| Approval flow locked (no double-submit) | PASS (modal/ref-guarded) |
| Human-readable amounts/decimals (no raw base units) | PASS |
| Contract error translation (no raw selectors) | PASS |
| Loading / empty / error states | PASS |
| Mobile responsive | PASS |
| Theme semantics (no hardcoded dark wrapper) | PASS |
| Favicon + tab title (no template defaults) | PASS |
| RPC polling in responsive range | PASS (10s poll, 250ms debounce, abort/seq-guarded) |
| Address copy-to-clipboard + explorer link | FAIL (UX-3) |
| Result links to block explorer | FAIL (UX-2) |
| Pre-publish OG/social metadata | FAIL (UX-7) |
| DogeOS-native onboarding (wallet/faucet) | PARTIAL — desktop injected works; mobile/embedded disabled in prod (UX-1); faucet buried (UX-4) |
| USD context for amounts | N/A (no testnet price feed; honestly omitted) |
