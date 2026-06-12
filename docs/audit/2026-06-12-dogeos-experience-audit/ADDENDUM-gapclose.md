# DogeSwap Audit — Addendum (Gap-Closing Pass)

**Date:** 2026-06-12
**Subject:** DogeSwap, non-custodial DEX aggregator on the DogeOS Chikyū Testnet (chainId **6281971**, `0x5fdaf3`)
**Scope:** Six follow-up workstreams covering what the first audit asserted from docs rather than ran, or left unmeasured: full frontend UX, V3/Algebra quote accuracy + router routing fraction, MEV/slippage + live liquidity depth, API recipient integrity, bridge moat right-sizing, and test-suite reproducibility.
**Companion findings:** [`gap-ux-full.md`](./findings/gap-ux-full.md) · [`gap-quote-accuracy.md`](./findings/gap-quote-accuracy.md) · [`gap-mev-liquidity.md`](./findings/gap-mev-liquidity.md) · [`gap-recipient-api.md`](./findings/gap-recipient-api.md) · [`gap-bridge-moat.md`](./findings/gap-bridge-moat.md) · [`gap-tests-gotchas.md`](./findings/gap-tests-gotchas.md)

---

## 1. What the gap pass confirmed / changed vs. the original reports

| Area | Original report stance | Gap-pass result |
|---|---|---|
| **Quote accuracy (V3/Algebra)** | Open question — only V2 was verified to the wei. | **Confirmed correct.** V3 and Algebra adapters are thin pass-throughs that return the on-chain quoter amount verbatim; live diffs against MuchFi V3 and Barkswap Algebra quoters matched **to the wei** on every official pair, both directions. Provider picks the best pool across fee tiers and decodes fee/gas correctly. **No quote-accuracy defect.** |
| **Is the audited router actually used?** | Concern that `DogeSwapRouter` might be bypassed for real users. | **Overturned — it is NOT bypassed.** `DOGESWAP_ROUTER_ADDRESS` is set in prod `.env` and `DOGESWAP_ROUTER_MODE` defaults to `all`, so ~**100% of UI swaps** route through the first-party router. The shipped bundle is exactInput-only; the sole direct-to-venue path is exactOutput, which the UI never sends (API-only). |
| **Which web tree is live** | Ambiguity over `apps/web` vs `packages/web` (possible dead duplicate). | **Resolved.** `apps/web/src` is the served frontend (built to `apps/web/dist`, served by `packages/web/src/server.mjs`, the systemd `ExecStart` target). `packages/web` is the **server, not a dead duplicate**. Verified against live `:8080`. |
| **Permit2 presence** | Several stale docs (`DEPLOYMENT.md`/`KNOWN_ISSUES.md`) say Permit2 is "ABSENT". | **Re-confirmed live and present** (canonical `0x0000…78BA3`, 9,152 bytes). The "ABSENT" docs are stale; the fork test's "fork lacks Permit2" skip rationale is also stale (it etches its own Permit2 regardless). |
| **Governance posture** | One keyless EOA (`0xE659…2873`) owns router/guardian/registry; handover incomplete. | **Re-confirmed across all four gap workstreams.** `owner()==guardian()==0xE659…2873`, empty bytecode (EOA), `pendingOwner()=0xf341…1773`. Unchanged — and now **amplified** because routing is ~100% through this contract (see §4). |
| **False network copy** | 4 known bugs (PWR Chain, instant finality, 10k TPS, instant withdrawals). | **Confirmed in source AND the shipped `dist` bundle**, plus **two new repetitions** (SwapFlow review modal, Activity footer). Same false claims, more surfaces. |
| **Success-screen Blockscout link** | Listed as "strongly recommended" in the original summary. | **Confirmed missing** end-to-end; hash is available at exec time but never linked. Re-rated **high** in the UX gap file (see §4). |

---

## 2. NEW findings (not in the original 39)

| # | Severity | Finding | Location |
|---|---|---|---|
| N1 | **High** | **Swap output recipient is client-controlled and never bound to sender.** The API never cross-checks `recipient` against `sender`; a caller can obtain a valid, simulation-"verified" tx paying any third party — or `address(0)`, which the contract silently no-ops, stranding output recoverable only by the single-EOA owner. High for hosted/embedded integrators, medium for the honest first-party UI. | `handler.mjs:763-812` (`/swap`), `:726-761` (`/approval`), `:299-309`; `buildSwapTx.mjs:60`; `dogeSwapRouterCalldata.mjs:288,191`; `DogeSwapRouter.sol:288,295,144` |
| N2 | **High** | **50% "MAX" slippage is an end-to-end sandwich gift.** `minOut` floors at half the quote at 5000 bps; the server only caps at 100% (`normalizeSlippageBps`); DogeOS runs a public, tip-priority mempool with no documented MEV protection. UI copy ("gas-war mode", "raise it to win contested launches", "MAX" preset) actively normalizes it. | `useSettings.js:28-35`, `SettingsView.jsx:179-181`, `SwapView.jsx:708-713`; `quoteService.mjs:19-20,141-145`; `handler.mjs:223` |
| N3 | **High** | **All routable liquidity is dust.** Total WDOGE depth across all three venues is ~**1,190 WDOGE** (~85% in two Barkswap Algebra pools); the MuchFi V2 pools the aggregator quotes hold single-digit reserves and **disagree on WDOGE price by 8x** (2.535 USDC vs 0.302 USDT) — arbitrary test seeds, not a market. At current depth, aggregation + the split-router add gas/data-fee cost **without delivering savings**. | live pools on chainId 6281971; `registry.mjs` (pool config) |
| N4 | **High** | **MetaMask nonce-desync error class is unhandled and mis-directed** — it surfaces as a generic "wallet did not respond" timeout instead of the correct DogeOS reset guidance. | `execute.js:93-132`, timeout path `:191/:214` |
| N5 | **High** | **Native DOGE has no balance / MAX / slider in the swap panel** because balances are read only via ERC-20 `balanceOf` (no `eth_getBalance` for the native pseudo-token). | `SwapView.jsx:242-252,:426-430,:694`; `TokensView.jsx:51-61` |
| N6 | **High** | **Contract test suite does not build/run in the prod checkout.** `packages/contracts/lib/` is absent and git-ignored, with no `.gitmodules`/pins to restore `forge-std`/OZ/Permit2; `forge build` and `forge test` both exit 1. The "53 tests pass" claim is **unverifiable in prod**. Deps exist only in the sibling staging tree. | `packages/contracts` (`lib/` missing; `remappings.txt` expects them) |
| N7 | **High** | **No Open Graph / Twitter / description metadata** in `index.html` (source and `dist`) — bad social/link previews for a launch. | `apps/web/src/index.html`, `apps/web/dist/index.html` |
| N8 | **Medium** | **Default 0.5% slippage reverts on virtually any V2 trade at current depth** (~0.04 WDOGE moves price past the floor; ~0.157 WDOGE = 5% impact). No live price-impact field is surfaced pre-confirm. | `quoteService.mjs:19-20`; `execute.js:114`; live pool `0xD826…87F4` |
| N9 | **Medium** | **Bridge-in → swap moat is greenfield.** Zero bridge integration code exists anywhere in the repo; the only cross-chain-bridge reference *rejects* bridge/messaging routers. Real bridge behavior is the opposite of "instant": deposits need a hand-crafted Dogecoin L1 OP_RETURN tx and relay up to ~4h; withdrawals up to ~4h. The ecosystem report sells it as a near-term, SDK-leveraged moat. | `intelligence.mjs:53-67`; `report-ecosystem.md:83,94,128,138`; `getting-started.md:117-133` |
| N10 | **Medium** | `documentedMaxReorgDepth=17` is **dead config** — echoed into the chain-meta API and asserted in tests but gates nothing. `waitForTransactionReceipt` returns on the first receipt with no confirmation-depth wait, so the "off-chain confirmation-depth policy" in the threat model **does not exist in code**. | `chains.mjs:20`; `execute.js:264-289`; `handler.mjs:92`, `live.mjs:113` |
| N11 | Medium | Several additional UX gaps: no copy-to-clipboard anywhere; token addresses not linked to Blockscout `/token/`; no real bridge link; confirm-swap button not disabled synchronously; Permit2 approve+swap not disclosed up front; modals lack `role=dialog`/focus-trap/Escape and icon buttons lack accessible names. | see `gap-ux-full.md` |
| N12 | Low | **exactOutput is the only router-bypass surface** (returns unchanged from `wrapQuoteForRouterExecution`); not exercised by the shipped UI but reachable via direct API calls. | `splitRoutes.mjs:24`; `venueCalldataBuilders.mjs:116-135,186-189,215-221` |
| N13 | Low | **Inconsistent contract test-count claims** (README 53 vs REPRODUCIBILITY/CODE_MATURITY/SLITHER_TRIAGE 39); checkout actually has 52 non-fork + 1 fork = 53 functions, none re-derived from a real run. | `README.md`; `REPRODUCIBILITY.md:96`, `CODE_MATURITY.md:14`, `SLITHER_TRIAGE.md:17` |
| N14 | Low | **RPC URL trailing-slash inconsistency** between `chains.mjs:10` (no slash) and `sdkConfig.js:8` (slash); both ship in `dist`, both work. | `chains.mjs:10` vs `sdkConfig.js:8` |
| N15 | Info | No `SELFDESTRUCT`/`PREVRANDAO`/blob/precompile reliance in `src` or the OZ/Permit2 deps actually used; the only chain-version dependency is **EIP-1153 transient storage** in the reentrancy guard (consistent with DogeOS=Prague). | `DogeSwapRouter.sol:6,34`; OZ v5.6.1 deps |
| N16 | Info | **USD context intentionally absent** (no testnet price feed) — confirmed the correct, honest call. Wire `fmtUsd` only when an oracle exists. | `SwapView.jsx:14-16,:452`; `primitives.jsx:14` |

---

## 3. Corrected / nailed-down facts

- **Live pool depths (chainId 6281971):** MuchFi V2 WDOGE/USDC `0xD826…87F4` = 7.847 USDC / 3.095 WDOGE; V2 WDOGE/USDT `0x1498…9AE4` = 2.472 USDT / 8.184 WDOGE (8x price disagreement → test seeds). MuchFi V3: USDC/WDOGE 500-tier 16.52/10.84, 2500-tier 0.425/1.042; USDT/WDOGE 500-tier 10.07/32.43. Barkswap Algebra (deepest): USDC/WDOGE 354.2/305.0, USDT/WDOGE 226.7/826.2. **Total ~1,190 WDOGE, ~85% in Algebra.** V2 factory `getPair(USDC,USDT)=0x0` (no stable/stable pool). **All six tokens are 18-decimal** (non-canonical vs real 6-dec USDC/USDT).
- **V3/Algebra quote accuracy verdict:** **correct, to the wei.** V3 selector `0xc6a5026a`, Algebra `0xe94764c4`; adapter calldata byte-for-byte identical to `cast`. No defect.
- **Router routing fraction:** **~100% of UI swaps go through the audited `DogeSwapRouter`.** The audited contract is *not* bypassed for real users; only API-only exactOutput stays direct-to-venue.
- **Which web tree is live:** `apps/web/src` (built to `apps/web/dist`, served by `packages/web/src/server.mjs`). `packages/web` is the server, not a duplicate.
- **Does the test suite run?** **No** — `lib/` deps absent, no `.gitmodules`/pins; `forge build`/`forge test` exit 1 in the prod checkout. "Tests pass" is undefendable for prod until the deps are vendored or pinned.
- **Recipient-binding risk:** the settlement recipient is fully client-supplied and **never** validated against the sender or against `address(0)` anywhere on the API.
- **Bridge moat:** **greenfield** — zero bridge code; multi-week new surface with async multi-hour pending UX. Both bridge directions are up to ~4h; deposit needs an L1 OP_RETURN tx. Never pair with "instant".
- **Permit2:** **live and present** (9,152 bytes at canonical address). "ABSENT" docs and the fork-test skip rationale are stale.
- **Governance (re-verified):** router `owner()==guardian()==0xE659…2873` (EOA, code `0x`), `pendingOwner()=0xf341…1773`, `feeBps=0`, `paused=false`, `defaultMaxInputPerTx=1e23`. Unchanged from the main report; handover still incomplete.

---

## 4. Severity movements

- **Governance concentration → effectively escalated in impact (still Critical/High).** The single-EOA router authority is unchanged in rating, but its **blast radius is now confirmed to be ~100% of production flow** (router mode `all` is the live default). It is also the **sole stranded-fund recovery key** for the new recipient/`address(0)` risk. The governance handover (`acceptOwnership()` + `DEFAULT_ADMIN_ROLE` renounce + guardian split) should be gated *before* router mode `all` is promoted as default, not treated as orthogonal.
- **Success-screen Blockscout link: recommended → High.** It was "strongly recommended (not a strict blocker)" in the original summary; the gap pass confirms it is missing across the success stage and toast despite the hash being available, and groups it with the broader deep-link/UX gap. Treat as a launch blocker for a public featuring.
- **False network copy: High, now broader.** Same severity, but two additional surfaces (SwapFlow review modal, Activity footer) and confirmation in the shipped `dist` bundle widen the fix scope.
- **No downgrades.** No original finding was weakened by ground truth in this pass. (One *non-finding* was strengthened: V3/Algebra quote accuracy is now positively confirmed rather than open.)

### New blockers to add to the go/no-go gate

1. **N1** — bind/validate `recipient` to `sender` (and forbid `address(0)`) server-side before calldata is built; apply before `executionQuoteTransform` so it covers the refreshed-quote path.
2. **N2 + N8** — cap user-selectable slippage at a sane ceiling (e.g. 5%, expert-gate higher), cap server-side well below 100%, surface live price impact, and drop the MAX/gas-war framing.
3. **N6** — make the prod checkout self-bootstrapping (`.gitmodules`/Soldeer/`foundry.lock` pins or vendored `lib/`) so "tests pass" is reproducible; reconcile the 39-vs-53 count from a real run.
4. **N4, N5, N7** — handle the MetaMask nonce-desync error class, add native-DOGE balance/MAX/slider, and add OG/Twitter/description metadata before any public launch.

### Right-sizing (not new severity, but planning corrections)

- **Bridge-in → swap** must be re-tagged in `report-ecosystem.md` §4/§6 as **multi-week greenfield**, decoupled from the same grant line as the small fixes, and sequenced pre-mainnet.
- **Aggregator moat** is weak on the merits at current depths; the only durable lever is **distribution** (DogeOS featuring it). Execution quality and UX are real but copyable and converge with liquidity.
