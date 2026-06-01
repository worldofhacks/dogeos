# DogeOS DEX Aggregator Architecture Plan

Research baseline: 2026-05-30

This document defines the current architecture direction for a DogeOS-native same-chain DEX aggregator. It replaces the previous hybrid routing/liquidity direction with an aggregator-only platform focused on external V2 and V3 liquidity.

## Primary Goal

Build the fastest safe DogeOS swap aggregator across verified external DEX venues.

V1 answers one question:

> Given token A, token B, and amount X on DogeOS, what executable route gives the best net output after price impact, execution gas, DogeOS data/finality fee, route risk, and slippage protection?

## Current Repository Reality

The repository now contains a dependency-light JavaScript aggregator runtime, API server, responsive web surface, DogeOS config package, live source verifier, and adapter verification docs. It still has no DEX contract package, pool factory, liquidity management surface, or deployment path.

## Explicit Non-Goals

- Create or fork liquidity venues.
- Vendor AMM core/periphery contracts.
- Deploy pool factories, position managers, or liquidity pools.
- Build LP pages, pool pages, or liquidity seeding tools.
- Prefer any venue for business reasons.
- Execute through unverified routers or unknown ABIs.

## Routing Stages

### Stage 1: Direct Best Route

Scope:

- Quote MuchFi V2, MuchFi V3, and Barkswap-style pools.
- Compare normalized net output.
- Execute through one verified source.
- Same-chain spot swaps only.
- No split orders.
- No multi-route execution.

Decision model:

```text
quote MuchFi V2
quote MuchFi V3
quote Barkswap
filter by verification and freshness
subtract gas + DogeOS data/finality fee
choose best single route
simulate
build transaction
```

### Stage 2: One-Hop Routing

Add one-hop routes through WDOGE when direct liquidity is weak. The live API enables these priced previews by default through `oneHopEnabled`; current routing returns one-hop as read-only previews only. Execution remains direct-only until a dedicated multi-leg calldata builder, approval plan, simulation path, and wallet flow exist.

Examples:

```text
USDC -> WDOGE -> USDT
USDT -> WDOGE -> USDC
```

The optimizer still chooses one route, not split execution. One-hop candidates reuse the same direct quote provider interface, which keeps the later split-routing model modular without changing venue adapters.

### Stage 3: Selective Split Routing

Add split routing only when it improves net output after extra gas and data/finality fees.

Rules:

1. Split only across certified sources.
2. Cap route complexity.
3. Simulate the full execution path.
4. Show source percentages.
5. Disable quickly if telemetry shows elevated failure or stale quote risk.

### Stage 4: Full Graph Routing

Add after liquidity fragments across enough venues to justify it:

- deeper multi-hop search
- route pruning
- gas-aware graph optimization
- partial-fill strategy
- optional solver/RFQ research

## Non-Negotiable Principles

1. Net executable value wins.
2. Verification enables execution.
3. DogeOS fee behavior is first-class.
4. Token metadata comes from chain and verified registries.
5. UI stays fast and responsive without hiding route risk.
6. Every venue can be disabled independently.
7. No arbitrary calldata execution in V1.

## DogeOS Context

Core network reference lives in [dogeos-chikyu-testnet.md](./dogeos-chikyu-testnet.md).

| Area | Finding | Architecture impact |
| --- | --- | --- |
| Chain ID | `6281971` / `0x5fdaf3`. | Chain config must key every quote, source, token, and transaction. |
| Native token | DOGE with 18 decimals on DogeOS. | UI must distinguish DogeOS DOGE, WDOGE, and Dogecoin L1 DOGE. |
| Fees | Execution fee plus Data and Finality fee. | Route scoring must include both. |
| L1 fee oracle | `0x5300000000000000000000000000000000000002`. | Live quotes query `getL1Fee(bytes)` with protocol-shaped swap payloads for calldata-sensitive data/finality estimates; active `/swap` verification re-queries the same oracle with the exact calldata returned to the wallet. |
| Reorg depth | Up to 17 blocks documented. | Indexer analytics need rollback/finality windows. |
| Official tokens | WDOGE, LBTC, WETH, USD1, USDC, USDT all report 18 decimals in prior validation. | Never assume Ethereum USDC/USDT decimals. |
| Wallet SDK | DogeOS SDK supports wallet modal, embedded login, social login, browser wallets, WalletConnect, and EVM provider calls. | Use DogeOS SDK as primary wallet layer. |
| Explorer | Blockscout is validated. | Use Blockscout for links, verification, and support workflows. |

## System Architecture

```text
                          DogeOS Inputs
          RPC, Blockscout, official docs, faucet tokens, SDK
                                      |
                                      v
                          Chain + Token Registry
                                      |
                                      v
                              Source Registry
                                      |
                      +---------------+---------------+
                      |                               |
                      v                               v
              Verification Service              Pool Discovery
          bytecode, ABI, selectors,          factories, pools,
          Blockscout, partner proof          reserves, ticks
                      |                               |
                      +---------------+---------------+
                                      |
                                      v
                              Quote Adapters
                  V2 reserves, V3 state/quoter, Algebra state
                                      |
                                      v
                              Route Optimizer
          net output, gas, data/finality fee, risk, TTL
                                      |
                                      v
                               Simulation
                      balances, allowances, exact calldata
                                      |
                                      v
                         Swap Transaction Builder
                                      |
                       +--------------+--------------+
                       |                             |
                       v                             v
              Responsive Web App              Public Quote API
```

V1 executes directly through the selected verified venue router. Transaction building returns calldata for the chosen external venue only; the platform does not deploy an aggregator execution router, pathfinding contract, pool factory, or pool creation surface.

## Module Boundaries

| Module | Responsibility |
| --- | --- |
| Chain config | DogeOS chain ID, RPCs, explorer, native token, fee oracle. |
| Token registry | Official tokens, decimals, symbols, bytecode, provenance. |
| Source registry | Venue metadata, protocol type, status, addresses, verification state. |
| Verification service | Shared cached verifier for the CLI and `GET /verification`; confirms router bytecode, selector presence, relationship reads, pinned pool token/state proof, token decimals, Blockscout contract status, Blockscout ABI payloads, target-bound adapter ABI fragments, and venue ABI artifacts before execution. |
| Pool discovery | Finds pools/pairs and captures state by block. |
| Quote adapters | Convert source-specific pool state into quote candidates. |
| Fee estimator | Adds execution gas and DogeOS data/finality fee from static values, injected providers, or the default DogeOS `L1GasPriceOracle` reader. |
| Route optimizer | Picks direct winner and returns alternatives. |
| Swap builder | Produces executable calldata only for fresh verified routes. |
| Swap verifier | Verifies DogeOS chain ID, simulates exact calldata with `eth_call`, and estimates sender-aware gas before wallet signing. |
| UI/API | Presents quotes, warnings, transaction status, and source details. |
| Observability | Measures latency, failures, route quality, stale data, and gas estimate deltas. |

## Source Statuses

| Status | Meaning |
| --- | --- |
| `watchlist` | Discovered but not trusted for quotes. |
| `readOnly` | Safe reads exist; no executable route returned. |
| `simulationOnly` | Transaction path can be simulated but not user-enabled. |
| `active` | Router, ABI provenance, selector evidence, relationship reads, typed builders, runtime simulation, and monitoring checks are enabled. |
| `disabled` | Source is intentionally excluded. |

## Execution Verification

Execution requires all of the following:

1. Router address confirmed.
2. Router bytecode present at latest block.
3. ABI provenance recorded. Current active routers use committed `adapter-fragment` ABI artifacts that are target-bound to the DogeOS router address, selector list, and function signatures. Blockscout-verified ABI/source or a venue-authorized ABI artifact remains the preferred upgrade path.
4. Expected swap selector or typed method exists.
5. Factory/router/quoter relationship reads match the registry, including `factory()`, `WETH()`, `WETH9()`, or `poolDeployer()` where applicable.
6. Factory/pool relationship confirmed, including pinned pool `token0`, `token1`, and state-read checks for `getReserves()`, `slot0()`/`liquidity()`, or `globalState()`/`liquidity()`.
7. Token decimals verified on-chain.
8. Source can be simulated for representative swaps.
9. `/swap` performs sender-aware `eth_call`, `eth_estimateGas`, exact-calldata data/finality fee resolution, and balance preflight before returning a transaction.
10. Source status is `active`.
11. Blockscout links are present for support and transparency.

Recent live checks on 2026-06-01 confirmed DogeOS RPC chain ID `0x5fdaf3`, official token decimals, pinned main-pair pool token/state proofs, and real live quotes from MuchFi V2, MuchFi V3, and Barkswap Algebra. MuchFi V2 router `0xC653e745FC613a03D156DACB924AE8e9148B18dc`, MuchFi V3 router `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB`, MuchFi V3 quoter `0x5DE1Ea595653419f295511DEb781b98387a77cc2`, Barkswap router `0x77147f436cE9739D2A54Ffe428DBe02b90c0205e`, and Barkswap quoter `0xcEF56157baaB2Fe9D16ccF0eB4a9Df354380257D` have bytecode, expected selectors, and matching address-returning relationship reads. They are active executable venues; `/swap` still simulates and estimates gas with the connected sender before wallet signing.

## Performance Strategy

1. Cache static metadata: chain config, token metadata, source verification records.
2. Batch dynamic reads: reserves, slot0/globalState, liquidity, fee tiers, balances, allowances.
3. Run adapters in parallel with strict per-provider timeouts.
4. Cache pool state by block number and invalidate on quote TTL.
5. Prefer direct routes when net outputs are effectively tied.
6. Use calldata-size-aware fee estimates before considering one-hop or split routes.
7. Track p50 and p95 quote latency by source.
8. Degrade gracefully: if one adapter rejects or times out, return available alternatives without blocking the quote path.

## UI Requirements

The frontend should be a real swap surface, not a landing page.

Required states:

- disconnected wallet
- wrong chain
- loading quote
- quote ready
- quote stale
- no route
- source watchlist or disabled
- source unverified
- awaiting signature
- submitted
- included
- confirmed
- failed with reason

Responsive requirements:

- Mobile layout keeps token inputs, quote state, and primary action visible without overlap.
- Desktop layout exposes route alternatives and source verification details.
- Quote refresh never shifts the core form size.
- Buttons and warnings fit their containers at small widths.
- Route details show Blockscout links without overwhelming the swap path.

## API Requirements

### `GET /sources`

Returns source metadata, status, protocol family, verification state, and known pools.

### `GET /tokens`

Returns official and verified token metadata with source provenance.

### `GET /venues`

Returns the operator-facing contract map grouped by source. Each venue includes router, factory, quoter, position-manager, pool-deployer, and known pool addresses where available, expected selectors, relationship-read expectations, pinned pool state proof, execution blockers, committed adapter or venue ABI artifact metadata when present, the latest Blockscout ABI/bytecode status when live verification is available, and a per-contract `executionEvidence` summary. This endpoint exists so router/pair/quoter provenance is visible without running quote work.

### `GET /verification`

Returns the latest verification snapshot for DogeOS source targets and official tokens. The response includes router/factory/quoter/pool roles, Blockscout URLs, Blockscout ABI availability, selector/read-check status, pinned pool `poolStateCheck` data, token decimal reads, per-contract `executionEvidence`, and a machine-readable summary. This endpoint is separate from `/quote` so provenance checks can be displayed or refreshed without slowing live quote paths.

### `POST /quote`

Inputs:

- chain ID
- sell token
- buy token
- sell amount
- optional include/exclude sources
- slippage preference

Outputs:

- status: `ok`, `read-only`, or `no-route`
- best route
- alternatives
- rejected candidates with machine-readable reasons
- expected output
- minimum output
- telemetry, including quote latency and source/provider issue diagnostics

### `POST /approval`

Inputs:

- connected wallet owner
- selected quote

Behavior:

- derives the spender from the quote router, not from free-form UI input
- derives the required sell-token amount from `amountIn` for exact-input routes or `maxAmountIn` for exact-output routes
- reads ERC-20 `allowance(owner, router)` through DogeOS RPC
- returns no transaction when allowance is sufficient
- returns an exact ERC-20 `approve(router, requiredAmount)` transaction when allowance is short

The web app must call this preflight before `/swap` so sender-aware swap simulation runs after required token approval is confirmed.

### Quote Response Fields

- price impact
- estimated gas
- estimated DogeOS data/finality fee
- warnings
- quote block
- expiry
- telemetry: total quote latency, pre-quote verification latency, candidate-provider latency, fee-resolution latency, route-scoring latency, candidate count, executable candidate count, rejected candidate count, source/provider issue count, and source/provider issue details

Quote response rules:

1. Reject wrong-chain candidates before scoring.
2. Apply include/exclude source filters before per-source live quote reads and before scoring.
3. Score only fresh `active` candidates.
4. Attach `minimumOutput` and swap-ready `minAmountOut` after scoring from the selected route amount and slippage basis points.
5. Return `no-route` with a warning when no route candidate remains; inactive preview candidates can return `read-only`.
6. Include timing telemetry on every successful quote response so route speed can be measured without adding another request.
7. Include per-request source/provider diagnostics when a live venue or quote provider fails or times out while healthy venues still return candidates. The selected route remains executable only for responding active sources, and the UI must show the source issue count so users and operators know coverage was incomplete.

### `POST /swap`

Returns transaction data only when:

- quote is fresh
- source is active
- router and ABI are verified
- simulation succeeds
- min-out and deadline are bound

### API Runtime Boundary

The initial API package exposes a dependency-free WHATWG `Request`/`Response` handler plus a Node HTTP adapter. `npm run start:api` starts the local API on `127.0.0.1:8787` by default.

Runtime rules:

1. `/sources` and `/tokens` are available from committed registries.
2. `/venues` exposes the same committed contract map plus live Blockscout ABI/bytecode status when the verification provider is available.
3. `/quote` accepts only DogeOS chain `6281971` and serializes bigint on-chain values as strings.
4. The live API handler verifies `eth_chainId` against DogeOS before quote provider work.
5. The local server reads `eth_gasPrice` from DogeOS RPC for gas-aware scoring.
6. Source include/exclude filters and pinned pool-pair filters run before live quote reads, so unsupported official-token pairs do not spend a block-number read, factory call, or quoter call.
7. V2 live discovery uses pinned registry pool addresses first, then reads pair `token0`, `token1`, and `getReserves` at one block before calling the V2 quote adapter. Factory `getPair` remains a fallback for sources without pinned pools.
8. V2 discovered candidates keep their source status. Current MuchFi V2 candidates are active executable quotes.
9. Default live V2, V3, and Algebra quote providers share one request-scoped block-number read, so a direct quote does not duplicate `eth_blockNumber` calls across protocol families.
10. V3 and Algebra quote providers are composed into the API runtime through on-chain quoter calls only.
11. Concentrated-liquidity providers do not synthesize exact-input quotes from partial pool state or unknown quoter selectors.
12. Default live quote reads cover MuchFi V3 QuoterV2-style output and Barkswap Algebra QuoterV2-style output.
13. Composite and protocol-family quote providers fail open: a rejected or timed-out source cannot block healthy venue candidates.
14. One-hop WDOGE routing is controlled with `oneHopEnabled`; the live API default enables read-only previews, and explicit disabled responses stay direct-only until multi-leg execution support exists.
15. Output-fee conversion and calldata builders remain injected so live reads can expand without coupling HTTP parsing to adapter logic.
16. The default local server returns active `ok` quote responses for MuchFi V2, MuchFi V3, and Barkswap Algebra when live liquidity exists.
17. `/swap` runs through the swap builder and refuses inactive, stale, wrong-chain, or malformed quotes before calldata can be returned.
18. `/swap` defaults to the verified calldata builder registry and has no arbitrary calldata fallback.
19. Venue-specific builders are typed for MuchFi V2, MuchFi V3, and Barkswap Algebra selectors and are enabled for active source quotes.
20. Active calldata building verifies source status, executable ABI provenance (`adapter-fragment`, `blockscout`, or `venue-artifact`), source/router match, and typed selector match, then relies on live `/swap` simulation before wallet signing. Selector-only `onchain-bytecode` evidence is rejected at this boundary.
21. The live `/swap` path verifies chain ID, runs `eth_call`, runs `eth_estimateGas`, resolves exact-calldata DogeOS data/finality fee, checks sell-token and native DOGE balances, and returns a buffered gas limit for active quotes.
22. The live `/approval` path verifies chain ID, reads ERC-20 allowance, and returns only the approval transaction needed for the selected quote's router and sell-token amount.
23. Successful `/quote` responses include timing telemetry for verification, provider, fee, scoring, and total latency tracking.

### Web Runtime Boundary

`npm run start:web` serves the responsive swap app on `127.0.0.1:8788` and delegates `/sources`, `/tokens`, `/venues`, `/verification`, `/quote`, `/approval`, and `/swap` to the same live aggregator handler. It also serves `/runtime-config.js`, which injects the public DogeOS SDK `clientId` from `DOGEOS_CLIENT_ID` or `VITE_DOGEOS_CLIENT_ID` at server startup so wallet configuration can change without rebuilding the frontend. `npm run dev:web` keeps that same route parity through the Vite middleware, including `/venues`, `/approval`, and runtime SDK config. The first committed web surface is intentionally dependency-light:

1. The app loads token and source registries from same-origin API routes.
2. The default quote path requests `1 USDC -> WDOGE` and renders active executable routes from MuchFi V2, MuchFi V3, and Barkswap Algebra.
3. The swap button is enabled for fresh active routes after a wallet is connected and quotes are ready.
4. The wallet button loads a lightweight wallet bridge first. When a DogeOS SDK client ID is configured through runtime config or a Vite build-time env var, the app can idle-load that bridge after the first quote, and the bridge lazy-loads the SDK-backed provider, wraps the app in `WalletConnectProvider`, and uses `useWalletConnect` plus `useAccount` for modal connection, chain switching, account state, and EVM provider access. Without a client ID, the app does not idle-load the full SDK bundle; a Connect click uses the lightweight bridge to connect an injected EVM wallet, switch or add DogeOS Chikyu Testnet, and keep execution available. If no injected wallet exists either, the bridge publishes an actionable setup error.
5. Route rows show output, slippage-protected min output, price impact, estimated DOGE fee, execution gas, data/finality fee, route status, and Blockscout pool/router links.
6. Source cards show the known contract/pool count, router address link, Blockscout ABI status, and relationship-read status from `/venues` and `/verification`.
7. Quote refresh runs on input changes without requiring a button press and refreshes periodically while the tab is visible.
8. New live quote requests abort the previous browser `/quote` fetch, and stale responses are still ignored by request sequence.
9. Route summaries show quote latency and source issue count from the latest `/quote` telemetry.
10. Active swaps require a connected sender, preflight ERC-20 allowance through `/approval`, submit an approval transaction when required, wait for its receipt, pass server-side balance preflight in `/swap`, and then submit the swap through the DogeOS SDK provider with `eth_sendTransaction`.
11. Desktop and mobile Playwright screenshots were captured for the loaded quote state; mobile QA confirmed no page-wide horizontal overflow.

## Security Controls

- Typed adapters only.
- No arbitrary user-provided calldata.
- Min-out and deadline on every executable route.
- Explicit recipient.
- Pinned source registry.
- Emergency source disable.
- No custody outside the transaction.
- Blockscout ABI verification when available; otherwise committed `adapter-fragment` provenance with router selector checks, relationship reads, typed local builders, and runtime simulation before execution.
- Simulate exact calldata before user signing.
- Verify sell-token and native DOGE balances before returning executable transaction data.

## Testing Strategy

| Layer | Required tests |
| --- | --- |
| Source registry | Status transitions and execution readiness. |
| Verification service | Bytecode, adapter ABI fragment, Blockscout ABI payload or venue ABI artifact, selector matching, disabled states. |
| Token registry | 18-decimal official token handling and provenance. |
| Quote adapters | V2 reserve math, V3 fixture math, Algebra fixture math. |
| Fee estimator | Execution gas plus DogeOS oracle-backed data/finality fee scoring. |
| Route optimizer | Direct route winner, tie-breaking, stale quote rejection. |
| Swap builder | Fresh quote binding, min-out, deadline, recipient, chain ID. |
| UI | Mobile/desktop screenshots and wallet/quote/transaction states. |
| Live verification | DogeOS RPC and Blockscout checks captured separately from unit tests. |

## Implementation Phases

### Phase 0: Repository Cleanup

- Remove superseded liquidity-venue strategy docs.
- Replace the old liquidity-venue fork spec and plan.
- Make aggregator-only architecture the source of truth.

### Phase 1: Registry And Verification

- Add chain config.
- Add token registry.
- Add source registry.
- Add verification service.
- Add Blockscout/RPC verification script.

### Phase 2: Direct Quotes

- Add MuchFi V2 adapter.
- Add MuchFi V3 adapter backed by verified quoter output.
- Add Barkswap adapter backed by verified Algebra-style quoter output.
- Add net-output scoring.
- Return route alternatives.

### Phase 3: Executable Direct Routes

- Confirm router addresses and ABIs.
- Build transaction data for active routes only.
- Simulate exact calldata.
- Add wallet flow and transaction timeline.

### Phase 4: One-Hop Routes

- Add WDOGE intermediary route composition.
- Keep one-hop responses as read-only previews until multi-leg calldata, approval, simulation, and wallet submission are implemented.
- Keep route scoring gas/data-fee aware.
- Add include/exclude source filters.

### Phase 5: Split Routing

- Add split candidates only after direct telemetry is reliable and one-hop execution has a dedicated multi-leg transaction path.
- Cap route complexity.
- Show percentages and incremental fee cost.

## Open Questions

| Question | Owner |
| --- | --- |
| Which Barkswap deployment is canonical? | Barkswap / DogeOS ecosystem |
| What are the Barkswap router and quoter addresses? | Barkswap |
| Is Barkswap Algebra Integral, a fork, or custom? | Barkswap engineering |
| What are canonical MuchFi V2 and V3 router/quoter addresses? | MuchFi |
| Should aggregators use both MuchFi V2 and MuchFi V3? | MuchFi |
| Which MuchFi CLMM fee tiers should be scanned by default? | MuchFi |
| Can Barkswap and MuchFi contracts be verified on Blockscout? | DEX teams |
| Are there other DogeOS spot DEXes that should enter watchlist discovery? | DogeOS ecosystem |

## Launch Definition

V1 is ready when:

- At least one external venue has active verification.
- Direct quote latency is measured and acceptable.
- Gas and data/finality fee estimates are shown and used for scoring.
- Transaction building refuses unverified routes.
- The UI is responsive on mobile and desktop.
- Blockscout links exist for all route contracts and submitted transactions.
- No platform liquidity-venue creation path exists in docs or code.
