# Gap: V3 / Algebra Quote Accuracy + DogeSwapRouter Routing Fraction

Closes the coverage gap left after V2 was live-verified. All reads below were run
2026-06-12 against DogeOS Chikyū Testnet (chainId `6281971`,
RPC `https://rpc.testnet.dogeos.com`) with `cast 1.7.1` and by driving the
actual aggregator provider code (`packages/dogeos-rpc` + `packages/aggregator`).

## TL;DR

- **V3 and Algebra adapter math matches the on-chain quoters to the wei.** The
  adapters do not recompute output — they pass the quoter's returned amount
  through verbatim, and the request encoding is byte-for-byte identical to
  `cast calldata`. Confirmed on both official-token pairs (WDOGE/USDC and the
  USDT pair) for V3 (MuchFi) and Algebra (Barkswap).
- **In production, ~100% of UI swaps route THROUGH the first-party
  DogeSwapRouter.** Router mode defaults to `"all"` and the shipped frontend is
  exactInput-only, so every single-venue and split swap is wrapped to
  `executionMode: "dogeswap-router"`. The audited contract is therefore NOT
  bypassed on the UI path.
- **The only direct-to-venue (router-bypass) surface is `exactOutput`**, which
  the shipped `apps/web/dist` bundle never requests — it is reachable only via
  direct API calls.
- **Governance caveat (overlaps contracts.md):** the router that 100% of swaps
  now flow through is owned/guarded by a plain EOA, not the Timelock+Safe the
  docs describe. Concentrating all flow through it raises the blast radius of
  that single-key `pause()`/`feeBps`/cap authority.

---

## 1. V3 quote accuracy — wei-exact

Adapter path: `discovery/concentratedLiquidityPools.mjs` builds the quoter
calldata (`encodeV3QuoteExactInputSingle`, selector `0xc6a5026a`), reads
`decodeWord(result, 0)` as `quotedAmountOut`, and
`quotes/adapters/concentratedLiquidity.mjs:86` returns that value unchanged as
`amountOut`. So adapter accuracy == quoter accuracy, provided encoding/decoding
is correct.

**Encoding is byte-identical to cast.** `encodeV3QuoteExactInputSingle` lays out
the QuoterV2 tuple as `(tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96)`,
which matches `MUCHFI_V3_QUOTER_ABI` (`abi/adapterAbiArtifacts.mjs:129`) and
`cast sig "quoteExactInputSingle((address,address,uint256,uint24,uint160))"`
= `0xc6a5026a`. The generated calldata for WDOGE→USDC 1e18 fee=500 equals
`cast calldata` exactly (MATCH: true).

**Live diff (MuchFi V3 quoter `0x5DE1Ea595653419f295511DEb781b98387a77cc2`):**

| Pair / amountIn | fee | cast raw word0 | aggregator `amountOut` |
|---|---|---|---|
| WDOGE→USDC 1e18 | 2500 | `727996393482786715` | `727996393482786715` |
| WDOGE→USDC 100e18 | 500 | `8939637900389285282` | `8939637900389285282` |
| USDT-pair 1e18 | 500 | `2933270132583820796` | `2933270132583820796` |

The provider also correctly picks the higher-output pool across fee tiers
(for WDOGE/USDC 1e18 it chose the 2500-fee pool `0xBeD5…6ecC` at
`727996…` over the 500-fee pool `0x4F1c…7299` at `719123987777600919`).
`gasUnits` comes from quoter word 3 (`gasEstimate`) and `feeBps =
feeTier/100` — both match.

## 2. Algebra quote accuracy — wei-exact

Adapter path: `encodeAlgebraQuoteExactInputSingle`, selector `0xe94764c4`
= `cast sig "quoteExactInputSingle((address,address,address,uint256,uint160))"`.
The quoter returns the full 6-word tuple `(amountOut, amountIn,
sqrtPriceX96After, ticksCrossed, gasEstimate, fee)`; the provider reads word 0
as `quotedAmountOut`, word 4 as `gasUnits`, word 5 as the dynamic fee — the
shapes documented at `concentratedLiquidityPools.mjs:217` and
`adapterAbiArtifacts.mjs:246` are correct.

**Live diff (Barkswap Algebra quoter `0xcEF56157baaB2Fe9D16ccF0eB4a9Df354380257D`,
deployer = zero sentinel):**

| Pair / amountIn | cast word0 (out) | word5 (fee) | aggregator `amountOut` / `feeBps` |
|---|---|---|---|
| WDOGE→USDC 1e18 | `844083826350883783` | 500 | `844083826350883783` / 5 |
| WDOGE→USDC 100e18 | `66019594441959923636` | 500 | `66019594441959923636` / 5 |
| USDT-pair 1e18 | `3222517115616186779` | 500 | `3222517115616186779` / 5 |

The exact-output decode (word 1 = real input; word 0 echoes requested amount)
was independently confirmed: in every exact-input call word 1 echoed the input
amount (`1e18`, `100e18`), proving the documented field ordering.

**Conclusion (sections 1–2):** the audited claim "adapter math matches the
on-chain quoter to the wei" holds for both V3 and Algebra, the same standard V2
was held to. No quote-accuracy defect found. The adapters are thin
pass-throughs of trusted quoter output, so accuracy depends only on (a) correct
selector/tuple encoding — verified byte-for-byte — and (b) the quoters being
non-malicious, which is the venue-trust assumption already documented.

Minor: `priceImpactBps` in the adapter is a coarse mid-price-vs-quote estimate
(`adapters/concentratedLiquidity.mjs:38`) using spot `sqrtPriceX96`, not the
quoter's `sqrtPriceX96After`; it is display-only and does not affect `amountOut`
or `minOut`. (On WDOGE/USDC 1e18 V3 it reported piBps≈7102 — plausible on a
micro-liquidity tick — but it is an estimate, not the executed slippage.)

## 3. Routing fraction: through DogeSwapRouter vs direct-to-venue

**Wrapping logic** — `routes/splitRoutes.mjs:22` `wrapQuoteForRouterExecution`
retargets a quote onto the router iff ALL hold:
exactInput, `protocolType ∈ {v2,v3,algebra}`, `status === "active"`, not already
a split / already wrapped, and a `routerAddress` is supplied.

**It is wired in prod.** `packages/api/src/live.mjs:334` sets
`executionQuoteTransform` only when `dogeSwapRouterMode === "all" &&
dogeSwapRouterAddress`. Live prod `.env`:
- `DOGESWAP_ROUTER_ADDRESS=0xa3158549f38400F355aDf20C92DA1769620Aa35A` (set)
- `DOGESWAP_ROUTER_MODE` unset → defaults to `"all"`
  (`live.mjs:158`, `registry.mjs:536`).

The transform is applied at both `/approval` (`handler.mjs:745`) and `/swap`
(`handler.mjs:777`) build time, so the executed transaction is the wrapped one.

**Shipped frontend is exactInput-only.** `apps/web/src/lib/quote.js:130` and
`chartDatafeed.js:104` only send `quoteMode:"exactInput"`; the served bundle
`apps/web/dist/assets/index-B_pz6dv9.js` (build 2026-06-12T20:23) contains
`exactInput` (×2) and zero `exactOutput`. The served tree is confirmed
`apps/web/dist` via `packages/web/src/server.mjs:18-44` (`defaultStaticRoot`),
which is the unit's `ExecStart` target
(`~/.config/systemd/user/dogeswap-prod.service`).

### Fraction

| Path | Routes through audited DogeSwapRouter? |
|---|---|
| Production UI swap (v2/v3/algebra, single-venue) | YES — wrapped to `executionMode: dogeswap-router` |
| Production UI split swap | YES — `dogeswap-split` IS the router program |
| exactOutput swap (API-only; not in shipped UI) | NO — direct-to-venue `exactOutputSingle` calldata |
| Non-v2/v3/algebra protocol | NO (none active today) |

**Effective production fraction through the router: ~100% of UI swaps.** The
audited contract is bypassed only on the `exactOutput` direct-API surface, which
the shipped UI never exercises. This is the opposite of the original concern —
the bypass risk is negligible for real users; the concentration risk is the live
issue (below).

Calldata routing confirmed in code: `swap/venueCalldataBuilders.mjs:141`
`routerExecutionBuilder` is registered for muchfi-v2/-v3/barkswap-algebra and is
selected by `swap/calldataRegistry.mjs:32,62` when
`quote.executionMode === "dogeswap-router"`, building
`execute(...)` via `buildDogeSwapSplitCalldata`. The direct exactOutput builders
(`buildMuchFiV3ExactOutputSingleCalldata`, etc.) target the venue router
directly — these are the only non-router execution paths.

## 4. Router-concentration / governance caveat (live-confirmed)

Because ~100% of flow now goes through `0xa315…Aa35A`, that contract's admin
authority is a single point of control over all DogeSwap execution:

- `owner() == guardian() == 0xE659A8d3745b1355CA47B3d92925997Ef93a2873`, which
  has **empty bytecode** (plain EOA) — NOT the TimelockController+Safe the
  deploy script / DEPLOYMENT.md describe; `acceptOwnership()` to the timelock was
  never completed.
- Live router state: `paused()=false`, `feeBps()=0`,
  `defaultMaxInputPerTx()=1e23`. The EOA can flip `pause()`, raise `feeBps`, or
  tighten caps and instantly affect every swap.

This is not a quote-accuracy bug, but it is the material risk that follows from
the "route everything through the first-party router" decision: the audited
settlement guarantees are real, yet the keys controlling that router are a single
EOA. Cross-reference: `findings/contracts.md` (ownership/timelock) and
`findings/aggregator.md`.

## Evidence index (file:line)

- Adapter pass-through: `packages/aggregator/src/quotes/adapters/concentratedLiquidity.mjs:86`
- V3 encoder/selectors: `packages/aggregator/src/discovery/concentratedLiquidityPools.mjs:100,131-156`
- Algebra encoder + 6-word decode: `…/concentratedLiquidityPools.mjs:108-114,214-233`
- Quoter ABIs / selectors: `packages/aggregator/src/abi/adapterAbiArtifacts.mjs:129,255`; `src/sources/registry.mjs:38-53,161,310`
- Router wrapping: `packages/aggregator/src/routes/splitRoutes.mjs:22-49`
- Wiring + mode default: `packages/api/src/live.mjs:153-158,334-337`; `registry.mjs:536`
- Transform applied at build: `packages/api/src/handler.mjs:745,777`
- Router exec calldata selection: `packages/aggregator/src/swap/venueCalldataBuilders.mjs:141-150`; `swap/calldataRegistry.mjs:32,62-80`
- Served tree / UI exactInput-only: `packages/web/src/server.mjs:18-44`; `apps/web/src/lib/quote.js:130`; `apps/web/dist/assets/index-B_pz6dv9.js`
- Live router state: `cast call` owner/guardian/feeBps/paused/defaultMaxInputPerTx on 2026-06-12
