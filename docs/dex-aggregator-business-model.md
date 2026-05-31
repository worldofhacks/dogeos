# DogeOS DEX Aggregator Business Model

Research baseline: 2026-05-30

Scope: revenue and operating strategy for a DogeOS same-chain spot DEX aggregator. This document explicitly excludes creating, forking, deploying, seeding, or operating a platform liquidity venue.

## Decision

The platform is an aggregator only.

It routes across verified external DogeOS liquidity venues, starting with MuchFi V2, MuchFi V3, and Barkswap-style concentrated-liquidity pools. These venues execute only through source-registry routers with on-chain selector evidence, relationship reads, typed calldata builders, and sender-aware runtime simulation.

The platform must not include:

- First-party liquidity venues.
- First-party AMM forks.
- Platform-owned liquidity campaigns.
- Platform-owned LP operations.
- Protocol fee capture from platform liquidity venues.
- Routing bias toward a first-party venue.

## Revenue Options

| Model | V1 posture | Notes |
| --- | --- | --- |
| No-fee aggregator | Allowed | Best for early adoption and route-quality measurement. |
| Transparent swap fee | Later | Only if disclosed before signing and included in net-route scoring. |
| Integrator/referral fee | Later | Useful for wallets and apps, but must never make a worse route look best. |
| API access | Later | Charge for reliable routing infrastructure once quotes and execution are production-grade. |
| DEX partner revenue share | Optional | Business agreement only; ranking remains source-neutral. |
| Positive slippage capture | Avoid for V1 | Adds trust and disclosure complexity. Revisit only with explicit policy. |

## Routing Integrity Rules

1. Net executable output wins.
2. Every quote includes gas, DogeOS data/finality fee, slippage, and source status.
3. Routers without bytecode, selector evidence, relationship reads, ABI provenance, typed builders, and runtime simulation stay read-only or watchlist, never executable.
4. Fee settings are part of quote scoring and must be visible before signing.
5. Source filtering exists for debugging, partner testing, and incident response.
6. The aggregator can disable a venue without redeploying the whole platform.

## V1 Launch Positioning

The product promise is simple:

> Find the fastest safe DogeOS route across verified V2 and V3 liquidity, show why it won, and return executable transaction data only when the router, ABI, and source details are proven.

## Operating Metrics

| Metric | Why it matters |
| --- | --- |
| Quote latency | Speed is part of the product. Track p50, p95, and timeout rate. |
| Route win rate by source | Proves source-neutral routing. |
| Quote-to-fill delta | Shows quote accuracy and stale-state risk. |
| Revert rate by adapter | Identifies unsafe or brittle venues. |
| Verification coverage | Shows which routers, factories, pools, and ABIs are trusted. |
| Gas estimate delta | Measures whether DogeOS fee estimates match reality. |

## Partner Policy

External DEXes are added through the same adapter verification process:

1. Factory and pool addresses identified.
2. Router and quoter addresses confirmed by venue team, official docs, or Blockscout verification.
3. ABI provenance recorded.
4. Quote math tested.
5. Execution simulated.
6. On-chain route uses pinned typed adapters for the selected external venue router only.
7. Source status is public.

Business relationships do not bypass technical verification.
