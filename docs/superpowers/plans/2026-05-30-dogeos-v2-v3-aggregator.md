# DogeOS V2/V3 DEX Aggregator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fast DogeOS aggregator for verified external V2 and V3 liquidity without any platform liquidity-venue creation path.

**Architecture:** Keep source metadata, verification, quotes, gas estimation, transaction construction, and UI state in separate modules. Start with direct single-route execution and preserve route candidate composition for one-hop and split routing later.

**Tech Stack:** Dependency-light ESM JavaScript, DogeOS RPC, Blockscout, DogeOS SDK v3, responsive web frontend, and direct venue approval/execution through verified external routers.

---

## Task 1: Scaffold Packages

**Files:**
- Create: `package.json`
- Create: `packages/config/src/chains.ts`
- Create: `packages/config/src/tokens.ts`
- Create: `packages/aggregator/src/sources/types.ts`
- Create: `packages/aggregator/src/sources/registry.ts`
- Create: `packages/aggregator/src/verification/types.ts`
- Create: `packages/aggregator/src/verification/verifySource.ts`
- Create: `packages/aggregator/test/sourceRegistry.test.ts`
- Create: `packages/aggregator/test/verifySource.test.ts`

- [x] Write tests for source status, read-only vs executable gating, and ABI provenance.
- [x] Run the tests and confirm they fail because modules do not exist.
- [x] Add the minimal config, token registry, source registry, and verification types.
- [x] Implement `verifySource` so executable status requires router address, bytecode presence, Blockscout ABI payload, and matching protocol details.
- [x] Run tests again and confirm they pass.

## Task 2: Add Direct Quote Adapters

**Files:**
- Create: `packages/aggregator/src/quotes/types.ts`
- Create: `packages/aggregator/src/quotes/adapters/v2.ts`
- Create: `packages/aggregator/src/quotes/adapters/v3.ts`
- Create: `packages/aggregator/src/quotes/adapters/algebra.ts`
- Create: `packages/aggregator/test/directQuoteAdapters.test.ts`

- [x] Test V2 reserve math with 18-decimal DogeOS token fixtures.
- [x] Test V3 and Algebra adapters against deterministic pool-state fixtures.
- [x] Ensure adapters return `sourceId`, `pool`, `amountOut`, `priceImpact`, `gasUnits`, `blockNumber`, `ttlMs`, and `warnings`.
- [x] Keep execution calldata out of quote adapters.
- [x] Run adapter tests and confirm direct quote behavior.

## Task 3: Add Gas And Data/Finality Fee Estimation

**Files:**
- Create: `packages/aggregator/src/fees/dogeosFeeEstimator.ts`
- Create: `packages/aggregator/test/dogeosFeeEstimator.test.ts`

- [x] Test that route scoring includes execution gas and DogeOS oracle-backed data/finality fee estimates.
- [x] Test that higher-calldata routes can lose even with better gross output.
- [x] Implement the estimator with injectable fee-provider boundaries and default DogeOS `L1GasPriceOracle.getL1Fee(bytes)` reads.
- [x] Add live-network verification as a separate script, not as a unit-test dependency.

## Task 4: Add Direct Route Optimizer

**Files:**
- Create: `packages/aggregator/src/routes/direct.ts`
- Create: `packages/aggregator/src/routes/score.ts`
- Create: `packages/aggregator/test/directRouteOptimizer.test.ts`

- [x] Test that the highest net output wins after fees and failure penalty.
- [x] Test tie-breaking toward the simpler verified source.
- [x] Test that stale or unverified executable routes are rejected.
- [x] Implement direct route scoring and route alternatives.

## Task 5: Add Swap Transaction Builder

**Files:**
- Create: `packages/aggregator/src/swap/buildSwapTx.ts`
- Create: `packages/aggregator/src/swap/verifySwapTx.ts`
- Create: `packages/aggregator/test/buildSwapTx.test.ts`
- Create: `packages/aggregator/test/swapVerification.test.ts`

- [x] Test that `buildSwapTx` refuses expired quotes.
- [x] Test that it refuses sources without executable verification.
- [x] Test that it binds amount, recipient, min output, deadline, chain ID, and source ID.
- [x] Implement venue-specific calldata builders behind typed adapter modules.
- [x] Add sender-aware swap simulation with `eth_call`, `eth_estimateGas`, and buffered gas limits before wallet signing.

## Task 6: Add Responsive Web App

**Files:**
- Create: `apps/web/src/index.html`
- Create: `apps/web/src/app.js`
- Create: `apps/web/src/styles.css`
- Create: `packages/web/src/server.mjs`
- Create: `packages/web/test/server.test.mjs`
- Create: `packages/web/test/staticApp.test.mjs`

- [x] Build a mobile-first swap form with stable token, amount, route, warning, and transaction states.
- [x] Use DogeOS SDK v3 as the primary wallet path with `WalletConnectProvider`, `useWalletConnect`, and `useAccount`.
- [x] Show route verification, estimated DOGE gas, data/finality fee, price impact, minimum output, and Blockscout links.
- [x] Verify desktop and mobile layouts with browser screenshots.

## Task 7: Add One-Hop Extension Point

**Files:**
- Create: `packages/aggregator/src/routes/oneHop.ts`
- Create: `packages/aggregator/test/oneHopRoutes.test.ts`

- [x] Test one-hop route composition through WDOGE without changing direct route adapter interfaces.
- [x] Keep one-hop read-only by default in the live API until a multi-leg transaction path exists.
- [x] Add feature flagging so split routing can use the same composed route model later.

## Task 8: Add Verification Runbook

**Files:**
- Create: `docs/adapter-verification.md`
- Create: `docs/dogeos-router-verification-runbook.md`

- [x] Document router, quoter, factory, pool, ABI, selector, bytecode, and Blockscout checks.
- [x] Add machine-readable relationship checks for router/quoter/factory reads such as `factory()`, `WETH()`, `WETH9()`, and `poolDeployer()`.
- [x] Document source statuses: `watchlist`, `readOnly`, `simulationOnly`, `active`, `disabled`.
- [x] Document rollback and emergency disable steps.
- [x] Require every executable source to have router, ABI, selector, relationship-read, and runtime simulation evidence.

## Task 9: Add API Runtime Boundary

**Files:**
- Create: `packages/api/src/handler.mjs`
- Create: `packages/api/src/server.mjs`
- Create: `packages/api/src/index.mjs`
- Create: `packages/api/test/handler.test.mjs`
- Create: `packages/api/test/server.test.mjs`
- Create: `packages/api/test/publicApi.test.mjs`

- [x] Test `/sources` and `/tokens` responses for UI metadata.
- [x] Add `/venues` contract/provenance map for router, quoter, factory, pool, selector, relationship-read, and Blockscout ABI visibility.
- [x] Test `/quote` request validation, source filters, gas-aware scoring, and bigint-safe JSON output.
- [x] Add fail-open composite quote provider behavior with per-provider timeout coverage for live API speed.
- [x] Test `/swap` refusal for non-active routes before calldata is built.
- [x] Add a Node HTTP adapter that forwards real GET and POST requests to the handler.
- [x] Add `npm run start:api` for local API startup.
- [x] Wire live DogeOS chain verification and gas provider into the API runtime.
- [x] Wire live V2 pool discovery into the API runtime with active executable quote candidates.
- [x] Wire verified V3 and Algebra quoter-output provider boundaries into the API runtime.
- [x] Add live MuchFi V3 and Barkswap Algebra quoter RPC readers from on-chain selector/provenance records.
- [x] Add per-source timeout and failure isolation so one stalled V2/V3/Algebra venue cannot erase healthy same-family quote candidates.
- [x] Prune unsupported pinned pool pairs before live block-number, factory, and quoter reads for faster quote responses.
- [x] Batch V2 pool state reads and V3/Algebra pool-state-plus-quoter reads through JSON-RPC batching when the RPC supports it, with individual-call fallback.
- [x] Batch source bytecode, token bytecode/decimals, relationship reads, and pool state verification reads through JSON-RPC batching when the RPC supports it, with individual-call fallback.
- [x] Wire `/swap` to a verified calldata builder registry with no arbitrary fallback.
- [x] Add typed MuchFi V2, MuchFi V3, and Barkswap Algebra calldata builders behind the verified registry.
- [x] Add live `/swap` chain verification, exact calldata simulation, `eth_estimateGas`, and buffered gas limit output for active quotes.
- [x] Add ERC-20 allowance preflight and exact approval transaction generation before active swap submission.
- [x] Add sell-token and native DOGE balance preflight before executable `/swap` transaction data is returned.
- [x] Remove committed execution-record approvals; active calldata building now uses source status, router match, ABI provenance, typed selector match, and runtime simulation directly.
- [x] Abort stale browser `/quote` requests when live typing schedules a newer quote so old inputs do not waste API/RPC work.
- [x] Coalesce identical concurrent `/quote` requests at the API boundary so live typing and repeated clients do not duplicate provider/RPC work.
- [x] Add target-bound adapter ABI fragments for the active MuchFi V2, MuchFi V3, and Barkswap router/quoter contracts.
- [ ] Add venue-authorized ABI artifacts or Blockscout verification records for executable routing.
  - Local support exists for `venue-artifact` provenance: target-bound artifact metadata, recomputed artifact hash, selector matching, relationship reads, and passed simulation are required before active execution. Current `adapter-fragment` artifacts are aggregator-owned ABI fragments, not venue endorsements, so venue-authorized artifacts or Blockscout records remain the preferred provenance upgrade.
- [x] Wire verified venue-specific calldata builder implementations into `/swap`.

## Done Definition

- No platform liquidity-venue fork, deployment, pool-seeding, or LP-management path exists in docs or code.
- Unit tests cover registry gating, verification, quote math, fee estimation, direct route scoring, and transaction building.
- Browser checks prove responsive desktop and mobile swap surfaces.
- Live DogeOS verification script records current router bytecode and Blockscout verification status.
- Split routing remains modular but disabled until direct execution is reliable and one-hop has a dedicated multi-leg transaction path.
