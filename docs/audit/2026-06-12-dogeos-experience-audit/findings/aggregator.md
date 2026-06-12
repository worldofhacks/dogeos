# Aggregator / Trading Correctness — DogeSwap on DogeOS Chikyū Testnet

Audit date: 2026-06-12
Auditor role: Senior DogeOS protocol engineer
Chain: DogeOS Chikyū Testnet, chainId 6281971
Live router: DogeSwapRouter `0xa3158549f38400F355aDf20C92DA1769620Aa35A`

## Overall assessment

The aggregator's trading core is, on the whole, carefully built and well tested.
The constant-product (V2) and concentrated-liquidity (V3 / Algebra) quote math is
correct, the MuchFi-V2 20bps fee is handled per-venue (not the canonical 30bps),
the DogeSwapRouter `execute()` calldata is byte-for-byte verified against `cast`
fixtures and the live `execute(bytes,bytes[],(address,uint256,address),uint256)`
selector (`0xe56964c6`, confirmed on-chain), and the CONTRACT_BALANCE last-leg
sentinel semantics match the contract's per-execute ledger `_delta` accounting
exactly. Net-output route scoring genuinely subtracts execution gas and the DogeOS
data/finality fee. Every production `/swap` is simulated (`eth_call` + `estimateGas`)
and balance-preflighted before a transaction is returned. The split + router-execution
path — the newest code — is structurally sound: aggregate minOut enforced on
measured balance delta, per-leg minOut 0, leftover refunds, single-approval Permit2.

The problems I found are mostly correctness-of-display and robustness gaps rather
than fund-loss bugs, because the contract's enforced settlement and the mandatory
pre-build simulation form a strong backstop: a mis-built tx reverts on simulation
and is rejected with HTTP 422 rather than handed to the user. The one finding that
rises above low severity is the fee-to-output-token unit conversion
(`outputWeiPerFeeWei`), which is hardcoded to `1n` in production and silently
mis-scales the displayed net-output / fee-cost whenever the traded pair is not
priced ~1:1 against native DOGE. Two medium items concern fragile assumptions
(V3 feeTier reconstruction; Permit2 nonce reuse on swap retry) that work today but
will break under foreseeable conditions.

## Strengths

- **V2 constant-product math is correct.** `amountOutWithFee` (v2.mjs:19-23) implements
  `amountInAfterFee * reserveOut / (reserveIn * feeDenominator + amountInAfterFee)` —
  the canonical Uniswap-V2 getAmountOut with the fee applied to the input. The
  exact-output inverse `amountInForExactOutput` (v2.mjs:25-34) correctly adds the
  `+ 1n` ceiling so the router never under-funds, and guards `amountOut >= reserveOut`.
- **MuchFi-V2 fee is venue-specific (20bps), not assumed.** registry.mjs:80 sets
  `feeBps: 20n` with a comment that it was cross-checked against the router's own
  `getAmountsOut` on 2026-06-12, and v2Pools.mjs:245 applies `source.feeBps ?? feeBps`
  so the per-venue fee wins over the 30bps default. This is exactly right and avoids
  systematic under-delivery on minAmountOut.
- **DogeSwapRouter calldata is verified byte-for-byte.** dogeSwapRouterCalldata.test.mjs
  pins `encodeDogeSwapRouterExecute`, `encodePermit2PermitInput`, `encodeV2/V3/AlgebraSwapInput`
  against `cast calldata` / `cast abi-encode` fixtures; all 29 tests pass. The
  `execute` selector and all three venue selectors match `cast sig` and the live
  registry.
- **CONTRACT_BALANCE last-leg semantics match the contract.** The builder
  (dogeSwapRouterCalldata.mjs:266-280) pulls the full input once via PERMIT2_TRANSFER_FROM,
  spends explicit amounts on non-last legs, and uses `CONTRACT_BALANCE` (type(uint256).max)
  on the last leg. The contract's `_spend` (DogeSwapRouter.sol:237-242) resolves
  CONTRACT_BALANCE to the per-execute ledger `_delta`, so no rounding dust is stranded,
  and explicit amounts are bounded by the measured delta — pre-existing balances are
  unspendable. The builder also rejects overspend before reaching the chain
  (`Split legs overspend the total input`, line 274).
- **Aggregate-only settlement is the right slippage model.** Per-leg minOut is 0;
  the contract enforces `out >= s.minOut` on the measured buyToken delta after the
  command loop (DogeSwapRouter.sol:289-293) and refunds leftover input deltas. This
  is robust against per-leg sandwiching as long as the aggregate floor is correctly
  derived — and it is (see clamp logic below).
- **Net-output scoring subtracts real costs.** `scoreQuote` (dogeosFeeEstimator.mjs:10-33)
  computes `netOutput = amountOut - (gasUnits*gasPrice + dataFinalityFee)*outputWeiPerFeeWei - failurePenalty`,
  and the split candidate adds a 90k router-overhead gas constant
  (splitRoutes.mjs:54,88-89) so the extra router cost is reflected in ranking. Splits
  are only surfaced when they beat the best single venue by `minImprovementBps`
  (splitRoutes.mjs:264-266).
- **Mandatory pre-return simulation + balance preflight.** In production
  (live.mjs:329-337) `swapVerifier` is always wired, so every `/swap` runs `eth_call`
  and `estimateGas` (verifySwapTx.mjs:61-63) and a sell-token + native-balance
  preflight (balancePreflight.mjs) before returning a tx. A tx that would revert
  on-chain is caught and returned as 422.
- **Refresh clamp fails closed.** `clampRefreshedSwapQuote` (handler.mjs:317-349)
  never weakens the user-accepted bound: it throws if the refreshed output dropped
  below the accepted minOut, and raises the refreshed minOut back up to the accepted
  floor otherwise. The split refresher (splitRoutes.mjs:123-182) deterministically
  re-quotes the locked legs so a `/swap` reliably reproduces the accepted structure.

## Findings

### AGG-1 — `outputWeiPerFeeWei`/`inputWeiPerFeeWei` hardcoded to 1n mis-scales fee/net-output for non-DOGE-priced pairs (severity: medium, confidence: high)

Location: `packages/api/src/live.mjs:158-159`, `packages/aggregator/src/fees/dogeosFeeEstimator.mjs:23,48`, `packages/api/src/server.mjs:91-101`

Evidence: The score converts the DogeOS fee (denominated in native-DOGE wei) into
output-token units by multiplying by `outputWeiPerFeeWei`:

```
const feeCostInOutputToken = fee.totalFeeWei * outputWeiPerFeeWei;   // dogeosFeeEstimator.mjs:23
const netOutput = amountOut - feeCostInOutputToken - failurePenalty;
```

`outputWeiPerFeeWei` defaults to `1n` (live.mjs:158) and `server.mjs` passes it
through as `undefined` for the production process, so the live server uses `1n`.
A value of `1` is only correct when 1 wei of native DOGE equals 1 wei of the output
token — i.e. the output token is DOGE/WDOGE itself, or trades exactly 1:1 with DOGE.
All official DogeOS tokens are 18-decimal (verified on-chain: USDC and USDT both
`decimals() = 18`), so there is no decimal mismatch, but the *price* mismatch
remains: for a WDOGE→USDC trade where DOGE is worth far less than 1 USDC (or vice
versa), the fee subtracted from `netOutput` and the `feeEstimate` reported to the
UI are off by the DOGE/USDC price ratio.

Impact: Mis-stated `netOutput`, `feeCostInOutputToken`, and `feeEstimate` in the
quote response. Because the same (wrong) scale is applied to every candidate, route
*ranking* between same-output-token candidates is largely preserved, so this is not
a "picks the wrong route" bug in the common case — but exact-output scoring uses
`inputWeiPerFeeWei` (defaults to the same value) and any future cross-pair or
mixed-decimal token would make both the displayed economics and the netOutput
comparison wrong. It also undermines the competitive claim that scoring nets out
the DogeOS data/finality fee "in output-token terms."

Recommendation: Wire a real DOGE↔token price (even a coarse pool mid-price from the
already-fetched reserves/sqrtPrice) into `outputWeiPerFeeWei`/`inputWeiPerFeeWei`,
or explicitly document that fee netting is approximate and denominated in DOGE-wei.
At minimum, set these per-request from the quoted pool price rather than a global `1n`.

### AGG-2 — V3/Algebra split-leg feeTier reconstructed as `feeBps * 100` is fragile and silently wrong for non-×100 tiers (severity: medium, confidence: high)

Location: `packages/aggregator/src/swap/dogeSwapRouterCalldata.mjs:215`, `packages/aggregator/src/swap/venueCalldataBuilders.mjs:74`, `packages/aggregator/src/discovery/concentratedLiquidityPools.mjs:71-72,171`

Evidence: The concentrated-liquidity adapter stores the pool fee as `feeBps =
feeTier / 100` (concentratedLiquidityPools.mjs:71-72), and the V3 quote object never
carries a raw `feeTier`. The split leg summary only includes `feeTier` when
`quote.feeTier !== undefined` (splitRoutes.mjs:42, legSummary lines 79), which it is
not for live V3 quotes. So `legSwapCommand` reconstructs it:

```
feeTier: leg.feeTier ?? BigInt(leg.feeBps) * 100n,   // dogeSwapRouterCalldata.mjs:215
```

and `feeTierFor` does the same for direct venue calldata (venueCalldataBuilders.mjs:74).
This round-trips correctly only for fee tiers that are exact multiples of 100. The
configured tiers (500, 2500, 3000, 10000) all are, so it works today. But `feeBps`
is integer-divided, so a pool with feeTier 250 (2.5bps) → `feeBps = 2` →
reconstructed `feeTier = 200`, selecting the *wrong pool* fee — the V3 router would
route through a non-existent or different-fee pool and revert (caught by simulation)
or, worse, silently hit a different pool.

Impact: A V3/Algebra venue (existing or future) with a fee tier not divisible by 100
produces calldata pointing at the wrong fee tier. Best case: simulation reverts and
`/swap` 422s. Worst case (if such a pool exists at the rounded tier): execution
through an unintended pool at a different price. The information needed to do it
correctly (the exact `feeTier`) is available at quote time and is being thrown away.

Recommendation: Carry the exact `feeTier` from the pool through the quote and the leg
summary (it is already known in `quotePool`), and use it directly in the calldata
builder instead of reconstructing from `feeBps`. Keep `feeBps * 100` only as a last-
resort fallback.

### AGG-3 — Permit2 in-tx permit reuses a stale nonce on swap retry, causing the second attempt to revert (severity: medium, confidence: medium)

Location: `packages/aggregator/src/swap/permit2Approval.mjs:142-225`, `packages/api/src/handler.mjs:299-309,720-735`, `apps/web/src/lib/execute.js:441-461`

Evidence: `/approval` reads the Permit2 nonce once (permit2Approval.mjs:163-165) and
builds a `PermitSingle` typed-data payload pinned to that nonce. The client signs it
and attaches `permit2Permit` to the quote. On `/swap`, the signed permit is carried
through unchanged (`quoteWithSwapExecutionFields`, handler.mjs:299-309) and embedded
as the PERMIT2_PERMIT command. Permit2's `permit()` consumes (increments) the nonce
on success. If the swap reverts for any reason after the permit succeeds — e.g. the
aggregate `MinOutNotMet` floor (a likely event on a marginal split) — and the user
clicks swap again, the frontend re-runs the flow but `obtainPermit2Authorization` is
only invoked when `approval.permit?.required` (execute.js:441); on a retry where the
ERC20→Permit2 max approval already exists and the previous permit was consumed,
`/approval` recomputes `permitRequired` from the *new* on-chain nonce/expiration —
which usually re-prompts a fresh signature, so this is partially self-healing. The
hazard is the in-flight retry path: a quote object that still carries the *old*
`permit2Permit` (merged via `mergeExecutionQuote`, execute.js:312-322) would rebuild
the same nonce and revert at `_permit2Permit`.

Impact: A retried swap can revert with an opaque Permit2 error (mapped by the UI to
the generic "approval is missing or insufficient" copy, execute.js:123) even though
the user already approved. Confusing UX; no fund loss (the tx reverts atomically).

Recommendation: On `/swap`, do not blindly forward `permit2Permit`; re-check the
live Permit2 allowance/nonce/expiration and drop the attached permit (forcing a
fresh sign) if it is stale or already satisfied. Alternatively, have the frontend
clear `quote.permit2Permit` after any failed swap attempt before retrying.

### AGG-4 — No fee-on-transfer / rebasing-token handling in V2 quote math (severity: low, confidence: high)

Location: `packages/aggregator/src/quotes/adapters/v2.mjs:19-34`, no FoT references anywhere in `packages/aggregator/src` or `packages/contracts/src`

Evidence: A repository-wide grep for `fee.?on.?transfer|FoT|supportingFee|skim|rebasing|transfer.?fee`
returns nothing. The V2 math assumes the amount sent equals the amount the pool
receives. The contract's direct V2 venue path uses `swapExactTokensForTokens`
(venueCalldataBuilders.mjs:98), the non-"SupportingFeeOnTransferTokens" variant,
which reverts if the post-transfer balance is short.

Impact: For a fee-on-transfer or rebasing sell token, the V2 quote over-promises
output and the direct-venue swap would revert (caught by simulation → 422) or, on
the router path, under-deliver but still pass the aggregate minOut only if slippage
absorbs it. All six official DogeOS tokens are standard ERC20s, so this is currently
inert; it is a latent correctness gap if a non-standard token is ever listed.

Recommendation: Either document that only standard ERC20s are supported, or detect
FoT (balance-delta check during pool discovery) and exclude such tokens from V2
constant-product quoting.

### AGG-5 — One-hop (via-WDOGE) candidates are preview-only and can never execute (severity: low, confidence: high)

Location: `packages/aggregator/src/routes/oneHop.mjs:44`, `packages/aggregator/src/routes/direct.mjs:3-6`

Evidence: Composed one-hop candidates are emitted with `status: "readOnly"`
(oneHop.mjs:44). `chooseBestDirectRoute` rejects any candidate whose `status !==
"active"` (direct.mjs:4, `rejectionReason`), so one-hop is always filtered out of
`best`/`alternatives` and surfaced only under `rejected` as a preview. There is no
multi-hop command in the DogeSwapRouter (Commands.sol has only single token→token
swap commands) and the split calldata builder does not chain legs, so even if a
one-hop route were marked active it could not be built into a valid tx.

Impact: Users on a pair with no direct pool but a viable USDC→WDOGE→USDT route see a
"read-only" preview they cannot execute. This is a missing feature, not a wrong
result — it can never produce a bad transaction. But the second leg's quote re-uses
`firstLeg.amountOut` as exact input (oneHop.mjs:100) without modeling that the
intermediate WDOGE must actually be received, so the preview output is optimistic.

Recommendation: Either implement multi-hop execution (a chained-leg program where
the second swap consumes the first's output via CONTRACT_BALANCE, settling the final
token) or clearly label one-hop quotes as non-executable estimates in the UI.

### AGG-6 — Client-controlled deadline has no server-side floor; relies entirely on simulation to reject past deadlines (severity: low, confidence: high)

Location: `packages/aggregator/src/swap/buildSwapTx.mjs:71-81`, `packages/aggregator/src/swap/dogeSwapRouterCalldata.mjs:192`, `apps/web/src/lib/execute.js:298-310`

Evidence: `deadline` is supplied by the client (`bindExecutionQuote`, execute.js:308:
`Math.floor(Date.now()/1000) + ttl`) and passed straight through `buildSwapTx`
(which does not inspect it) into the calldata builder, which only enforces
`deadline > 0` (`positiveUint`, dogeSwapRouterCalldata.mjs:192). There is no check
that `deadline > nowSeconds` server-side. The on-chain `execute` reverts
`DeadlineExpired` if `block.timestamp > deadline` (DogeSwapRouter.sol:165), and the
mandatory `eth_call` simulation would catch a past deadline before returning a tx.

Impact: A malformed/past deadline produces a tx that the simulation rejects (422)
rather than one that is signed and wasted on-chain — so this is fail-safe. The risk
is only if simulation is ever disabled (handler.mjs:767 returns the tx with no
verification when `swapVerifier` is unset; not the production config). Worth a
defense-in-depth floor regardless.

Recommendation: Validate `deadline >= nowSeconds + smallMargin` in `buildSwapTx` (or
the handler) and reject with a clear re-quote message, independent of simulation.

### AGG-7 — Split optimizer cannot split across two pools of the same venue (e.g. MuchFi V3 500 vs 2500) (severity: info, confidence: high)

Location: `packages/aggregator/src/routes/splitRoutes.mjs:57-69,205-208`, `packages/aggregator/src/discovery/concentratedLiquidityPools.mjs:291-306`

Evidence: `activeBestBySource` keys by `sourceId` and keeps only the single best
candidate per source (splitRoutes.mjs:57-68); the split then takes the top two
*distinct sources* (`[venueA, venueB]`, line 208). The concentrated-liquidity
provider already collapses a venue's multiple pools to one best pool
(concentratedLiquidityPools.mjs:291-306). So a split that would optimally route part
through MuchFi-V3's 500-tier pool and part through its 2500-tier pool is impossible —
splits only span different venue identities.

Impact: Missed best-execution on pairs where the deepest liquidity is spread across
fee tiers of one venue. Pure optimization opportunity; no incorrectness.

Recommendation: Key the split optimizer on (sourceId, poolAddress/feeTier) so legs
can target distinct pools of the same venue, then dedupe at the command level.

### AGG-8 — Router gas estimate for wrapped/split legs uses the venue's direct-call gas, not the router-wrapped gas (severity: info, confidence: medium)

Location: `packages/aggregator/src/routes/splitRoutes.mjs:54,88-89`, `packages/aggregator/src/routes/splitRoutes.mjs:34-48` (wrap)

Evidence: A split sums each leg's `gasUnits` (the venue quoter's gasEstimate for a
*direct* swap) plus a flat `ROUTER_OVERHEAD_GAS_UNITS = 90_000n`. The router path
adds per-leg overhead (Permit2 transferFrom, forceApprove, ledger touches, the
external call through the router) that a single 90k constant approximates rather than
models per-leg. This only affects scoring/display, not the actual gas the wallet
uses (the returned tx carries the buffered `estimateGas` result from
verifySwapTx.mjs:77, which is the true wrapped gas).

Impact: The quote-time `feeEstimate`/`netOutput` for splits is approximate; the
executed gas limit is correct (real `estimateGas`). Minor ranking imprecision for
splits vs single-venue.

Recommendation: Either derive the overhead empirically (one `estimateGas` of the
candidate program) or document that the split gas figure is an estimate refined at
build time.

## Notes verified as correct (not findings)

- `execute(bytes,bytes[],(address,uint256,address),uint256)` selector `0xe56964c6`
  matches `cast sig`, the registry (registry.mjs:22), and the live router.
- V2 / V3 / Algebra venue selectors (`0x38ed1739`, `0x04e45aaf`, `0x1679c792`) match
  `cast sig` and the live router constants from the ground-truth probe.
- The split `minAmountOut` reaches the calldata builder correctly:
  `withExecutionBounds` sets `minAmountOut` for exactInput (quoteService.mjs:52-57),
  the refresher sets `minimumOutput`/`minAmountOut` (splitRoutes.mjs:175-180), and
  `buildDogeSwapSplitCalldata` reads `quote.minAmountOut ?? quote.minimumOutput`
  (dogeSwapRouterCalldata.mjs:243).
- The clamp logic (handler.mjs:317-349) cannot weaken the accepted bound; it only
  tightens minOut or throws.
- Permit2 EIP-712 domain is `(name, chainId, verifyingContract)` with no version
  field (permit2Approval.mjs:91-127), which matches canonical Permit2, and the
  encoded PermitSingle is byte-verified against `cast abi-encode`.
- USDC/USDT are 18-decimal on this testnet (verified on-chain), so there is no
  6-vs-18 decimal hazard in the current token set.
