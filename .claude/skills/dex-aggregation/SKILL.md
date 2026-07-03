---
name: dex-aggregation
description: DogeSwap DEX-aggregator domain knowledge — quote math, routing/splitting, venue sourcing, slippage, price impact, fees, and how we compare to 1inch/0x/UniswapX/CoW/Relay. Use when asked "why is this quote wrong", "quote math", "price impact", "add a venue", "routing" or "splitting", "slippage", "why did the router pick this venue", "compare to 1inch" (or any aggregator), "aggregator architecture", or when reviewing any change under packages/aggregator or packages/contracts that touches quoting, scoring, or swap building.
---

# DEX aggregation — DogeSwap's model, the landscape, and quote-accuracy discipline

DogeSwap is a DEX aggregator on DogeOS Chikyū zkEVM testnet (chain 6281971, Prague EVM). Three
external venues — MuchFi V2 (UniV2-style), MuchFi V3 (UniV3/QuoterV2-style), Barkswap (Algebra) —
plus a first-party command/executor settlement router (`packages/contracts/src/DogeSwapRouter.sol`).
Quoting lives in `packages/aggregator/` (plain ESM `.mjs`, all money as `BigInt`, `node:test`);
the API glue is `packages/api/src/live.mjs` + `packages/api/src/handler.mjs`. Facts below were
verified against the repo code and (where dated) live-checked 2026-07-02.

Supporting files:
- [references/venue-quirks.md](references/venue-quirks.md) — per-venue selector/return-shape/fee/gas
  gotchas as a quick table. Read it BEFORE touching venue quoting code or adding a venue.
- [references/protocols.md](references/protocols.md) — deep dives on 1inch, 0x Settler, UniswapX,
  CoW, Relay, and the meta-aggregators, with source URLs. Read it when comparing designs, planning
  an intents V2, or when asked "how does X do it".

## 1. This repo's model

### 1.1 Quote pipeline

```
POST /quote (packages/api/src/handler.mjs:800)
  └─ resolveQuoteCandidates — in-flight dedupe by request key (handler.mjs:544-574)
      └─ OUTER composite provider (live.mjs:295-314)
          ├─ "direct"  = INNER composite (live.mjs:251-264)
          │     ├─ "v2" provider (discovery/v2Pools.mjs:152)             per venue via runSourceQuote
          │     └─ "concentrated-liquidity" provider
          │           (quotes/providers/concentratedLiquidity.mjs:29)    per venue via runSourceQuote
          │           └─ live quoter caller (discovery/concentratedLiquidityPools.mjs:240)
          ├─ "one-hop" provider (routes/oneHop.mjs:72)   — re-enters "direct"; PREVIEW-ONLY
          └─ "split"   provider (routes/splitRoutes.mjs:211) — re-enters "direct"
      → flat candidate list
  └─ buildQuoteResponse (aggregator/src/quoteService.mjs:156)
      └─ chooseBestDirectRoute (routes/direct.mjs:9) + scoring (fees/dogeosFeeEstimator.mjs)
  └─ transient-diagnostic status mapping + telemetry (handler.mjs:844-878)
```

The source registry `packages/aggregator/src/sources/registry.mjs` (SOURCES array, lines 66-564) is
the single source of truth for venues: addresses, pinned pools, statuses
(`watchlist|readOnly|simulationOnly|active|disabled`), verification specs. Active: `muchfi-v2`,
`muchfi-v3`, `barkswap-algebra`, plus `dogeswap-split` (registry.mjs:529-563, ACTIVE only when
`DOGESWAP_ROUTER_ADDRESS` env is set — read once at module load, line 21). `suchswap` and `dogebox`
are WATCHLIST (no confirmed router/quoter) and never quoted. To add a venue, follow the registry
entry shape + verification targets; executability is derived, not declared — see
`verification/verifySource.mjs deriveExecutableStatus` (47-204): router ABI artifact + all expected
selectors in on-chain bytecode + relationship read checks must pass or the source degrades.

### 1.2 Per-venue quote sourcing (full quirk table: [references/venue-quirks.md](references/venue-quirks.md))

- **MuchFi V2 — local reserve math, no quoter.** `discovery/v2Pools.mjs:152-299` resolves the pool
  (pinned pair, else live `factory.getPair` `0xe6a43905` — pasted tokens route without registry
  edits), reads `getReserves()` at the request-pinned block, then computes in
  `quotes/adapters/v2.mjs` (pure, no RPC): constant-product with fee, exactInput at lines 19-23,
  exactOutput at 25-34 (`+1n` rounding, liquidity guard). **feeBps is 20n, NOT the canonical 30**
  — measured on-chain 2026-06-12 against the router's own `getAmountsOut`
  (registry.mjs:76-80; re-run `scripts/verify-quoter-shapes.mjs` if V2 swaps start reverting on
  minAmountOut or under-delivering). Fixed `gasUnits = 135_000n` (v2Pools.mjs:159).
- **MuchFi V3 — QuoterV2 eth_call.** `discovery/concentratedLiquidityPools.mjs:116-178`: batched 5
  eth_calls per pool (`token0`, `token1`, `liquidity` `0x1a686502`, `slot0` `0x3850c7bd`, quoter).
  `quoteExactInputSingle((tokenIn,tokenOut,amountIn,fee,sqrtPriceLimitX96=0))` selector
  `0xc6a5026a` / exactOutput `0xbd21704a`. Word 0 = quoted amount, **word 3 = gasEstimate → becomes
  the candidate's gasUnits** (line 175). `feeBps = feeTier/100` (lines 72-74).
- **Barkswap Algebra — quoter with a trap return shape.** Selectors `0xe94764c4` (exactInput) /
  `0x62086e24` (exactOutput); args include `deployer` = `quoterPoolDeployer` which for Barkswap is
  the **zero-address sentinel** (registry.mjs:312). The quoter returns SIX words
  `(amountOut, amountIn, sqrtPriceX96After, ticksCrossed, gasEstimate, fee)` for BOTH directions —
  **for exact-output, word 0 just echoes the requested amountOut; the real input is word 1**
  (concentratedLiquidityPools.mjs:217-228, empirically verified 2026-06-12). gasUnits = word 4;
  dynamic fee = word 5, falling back to `globalState` `0xe76c01e4` word 2 (lines 214-215).
- Pool selection: pinned pools first, else live factory discovery (`discovery/poolScan.mjs:79-123`
  — V3 `getPool` `0x1698ee82` over tiers `[100,500,2500,3000,10000]`, Algebra `poolByPair`
  `0xd9a641e1`), liquidity-gated; multiple pools quoted in parallel, best picked. If EVERY pool
  fails, the first error is rethrown so the venue records a sourceError instead of a silent empty
  (concentratedLiquidityPools.mjs:296-302).
- CL adapters (`quotes/adapters/concentratedLiquidity.mjs`) hard-assert quoter ABI provenance
  (lines 9-13) and compute price impact from `sqrtPriceX96` Q192 mid-price (30-42). Gas fallback
  if the quoter gave none: v3 165k / algebra 180k (`quotes/providers/concentratedLiquidity.mjs:12-15`).
  Note: the CL exactInput adapter does NOT set `quoteMode`; consumers default missing→"exactInput".

### 1.3 Timeouts and the transient-vs-genuine invariant (commit c32bc98, deployed 2026-07-01)

Core invariant (`quotes/sourceQuoteRunner.mjs:1-24`): **`[]` from a venue must mean "this venue
genuinely cannot quote this pair at this block" — NEVER "the RPC was slow".** Two nested budgets,
deliberately per-venue (3s) < per-provider (4s):

- `runSourceQuote` (sourceQuoteRunner.mjs:77-104, `DEFAULT_SOURCE_TIMEOUT_MS = 3_000` line 29)
  races each venue task; on throw/timeout it reports
  `onSourceError(error, {sourceId, transient: isTransientError(error)})` and returns `[]` so
  sibling venues survive `Promise.all`. `isTransientError` (46-61): explicit `transient===true` /
  AbortError → transient; message matching `execution reverted|revert|must (be|contain)|decode|
  invalid|exceeds` → genuine (checked FIRST — known misclassification trap for transport errors
  whose message contains those words, e.g. "not valid JSON"); then timeout/HTTP/ECONN-class →
  transient.
- The composite (`quotes/providers/composite.mjs`, `DEFAULT_PROVIDER_TIMEOUT_MS = 4_000` line 5 —
  DogeOS testnet quoter eth_call is ~0.7s normal, 2-3s spikes; `DEFAULT_PROVIDER_RETRIES = 1` line
  10) retries only THROWN failures; a resolved `[]` is never retried (runProviderWithRetry 56-66).
- API mapping (handler.mjs:844-861): if the result is `no-route` AND any recorded diagnostic is
  `transient:true`, the response becomes `status:"unavailable", retryable:true,
  warnings:["quote-temporarily-unavailable"]` (HTTP 200) so the client keeps the prior quote and
  re-polls. A genuine empty stays `"no-route"`. Diagnostics ride a non-enumerable
  `input.quoteDiagnostics` array (handler.mjs:149-157) and are surfaced in `telemetry.sourceErrors`.
- Staleness: every candidate carries `quoteTimestampMs` + `ttlMs` (default 5_000);
  `chooseBestDirectRoute` rejects `nowMs − quoteTimestampMs > ttlMs` as `"stale"` (direct.mjs:3-7);
  `expiresAtMs = best.quoteTimestampMs + best.ttlMs` (quoteService.mjs:221).

### 1.4 Route selection, scoring, one-hop, split

- **Scoring** (`fees/dogeosFeeEstimator.mjs`): `totalFeeWei = gasUnits·gasPriceWei +
  dataFinalityFeeWei`; exactInput `netOutput = amountOut − feeWeiToTokenAmount(totalFeeWei,
  outputWeiPerFeeWei) − failurePenalty`; exactOutput `totalInput = amountIn +
  feeWeiToTokenAmount(totalFeeWei, inputWeiPerFeeWei)`. Rates can be a bigint scalar or a rational
  `{ numerator, denominator }` (`f328fdd`). Live mode now derives default rates from a cached
  WDOGE→target-token quote: output token for exact-input, input token for exact-output, with WDOGE
  = 1:1 and fail-open `0n` if no safe conversion route exists. Selection (direct.mjs:47-58):
  exactInput by descending netOutput, exactOutput by ascending totalInput, ties → lower gasUnits →
  sourceId lexicographic. `failurePenalty` is plumbed but nothing sets it.
- **One-hop** (`routes/oneHop.mjs`): via-token = WDOGE only (live.mjs:67-71); composes two direct
  legs but candidates are hard-coded `status:"readOnly", reason:"one-hop-execution-preview"`
  (oneHop.mjs:41-44) — **multi-hop is preview-only, never executable today**; it only upgrades a
  "no-route" response to "read-only". exactOutput unsupported (oneHop.mjs:80).
- **Split** (`routes/splitRoutes.mjs:211-304`): exact-input only; requires the DogeSwapRouter.
  Takes the two best ACTIVE venues from a full direct quote (activeBestBySource 57-69), evaluates
  coarse ratios **[25%, 50%, 75%]** (line 55) with real depth-aware re-quotes of each leg
  (per-venue pinned via `includeSources`, 239-264), then refines ±12.5% (`refineStepBps=1_250n`,
  217, 278-285). Surfaced only if it beats the best single venue by `minImprovementBps` — 1 bp in
  router-mode "all", 5 bps otherwise (live.mjs:288-293). Candidate: `routeType:"split",
  sourceId:"dogeswap-split"`, amountOut = Σ legs, `gasUnits = Σ legs + 90_000n` router overhead
  (line 54), data/finality fee replaced by ONE combined router-program oracle read (122-135).
  Cost note: one exact-input /quote can trigger up to ~13 inner direct invocations (1 full +
  6 coarse-leg + 4 refine-leg) under the same 4s budget — under RPC spikes the split silently
  times out while still generating the RPC traffic.
- **Split refresh** (`createSplitQuoteRefresher`, splitRoutes.mjs:143-209): /swap re-quotes the
  EXACT locked legs (same venues, same per-leg amountIn) instead of re-running the marginal
  optimizer, which often fails to reproduce the split and would 422.

### 1.5 Fee model — what DogeSwap takes

**Zero protocol fee today.** Nothing in the quote path adds a fee; the on-chain router supports an
owner-set output-side fee capped at `MAX_FEE_BPS = 100` (1%) (`DogeSwapRouter.sol:71-74,121-131`)
but defaults to `feeBps=0, feeRecipient=address(0)`. What IS computed per quote:
1. **Venue LP fee** — embedded in amountOut/amountIn, surfaced as `feeBps` (V2 20bps; V3 tier/100;
   Algebra dynamic from the quoter).
2. **Execution gas** — `gasUnits × gasPriceWei` (live `eth_gasPrice`).
3. **DogeOS data/finality (L1) fee** — `getL1Fee(bytes)` selector `0x49948e0e` on the predeploy
   `0x5300000000000000000000000000000000000002` (`fees/l1GasPriceOracle.mjs:3`,
   `config/src/chains.mjs:19`). **Route-aware payload sizing** (`swapPayloadForFee`, 83-95):
   direct-venue calldata v2 260B / v3 228B / algebra 260B (lines 8-12); a router program is
   `388 + 256·legs` bytes (lines 20-21; measured 1-leg 644B, 2-leg 900B) — this fixed a ~3-5×
   under-count. Cached 15s, 256-entry FIFO; oracle failure falls back to 0 wei with a console
   warning, never blocks quoting (live.mjs:204-207). At /swap time the fee is recomputed on the
   REAL calldata (live.mjs:224-230).

Slippage: server-side hard cap `MAX_SLIPPAGE_BPS = 500n` (5%), enforced at request parse
(handler.mjs:255) AND scoring (quoteService.mjs:11,148-154). Bounds: `minimumOutput =
amountOut·(10000−s)/10000`, exactOutput `maximumInput = amountIn·(10000+s)/10000`
(quoteService.mjs:26-32); each executable route carries `feeEstimate`, `score`, and bounds
(quoteService.mjs:34-65).

### 1.6 Swap building — DogeSwapRouter programs

- `swap/buildSwapTx.mjs:44-82` validates chain/status/TTL/addresses and dispatches to the builder
  registry (`swap/calldataRegistry.mjs:89-112`), which enforces source ACTIVE + verified ABI
  provenance + router-address match + built calldata starts with the registered selector.
- Direct venue encoders are byte-exact and hand-rolled (`swap/venueCalldataBuilders.mjs`): V2
  `0x38ed1739`/`0x8803dbee`; MuchFi V3 `0x04e45aaf`/`0x5023b4df` (**no deadline field** in the
  venue's struct); Algebra `0x1679c792`/`0x1764babc` (deployer + deadline in-struct).
- Router programs (`swap/dogeSwapRouterCalldata.mjs`): `execute(bytes,bytes[],
  (address,uint256,address),uint256)` selector `0xe56964c6` (line 20); one command byte per input:
  PERMIT2_PERMIT 0x00, PERMIT2_TRANSFER_FROM 0x01, V2 0x02, V3 0x03, ALGEBRA 0x04, WRAP 0x05,
  UNWRAP 0x06 (24-32). `buildDogeSwapSplitCalldata` (236-292): optional in-tx Permit2 permit
  (signed PermitSingle, gasless for the user), one Permit2 pull of total input, per-leg swap
  commands with **per-leg minOut 0 and the LAST leg using CONTRACT_BALANCE (2^256−1) so rounding
  dust is consumed** — the aggregate minOut is enforced only in the router's settlement against
  the recipient's measured balance delta. Encodings are tested byte-for-byte vs `cast calldata`
  fixtures (`test/dogeSwapRouterCalldata.test.mjs`).
- **Router-mode "all"** (`DOGESWAP_ROUTER_MODE`): `wrapQuoteForRouterExecution`
  (splitRoutes.mjs:22-49) retargets every eligible active exact-input v2/v3/algebra quote onto the
  DogeSwapRouter at /approval and /swap time only (live.mjs:508-511 → applied handler.mjs:903,947
  — NOT in the /quote response), for enforced settlement/deadline/Permit2. Exact-output always
  goes direct to the venue (router commands are exact-input only).
- Approvals (live.mjs:513-526): direct venue swaps use exact-amount ERC-20 approve plans; anything
  through the router uses Permit2 — one-time MAX approve to canonical Permit2
  `0x000000000022D473030F116dDEE9F6B43aC78BA3` + per-window signed PermitSingle (30-day
  expiration, 30-min sig deadline), with on-chain `Permit2.approve` fallback for wallets that
  can't sign typed data (`swap/permit2Approval.mjs:1-31`).
- **Re-quote before build**: /swap and /approval first refresh the quote live
  (`refreshSwapQuoteBeforeBuild=true`, live.mjs:196; handler.mjs:576-598) and fail-closed clamp to
  the user-accepted bounds — refreshed amountOut below accepted minAmountOut throws "Price moved"
  instead of silently executing worse (`clampRefreshedSwapQuote`, handler.mjs:349-381). Pre-flight
  then simulates + estimateGas ×1.2 + exact-calldata L1 fee (`swap/verifySwapTx.mjs`) and checks
  balances (`swap/balancePreflight.mjs`).
- **Deployment caveat (memory + audit, verified 2026-06-26):** the LIVE router
  `0xa3158549f38400F355aDf20C92DA1769620Aa35A` is the immutable PRE-hardening build (lacks
  H1-H11); the hardened source in-repo is not yet deployed. Cutover runbook:
  `packages/contracts/audit/REDEPLOY-RUNBOOK.md`. Registry `0xC596081d427E8296e089eDD59a62E73Da3191215`;
  the web app pins the router via env var, not the registry.

## 2. The comparative landscape (details + URLs: [references/protocols.md](references/protocols.md))

- **1inch** — AggregationRouterV6 (= Limit Order Protocol v4, one contract) with two execution
  tiers: cheap `unoswap` (packed pool-word calldata, 1-3 hops) vs generic `swap(executor, desc,
  data)` where the API emits opaque route bytes and the router only enforces the measured
  `minReturnAmount`. Pathfinder (closed) is gas-aware graph search splitting across venues AND
  same-pair "market depths". Fusion = gasless Dutch-auction intents filled by ~10 staked/KYB'd
  resolvers; Fusion+ = cross-chain via HTLC escrows. **Adopt:** the two-tier calldata idea (a
  packed direct path for the 99% single-venue case) and the "invariant onchain, intelligence
  offchain" division we already follow; the v6 lesson of indexed selector whitelists over free
  4-byte calls. **Ignore:** Fusion's resolver economics (needs professional MM set + staking
  token) and the everything-in-one-contract deployment (concentrates risk; our thin immutable
  router + redeploy model is closer to Settler and fine at our scale).
- **0x Settler** — **this repo's direct design lineage**: zero passive allowances on the settler,
  Permit2-only ingress, immutable instances rotated via an on-chain registry, EIP-1153 transient
  reentrancy guard, action-list execution. Differences: Settler uses Permit2 *SignatureTransfer*
  (single-use permit per trade, witness binds the action list for gasless metatxs) where DogeSwap
  uses *AllowanceTransfer* (standing Permit2 allowance, router as spender); Settler has venue
  "VIP" paths (pull inside the pool callback, no custody hop). **Adopt:** witness-bound metatx if
  we ever add gasless; registry-verified deployments (`ownerOf/prev`) for integrators. **Ignore:**
  VIP callback paths — with 3 venues and testnet gas prices the complexity buys nothing.
- **UniswapX** — signed order + Permit2 order-as-witness; reactors enforce decay-curve price at
  fill time; exclusivity + cosigner for RFQ winners; priority-fee auctions on PGA chains. Fillers
  pay gas; failed fills cost the user nothing. **Adopt:** the reactor mental model for a V2 (see
  §3) and ERC-7683 structs if cross-chain to Dogecoin L1 ever matters. **Ignore:** cosigner
  infrastructure — needs an operator you trust for surplus capture.
- **CoW Protocol** — batch auctions, uniform directed clearing prices, bonded solver allowlist,
  EBBO floor, CoW matching bypassing AMMs entirely. Strongest MEV story; heaviest offchain
  machinery (autopilot, solver scoring, bonding pools). **Adopt:** the discipline that users
  approve a VaultRelayer, never the settlement contract (we already do the Permit2 equivalent),
  and the "solver bears revert cost" framing. **Ignore:** batch auctions — they need order flow
  density DogeOS doesn't have.
- **Relay** — cross-chain relayer-fill: deposit into a non-upgradable per-chain Depository with an
  orderId, solver fills on destination from own inventory in ~seconds, repaid per-order via
  threshold-signed oracle attestations on a dedicated Relay Chain. **Adopt:** the
  status-endpoint/step-execution API shape (`steps[].items[].check`) and explicit
  `refundTo`/fast-refund semantics if we ever bridge. **Ignore for now:** DogeOS is not supported
  (verified 2026-07-02: only Sepolia + Base Sepolia on their testnet API); onboarding is a BD
  conversation, not an integration.
- **ParaSwap/Velora, Kyber, LI.FI, Socket, Jupiter** (briefs in the reference): the patterns worth
  stealing are Kyber's two-step `/routes` → `/route/build` (cheap quote, encode at execution,
  checksum + expiry), Kyber Smart Settlement (multiple candidate pools per hop compared ON-CHAIN
  at execution — the only anti-drift design that needs no offchain auction), integrator-fee params
  in the quote request (universal pattern), and positive-slippage capture as a disclosed revenue
  lever. Ignore their chain-count/meta-aggregation sprawl — irrelevant to a single-chain
  aggregator.

## 3. Where DogeSwap sits, and the intents V2 path

Spectrum: **onchain routing** (route fixed in user's calldata; user pays gas + revert risk; MEV
protection = slippage bound only) → **offchain quote + onchain settlement with measured-delta
enforcement** (0x Settler; 1inch generic swap) → **intents** (user signs an outcome; fillers/solvers
compete; user pays no gas, no revert cost; MEV moves to the filler layer). DogeSwap today is
squarely in the middle: the API computes routes, the tx carries a fixed command program, and
`DogeSwapRouter._settle` enforces aggregate minOut on the recipient's measured balance delta
(`DogeSwapRouter.sol:328-359`) — venue return values are deliberately ignored. That is already the
settlement half of an intent system.

**Concrete V2 migration path (intent/solver), reusing this codebase:**
- **Stays:** the source registry + verification pipeline (registry.mjs — solvers still need a
  vetted venue set for the reference route); the venue quote adapters and quoter callers (they
  become the in-house solver's pricing engine AND the EBBO-style floor check); the DogeSwapRouter
  as settlement (its ledger/settlement design already measures deltas and enforces floors);
  Permit2 (switch AllowanceTransfer → SignatureTransfer with the order as witness, UniswapX-style,
  so a fill is only valid under the order's exact terms).
- **Changes:** the order type — replace "quote + fixed program" with a signed
  `{sellToken, buyToken, amountIn, decayStartAmount, decayEndAmount, decayWindow, deadline, nonce}`
  Dutch order (start = our best quoted amountOut, end = minOut at the slippage cap); add a thin
  reactor entrypoint on the router (`fillOrder(order, sig, program)`) that resolves the curve at
  fill time and runs the existing command loop with the resolved floor; the auction is just decay
  + open filling at first (no offchain auction infra needed — this is UniswapX's open Dutch mode);
  the filler set starts as our own filler bot running the existing aggregator as its router, open
  to third parties later.
- **Sequencing reality:** on a testnet with 2 official pairs and no third-party fillers, V2 is an
  architecture investment, not a price improvement. The cheap intermediate step with real user
  value is Kyber-style execution-time adaptivity: encode 2 candidate pools per leg and let the
  router pick the better delta at execution — no new order type, no signature changes.

## 4. Quote-accuracy discipline — review checklists

Apply these to any diff touching quoting, scoring, or swap building.

**Slippage / bounds**
- [ ] Any new bound derives from `MAX_SLIPPAGE_BPS = 500n` (quoteService.mjs:11) and is enforced
      server-side, both at parse (handler.mjs:255) and scoring — never client-only.
- [ ] minOut is enforced on the MEASURED receipt at settlement (router `_payReceived`,
      DogeSwapRouter.sol:363-373 — handles fee-on-transfer), not on venue return values. Per-leg
      minOut inside router programs stays 0; only the aggregate settlement floor protects the user
      — do not "helpfully" add per-leg floors (they break CONTRACT_BALANCE dust consumption).
- [ ] Refresh paths clamp to user-accepted bounds and fail closed on worse prices
      (clampRefreshedSwapQuote, handler.mjs:349-381). A refresh must never widen `minAmountOut` /
      `maxAmountIn`.
- [ ] exactOutput bounds: `minimumOutput = amountOut` (fixed), slippage applies to
      `maximumInput` (quoteService.mjs:47-57).

**Price impact**
- [ ] V2: impact = shortfall vs zero-fee mid `amountIn·reserveOut/reserveIn` in bps
      (adapters/v2.mjs:36-40). CL: vs `sqrtPriceX96` Q192 spot (adapters/concentratedLiquidity.mjs:30-42).
      **Known issue:** both compare a post-LP-fee amount to a fee-free mid, so displayed impact is
      overstated by ~feeBps (20-25bps here). Any change consuming priceImpactBps (routability
      probes use it via round-trip recovery, UI displays it) must account for this; a fix must
      update BOTH adapters symmetrically and the routability threshold
      (`MIN_ROUND_TRIP_BPS 6000`, discovery/routability.mjs).
- [ ] Never compute CL impact from reserves — CL pools don't have meaningful reserve ratios; only
      sqrtPriceX96.

**Effective price / scoring**
- [ ] Scoring must stay gas-inclusive: a diff that compares candidates on raw amountOut regresses
      the venue-gas tiebreak (135k/165k/180k differ by venue). Use `score.netOutput` /
      `score.totalInput`.
- [ ] Fee scoring rates must stay unit-correct: `outputWeiPerFeeWei` / `inputWeiPerFeeWei` may be
      rational objects, and live mode derives them from WDOGE→token quotes. If that derivation
      fails it returns `0n`, so the route falls back to raw amount comparison plus the gasUnits
      tie-break; do not reintroduce the old hardcoded `1n` native-wei→token-wei assumption.
- [ ] Split acceptance must keep the `minImprovementBps` floor mode-aware (1bp "all" / 5bp
      otherwise, live.mjs:288-293) — in "all" mode single-venue swaps already pay router overhead,
      so demanding 5bps there suppresses genuinely better splits.
- [ ] Data/finality fee must track the REAL execution shape: router-wrapped exactInput = 1-leg
      program bytes, split = ONE combined program, exactOutput/direct = venue bytes
      (swapPayloadForFee, l1GasPriceOracle.mjs:83-95). Adding a command to programs? Re-measure
      the 388/256 byte constants against `buildDogeSwapSplitCalldata` output.

**Staleness / re-quote / transient handling**
- [ ] Never convert a thrown venue failure into a bare `[]` without an `onSourceError` report
      carrying a `transient` classification — that recreates the pre-c32bc98 false-"no route" bug.
- [ ] New venue-level awaits go INSIDE `runSourceQuote`'s task so they're budgeted; keep per-venue
      timeout (3s) strictly below the provider budget (4s) so timeouts attribute to the venue.
- [ ] New error messages: check them against the `isTransientError` regex order
      (sourceQuoteRunner.mjs:51) — a transport error whose message contains
      "invalid"/"decode"/"exceeds" will be misclassified as genuine.
- [ ] Anything consuming candidates must respect `ttlMs` (default 5s) and preserve
      min-over-legs ttl/timestamp composition for split/one-hop (splitRoutes.mjs:110-111).
- [ ] /swap must re-quote (or split-refresh with EXACT locked legs) before building — never build
      from a client-supplied quote body without the refresh + clamp path.
- [ ] Revert handling: "execution reverted" from a quoter is a GENUINE no-route for that
      pair/venue (deterministic), not retryable — don't add retries around it.

## 5. Known sharp edges (fast recall)

- Live router is pre-hardening + EOA-owned (REDEPLOY-RUNBOOK.md) — don't build features assuming
  H1-H11 behavior on-chain until cutover.
- `Promise.race` timeouts don't abort losing tasks (no AbortController) — orphaned RPC batches
  stack under sustained spikes (sourceQuoteRunner.mjs:87-92, composite.mjs:40-45).
- /quote catch-all maps every thrown error to HTTP 400 "invalid-quote-request" with the raw
  message (handler.mjs:879-881) — transient infra faults look like client errors and can leak RPC
  details.
- `DOGESWAP_ROUTER_ADDRESS`/`_MODE` are read once at module load into the frozen SOURCES array
  (registry.mjs:21,536-537) — env changes need a process restart.
- Algebra fee fallback assumes `globalState` word 2 is the fee — Algebra versions move this field;
  wrong fee corrupts feeTier-derived router calldata (`legSummary feeBps·100`,
  dogeSwapRouterCalldata.mjs:215).
- MuchFi V3 venue calldata has NO deadline field — deadline enforcement for V3 direct swaps only
  exists when execution goes through the DogeSwapRouter.
