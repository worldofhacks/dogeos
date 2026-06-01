# DogeOS V2/V3 DEX Aggregator Design Spec

Status: aggregator-only replacement baseline
Date: 2026-05-30

## Decision

Revamp the repository around a DogeOS DEX aggregator for external V2 and V3 liquidity. Remove the previous platform-controlled V3 DEX fork path entirely.

The first product does not create pools, deploy an AMM, fork external AMM code, manage platform LP positions, or privilege a platform source. It discovers, verifies, quotes, ranks, and executes routes through verified external DogeOS venues.

## Repository Finding

The repository now contains a DogeOS aggregator runtime, API surface, responsive web app, package manifests, source verification, typed venue calldata builders, live quote providers, and tests. It intentionally contains no smart contracts, pool factories, liquidity managers, AMM deployers, or platform-controlled DEX execution path.

## V1 Sources

| Source | Protocol family | V1 status | Execution check |
| --- | --- | --- | --- |
| MuchFi V2 | V2 constant-product | Active direct execution | Router address, adapter ABI fragment, selectors, relationship reads, live reserves, and swap simulation are verified. |
| MuchFi V3 | V3 concentrated liquidity | Active direct execution | Router/quoter addresses, adapter ABI fragments, selectors, relationship reads, supported fee tiers, live quoter output, and swap simulation are verified. |
| Barkswap | Algebra/V3-style CLAMM | Active direct execution | Router/quoter addresses, adapter ABI fragments, selectors, relationship reads, live quoter output, and swap simulation are verified. |
| SuchSwap | Unconfirmed V3-style | Watchlist | Do not route until identity and periphery are proven. |
| DogeBox | Low-confidence V2-like | Watchlist | Do not route without official-token liquidity and router proof. |

## Route Stages

1. Direct best-route: choose one verified venue for the requested pair.
2. One-hop route: use WDOGE as the first intermediary when direct pools are weak or missing; return read-only priced previews until multi-leg calldata, approval, simulation, and wallet submission exist.
3. Split routing: add later through the same route candidate interface after telemetry proves direct execution and one-hop has a dedicated transaction path.
4. Full graph search: later only when DogeOS liquidity density justifies it.

Split routing is intentionally out of V1 execution, but route candidates must already support composition so it can be added without rewriting adapters.

## Core Architecture

```text
Chain Config
  -> Token Registry
  -> Source Registry
  -> Verification Service
  -> Pool Discovery
  -> Quote Adapters
  -> Route Optimizer
  -> Gas + Data/Finality Fee Estimator
  -> Simulation
  -> Swap Transaction Builder
  -> Responsive Web App / Public API
  -> Verified Venue Router Transaction
```

V1 executes directly through the selected verified venue router. The platform must not create pools, hold strategy liquidity, perform pathfinding on-chain, or accept arbitrary user-provided calls.

## Verification Requirements

Every executable venue must have a verification record:

- Chain ID and explorer.
- Source ID and display name.
- Protocol type: `v2`, `v3`, `algebra`, or `custom`.
- Factory, router, quoter, position manager, and pool addresses where applicable.
- ABI provenance: Blockscout verified source, committed adapter ABI fragment, official docs, target-bound venue artifact, or disabled.
- Bytecode presence checked over DogeOS RPC.
- Router selectors matched against expected swap functions.
- Read-only and execution status separated.
- Last verification block and timestamp.

Unverified routers can be quoted only when read calls are safe and deterministic. They cannot be used for executable swap transactions.

## Speed And Gas Strategy

- Batch pool reads with multicall or RPC batching where available.
- Cache token metadata and verified source records aggressively.
- Cache pool state by block number with quote TTLs.
- Run V2, V3, and Algebra quote adapters in parallel with strict timeouts.
- Score by net output after price impact, execution gas, DogeOS data/finality fee, and failure risk.
- Resolve data/finality estimates per route through `L1GasPriceOracle.getL1Fee(bytes)` at `0x5300000000000000000000000000000000000002`.
- Prefer the simplest route when outputs are effectively tied.
- Exclude route candidates that rely on stale pool state or unverified execution.

## Frontend Requirements

- Mobile-first responsive swap surface.
- DogeOS SDK v3 as the primary wallet path with `WalletConnectProvider`, `useWalletConnect`, and `useAccount`.
- Native DOGE, WDOGE, and Dogecoin L1 DOGE labeled distinctly.
- Fast quote refresh without layout shift.
- Clear route winner, alternatives, estimated DOGE gas, data/finality fee, price impact, minimum output, and verification state.
- Transaction timeline: quote ready, wallet signature, submitted, included, confirmed, finality-aware analytics.
- Blockscout links for tokens, pools, routers, and transactions.

## Acceptance Criteria

- No repository package, script, doc, or config introduces a DEX contract, factory, liquidity manager, deployer, or platform router.
- Source registry includes external V2 and V3 venue types only.
- Execution uses verified router addresses, ABI provenance, source details, route shape, and simulation evidence. One-hop quotes remain read-only previews until multi-leg execution exists.
- Direct routing can launch before split routing.
- Route interfaces are modular enough to add one-hop execution and split routing later.
- DogeOS gas and data/finality fees are part of route ranking.
- UI and API are responsive to wallet, quote, transaction, and chain-state changes.
