# DogeOS DEX Aggregator Architecture Plan

Research date: 2026-05-01

Latest validation update: 2026-05-04

This document maps the initial architecture for a DogeOS-native DEX aggregator focused on same-chain swaps on the DogeOS Chikyū Testnet. It compares DogeOS-specific constraints against established EVM DEX aggregator patterns and defines the V1 direction.

## Primary Goal

Build the best same-chain swap aggregator for the DogeOS ecosystem before expanding into cross-chain swaps, yield, intents, RFQ, or bridge aggregation.

V1 should answer one user question well:

> Given token A, token B, and amount X on DogeOS, what executable route gives the best net output after price impact, gas, DogeOS data/finality fees, and slippage protection?

This should be infrastructure first, not just an app. The long-term product should become the default DogeOS routing layer for DEXes, launchpads, wallets, games, DeFi apps, and developer tools that need swaps.

## Staged Hybrid Routing Path

We will not start with full 1inch-style split routing. The architecture should grow through clear stages.

### Stage 1: Basic Best-Route Aggregator

Scope:

- Quote Barkswap, MuchFi, and owned CLAMM.
- Compare normalized net output.
- Execute through the single best venue/router.
- Same-chain spot swaps only.
- Direct pool routes first.
- No split orders.
- No multi-route execution.

Decision model:

```text
quote Barkswap
quote MuchFi V2
quote MuchFi V3
quote Owned CLAMM
normalize output
subtract gas + DogeOS data/finality fee
choose best single route
simulate
execute
```

This is the first useful product and the correct initial build.

### Stage 2: Simple One-Hop Routing

Add one-hop routes through high-liquidity intermediates, primarily WDOGE.

Examples:

```text
USDC -> WDOGE
USDT -> WDOGE
USDC -> WDOGE -> USDT
WETH -> WDOGE -> USDC
```

The optimizer still chooses one route, not split execution.

### Stage 3: Selective Split Routing

Add split routing only where it creates meaningful improvement.

Initial use case:

```text
USDC -> WDOGE split across:
  - MuchFi V3
  - Barkswap
  - Owned CLAMM
```

Rules:

1. Split only across certified sources.
2. Split only when net output improves after additional gas and DogeOS fees.
3. Cap route complexity.
4. Simulate the full execution path.
5. Always show source percentages.

### Stage 4: Advanced 1inch-Style Engine

Later, after DogeOS liquidity fragments across more DEXes, launchpads, and pools:

- multi-hop graph search
- multi-source split routes
- route pruning
- gas-aware path optimization
- partial fill handling
- custom execution router
- MEV/slippage protections
- solver/RFQ experiments

This should be a later architecture target, not the first implementation.

## Non-Negotiable Principles

1. Best executable rate wins

The route winner must be selected by net executable value, not marketing preference, partner preference, or gross output alone. Net value means output after price impact, route reliability, execution gas, DogeOS data/finality fee, and slippage constraints.

2. Cover every credible DogeOS liquidity source

The aggregator must integrate all meaningful DEXes and launchpad liquidity venues on DogeOS as they exist now and as they launch. If liquidity exists on DogeOS and is safe to route through, the system should either support it or have a documented reason why it is excluded.

3. Safety beats route cleverness

No best-rate claim matters if execution is unsafe. On-chain min-out, deadlines, adapter allowlists, narrow router permissions, verified token metadata, quote freshness, and reorg-aware indexing are core product features.

4. DogeOS-specific correctness

Do not ship Ethereum-mainnet assumptions under a DogeOS skin. Fees, token decimals, wallet flows, finality, chain config, explorer links, and native DOGE behavior must be modeled explicitly.

5. Smooth user experience without hiding complexity

Users should get the smoothest possible swap flow, but the system should still expose route details, fees, warnings, and transaction state clearly enough that sophisticated users and partners can trust it.

6. Partner-grade operations

DogeOS ecosystem and engineering leadership should see a path to operational maturity: observability, incident response, adapter tests, integration checklists, security reviews, and measurable route quality.

7. Showcase DogeOS strengths

The aggregator should make DogeOS's speed, DOGE-native fees, social onboarding, EVM compatibility, and application-layer model visible in normal use. If a user leaves a swap without understanding why DogeOS made it smoother, we are underusing the platform.

## Leadership Review Lens

The architecture should survive review from both ecosystem and engineering leadership.

### Ecosystem Questions We Must Answer

| Question | Required answer |
| --- | --- |
| How does this help every DEX and launchpad on DogeOS? | Provide a clear integration path, adapter spec, test checklist, and listing process. |
| How does this avoid picking winners? | Rank by transparent executable route quality and publish route composition. |
| How does this protect users from bad assets? | Maintain curated defaults, token risk labels, verified metadata, and liquidity thresholds. |
| Why is this better than a generic aggregator later? | It is DogeOS-native: wallet SDK, DOGE fee model, local launchpad coverage, curated assets, and ecosystem-specific routing. |
| How does this become reusable infra? | Expose stable quote APIs, route metadata, adapter docs, and status endpoints for other apps. |

### Engineering Questions We Must Answer

| Question | Required answer |
| --- | --- |
| What is trusted and what is trustless? | Backend finds routes, but router enforces min-out, deadline, adapter allowlist, and recipient constraints on-chain. |
| Can arbitrary calldata drain users? | No. V1 avoids arbitrary user-provided calls and routes only through typed allowlisted adapters. |
| How are fees estimated? | Combine `eth_estimateGas`, gas price, route calldata size, and `L1GasPriceOracle` data/finality estimates; compare estimates against executed swaps. |
| How do we handle stale quotes? | Quote TTL, block-number binding, pool freshness checks, slippage protection, and execution telemetry. |
| What breaks during reorgs? | Indexer buffers at least 17 blocks for canonical analytics and can roll back pool state. |
| How do we know routes are correct? | Deterministic adapter tests, fork tests, quote-vs-execution tests, invariant tests, and production route monitoring. |
| Who can change router behavior? | Admin model must be explicit: multisig, timelock before mainnet, emergency pause, adapter allowlist events, and public changelog. |

## DogeOS Context

Core network reference lives in [dogeos-chikyu-testnet.md](./dogeos-chikyu-testnet.md).

Verified facts from DogeOS docs and local RPC checks:

| Area | Finding | Architecture impact |
| --- | --- | --- |
| EVM compatibility | DogeOS is EVM compatible and Ethereum tooling works when pointed at the DogeOS RPC. | Use Solidity, Foundry, Hardhat, viem/ethers, wagmi patterns. |
| Chain ID | `6281971` / `0x5fdaf3`. | Must be first-class in app, SDK config, deployment scripts, indexers, and quote service. |
| Native token | Native gas token is `DOGE`, 18 decimals on DogeOS. | UI must distinguish DogeOS DOGE from Dogecoin L1 DOGE, which has different wallet/provider behavior. |
| EVM target | Docs recommend Prague and Solidity `>=0.8.30`. | Contracts should compile against current EVM semantics and avoid older compiler assumptions. |
| Unsupported behavior | `SELFDESTRUCT` is disabled; some precompiles are unsupported; `PREVRANDAO` returns `0`; `COINBASE` returns the fee vault. | Avoid dependencies that assume those opcodes/precompiles. Router should not use randomness or coinbase assumptions. |
| Reorg depth | Docs state max reorg depth is 17 blocks, with absolute ordering certainty after finalization. | Indexer and quote cache should use confirmations for canonical analytics; swap UX can submit immediately but monitoring should tolerate reorgs. |
| Fees | Total fee is execution fee plus Data and Finality fee. `L1GasPriceOracle` exists at `0x5300000000000000000000000000000000000002`. | Quote ranking must include data/finality fee estimates, not only `eth_estimateGas * gasPrice`. Calldata size matters. |
| Official faucet tokens | WDOGE, LBTC, WETH, USD1, USDC, USDT all have contract bytecode and report 18 decimals on testnet. | Token registry must read decimals on-chain and never hard-code Ethereum mainnet conventions like USDC/USDT 6 decimals. |
| Wallet SDK | Official React SDK supports wallet modal, embedded login, social login, browser wallets, WalletConnect, EVM provider calls, and chain switching. | Use DogeOS SDK as the primary wallet layer instead of generic wallet onboarding. |
| Explorers | Blockscout is reachable and exposes REST/API links and contract verification endpoints. L2scan was provided, but its root returned HTTP `404` during the 2026-05-04 validation pass. | Use Blockscout as the source of record for links, verification, transaction indexing fallback, and support workflows until L2scan is confirmed. |

## DogeOS-Native Leverage

The aggregator should actively exploit what makes DogeOS different instead of merely deploying Ethereum-style code to another EVM endpoint.

| DogeOS capability | How the aggregator should use it | User/ecosystem benefit |
| --- | --- | --- |
| Dogecoin application layer | Treat native DOGE, WDOGE, and Dogecoin-provider flows as first-class rather than bolted-on. | Users understand how DOGE moves through DeFi and do not confuse Dogecoin L1 with DogeOS EVM assets. |
| EVM bytecode compatibility | Use proven Solidity, Foundry, Hardhat, viem/ethers, wagmi, and AMM patterns. | Faster delivery, easier audits, and easier partner integrations for Ethereum-native teams. |
| Prague EVM target and current Solidity | Build with modern Solidity assumptions and avoid legacy bytecode/compiler patterns. | DogeOS engineering sees we are aligned with their supported execution environment. |
| Faster feedback than Dogecoin L1 | Design UI around quick route refresh, fast transaction status, and immediate post-swap state updates. | Swaps feel responsive and showcase why DogeOS is better for interactive DeFi. |
| Higher throughput than Dogecoin L1 | Support frequent quote refreshes, pool indexing, and launchpad demand without assuming L1-style latency. | DEXes, games, and launchpads can depend on swap infra during busy launches. |
| DOGE-native gas | Quote and display all transaction costs in DOGE, with execution fee and data/finality fee separated. | Users see DogeOS as DOGE-native infrastructure, not an Ethereum clone. |
| Data and Finality fee model | Use `L1GasPriceOracle` and calldata-size-aware route scoring. | We can choose better net routes than generic EVM aggregators that ignore DogeOS-specific fees. |
| Dogecoin/Celestia security model | Explain finality and confirmations in transaction status and indexer analytics. | Advanced users and partners understand why route analytics are reorg-aware. |
| Official Wallet SDK | Use modal and embedded login for browser wallets, social login, and app-specific onboarding. | Dogecoin-native users can enter DeFi without a generic crypto-wallet learning curve. |
| Dogecoin provider support | Keep room for Dogecoin L1 account actions and future bridge/deposit flows adjacent to swaps. | The aggregator can become a DOGE onboarding surface, not just a token swap form. |
| Blockscout explorer, plus L2scan once confirmed | Link every route, token, contract, and swap to DogeOS-native explorers. | Better support, partner transparency, and trust during testnet/mainnet growth. |
| Official faucet token set | Bootstrap with WDOGE, LBTC, WETH, USD1, USDC, and USDT as verified test assets. | Early DeFi builders get predictable pairs and quote behavior. |

### Product Commitments From DogeOS Capabilities

1. DOGE-first asset language

The UI and API should label native DOGE, WDOGE, and Dogecoin L1 DOGE distinctly. Token pickers, route explanations, and approvals should avoid generic "ETH/native" terminology.

2. Fee transparency as a feature

Every quote should expose:

- estimated execution fee in DOGE
- estimated Data and Finality fee in DOGE
- total estimated DOGE fee
- whether fee cost changed route ranking
- warning when fee precision is limited

3. Fast interactive swap UX

DogeOS's faster block feedback should be visible in the product:

- rapid quote refresh
- pending/confirmed/finality-aware transaction timeline
- post-swap balance refresh
- route invalidation on pool updates
- quick retry/re-quote when a transaction fails

4. Official SDK onboarding path

The app should use the DogeOS SDK as the default wallet layer, especially for embedded/social login flows. Generic EIP-1193 fallback should exist for development and power users, but not be the primary experience.

5. Launchpad readiness

Because DogeOS is likely to have ecosystem launches and new assets, the aggregator should be able to route into launchpad liquidity with clear labels, eligibility checks, and transferability warnings.

6. DogeOS partner credibility

Every integration should be easy for DogeOS ecosystem and engineering teams to inspect:

- adapter status
- route metrics
- contract verification links
- listing rationale
- known limitations
- incident history

## Competitor Pattern Comparison

| Example | Useful pattern | Limitation for DogeOS V1 |
| --- | --- | --- |
| 1inch | Deep routing, split paths, gas-aware optimization, mature UX. | Current routing engine is API-side; old open-source `1inchProtocol` is archived/deprecated. Too broad for bootstrapping a new ecosystem. |
| 0x / Matcha | API-first smart order routing with public/private liquidity and settlement infrastructure. | Reliance on hosted liquidity network and market makers does not solve DogeOS-local liquidity discovery at launch. |
| ParaSwap / Velora DexLib | Strong adapter design, event-based pool state, canonical off-chain hints for router execution. | GPL-3.0 library means copying code has licensing consequences; better as design reference than codebase foundation. |
| Odos Router V2 | Security-wrapper model around arbitrary execution, min-out enforcement, multi-input/multi-output design. | Multi-input/multi-output is valuable later; V1 should be simpler unless DogeOS liquidity quickly requires it. |
| OKX DEX Router EVM | MIT router with modular adapters, split trading, Uniswap V2/V3/Curve style coverage, commission patterns. | Broad adapter set can be overkill; DogeOS needs a smaller, audited subset around actual deployed DEXs. |
| OpenOcean V2 | Multi-route aggregation, referral/monetization, gasless/Permit2 concepts. | License/source posture is less clear; also optimized for many chains rather than DogeOS-specific UX. |
| KyberSwap | Dynamic routing, PMM support, API-driven integration, fee customization. | API and PMM layer are not initially available for DogeOS unless partners join. |
| DexGuru meta-aggregation | Unified wrapper over multiple routers and best-route selection. | Good later if DogeOS has multiple external aggregators; V1 needs direct DEX aggregation first. |
| DeFiLlama / LlamaSwap | Meta-aggregates aggregators and emphasizes transparent comparison. | Useful UX principle, but DogeOS will initially lack enough aggregator providers to meta-aggregate. |

## Pain Points

1. Early liquidity fragmentation

DogeOS testnet has official DeFi builder tokens, but the eventual DEX landscape may start with only a few pools and duplicated token pairs. A generic multi-chain aggregator can look empty or unreliable if it assumes dense liquidity.

2. Fee ranking is not Ethereum-simple

DogeOS total transaction cost includes execution fee plus Data and Finality fee. Aggregators that only compare gross token output can choose a route with worse net value because split routes and long calldata may cost more.

3. Token metadata assumptions will be wrong

All official testnet tokens checked over RPC report 18 decimals, including USDC and USDT. A mainnet-biased token registry would misquote stablecoin amounts.

4. Wallet onboarding is a product differentiator

DogeOS has an official React wallet SDK with social login and embedded wallets. A generic wagmi-only wallet layer would miss the easiest onboarding path for Dogecoin-native users.

5. Dogecoin vs DogeOS mental model

Users may not understand the difference between Dogecoin L1 DOGE, DogeOS native DOGE, WDOGE, and bridged/faucet assets. The aggregator needs explicit asset labeling and guardrails.

6. Explorer and analytics maturity

Blockscout is available and moving, but explorer displays and APIs may behave differently than Etherscan assumptions. Indexing should use direct RPC/event ingestion as the source of truth, with explorers for links and verification.

7. Reorg and finality handling

A 17-block max reorg depth means analytics, route backtesting, and pool indexing need reorg tolerance. Swap submission can be fast, but our backend cannot treat every latest block event as final.

8. DEX adapter uncertainty

We do not yet know the canonical DogeOS DEXs, pool factories, fee tiers, or router contracts. The architecture must make adding DEX adapters cheap and testable.

9. Launchpad liquidity is not always router-shaped

Launchpads may expose bonding curves, fixed-price sales, vesting-aware claims, custom routers, or sale contracts that do not look like Uniswap pools. If users can buy or swap launch assets there, the aggregator needs a safe integration path without pretending every venue is an AMM.

10. Best route can become political

If multiple ecosystem partners launch DEXes, route selection can be perceived as favoritism. The aggregator needs transparent scoring, partner-neutral route ranking, and clear exclusion criteria.

## How We Improve On Previous Examples

1. DogeOS-native net quote scoring

Score routes by expected output minus:

- execution gas cost
- Data and Finality fee estimate from `L1GasPriceOracle`
- price impact
- route calldata size
- failure risk penalty

This should be better than copying generic EVM aggregators that rank mostly by gross output plus normal gas.

2. First-class official wallet SDK integration

Use the DogeOS SDK as the primary connect path:

- social login
- embedded wallet onboarding
- major browser wallets
- WalletConnect where configured
- explicit DogeOS Chikyū chain switching

This can make the aggregator the easiest DogeOS DeFi entry point, not just another swap UI.

3. Curated token and pool registry

Start with a verified registry:

- official faucet tokens
- token decimals fetched and cached from chain
- verified pool factory/router addresses
- explorer links
- known-risk flags

Do not list every token by default until liquidity and token metadata are trustworthy.

4. Small, auditable router surface

V1 router should be intentionally narrower than 1inch/OKX:

- exact-input swaps
- native DOGE wrap/unwrap handling
- ERC-20 pull/approve/swap/return flow
- `minAmountOut`
- deadline
- rescue functions with strict access control
- optional protocol fee toggle kept off or very small at launch

Exact-output, RFQ, intents, multi-input/multi-output, and cross-chain flows should wait.

5. Adapter-first backend

Model backend DEX adapters after ParaSwap DexLib's separation of pool state, quote logic, and calldata generation, but keep our implementation permissively licensed and smaller.

Each adapter should provide:

- pool discovery
- pool state sync
- quote function
- calldata builder
- health/failure reporting
- deterministic test fixtures

6. Transparent route explainability

Show users why a route won:

- expected output
- min received
- price impact
- route hops
- DEX split
- estimated DOGE fee
- data/finality fee estimate
- warning if route is single-source or low-liquidity

This is a practical wedge against black-box aggregators.

7. Launchpad-aware liquidity integration

Support launchpads as first-class liquidity venues when they provide executable buy/sell paths. Treat them as specialized adapters with stronger validation:

- supported sale phase
- price curve or fixed price
- max allocation and per-wallet constraints
- token claim/vesting behavior
- whether output token is immediately transferable
- failure conditions surfaced in the quote response

Launchpad routes should not be mixed into normal swap routing unless the output asset is transferable and the execution semantics are clear.

8. Partner-neutral route quality metrics

Publish the scoring model internally first, then externally when stable. At minimum, the route engine should record:

- gross output
- net output after estimated fees
- execution success rate by adapter
- average quote slippage by adapter
- stale quote rate
- pool depth and price impact
- route latency

This makes the aggregator defensible when DogeOS partners ask why their venue did or did not win flow.

## Liquidity Source Coverage

The aggregator should classify DogeOS liquidity sources by execution type instead of treating everything as a generic DEX.

| Source type | Examples | V1 handling |
| --- | --- | --- |
| Concentrated-liquidity AMM | Uniswap V3-style forks, Algebra-style pools, owned CLAMM | First-class V1 adapter family for MuchFi V3, Barkswap, and our owned DEX. |
| Constant-product AMM | Uniswap V2-style forks, simple pair pools | Include in V1 where present, starting with MuchFi V2, but treat it as one source type rather than the architecture center. |
| Stable-swap AMM | Curve-style stable pools | Add once stablecoin liquidity appears and pool math is verified. |
| Launchpad sale contract | Fixed-price sale, bonding curve sale, IDO contract | Specialized launchpad adapter with strict eligibility and transferability checks. |
| Native DogeOS DEX | Any DogeOS-specific router/pool design | Partner adapter after interface and test fixtures are documented. |
| External aggregator | Future 1inch/0x/OpenOcean/DogeOS meta providers | Later meta-aggregation only if available and trustworthy on DogeOS. |
| RFQ / market maker | Signed quotes, professional market makers | Later phase; requires solver/market-maker controls and failure monitoring. |

Coverage target:

- V1: official tokens plus Barkswap, MuchFi V2, MuchFi V3, and owned CLAMM direct-route quoting.
- V1.5: simple one-hop routing across credible AMM pools.
- V2: selective split routing once net-output improvement is measurable.
- V3: launchpad adapters, public partner API, and optional RFQ/meta-aggregation.

## Listing And Integration Policy

To be the default aggregator without becoming unsafe, we need an explicit listing policy.

### Token Listing Requirements

- Contract exists on DogeOS and metadata can be read on-chain.
- Decimals, symbol, and name are cached from chain and reviewed before default listing.
- Token appears on Blockscout or another accepted explorer.
- Risk flags are available for unverified, fee-on-transfer, rebasing, pausable, blacklistable, proxy, or nonstandard tokens.
- Default token list starts curated; permissionless search can exist later behind warnings.

### DEX Adapter Requirements

- Factory/router/pool contracts identified.
- Swap math understood and tested.
- Quote output reproducible from on-chain state.
- Adapter has deterministic unit tests and fork/integration tests.
- Adapter can build calldata without granting arbitrary execution.
- Adapter reports health, latency, quote freshness, and failure rate.

### Launchpad Adapter Requirements

- Sale contract and phase state can be read reliably.
- Quote can explain whether the action is a normal swap, primary sale, claim, or vesting-related action.
- Output token transferability is verified or clearly warned.
- Per-wallet limits and eligibility checks are included before presenting an executable quote.
- Launchpad routes are visually labeled so users understand they are not normal AMM swaps.

## Proposed V1 Architecture

### Components

| Component | Responsibility |
| --- | --- |
| Web app | Swap UI, token picker, route preview, wallet SDK integration, transaction submit, status tracking. |
| DogeOS wallet layer | Official SDK provider, social login, embedded onboarding, browser wallet support, DogeOS chain switching, Dogecoin provider adjacency. |
| Quote API | Receives quote requests, calls adapters, ranks routes, returns executable transaction plan. |
| Token registry | Official token list, decimals, symbols, logos later, risk flags, explorer URLs. |
| Pool registry | Known factories, pools, fee tiers, token pairs, DEX metadata. |
| Liquidity adapters | Per-DEX and per-launchpad quote/state/calldata modules. Start with Barkswap Algebra-style CLAMM, MuchFi V3, MuchFi V2, and owned CLAMM adapters. |
| Route solver | Stage 1 chooses the best single executable route; later stages add one-hop, two-hop, and split routes where useful. |
| Fee estimator | Combines `eth_estimateGas`, gas price, route calldata size, and DogeOS data/finality fee estimates. |
| Router contract | Executes selected route atomically with min-out and deadline checks. |
| Indexer | Syncs pools, reserves, swap events, token metadata, route performance, and DogeOS reorg/finality-aware analytics. |
| Observability | RPC health, quote latency, failed swaps, stale pools, adapter failures, route win rates. |

### ASCII Flow

```text
                               +-----------------------------+
                               | DogeOS Docs / Config Source |
                               | RPC, chain ID, explorers,   |
                               | SDK, official tokens        |
                               +--------------+--------------+
                                              |
                                              v
+----------------+      +---------------------+----------------------+
| User / Wallet  |<---->| Web App with DogeOS Wallet SDK             |
| Social login   |      | token picker, quote view, route warnings   |
| Browser wallet |      +---------------------+----------------------+
+-------+--------+                            |
        |                                     | quote request
        | signed tx                           v
        |                       +-------------+--------------+
        |                       | Quote API                  |
        |                       | validate tokens, amount,   |
        |                       | user settings, chain ID    |
        |                       +------+------+--------------+
        |                              |      |
        |                              |      v
        |                              |  +---+----------------+
        |                              |  | Token / Pool       |
        |                              |  | Registry           |
        |                              |  +---+----------------+
        |                              |      |
        |                              v      v
        |                 +------------+------+-------------+
        |                 | Liquidity Adapter Layer          |
        |                 | DEXes, launchpads, future RFQ    |
        |                 | DogeOS-native venues             |
        |                 +------------+------+-------------+
        |                              |
        |                              v
        |                 +------------+--------------+
        |                 | Route Solver              |
        |                 | direct, multi-hop, split   |
        |                 +------------+--------------+
        |                              |
        |                              v
        |                 +------------+--------------+
        |                 | DogeOS Fee Estimator      |
        |                 | execution gas +           |
        |                 | data/finality fee oracle   |
        |                 +------------+--------------+
        |                              |
        | executable route + calldata  v
        |                 +------------+--------------+
        +---------------->| Router Contract           |
                          | minOut, deadline, exactIn |
                          +------------+--------------+
                                       |
                                       v
                          +------------+--------------+
                          | DogeOS Chikyū Testnet     |
                          | RPC / WS / Blockscout     |
                          +------------+--------------+
                                       |
                                       v
                          +------------+--------------+
                          | Indexer + Analytics       |
                          | pools, swaps, failures,   |
                          | reorg-safe route metrics  |
                          +---------------------------+
```

## Route Strategy

V1 route search should be deliberately bounded:

1. Direct pool routes.
2. One-hop routes through common bases: `WDOGE`, `WETH`, `USDC`, `USDT`, `USD1`.
3. Two-hop routes only when liquidity is sparse and gas/data fee impact is acceptable.
4. Split routes only after direct and one-hop routing are stable.

Early split routing should have a minimum benefit threshold. On DogeOS, split routes increase calldata and may increase Data and Finality fee, so they should only win when net output improves enough to justify complexity.

Launchpad routes should be evaluated separately from normal swap routes unless the launchpad exposes immediately transferable output and normal swap semantics. A launchpad route can be the best executable route for acquiring a new asset, but it must be labeled as a primary-sale or launchpad route, not hidden as a normal DEX swap.

## Best-Rate Scoring Model

The route solver should rank by net executable value:

```text
netOutput =
  expectedOutput
  - priceImpactPenalty
  - executionGasCostInOutputTerms
  - dataFinalityFeeInOutputTerms
  - staleQuotePenalty
  - adapterFailureRiskPenalty
```

The first implementation can use conservative approximations, but the API contract should preserve this shape from day one.

Required scoring inputs:

- current pool state block number
- route calldata size
- estimated execution gas
- estimated data/finality fee from `L1GasPriceOracle`
- output token price proxy where available
- adapter recent success rate
- expected output after pool fees
- user slippage tolerance
- route expiry

The quote API should return both the winning route and the nearest alternatives. That lets the UI prove the route is best and gives engineering data to catch bad scoring.

## Router Contract Design

V1 router should support:

- exact-input swaps
- native DOGE in and out
- ERC-20 to ERC-20
- ERC-20 to native DOGE
- native DOGE to ERC-20
- `recipient`
- `minAmountOut`
- `deadline`
- allowlisted adapters
- emergency pause
- owner-controlled adapter registry, ideally timelocked before mainnet
- no arbitrary external call surface exposed to users
- clear events for route execution, adapter used, amount in, amount out, recipient, and fee if any
- optional Permit2 support only after the direct approval flow is stable and reviewed

V1 router should avoid:

- exact-output swaps
- arbitrary calldata from untrusted clients
- cross-chain logic
- intent settlement
- RFQ/market-maker settlement
- aggregator-of-aggregators dependency
- in-contract pathfinding

### Admin And Governance Model

Testnet can move faster, but mainnet should have stricter controls.

| Control | Testnet posture | Mainnet posture |
| --- | --- | --- |
| Router owner | Small multisig or deployer during rapid iteration. | Multisig with public signers where appropriate. |
| Adapter allowlist | Owner-controlled with emitted events. | Timelocked adapter additions/removals except emergency disable. |
| Pause | Immediate pause for critical bugs. | Immediate pause through multisig/security role, with public incident note. |
| Fees | Prefer disabled or near-zero while proving route quality. | Explicit policy, capped on-chain, visible in quotes. |
| Upgrades | Avoid upgradeable router if possible; deploy new versions and migrate. | Immutable or minimally upgradeable with timelock and migration docs. |
| Rescue functions | Only recover accidental stuck funds, never user funds in active swaps. | Same, with event emission and policy docs. |

The router should be easy to reason about. If a feature requires arbitrary external calls, complex custody, or hidden execution, it should not be in V1.

## Threat Model

| Threat | Example | Mitigation |
| --- | --- | --- |
| Stale quote | Pool moves after quote but before execution. | Quote TTL, block number in response, min-out, deadline, re-quote prompts. |
| Malicious token | Fee-on-transfer, blacklist, rebase, pause, broken return values. | Token risk registry, safe ERC-20 handling, warnings, default curated list. |
| Malicious pool or DEX | Pool lies through custom behavior or reverts selectively. | Adapter allowlist, per-adapter tests, monitored revert rates, partner review. |
| Backend manipulation | Quote API returns route favoring wrong venue. | On-chain min-out protects execution; route alternatives and scoring logs make manipulation visible. |
| RPC inconsistency | Primary RPC stale or wrong. | Multi-RPC checks, provider health scoring, block-number sanity checks. |
| Reorg | Indexed pool state rolls back. | 17+ block reorg buffer, rollback-capable indexer, latest-state caution in analytics. |
| Sandwich / MEV | User trade is moved against in mempool. | Conservative slippage defaults, fast expiry, optional private/protected routing later if DogeOS supports it. |
| Approval risk | User grants unlimited approvals to unsafe spender. | Router as approval target, clear allowance UI, exact approvals where practical, Permit2 review later. |
| Launchpad eligibility mismatch | User cannot participate or output is locked. | Preflight eligibility checks and explicit launchpad route labels. |
| Admin key compromise | Adapter allowlist or pause abused. | Multisig, timelock for non-emergency changes, public events, least-privilege roles. |

## Backend Design

The quote API should be stateless at the request boundary but backed by stateful caches:

- latest indexed pool states
- live RPC fallback for stale pools
- token metadata cache
- gas and data/finality fee cache
- RPC provider health
- route performance metrics

The route response should include:

- route ID
- input token, output token, amount in
- expected amount out
- min amount out
- estimated execution gas
- estimated data/finality fee
- total estimated DOGE fee
- calldata target and data
- approval target
- route explanation
- warnings
- expiry timestamp
- alternative routes and why they lost
- route source type: AMM, launchpad, RFQ, or meta-provider
- block number and pool state freshness

### Fee Estimation Algorithm

The quote API should estimate fees in a DogeOS-aware way:

1. Build candidate route calldata.
2. Estimate execution gas with `eth_estimateGas`.
3. Fetch current gas price or EIP-1559 fee fields from RPC.
4. Estimate Data and Finality fee with `L1GasPriceOracle` at `0x5300000000000000000000000000000000000002`.
5. Convert total DOGE fee into output-token terms when a reliable reference route exists.
6. Rank by net output.
7. Store executed swap telemetry and compare estimated fee vs realized fee.

If output-token conversion is unavailable, return both gross output and DOGE fee separately and avoid overclaiming precision.

## DogeOS Experience Surface

The aggregator should make DogeOS advantages visible in the actual swap surface.

### Swap Preview

The preview should show:

- best executable route
- DOGE execution fee
- DOGE Data and Finality fee
- total DOGE fee
- whether DogeOS fee modeling changed the winning route
- estimated confirmation progress
- route source types: DEX, launchpad, RFQ later, or meta-provider later

### Transaction Timeline

Use DogeOS speed and finality details instead of a generic pending spinner:

```text
Quote ready -> Wallet signature -> Submitted -> Included on DogeOS -> Confirmed -> Finality window
```

The UI should update quickly after inclusion while advanced details can explain that analytics and finality-sensitive views use a deeper confirmation window.

### DOGE-Native Onboarding

The first-run flow should prioritize:

- DogeOS SDK embedded/social login
- DogeOS Chikyū network switch
- faucet links for testnet DOGE and official tokens
- clear explanation of native DOGE vs WDOGE
- links to Blockscout after transaction submission, with L2scan added once its explorer route is confirmed

### Developer And Partner Surface

For DogeOS builders, expose:

- quote API examples using DogeOS chain ID
- token registry endpoint
- liquidity venue status endpoint
- route explanation schema
- adapter integration guide
- launchpad adapter guide
- Blockscout verification expectations

This positions the aggregator as DogeOS-native infrastructure rather than a standalone website.

## Indexer Design

The indexer should:

- ingest pool events over WS RPC when stable
- fall back to HTTP RPC polling
- tolerate reorgs up to at least 17 blocks
- store pool snapshots with block numbers
- track swap outcomes from our router
- compare quoted vs realized output
- flag adapters with elevated revert rates
- expose route analytics to the quote API

For final route analytics, treat blocks as final only after the configured confirmation window or explicit finality signal if exposed later.

## Product Positioning For DogeOS

The aggregator can become the best DogeOS-specific swap product by optimizing for the ecosystem rather than generic chain count:

1. Be the canonical DogeOS swap surface for official tokens and first-party DeFi pools.
2. Integrate the official wallet SDK more deeply than generic aggregators.
3. Explain DogeOS fees clearly, including the data/finality component.
4. Maintain verified token and pool lists instead of an unsafe open token search by default.
5. Publish transparent route scoring and adapter status.
6. Make it easy for new DogeOS DEXs to integrate through a documented adapter interface.
7. Provide public quote APIs once stable, so wallets and other apps can route through us.

The product should not need to win through traffic acquisition alone. It should win because it is demonstrably the best router:

- more DogeOS liquidity venues covered
- better net-rate scoring
- fewer failed swaps
- clearer DogeOS fee modeling
- faster support for new DogeOS DEXes and launchpads
- safer default token list
- better wallet onboarding through the official SDK

## Operational Expectations

To be taken seriously as DogeOS swap infrastructure, the system should expose operational quality clearly.

| Area | Target |
| --- | --- |
| Quote latency | Track p50/p95/p99 latency by route type and adapter. |
| Route freshness | Include pool state block number and quote expiry in every response. |
| Adapter health | Track success rate, revert rate, stale state, and response latency per adapter. |
| RPC health | Track primary RPC and Unifra fallback availability, height drift, and response latency. |
| Execution quality | Compare expected output, min output, realized output, estimated fee, and realized fee. |
| Incident response | Maintain playbooks for adapter disable, RPC outage, bad token listing, router pause, and indexer reorg. |
| Partner transparency | Provide integration status for each DEX/launchpad: pending, testing, live, disabled, or blocked. |

## Testing And Audit Plan

Testing must prove both math correctness and execution safety.

Required test layers:

- Unit tests for token math, fee conversion, slippage, and route scoring.
- Adapter tests using deterministic pool fixtures.
- Fork/integration tests against DogeOS Chikyū for every live adapter.
- Quote-vs-execution tests that execute small swaps and compare realized output.
- Router invariant tests: no stuck funds, min-out enforced, deadline enforced, no unauthorized adapter calls.
- Reorg simulation for the indexer with at least a 17-block rollback window.
- RPC fallback tests that simulate stale or unavailable providers.
- Launchpad adapter tests for sale phase, allocation limits, and non-transferable outputs.

Pre-mainnet audit expectations:

- Internal threat model review.
- External smart contract audit for router and adapters.
- Review of quote API trust assumptions.
- Public contract verification on Blockscout.
- Published admin key and adapter allowlist policy.
- Bug bounty or responsible disclosure path.

## Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Sparse testnet liquidity | Quotes may look bad or fail. | Start with official faucet tokens and known pools; show liquidity warnings. |
| Wrong token decimals | Severe quote/math errors. | Fetch metadata on-chain, cache with verification, never use chain defaults. |
| DogeOS fee underestimation | Bad net-route ranking and failed UX expectations. | Add DogeOS fee estimator using gas plus L1/data fee oracle; show estimates separately. |
| RPC instability | Slow or stale quotes. | Support primary RPC plus Unifra fallback; track provider health. |
| Reorgs | Incorrect index state and analytics. | Reorg-aware indexer with 17+ block buffer. |
| Arbitrary router call risk | User funds at risk. | Allowlisted adapters, narrow exact-input interface, min-out checks, audits. |
| SDK client ID requirement | Frontend integration may be blocked without approved client ID. | Keep wallet abstraction thin enough to support generic EIP-1193 fallback in development. |
| DEX contract diversity | Adapter maintenance grows. | Standardize adapter interface and test fixtures; start with V2/V3 families only. |
| Copying GPL code | Licensing conflict. | Use GPL projects as design references only unless project licensing strategy changes. |
| Mainnet changes | Testnet assumptions may shift. | Keep network config in one file/module and validate at startup. |
| Launchpad route confusion | Users may think a primary sale is a normal swap. | Label launchpad routes distinctly and surface vesting/transferability constraints. |
| Partner pressure on routing | Ecosystem partners may expect flow despite worse rates. | Publish route scoring and route alternatives; rank by net executable value only. |
| Hidden route quality regressions | Aggregator may silently stop giving best rates. | Continuous route comparison, quote sampling, and adapter health dashboards. |

## Why This Is The Best Initial Architecture

This is the right architecture for DogeOS because it matches the ecosystem's actual stage.

A full 1inch-style system is too broad for launch: it assumes many mature venues, dense liquidity, and an expensive route engine before the chain needs it. A generic hosted API integration is too shallow: it will miss DogeOS-specific fees, launchpad liquidity, official wallet onboarding, and local partner needs. A pure on-chain pathfinder is also the wrong starting point because it is expensive, harder to upgrade, and less flexible while the DEX landscape is still forming.

The recommended design separates concerns cleanly:

- backend route discovery can evolve quickly as new DEXes and launchpads appear
- on-chain router remains narrow and auditable
- DogeOS fee estimation is treated as a first-class ranking input
- token and pool registries protect users while the ecosystem matures
- adapters make partner integrations repeatable
- observability makes route quality measurable

That combination gives DogeOS the best practical path to a smooth, credible, best-rate aggregator.

## Implementation Phases

### Phase 0: Research And Network Readiness

- Maintain DogeOS network config and token registry.
- Identify deployed DEX factories, routers, pools, and fee tiers.
- Confirm Blockscout verification flow.
- Confirm DogeOS SDK client ID process.
- Define token listing policy, DEX adapter policy, launchpad adapter policy, and admin model.
- Create adapter integration checklist for ecosystem partners.

### Phase 1: Quote-Only Prototype

- Build token and pool registry.
- Add Barkswap Algebra-style CLAMM read adapter after ABI/source confirmation.
- Add MuchFi V3 read adapter after ABI/source confirmation.
- Add MuchFi V2 reserve-based read adapter.
- Add owned CLAMM read adapter once contracts are selected.
- Add best single-route solver for direct official-token swaps.
- Add DogeOS fee estimator.
- Return route previews without executing swaps.
- Return alternative routes and route-quality explanations.

### Phase 2: Router And Testnet Execution

- Deploy narrow exact-input router.
- Execute swaps through allowlisted adapters.
- Add min-out/deadline protection.
- Verify contracts on Blockscout.
- Track quote vs execution deltas.
- Add router invariant tests and adapter disable controls.

### Phase 3: UX And DogeOS SDK Integration

- Build swap UI around DogeOS SDK.
- Add embedded/social login flow.
- Add route explanation and fee breakdown.
- Add transaction status using Blockscout links.

### Phase 4: Liquidity Coverage

- Expand V3/CLAMM coverage beyond Barkswap, MuchFi V3, and owned CLAMM as new DogeOS pools appear.
- Add DogeOS-native DEX adapters as partners launch.
- Add launchpad adapters where sale mechanics are clear and safe.
- Add split routing only when net output improvement is measurable.

### Phase 5: Public Integrator API

- Expose quote API for DogeOS apps and wallets.
- Publish adapter contribution docs.
- Add status page for DEX adapters and RPC health.
- Publish route quality metrics and integration status for each liquidity venue.

## Open Questions

1. Which DEXs are already deployed or planned on DogeOS Chikyū?
2. Are there canonical factory/router addresses for DogeOS-native DEXs?
3. Will official stablecoins remain 18 decimals on mainnet?
4. What is the expected DogeOS SDK client ID approval process and timeline?
5. Does DogeOS expose a finality endpoint or should we rely on block-confirmation buffering?
6. Should protocol fees be disabled at launch to maximize trust and adoption?
7. Which explorer should be the canonical external transaction link: Blockscout, L2scan, or both?
8. Which launchpads are planned, and what sale/claim/vesting interfaces will they expose?
9. Will DogeOS support private/protected transaction submission or MEV-aware routing?
10. What partner-neutral criteria should govern default token and DEX listings?
11. Should route scoring be public from day one or first exposed to partners during testnet?

## Leadership Readiness Checklist

Before presenting this architecture as serious DogeOS infrastructure, we should be able to show:

- Chain config and official token registry verified against RPC.
- At least one live DEX adapter with quote-vs-execution tests.
- DogeOS fee estimator with execution fee and data/finality fee separated.
- UI and API that explicitly showcase DOGE-native fee handling, fast DogeOS status updates, official SDK onboarding, and native DOGE vs WDOGE distinctions.
- Router contract with min-out, deadline, adapter allowlist, and no arbitrary call surface.
- Token listing policy and risk flag taxonomy.
- DEX and launchpad integration checklist.
- Admin model for testnet and proposed mainnet model.
- Adapter health and quote quality metrics.
- Reorg-aware indexer design.
- Public route explanation format.
- Security review plan and audit path.

## Source Links

- DogeOS docs: https://docs.dogeos.com
- DogeOS developer quickstart: https://docs.dogeos.com/en/developers/developer-quickstart
- DogeOS Ethereum differences: https://docs.dogeos.com/en/developers/ethereum-and-dogeos-differences
- DogeOS transaction fees: https://docs.dogeos.com/en/developers/transaction-fees-on-dogeos
- DogeOS SDK docs: https://docs.dogeos.com/en/sdk
- DogeOS SDK guides: https://docs.dogeos.com/en/sdk/guides
- DogeOS embedded wallets: https://docs.dogeos.com/en/sdk/embedded-wallets
- DogeOS troubleshooting: https://docs.dogeos.com/en/sdk/troubleshooting
- DogeOS faucet: https://faucet.testnet.dogeos.com
- DogeOS Blockscout: https://blockscout.testnet.dogeos.com
- OKX DEX Router EVM: https://github.com/okxlabs/DEX-Router-EVM-V1
- Odos Router V2: https://github.com/odos-xyz/odos-router-v2
- ParaSwap / Velora DexLib: https://github.com/VeloraDEX/paraswap-dex-lib
- DexGuru Meta Aggregation API: https://github.com/dex-guru/meta-aggregation-api
- 0x Swap API: https://docs.0x.org/docs/0x-swap-api/introduction
- KyberSwap Aggregator: https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator
- OpenOcean Exchange V2: https://github.com/openocean-finance/OpenOceanExchangeV2
- 1inch archived on-chain protocol: https://github.com/1inch/1inchProtocol
