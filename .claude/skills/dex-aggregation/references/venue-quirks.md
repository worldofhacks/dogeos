# Venue quirks — quick reference

Per-venue gotchas for DogeSwap's DogeOS Chikyū testnet venues (chain 6281971). Registry of record:
`packages/aggregator/src/sources/registry.mjs` (SOURCES, lines 66-564). Quoter shapes and the
MuchFi V2 fee were empirically verified on-chain 2026-06-12 via `scripts/verify-quoter-shapes.mjs`
— re-run that script whenever a venue starts under-delivering or reverting on minAmountOut.

## Address table

| Venue | protocolType | Factory | Router | Quoter | Pinned pools |
|---|---|---|---|---|---|
| MuchFi V2 (`muchfi-v2`) | `v2` | `0x7864071B532894216e3C045a74814EafEB92ae20` | `0xC653e745FC613a03D156DACB924AE8e9148B18dc` | none (local math) | WDOGE/USDC `0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4`, WDOGE/USDT `0x1498200A5D49081D8E55250aFeb13aAf3c1d9AE4` |
| MuchFi V3 (`muchfi-v3`) | `v3` | `0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B` | `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB` | `0x5DE1Ea595653419f295511DEb781b98387a77cc2` | WDOGE/USDC tier 500 `0x4F1c638952a23DB25a13167B83810201c4BC7299`, tier 2500 `0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC`; WDOGE/USDT tier 500 `0x64A2683ae2995E1ca89FECA0c9ffc9056EF0504F` |
| Barkswap (`barkswap-algebra`) | `algebra` | `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | `0x77147f436cE9739D2A54Ffe428DBe02b90c0205e` | `0xcEF56157baaB2Fe9D16ccF0eB4a9Df354380257D` | WDOGE/USDC `0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1`, WDOGE/USDT `0x5DC3eB0e452f464e134F854EAeDf9431B93Da624` |
| DogeSwap Split (`dogeswap-split`) | `aggregator` | — | `DOGESWAP_ROUTER_ADDRESS` env (live: `0xa3158549f38400F355aDf20C92DA1769620Aa35A`) | — | — |
| SuchSwap / DogeBox | v3 / v2 | listed | null | null | WATCHLIST — never quoted or executed |

Key tokens: WDOGE `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE`, USDC
`0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925`, USDT `0xC81800b77D91391Ef03d7868cB81204E753093a9`.
Permit2 (canonical, live on DogeOS since 2026-06-12): `0x000000000022D473030F116dDEE9F6B43aC78BA3`.
L1 gas oracle predeploy: `0x5300000000000000000000000000000000000002` (`getL1Fee` `0x49948e0e`).

## Quoting selectors and return shapes

| What | Selector | Return / decode | Code |
|---|---|---|---|
| V2 `getPair(a,b)` (discovery) | `0xe6a43905` | address word | `discovery/v2Pools.mjs:69-84`, `discovery/poolScan.mjs:13` |
| V2 pool `getReserves()` | `0x0902f1ac` | (reserve0, reserve1, ts) | `discovery/v2Pools.mjs:86-96` |
| V3 `getPool(a,b,fee)` (discovery) | `0x1698ee82` | address; probed over tiers `[100,500,2500,3000,10000]` | `discovery/poolScan.mjs:14,23` |
| Algebra `poolByPair(a,b)` (discovery) | `0xd9a641e1` | address | `discovery/poolScan.mjs:15` |
| pool `token0()` / `token1()` | `0x0dfe1681` / `0xd21220a7` | address | `discovery/concentratedLiquidityPools.mjs:7-8` |
| CL pool `liquidity()` | `0x1a686502` | uint | line 9 |
| V3 pool `slot0()` | `0x3850c7bd` | word 0 = sqrtPriceX96 | lines 10, 95 |
| Algebra pool `globalState()` | `0xe76c01e4` | word 0 = sqrtPriceX96, **word 2 = dynamic fee** | lines 11, 95-96 |
| V3 `quoteExactInputSingle(struct)` | `0xc6a5026a` | word 0 = amountOut, **word 3 = gasEstimate** | lines 12, 170-175 |
| V3 `quoteExactOutputSingle(struct)` | `0xbd21704a` | word 0 = amountIn, word 3 = gas | lines 13, 170 |
| Algebra `quoteExactInputSingle(struct)` | `0xe94764c4` | 6 words, see below | lines 14, 108-110 |
| Algebra `quoteExactOutputSingle(struct)` | `0x62086e24` | 6 words, see below | lines 15, 112-114 |

### The Algebra 6-word trap (verified on-chain 2026-06-12)

Barkswap's Algebra QuoterV2 returns `(amountOut, amountIn, sqrtPriceX96After,
initializedTicksCrossed, gasEstimate, fee)` **for BOTH directions**
(`discovery/concentratedLiquidityPools.mjs:217-228`):

- exactInput → real output is word 0. Fine.
- **exactOutput → word 0 merely ECHOES the requested amountOut; the real required input is
  word 1.** Decoding word 0 for exact-output silently quotes amountIn = amountOut.
- gasUnits = word 4; fee = word 5 with fallback to `globalState` word 2 when the quoted fee is 0
  (lines 214-215). Caution: other Algebra versions move the fee field in globalState — a layout
  change silently corrupts feeBps AND the feeTier-derived router calldata
  (`legSummary` `feeBps·100`, `swap/dogeSwapRouterCalldata.mjs:215`).
- Algebra quoter struct arg order differs from V3: `(tokenIn, tokenOut, deployer, amount,
  limitSqrtPrice)` — the extra `deployer` is `quoterPoolDeployer`, which for Barkswap is the
  **zero-address sentinel** (registry.mjs:312). Do not "fix" it to the real poolDeployer
  `0xeb4E9b84990C7c07D5205D35647A29de1B33dE7e`; the quoter expects the sentinel.

## Fee and gas facts

| Venue | LP fee | How obtained | gasUnits |
|---|---|---|---|
| MuchFi V2 | **20 bps — NOT the canonical 30** | `source.feeBps` (registry.mjs:80); measured 2026-06-12 vs the router's `getAmountsOut`. Provider default if unset is 30n (`v2Pools.mjs:209`) | fixed `135_000n` (`v2Pools.mjs:159`) |
| MuchFi V3 | feeTier/100 (500→5bps, 2500→25bps) | pinned pool feeTier (`concentratedLiquidityPools.mjs:72-74`) | quoter word 3; fallback `165_000n` (`quotes/providers/concentratedLiquidity.mjs:13`) |
| Barkswap Algebra | dynamic | quoter word 5 → globalState word 2 fallback | quoter word 4; fallback `180_000n` (line 14) |
| DogeSwap Split | n/a (protocol fee 0) | — | Σ legs + `90_000n` router overhead (`routes/splitRoutes.mjs:54`) |

If MuchFi V2 changes its fee, quotes will systematically over/under-deliver and minAmountOut
reverts appear — the standing instruction (registry.mjs:76-79) is to re-run
`scripts/verify-quoter-shapes.mjs` and update `feeBps`.

## Execution calldata quirks

| Venue | exactInput | exactOutput | Quirks |
|---|---|---|---|
| MuchFi V2 | `swapExactTokensForTokens` `0x38ed1739` | `swapTokensForExactTokens` `0x8803dbee` | path array; explicit deadline param |
| MuchFi V3 | `exactInputSingle` `0x04e45aaf` | `exactOutputSingle` `0x5023b4df` | **struct has NO deadline field** (SwapRouter02-style) — direct V3 swaps have no deadline unless routed through DogeSwapRouter |
| Barkswap Algebra | `exactInputSingle` `0x1679c792` | `exactOutputSingle` `0x1764babc` | struct includes `deployer` AND an in-struct deadline |
| DogeSwapRouter | `execute(bytes,bytes[],(address,uint256,address),uint256)` `0xe56964c6` | not supported (exact-input only) | command bytes 0x00-0x06; last-leg amountIn = CONTRACT_BALANCE (2^256−1); per-leg minOut 0, aggregate minOut in settlement |

All encoders are hand-rolled and byte-exact (`swap/venueCalldataBuilders.mjs`,
`swap/dogeSwapRouterCalldata.mjs`), verified against `cast calldata` fixtures in
`packages/aggregator/test/dogeSwapRouterCalldata.test.mjs` and `venueCalldataBuilders.test.mjs`.
The calldata registry (`swap/calldataRegistry.mjs:89-112`) refuses to build unless the source is
ACTIVE, the ABI provenance is `adapter-fragment|blockscout|venue-artifact`, the quote's router
matches the registry (or venueRouter + verified split router for `executionMode:
"dogeswap-router"`), and the built bytes start with the registered selector.

## Data/finality payload bytes (for the L1 fee oracle)

`fees/l1GasPriceOracle.mjs:8-21` — direct venue calldata: v2 260B, v3 228B, algebra 260B; router
program: `388 + 256·legCount` bytes (measured: 1-leg 644B, 2-leg 900B, WITHOUT the optional
Permit2 permit command). If you add/remove commands in `buildDogeSwapSplitCalldata`, re-measure
and update these constants, or every quote's data/finality fee drifts.

## Behavioral gotchas checklist

- **[] means no-route, never slow-RPC.** All venue tasks must run inside `runSourceQuote`
  (`quotes/sourceQuoteRunner.mjs`) with a transient-classified `onSourceError`. Per-venue budget
  3s < provider budget 4s — keep that ordering.
- V2 exactOutput math adds `+1n` (round-up) and guards `amountOut >= reserveOut`
  (`quotes/adapters/v2.mjs:25-34`).
- V2 exactOutput does a fee-free preview quote first purely to size the data/finality fee, then
  re-quotes with the real fee (`v2Pools.mjs:212-247`) — don't let the preview leak into candidates.
- CL adapters hard-assert quoter provenance (`quotes/adapters/concentratedLiquidity.mjs:9-13`) and
  the provider gates on `quoter` existing + `quoterAbiProvenance !== "none"`
  (`concentratedLiquidityPools.mjs:256`). A venue without a verified quoter never CL-quotes.
- CL exactInput candidates carry NO `quoteMode` field (adapter omits it; v2 sets it) — consumers
  default missing→"exactInput"; don't write strict `quoteMode === "exactInput"` checks.
- Price impact overstates by ~feeBps on ALL venues (compares post-fee amount to fee-free mid) —
  v2 adapter lines 36-40, CL adapter lines 38-42.
- Multiple CL pools for one pair are quoted in parallel; best = highest amountOut / lowest
  amountIn, tiebreak gas then address (`concentratedLiquidityPools.mjs:304-319`). Per-pool
  failures are tolerated; if ALL pools fail the first error is rethrown (296-302).
- `batchCall` falls back to sequential `client.call` when the RPC frontend rejects JSON-RPC
  batches (`concentratedLiquidityPools.mjs:60-70`) — 5 calls per pool per quote.
- Sources without a factory are pinned-pairs-only; sources with a factory accept any pasted pair
  and let live discovery decide (`sources/sourceFilters.mjs:12-35`).
- The live DogeSwapRouter `0xa315…Aa35A` is the immutable pre-hardening build (see
  `packages/contracts/audit/REDEPLOY-RUNBOOK.md`); the in-repo hardened source ≠ deployed
  bytecode. Behavior differences matter for anything that reasons about on-chain settlement.
