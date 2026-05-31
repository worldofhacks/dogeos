# DEX Aggregator Competitive Analysis

Research baseline: 2026-05-30

Scope: same-chain spot DEX aggregation on DogeOS across verified external V2 and V3 venues. Cross-chain swaps, lending, perps, RFQ, solver systems, and liquidity management are included only when they inform the aggregator architecture.

## Executive Summary

The DogeOS product should compete on speed, route quality, execution reliability, verification discipline, and DogeOS-native UX.

V1 objective:

> For an official DogeOS token swap, return the best executable single route across verified external V2 and V3 liquidity after price impact, execution gas, DogeOS data/finality fee, slippage, and source reliability.

The launch target is intentionally smaller than a full 1inch-style graph engine:

```text
Stage 1: best direct single route
Stage 2: one-hop route through WDOGE
Stage 3: selective split routing
Stage 4: full graph routing only if liquidity density justifies it
```

## Competitor Lessons

| Aggregator | Useful pattern | DogeOS V1 implication |
| --- | --- | --- |
| 1inch | Deep pathfinding, split routes, source transparency. | Keep route interfaces composable, but do not build full split routing before direct execution works. |
| 0x Swap API | Quote and transaction construction are separate; route scoring includes gas and fees. | Keep `/quote` fast and `/swap` responsible for sender-aware simulation before wallet signing. |
| ParaSwap / Velora | Serious adapters require pricing replication, state sync, calldata generation, and tests. | Add each DogeOS DEX through adapter certification, not name recognition. |
| Odos | Complex route graphs can improve large trades but increase calldata and gas. | Make DogeOS fee-aware scoring penalize unnecessary complexity. |
| KyberSwap | Source filtering and route previews help users and integrators inspect routing. | Add include/exclude source filters and transparent route details. |
| OpenOcean | Broad source coverage matters when liquidity fragments. | Make the source registry easy to extend without rewriting the quote engine. |
| Uniswap Smart Order Router | Even same-family routing needs gas estimates and simulation. | Simulate executable calldata before returning a swap transaction. |
| LI.FI | Integration requirements and trusted-source policy are explicit. | Publish adapter verification requirements and source statuses. |

## DogeOS Source Model

| Source | Protocol family | V1 status |
| --- | --- | --- |
| MuchFi V2 | V2 constant-product | Active executable target with live pool reads and typed router calldata. |
| MuchFi V3 | V3 concentrated liquidity | Active executable target with live quoter reads and typed router calldata. |
| Barkswap | Algebra/V3-style concentrated liquidity | Active executable target with live quoter reads and typed router calldata. |
| SuchSwap | Unconfirmed V3-style | Watchlist only. |
| DogeBox | Low-confidence V2-like | Watchlist only. |
| Future DogeOS DEXes | V2, V3, Algebra, or custom | Added through the same verification checklist. |

Source registry fields:

| Field | Purpose |
| --- | --- |
| `sourceId` | Stable internal ID, for example `muchfi-v2` or `barkswap-algebra`. |
| `displayName` | UI/API label. |
| `protocolType` | `v2`, `v3`, `algebra`, or `custom`. |
| `factory` | Discovery contract when applicable. |
| `router` | Execution contract, required for active routes. |
| `quoter` | Quote contract if the venue needs one. |
| `positionManager` | Position NFT for V3-style venues. |
| `abiProvenance` | Blockscout, official docs, signed partner artifact, or none. |
| `verification` | Bytecode, selector, source, and address verification state. |
| `status` | `watchlist`, `readOnly`, `simulationOnly`, `active`, or `disabled`. |
| `supportedPairs` | Known official-token pairs. |

## Quote And Swap Split

| Endpoint | Role |
| --- | --- |
| `POST /quote` | Return route candidates, best route, alternatives, warnings, fee estimates, timing telemetry, and source/provider diagnostics. |
| `POST /swap` | Return executable transaction data for a selected fresh quote only. |
| `GET /sources` | Return source registry, verification state, and venue status. |
| `GET /venues` | Return the contract map grouped by source with router, quoter, factory, pool, selector, relationship-read, and Blockscout ABI status. |
| `GET /tokens` | Return official and verified token metadata. |

Quote responses should not require users to trust hidden routing. They should return:

- source and pool addresses
- route type
- expected output
- minimum output
- price impact
- estimated execution gas
- estimated DogeOS data/finality fee
- verification state
- warnings
- quote block and expiry

## Net-Output Scoring

Best route is not the same as best gross output.

```text
netValue =
  expectedOutputValue
  - executionGasCostInOutputTerms
  - DogeOSDataFinalityFeeInOutputTerms
  - protocolOrIntegratorFeeIfAny
  - failureRiskPenalty
```

DogeOS has a specific edge here: calldata-heavy routes and split routes must account for the chain's data/finality fee, not just normal EVM gas.

## Split And Multi-Hop Roadmap

| Route type | Stage | Rule |
| --- | --- | --- |
| Direct single venue | 1 | Launch path. |
| One-hop through WDOGE | 2 | Add when direct pools cannot cover official-token pairs well. |
| Direct split across certified sources | 3 | Enable only when net output improves after extra gas and data/finality fee. |
| Full graph search | 4 | Add after more DogeOS liquidity venues exist. |

The Stage 1 code should still use route candidates that can contain legs. A direct route has one leg; one-hop has two; split routing later can reuse the same model.

## Features To Avoid In V1

| Feature | Reason |
| --- | --- |
| Arbitrary calldata execution | Too broad and unsafe for early user funds. |
| Solver/intents | Extra trust, infra, and monitoring burden. |
| RFQ/private market makers | No current evidence of DogeOS RFQ liquidity. |
| Cross-chain routing | Out of scope for same-chain launch. |
| Multi-token input/output | More complex than current DogeOS liquidity needs. |
| Gasless swaps | Adds relayer/paymaster complexity. |
| Yield or liquidity zaps | Not needed for spot aggregation. |

## DogeOS Differentiators

| DogeOS capability | Aggregator feature |
| --- | --- |
| Native DOGE gas | Quote all transaction costs in DOGE. |
| Data/finality fee model | Include per-route data/finality estimates in route ranking through DogeOS `L1GasPriceOracle.getL1Fee(bytes)`. |
| Official SDK | Use DogeOS wallet and embedded login flows as the primary wallet layer. |
| Official faucet token set | Start from WDOGE, USDC, USDT, WETH, LBTC, and USD1 with on-chain decimals. |
| Blockscout | Link every source, pool, router, token, and transaction. |
| Early ecosystem | Provide a public, neutral adapter process before liquidity fragments further. |

## V1 Requirements

### Product

| Feature | Requirement |
| --- | --- |
| Token selector | Official tokens first, with verified metadata and warnings for others. |
| Route preview | Best route, alternatives, fees, warnings, and verification state. |
| Source badges | MuchFi V2, MuchFi V3, Barkswap, and watchlist labels. |
| Fee display | DOGE execution fee plus DogeOS data/finality estimate. |
| Price impact warning | Visible before execution. |
| Explorer links | Blockscout links for route contracts and final transaction. |

### Backend

| Feature | Requirement |
| --- | --- |
| Source registry | Versioned, auditable, and status-aware. |
| Venue contract map | Router, quoter, factory, pool, ABI provenance, selector, and relationship-read status visible outside quote execution. |
| Token registry | On-chain decimals and provenance. |
| Pool indexer | Barkswap and MuchFi pool state first. |
| Quote adapters | V2 reserve math, V3 pool/quoter support, Algebra-style support. |
| Route optimizer | Direct first, one-hop next, split later. |
| Simulation | Exact calldata simulation before `/swap`. |
| Observability | Quote latency, source/provider timeout rate, route win rate, stale quote rate, revert rate, gas estimate delta. |

### Contracts

V1 executes directly through the selected verified venue router. The platform should not deploy an aggregator execution router for the current scope; the wallet signs the transaction for the chosen external venue after route verification, sender-aware simulation, gas estimation, and data/finality fee resolution.

Any future contract-mediated execution path requires separate user approval, threat modeling, and tests before implementation. It must remain outside DEX creation: no pool creation, no liquidity management, no on-chain pathfinding, and no arbitrary user calldata.

## Adapter Certification Standard

A DEX becomes executable only after:

1. Canonical factory, pool, router, and quoter addresses are confirmed.
2. ABI/source is verified through Blockscout, official docs, or signed venue artifact.
3. Router bytecode exists on DogeOS RPC.
4. Expected swap selectors are present or ABI-encoded calls simulate successfully.
5. Quote math is reproducible.
6. Liquidity threshold is met.
7. Exact-call simulation passes.
8. Monitoring is in place.
9. The source can be disabled without redeploying the platform.

## Roadmap

### Phase 1: Verified Read-Only Quotes

- Source registry.
- Token registry.
- MuchFi V2 read adapter.
- MuchFi V3 read adapter.
- Barkswap Algebra-style read adapter.
- Direct route comparison endpoint.

### Phase 2: Executable Direct Routes

- Confirm routers, quoters, and ABIs.
- Build transaction generator.
- Simulate exact calldata.
- Enforce min-out and deadline.
- Add route detail UI.

### Phase 3: One-Hop Routing

- Add WDOGE intermediary routes.
- Preserve fee-aware route scoring.
- Add source include/exclude filters.

### Phase 4: Selective Split Routing

- Split only across certified sources.
- Cap split count.
- Show source percentages.
- Simulate full execution.

### Phase 5: Ecosystem Expansion

- Add SuchSwap only if confirmed.
- Add DogeBox only if confirmed.
- Add launchpad/bonding-curve adapters only when semantics are explicit.
- Publish adapter integration docs.

## Sources

- 0x Swap API docs: https://docs.0x.org/docs/0x-swap-api/introduction
- 0x API reference: https://docs.0x.org/api-reference/api-overview
- 1inch aggregation protocol reference: https://github.com/1inch/1inchProtocol
- KyberSwap Aggregator docs: https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator
- Velora / ParaSwap aggregation protocol docs: https://docs.velora.xyz/intro-to-velora/velora-overview/aggregation-protocol
- ParaSwap DexLib repository: https://github.com/VeloraDEX/paraswap-dex-lib
- Odos overview: https://www.odos.xyz/about
- OpenOcean docs: https://docs.openocean.finance/
- Uniswap quote API docs: https://api-docs.uniswap.org/api-reference/swapping/quote
- LI.FI DEX integration requirements: https://docs.li.fi/introduction/learn-more/for-dexs
