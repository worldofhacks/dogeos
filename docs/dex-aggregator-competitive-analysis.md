# DEX Aggregator Competitive Analysis

Research date: 2026-05-02

Latest DogeOS validation update: 2026-05-04

Scope: same-chain spot DEX swapping and efficient routing for DogeOS. Cross-chain, yield, lending, perps, RFQ, and solver/intents are included only when they teach us something useful for V1 routing.

## Executive Summary

The best DEX aggregators compete on five things:

1. Liquidity coverage
2. Route quality
3. Execution reliability
4. Safety controls
5. Developer/user experience

For DogeOS V1, we should not try to clone every feature from 1inch, 0x, ParaSwap, Odos, KyberSwap, OpenOcean, or LI.FI. We should build the smallest version that can reliably beat a user manually checking Barkswap, MuchFi, and our owned CLAMM.

V1 objective:

> For an official DogeOS token swap, return the best executable single route across Barkswap, MuchFi, and our owned CLAMM after price impact, gas, DogeOS data/finality fees, and slippage protection.

The staged path is:

```text
Stage 1: best single route
Stage 2: simple one-hop route
Stage 3: selective split route
Stage 4: full 1inch-style routing engine
```

## Competitor Feature Map

| Aggregator | Relevant capability | What it teaches us |
| --- | --- | --- |
| 1inch | Pathfinder route discovery, liquidity-source registry, split routes, multi-hop routes, API-accessible source lists. | Route search and source transparency are core aggregator features, but current commercial API access should not be treated as open-source infrastructure. |
| 0x Swap API | Smart order routing, public/private liquidity, quote API returning executable transaction data, source endpoint, gas/fee-adjusted routing, approval safety via Permit2/AllowanceHolder. | Separate discovery, quote, and transaction construction. Score by net executable output, not raw pool price. |
| ParaSwap / Velora | Classical smart-order routing plus intent/solver layer through Delta; DexLib is public and shows how serious aggregators require state sync, pricing replication, calldata generation, and end-to-end tests for each DEX. | Start with direct routing, but keep architecture open to later solver/intents. Make adapter admission test-driven, not name-driven. |
| Odos | Advanced AMM pathfinding, non-linear routes, multi-token input/output, gas-aware route complexity. | Route graph design matters; pathfinding should support split and multi-hop later, even if V1 starts smaller. |
| KyberSwap Aggregator | Route scanner, split/reroute across sources, API route preview then transaction build, source filtering. | Let integrators include/exclude venues and inspect route composition. |
| OpenOcean | Quote then swap transaction pipeline, multi-hop/split routes, broad source coverage. | Clean quote/execute API shape is table stakes. |
| Uniswap Smart Order Router | Best route within a protocol family, gas estimates, simulation/failure reason in API flow. | Even single-protocol routing needs gas and failure-aware route selection. |
| LI.FI | Integration standards for DEXes/aggregators/solvers, trusted-source prioritization, same-chain route execution through specific DEX contracts. | Do not integrate every venue blindly; require technical and security standards. |
| CoW Swap / solver systems | Batch auctions, solver competition, MEV protection, user-signed intents. | Not V1, but future direction for larger trades and MEV-sensitive execution. |

## Industry Standard Architecture

```text
Token Registry
  |
  v
Liquidity Source Registry
  |
  +-- Barkswap adapter
  +-- MuchFi V2 adapter
  +-- MuchFi V3 adapter
  +-- Owned CLAMM adapter
  +-- Future venue adapters
  |
  v
Quote Sampler
  |
  +-- direct route quotes
  +-- multi-hop route quotes
  +-- split route candidates
  |
  v
Route Optimizer
  |
  +-- gross output
  +-- price impact
  +-- execution gas
  +-- DogeOS data/finality fee
  +-- slippage tolerance
  +-- reliability score
  |
  v
Simulation / Validation
  |
  +-- allowance checks
  +-- balance checks
  +-- exact calldata simulation
  +-- min-out and deadline enforcement
  |
  v
Executable Swap Transaction
```

## What We Should Copy

### 1. Source Registry

Every serious aggregator has a model of supported liquidity sources.

For DogeOS:

| Source | V1 status |
| --- | --- |
| Barkswap | Active integration target |
| MuchFi V2 | Active integration target |
| MuchFi V3 | Active integration target |
| Owned CLAMM | Planned V1 source |
| SuchSwap | Watchlist only |
| DogeBox | Watchlist only |

Source registry fields:

| Field | Purpose |
| --- | --- |
| `sourceId` | Stable internal ID, e.g. `barkswap-v2-cl`, `muchfi-v2`, `muchfi-v3`. |
| `displayName` | UI/API route name. |
| `protocolType` | `v2`, `v3`, `algebra`, `custom`. |
| `factory` | Discovery contract. |
| `router` | Execution contract. |
| `quoter` | Quote contract if needed. |
| `positionManager` | CLAMM position NFT if applicable. |
| `verified` | Blockscout/source verification status. |
| `status` | `active`, `quoteActive`, `watchlist`, `disabled`. |
| `riskLevel` | Routing risk classification. |
| `supportedPairs` | Known official-token pairs. |

### 2. Quote/Swap Split

Most API aggregators separate route preview from executable transaction generation.

For DogeOS:

| Endpoint | Role |
| --- | --- |
| `GET /quote` | Return route candidates and best route, no calldata commitment needed. |
| `POST /swap` | Return executable calldata for a selected fresh quote. |
| `GET /sources` | Return supported source registry and status. |
| `GET /tokens` | Return official and verified token registry. |

### 3. Net-Output Scoring

Best rate is not just pool output.

Score route by:

```text
netValue =
  expectedOutputValue
  - executionGasCostInOutputTerms
  - DogeOSDataFinalityFeeInOutputTerms
  - expectedFailurePenalty
  - protocolFeeIfAny
```

For DogeOS, the data/finality fee is a specific advantage. Generic EVM aggregators may ignore it or approximate it poorly. We can make this a routing differentiator.

### 4. Split And Multi-Hop Routing

Top aggregators split orders across sources when useful and use intermediate tokens when direct liquidity is weak.

Our staged support should be:

| Route type | Stage |
| --- | --- |
| Direct single-pool | Stage 1 |
| Best single venue among Barkswap/MuchFi/owned CLAMM | Stage 1 |
| One-hop through WDOGE | Stage 2 |
| Direct split across certified sources | Stage 3 |
| Deep multi-hop graph search | Stage 4 |
| Multi-token input/output | Later / optional |

Because current visible official liquidity is concentrated around `WDOGE/USDC` and `WDOGE/USDT`, single-route selection matters first. Split routing becomes useful only after our owned CLAMM and external venues have enough depth that splitting improves net output after gas and DogeOS fees.

### 5. Simulation And Failure Reasons

A quote should not be considered usable until the final transaction path can be simulated.

Required checks:

| Check | Reason |
| --- | --- |
| User balance | Prevent impossible swaps. |
| Allowance or Permit2 state | Prevent approval confusion. |
| Pool freshness | Avoid stale reserves/ticks. |
| Exact calldata simulation | Catch router/revert issues before user signs. |
| Min-out/deadline | Protect against slippage and stale quotes. |
| Recipient validation | Prevent misdirected funds. |

### 6. Source Filtering

KyberSwap and 0x-style APIs expose source lists/filtering. We should do the same.

For DogeOS:

```text
/quote?sellToken=USDC&buyToken=WDOGE&sellAmount=...&includeSources=muchfi-v2,barkswap
/quote?...&excludeSources=barkswap
```

This helps with:

- debugging
- partner testing
- incident response
- proving route quality
- ecosystem neutrality

### 7. Route Transparency

The route response should explain why a route won.

Return:

| Field | Example |
| --- | --- |
| `sources` | `MuchFi V2 55%, Barkswap 45%` |
| `pools` | pool addresses |
| `expectedOutput` | raw token amount |
| `minimumOutput` | slippage-protected amount |
| `estimatedGas` | gas units |
| `estimatedDogeFee` | execution plus data/finality estimate |
| `priceImpact` | percentage |
| `routeConfidence` | `high`, `medium`, `low` |
| `warnings` | unverified venue, low liquidity, high price impact |

## What We Should Not Copy Yet

| Feature | Why not V1 |
| --- | --- |
| RFQ / private market makers | No evidence yet of DogeOS RFQ market makers. |
| Solver/intents | More infrastructure and trust assumptions; useful later. |
| Cross-chain routing | Explicitly out of current scope. |
| Multi-token input/output | Useful but not needed for two initial venues. |
| Limit orders | Not required for spot aggregation. |
| Gasless swaps | Nice UX, but adds relayer/paymaster complexity. |
| Bridge aggregation | Out of scope. |
| Yield/liquidity zaps | Out of scope. |

## DogeOS-Specific Differentiators

We should not be a generic aggregator with a DogeOS logo.

| DogeOS capability | Aggregator feature |
| --- | --- |
| Native DOGE gas | Quote all transaction costs in DOGE. |
| Data/finality fee model | Include it in route scoring. |
| Official SDK | Use DogeOS wallet/social login as primary wallet surface. |
| Official faucet token set | Start with strict official-token registry. |
| Blockscout, plus L2scan once confirmed | Link every source, pool, token, and swap. |
| Early ecosystem | Provide canonical source registry and adapter process before liquidity fragments. |

## V1 Feature Requirements

### Product

| Feature | Requirement |
| --- | --- |
| Token selector | Official tokens first: WDOGE, USDC, USDT, WETH, LBTC, USD1. |
| Route preview | Show best route and alternatives. |
| Source badges | Barkswap, MuchFi V2, MuchFi V3, owned CLAMM. |
| Fee display | DOGE gas plus data/finality estimate. |
| Price impact warning | Warn before execution. |
| Route details | Pools, split percentages, estimated output, min output. |
| Explorer links | Blockscout links for route contracts and final tx. |

### Backend

| Feature | Requirement |
| --- | --- |
| Source registry | Versioned, auditable, with status flags. |
| Token registry | Official tokens plus verified metadata. |
| Pool indexer | Track Barkswap and MuchFi pools. |
| Quote sampler | V2 reserves, V3/Algebra state/quoter. |
| Route optimizer | Direct, split, and simple two-hop routes. |
| Simulation | Exact calldata before `/swap` response. |
| Observability | Quote latency, route win rate, revert rate, stale quote rate. |

### Contracts

| Feature | Requirement |
| --- | --- |
| Router allowlist | Only certified adapters/venues. |
| Slippage protection | Always enforce min-out. |
| Deadline | Always enforce deadline. |
| Recipient | Explicit recipient, no arbitrary target calls. |
| Pause | Emergency source/adapter disable. |

## Adapter Certification Standard

A DEX moves from watchlist to routeable only after:

1. Canonical contracts are confirmed.
2. ABI/source is verified or provided.
3. Quote math is reproducible.
4. Execution router is understood.
5. Exact-call simulation passes.
6. Liquidity threshold is met.
7. Monitoring is in place.
8. The venue can be disabled without redeploying the whole aggregator.

For V1, Barkswap and MuchFi should go through this same checklist even though they are known main venues.

## Proposed Roadmap

### Phase 1: Read-Only Quote Engine

- Barkswap read adapter.
- MuchFi V2 read adapter.
- MuchFi V3 read adapter.
- Owned CLAMM read adapter.
- Official token registry.
- Source registry.
- Quote comparison endpoint.

### Phase 2: Executable Routes

- Confirm routers/quoters with teams.
- Build swap transaction generator.
- Simulate exact calldata.
- Enforce min-out/deadline.
- Add route detail UI.

### Phase 3: One-Hop Routing

- Two-hop routes through WDOGE.
- Gas plus DogeOS data/finality scoring.
- Source include/exclude filters.

### Phase 4: Selective Split Routing

- Split orders across MuchFi, Barkswap, and owned CLAMM only when net output improves.
- Cap split complexity.
- Show source percentages.
- Simulate full multi-call execution.

### Phase 5: Scale To Ecosystem

- SuchSwap if confirmed.
- DogeBox if confirmed.
- Launchpads/bonding curves.
- Future DEXes.
- Optional solver/RFQ layer if the ecosystem matures.

## Sources

- 0x Swap API docs: https://docs.0x.org/docs/0x-swap-api/introduction
- 0x monetization docs: https://docs.0x.org/docs/0x-swap-api/guides/monetize-your-app-using-swap
- 0x API reference: https://docs.0x.org/api-reference/api-overview
- 0x smart order routing overview: https://0x.org/post/0x-smart-order-routing
- 1inch deprecated open-source aggregation protocol: https://github.com/1inch/1inchProtocol
- Uniswap concentrated liquidity docs: https://developers.uniswap.org/docs/get-started/concepts/liquidity-providers/concentrated-liquidity
- Uniswap V3 core repository and license: https://github.com/Uniswap/v3-core
- KyberSwap Aggregator docs: https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator
- KyberSwap EVM swaps API: https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/aggregator-api-specification/evm-swaps
- Velora / ParaSwap aggregation protocol docs: https://docs.velora.xyz/intro-to-velora/velora-overview/aggregation-protocol
- ParaSwap DexLib repository: https://github.com/VeloraDEX/paraswap-dex-lib
- Odos overview: https://www.odos.xyz/about
- OpenOcean docs: https://docs.openocean.finance/
- Uniswap quote API docs: https://api-docs.uniswap.org/api-reference/swapping/quote
- LI.FI architecture docs: https://docs.li.fi/introduction/lifi-architecture/system-overview
- LI.FI DEX integration requirements: https://docs.li.fi/introduction/learn-more/for-dexs
