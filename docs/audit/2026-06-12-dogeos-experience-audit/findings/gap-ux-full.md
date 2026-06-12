# Gap audit — full frontend UX (DogeSwap on DogeOS Chikyū)

Date: 2026-06-12. Reviewer: senior DogeOS engineer / ecosystem reviewer.
Scope: every file under `apps/web/src/ui` + `apps/web/src/lib`, audited against
`ethskills/frontend-ux/SKILL.md` mandatory patterns AND DogeOS-native
expectations (faucet/bridge guidance, Blockscout deep-links, wrong-network
switch to 6281971, Permit2 approve→swap clarity, the MetaMask nonce-desync
gotcha, native-DOGE balance handling).

All line cites are against `apps/web/src/*` (the served tree — see below).

---

## 0. Which web tree is served (resolved)

`apps/web/src` is the production frontend. `packages/web` is NOT a dead/duplicate
UI tree — it is the production HTTP server only (`packages/web/src/server.mjs`,
one source file + tests).

Evidence:
- `vite.config.js` sets `root: "apps/web/src"`, `build.outDir: "../dist"` → builds
  `apps/web/src` into `apps/web/dist`.
- The systemd unit `dogeswap-prod.service` runs `node ... packages/web/src/server.mjs`,
  which serves `defaultStaticRoot()` = `apps/web/dist` (it picks dist because
  `dist/index.html` exists) (`server.mjs:43-45`, `:17-18`).
- Live confirmation: `curl http://127.0.0.1:8080/` returns the dist `index.html`
  with `<script src="/assets/index-B_pz6dv9.js">`, byte-identical to
  `apps/web/dist/index.html`.
- The buggy copy strings ("PWR Chain", "10,000", "instant withdrawals",
  "instant finality", "free deposits") are all present in the shipped bundle
  `apps/web/dist/assets/*.js` (grep -F confirmed each).

So: edit `apps/web/src`, run `npm run build:web`, restart the service. There is
NO separate `packages/web` React app to flag.

---

## 1. False / misleading network copy (CONFIRMED + EXPANDED)

The known four are confirmed in source AND in the shipped bundle. Expanded with
two more honesty bugs the first pass did not list.

### 1a. "instant finality via PWR Chain" — SettingsView.jsx:245
`<Row label="throughput" hint="instant finality via PWR Chain">`. PWR Chain is an
unrelated L1 (no relationship to DogeOS). DogeOS is a zkEVM rollup that publishes
data to Ethereum and is verified by Dogecoin (per getting-started.md). Finality
is NOT instant (ZK proof + L1 settlement). Severity: high (false provenance).

### 1b. "10,000+" TPS — SettingsView.jsx:36 (`tps: "10,000+"`) → rendered :247
Marketing number with no basis; live chain produces ~one block at a time, real
throughput ~300 TPS order-of-magnitude. Severity: medium.

### 1c. "free deposits · instant withdrawals" — SettingsView.jsx:260, value ":261 free · instant"
Bridge withdraws take up to ~4 hours (getting-started.md "Withdraw from DogeOS":
"can take up to 4 hours"). Deposits also take up to ~4h and require an L1 OP_RETURN
tx. "instant withdrawals" is the most actively harmful claim here — a user could
expect funds back in seconds. Severity: high.

### 1d. "settles to Dogecoin · instant finality" — SwapView.jsx:976
Footer line on the swap panel. A swap is an L2 EVM tx; it does not "settle to
Dogecoin" per-swap, and finality is not instant. Severity: medium.

### 1e. (NEW) "settles on" → "Dogecoin · instant" — SwapFlow.jsx:550
Same false claim repeated inside the REVIEW modal detail rows
(`["settles on", "Dogecoin · instant"]`). This is worse than the footer because
it sits in the confirm dialog right above the user's signature. Severity: medium.

### 1f. (NEW) "settled on Dogecoin" — ActivityView.jsx:405
Activity footer: `settled on Dogecoin ·`. Same conceptual error; an L2 swap is not
settled on Dogecoin L1. Severity: low.

Note "secured by: Dogecoin PoW" (SettingsView.jsx:35) is also loosely worded —
DogeOS anchors via ZK proofs verified by Dogecoin, the row hint at :240 ("state
anchored to Dogecoin via ZK proofs") is correct but the value "Dogecoin PoW"
oversimplifies. Low.

---

## 2. Onchain button / approval-flow states (Rule 1 + Rule 2)

### 2a. Swap CTA four-state flow — GOOD
SwapView.jsx:612-666 implements connect → switch-network → insufficient/enter →
review correctly, with the wrong-network check BEFORE the amount/review check
(`wrongChain` at :270, used at :614/:621/:655). Disabled state is real
(`disabled` at :631). Matches Rule 2.

### 2b. Per-action pending states inside the execution flow — GOOD
`useSwapExecution.js` is a single sequential state machine (idle → approving →
swapping → success/error) driving ONE modal, not multiple concurrent buttons, so
the "never share one isLoading across buttons" rule does not apply here. The
modal is non-dismissible while pending (`dismissible = !exec.isPending`,
SwapFlow.jsx:331) and has an explicit cancel escape hatch (SwapFlow.jsx:624,
execute.js abort + 120s wallet timeout at :191/:214). This is solid.

### 2c. (MEDIUM) Confirm-swap button has no immediate disable on click
SwapFlow.jsx:680-693: the `confirm` button is disabled only by
`isScanning || !bestRoute`. `confirm()` (:316) calls `exec.run()` which is async;
the button is not disabled synchronously on click. There IS a `runningRef` guard
in `useSwapExecution.run` (:45-46) that drops a second invocation, and the status
flips to `approving` on the next tick which re-renders to the pending stage — so a
true double-submit is prevented. But for the brief window before re-render the
button still looks clickable. Low/medium. Recommend an explicit local
`submitting` flag set in `confirm()` to match the skill's "disable immediately on
click" wording.

### 2d. Contract-error translation — GOOD (Rule 7)
`execute.js:93-132 transactionErrorMessage` maps user-reject, min-out/slippage,
deadline, paused, allowance/permit, balance, and native-DOGE-funding to readable
text, and the error stage renders it inline (SwapFlow.jsx:447-506) with a faucet
deep-link when the message mentions funding (:488-504). This is above-average.

---

## 3. Permit2 approve→swap flow clarity

Ground truth: Permit2 IS live (canonical `0x000000000022D473030F116dDEE9F6B43aC78BA3`).
The execution path supports it (execute.js:341-387 `obtainPermit2Authorization`:
EIP-712 PermitSingle gasless sign, on-chain `Permit2.approve` fallback) and the
pending copy distinguishes the sub-steps (SwapFlow.jsx:356-366: "sign the … permit
… (gasless)", "approve … in your wallet", "approving … on DogeOS").

### 3a. (MEDIUM) No up-front "you'll approve, then swap" disclosure
Before the user clicks confirm, nothing in the review screen tells them a split
route may require TWO wallet interactions (one ERC-20→Permit2 approve + one permit
signature + the swap) the first time they trade a token. The frontend-ux skill's
approval-flow rule is about not surprising the user mid-flight. The sub-step
labels appear only AFTER they commit. Recommend a small "first trade of TOKEN
needs a one-time approval" hint on review when `routerMode === "all"`/split and
the token is unapproved. Medium.

### 3b. NOTE — useWallet header comment is stale vs. live behaviour
useWallet.js:30-34 says "Permit2 / eth_signTypedData_v4 frontend signing is
deferred … the live swap path keeps using on-chain ERC-20 /approval". The live
swap path in `execute.js` DOES sign typed data for Permit2 (:348). The comment is
out of date and will mislead the next engineer. Doc-only, low.

---

## 4. Wrong-network detect + switch to 6281971 — GOOD

- Detection: `chainIdMatchesDogeos` compares parsed chain id to 6281971
  (execute.js:27-41, DOGEOS_CHAIN_ID = 6_281_971 in api.js:4).
- Surfaced in two places: the swap CTA "switch to DogeOS network"
  (SwapView.jsx:655, handler :325 `onSwitchChain` → `wallet.switchChain()` with a
  toast on failure :327) and the header connect-chip "wrong network" red dot
  (Shell.jsx:142-171).
- Execution re-guards at signing time (execute.js:160-171), so even a stale UI
  cannot send on the wrong chain. This is correct and DogeOS-native.

---

## 5. Faucet + bridge guidance

- Faucet link present: SettingsView.jsx:275-284 (`DOGEOS_FAUCET_URL` =
  `https://faucet.testnet.dogeos.com`), and contextually surfaced on funding
  errors (execute.js:88/:106, SwapFlow.jsx:488-504). GOOD.

### 5a. (MEDIUM) No bridge link / guidance anywhere
getting-started.md's core onboarding path is faucet OR bridge
(`portal.testnet.dogeos.com/bridge`). The settings "deposits / withdrawals" row
(SettingsView.jsx:260) describes the bridge but links nothing, and its copy is
false (see 1c). A new user with only Dogecoin-L1 testnet DOGE has no path from the
app to the bridge. Recommend a real bridge link + honest "~4h" timing. Medium.

---

## 6. Blockscout deep-links

### 6a. Activity rows + footer — GOOD
ActivityView.jsx:61-67 builds `/tx/{hash}` and `/address/{address}` links; every
row with a hash is an `<a>` to Blockscout (:297, :323/:362), and the footer links
the connected address (:406-413).

### 6b. (HIGH) Swap SUCCESS screen has NO "view on Blockscout" link
SwapFlow.jsx:380-446 (success stage) shows the mascot + estimated received, then a
"done" button. The confirmed tx hash IS in hand (`exec.hash`, passed to
onComplete at SwapFlow.jsx:303), but it is never rendered as a Blockscout link.
This is the single highest-value missing deep-link: right after a swap the user
most wants to verify it on-chain. The success toast (SwapView.jsx:1027) also has
no link. Recommend adding `view on Blockscout ↗` → `${BLOCKSCOUT}/tx/${exec.hash}`
to the success stage. High.

### 6c. (MEDIUM) Token addresses are not linked to Blockscout `/token/{addr}`
TokenPicker.jsx:211 and TokensView.jsx:190 render `compactAddress(token.address)`
as plain text. DogeOS users expect to click a token to its Blockscout token page
(especially for pasted/imported unverified tokens — the import flow at
TokenPicker.jsx:361 offers no way to inspect the contract before importing).
Medium. No `/token/` deep-link exists anywhere (grep confirmed).

---

## 7. Address display / copy (Rule 3)

### 7a. (MEDIUM) No copy-to-clipboard ANYWHERE
grep for `clipboard`/`onCopy` across `ui` + `lib` = zero hits. The connect chip
(Shell.jsx:144-172) truncates the address but clicking it DISCONNECTS (:147)
rather than copying — and there is no separate copy affordance. Imported-token,
activity, and picker addresses are all read-only text. The skill's Rule 3
requires copy support for displayed addresses. Medium.

### 7b. Truncation + explorer linking — PARTIAL
`truncateAddress`/`compactAddress` exist and are used (primitives.jsx:27,
tokens.js:67). Activity links addresses to the explorer (good); token/account
addresses elsewhere do not (see 6c). No ENS/name resolution — acceptable, DogeOS
has no name service in scope.

### 7c. Pasted-address input validation — GOOD
TokenPicker.jsx:15/:239 validates with `^0x[0-9a-fA-F]{40}$` before scanning, and
`addCustomToken` (customTokens.js:39) re-validates. The token scan surfaces
"No liquidity pools" / "Not a valid token" honestly (:255-262).

---

## 8. USD context (Rule 4) — INTENTIONALLY ABSENT, honestly handled

The app shows token units with NO USD anywhere (SwapView "you receive" :520,
balances, review screen). Per the code comments this is deliberate: DogeOS testnet
has no price feed, so rather than fake USD the UI omits it (SwapView.jsx:14-16,
:452; TokensView.jsx:8-11; TokenPicker.jsx:3-4). `fmtUsd` exists
(primitives.jsx:14) but is never used in `ui`/`lib` (grep confirmed only the
definition + an unrelated `~${fee} Ð` at SwapView:967).

Verdict: this is the RIGHT call for a no-price-feed testnet — faking USD would be
worse. Documented as INFO, not a defect. If/when a price oracle exists, wire
`fmtUsd` into balances, the amount input preview, and the review screen. Info.

---

## 9. Human-readable amounts / decimals (Rule 9) — GOOD

`units.js` does all conversion via BigInt (`decimalToUnits`/`unitsToDecimal`,
:19/:37); execution uses base-unit strings, display uses `unitsToNumber` (marked
"display only; not for execution", :49). Input sanitizer collapses multi-dot
(:9-15). No raw wei is ever shown. Correct.

---

## 10. DogeOS gotchas

### 10a. useAccount().balance NOT used as source-of-truth — GOOD
Balances come from a direct `eth_call balanceOf` against the wallet provider
(useTokenBalances.js:23-29, encode/decode in units.js:81-92), seq-guarded against
races (:66/:80). No `useBalance`/`useAccount().balance` anywhere (grep: only a
doc comment mention in useWallet.js:34). This avoids the known wagmi-balance
staleness gotcha. Correct.

### 10b. (HIGH) MetaMask nonce-desync error class is NOT handled
getting-started.md "Common Errors" calls out the #1 DogeOS support issue:
local-vs-node nonce mismatch ("Incorrect nonce", or "nothing happens on
confirm"), fixed by MetaMask → Advanced → Reset account. The error mapper
(execute.js:93-132) has NO branch for nonce errors (e.g. "nonce too low",
"nonce too high", "invalid nonce", "replacement transaction underpriced") — they
fall through to the generic message (:131). And the "nothing happens on confirm"
case manifests here as the wallet-response 120s timeout (execute.js:214) →
"The wallet did not respond" — which points the user at the wrong remedy.
Recommend a nonce-error branch returning the DogeOS-specific guidance: "Your
wallet's nonce is out of sync with DogeOS. In MetaMask: Settings → Advanced →
Reset account (no funds are lost), then retry." High — this is the most common
real DogeOS user failure and the app actively mis-directs it.

---

## 11. Native DOGE handling (DogeOS-specific)

### 11a. (HIGH) Native DOGE has no balance/MAX in the swap panel
`payBalNum` (SwapView.jsx:242-252) and TokensView `balanceOf` (:51-61) read
balance via ERC-20 `balanceOf` only. For native DOGE there is no token address to
call, so the balance is 0 → the "bal" readout shows 0, "max" is inert
(SwapView.jsx:426-430, only fires when `payBalNum > 0`), the amount % slider is
disabled (`format` returns "—", onChange returns early at :694), and
`overBal` logic can't protect the user. The execution path correctly treats
native DOGE specially (execute.js:325-334 `isNativeSell` skips approval), and DOGE
is in the token catalog (it's a quick-pick at TokenPicker.jsx:233), so a user CAN
select DOGE as the pay token and hit a panel that shows 0 balance and a dead MAX
button. Native DOGE is THE native gas/value asset on DogeOS, so this is a
first-class path. Recommend reading native balance via `eth_getBalance` for the
native pseudo-token. High.

---

## 12. Loading / empty / error states — mostly GOOD

- Quote: scanning skeletons with pinned heights (no layout shift, SwapView.jsx:18-19,
  :504/:842), a real "quotes unavailable — tap to retry" failure state
  (:568/:830, status==="error" at :297), and "no executable route" (:839). GOOD.
- Activity empty state: mascot + microcopy + "start a swap" CTA
  (ActivityView.jsx:174-240). GOOD.
- Tokens loading/empty/no-match (TokensView.jsx:236-245) + disconnected prompt
  (:249). GOOD.
- Settings advanced provenance: lazy-load + "loading…" + "provenance feed
  unavailable" (SettingsView.jsx:304-319, :406-407). GOOD.
- Quote-expiry guard on review with refresh CTA (SwapFlow.jsx:280-314, :646-678).
  GOOD.

### 12a. (LOW) Mascot/asset onError fallbacks rely on `nextSibling`
SwapFlow.jsx:395-399 and ActivityView.jsx:190-194 hide the `<img>` and set
`nextSibling.style.display = "flex"`. This is brittle (assumes exact sibling
order) but the fallback `<span>` is correct and present. Low.

---

## 13. Theme (Rule 6) — GOOD with a caveat

Light/dark are real semantic token sets (theme.js:13-48) selectable in Settings
(SettingsView.jsx:200-225), threaded via context — no hardcoded full-page dark
wrapper. Default is LIGHT (useSettings DEFAULTS.dark=false). The app does NOT read
`prefers-color-scheme` to seed the initial theme — minor; the toggle exists so
this is acceptable. Note the SDK Connect Kit is hardcoded to `defaultTheme:
"light"` (sdkConfig.js:79) regardless of the app's dark mode, so the wallet modal
will be light even in dark mode — minor visual inconsistency. Low.

---

## 14. Metadata / branding (Rule 8)

### 14a. (HIGH) No Open Graph / Twitter card / description meta tags
`apps/web/src/index.html` (and the shipped `dist/index.html`) have ONLY
`<title>` + viewport + favicon. There is NO `og:title`, `og:description`,
`og:image`, `twitter:card`, `meta description`, `theme-color`, or apple-mobile
tags (grep confirmed none in `index.html`). A shared link renders with no preview
card. The skill's Rule 8 requires an absolute, reachable OG image + title/desc
before production. The app has `dist/doge-mascot.png` available to use as an OG
image. High for a production launch.

### 14b. Title + favicon — GOOD
Title is project-identified ("DogeSwap — swap aggregator on DogeOS"), favicon is a
custom branded SVG (the gold Ð mark), no template/default branding remains. Good.
Minor: only `favicon.svg` is shipped — no `.ico`/PNG fallback for older
crawlers/Safari pinned tabs (server aliases `/favicon.ico`→`/favicon.svg` at
server.mjs:122, so requests don't 404, but the format may not render everywhere).
Low.

---

## 15. Accessibility — LOW/MEDIUM

Across all of `ui/*.jsx`, only WalletChooser.jsx has `role`/`aria-label`
(:41/:67, 3 hits). Every other interactive control — the swap CTA, token chips,
flip button, sliders, modal close buttons (`✕` text only), nav tabs, toggles — has
no accessible name and many are icon-only (`⇄`, `⇅`, `▾`, `✕`, `⌕`, `⛓`). The
non-dismissible pending modal and the picker/flow modals lack `role="dialog"` /
focus trapping / Escape handling (the modal backdrop closes on click but there is
no keydown Escape handler). Recommend `aria-label`s on icon buttons,
`role="dialog"` + focus management on modals. Medium for the modals, low
elsewhere.

---

## 16. Mobile — GOOD

Dedicated mobile branch in Shell (sticky frosted header + fixed bottom tab bar
with safe-area insets, Shell.jsx:233-406), `useIsMobile` breakpoints (760 default,
999 for chart docking), bottom-sheet modals with drag-to-dismiss
(SwapFlow.jsx:42-68, TokenPicker.jsx:30-56), `inputMode="decimal"` on the amount
field (SwapView.jsx:437), and `viewport-fit=cover` + `env(safe-area-inset-*)`
throughout. This is well done. No finding.

---

## Severity summary

HIGH
- 1a "instant finality via PWR Chain" (false provenance) — SettingsView.jsx:245
- 1c "instant withdrawals" (bridge is ~4h) — SettingsView.jsx:260
- 6b Swap success screen has no Blockscout tx link — SwapFlow.jsx:380-446
- 10b MetaMask nonce-desync not handled + mis-directed — execute.js:93-132
- 11a Native DOGE has no balance/MAX in swap — SwapView.jsx:242-252
- 14a No OG/Twitter/description metadata — index.html

MEDIUM
- 1b "10,000+ TPS" — SettingsView.jsx:36/247
- 1d/1e/1f "instant finality / settles to Dogecoin" repeated — SwapView:976, SwapFlow:550, ActivityView:405
- 2c Confirm button not disabled synchronously on click — SwapFlow.jsx:680
- 3a No up-front approve+swap disclosure on review
- 5a No bridge link/guidance anywhere
- 6c Token addresses not linked to Blockscout `/token/`
- 7a No copy-to-clipboard anywhere
- 15 Modals lack role=dialog / focus trap / Escape; icon buttons unlabeled

LOW / INFO
- 1g "Dogecoin PoW" oversimplified — SettingsView.jsx:35
- 3b useWallet stale Permit2 comment — useWallet.js:30
- 8 USD context intentionally absent (correct for no-price-feed testnet) — INFO
- 12a Brittle img onError nextSibling fallback
- 13 SDK Connect Kit forced light theme; no prefers-color-scheme seed
- 14b favicon SVG-only (no .ico/PNG fallback)

## Confirmed-good (no action)
- Served tree resolved: `apps/web/src` (built→dist→served by packages/web server). `packages/web` is the server, not dead code.
- Four-state swap CTA with wrong-network-first ordering.
- Wrong-network detect + switch to 6281971, re-guarded at signing time.
- Contract-error translation (Rule 7) with faucet deep-link on funding errors.
- Permit2 gasless-sign + on-chain fallback path with distinct sub-step copy.
- Balances via eth_call balanceOf (NOT useAccount().balance) — gotcha avoided.
- BigInt unit math; no raw wei shown.
- Loading/empty/error/quote-expiry states; mobile layout.
