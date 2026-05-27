# DogeOS Swap Frontend And Full Aggregator Design

Status: approved direction for implementation planning
Date: 2026-05-27
Scope: DogeOS Chikyu testnet swap frontend, quote service, full pathfinder, MuchFi V2/V3 and Barkswap adapter expansion, multihop routing, and audit-ready activation gates.

## Decision

Build the Option 3 path: a real DogeOS testnet swap product with a CoW/1inch-style simple swap surface, a backend pathfinder service, live on-chain quote reads, multihop routing, and adapter work for the sources needed to make the aggregator credible.

The selected V1 frontend skeleton is "Swap + Route Intelligence": a focused swap card on the left and a route/source/security panel on the right. The UI should feel familiar to users of modern aggregator swap forms, but use DogeOS branding, Doge-native language, and our own assets, copy, and route evidence. It must not be a static mockup.

## User Intent

The product should be real on testnet as soon as possible. It should connect a wallet, enforce DogeOS Chikyu, quote from live source state, build executable transactions where adapters are certified, submit real swaps, and show evidence for what the router actually did. The team wants to stop limiting the roadmap to a single direct V2 route and instead build toward V3, Algebra, and multihop aggregation now.

## Current Repo And Chain Baseline

Repository state on this branch:

- Deployed `DogeOSSwapRouter`: `0xBBf7ECC134350a9aF2BCA49A1420ac5E15fe54c3`.
- Deployed `DogeOSV2PairAdapter`: `0xe3D7979C510a3eBc7e3C60dB0F9f69c60E3D7A0E`.
- MuchFi V2 adapter is allowlisted and has a dust canary swap.
- `muchfi-v2` is executable in the aggregator registry.
- `muchfi-v3` and `barkswap-algebra` are quote-active but non-executable.
- DogeOS Chikyu chain ID is `6281971`.
- Official token evidence shows WDOGE, USDC, USDT, USD1, WETH, and LBTC as 18-decimal testnet tokens.
- Current read-only on-chain analysis is in `docs/dexv3/onchain-validation-2026-05-27.md`.
- Current security automation evidence is in `docs/dexv3/security-automation-2026-05-27.md`.

External UI references:

- CoW Swap: https://swap.cow.fi/
- 1inch simple swap page: https://1inch.com/swap?src=1:ETH
- 1inch help content describes the difference between simple and advanced modes, with simple mode focused on streamlined swaps and advanced mode exposing richer controls.

## Product Surface

### Primary Screen

The first screen is the actual swap experience, not a landing page.

Layout:

- Top bar with DogeOS swap brand, DogeOS Chikyu network indicator, source health, and connect wallet button.
- Left primary panel: swap card with Pay and Receive fields, token selectors, amount input, balance shortcuts, reverse-token control, slippage/settings control, and review/swap button.
- Right route intelligence panel: best route, source status, hop breakdown, estimated gas, DogeOS data/finality fee where available, min received, price impact, adapter certification state, latest canary/evidence, and transaction state.
- Lower compact panel or drawer: route alternatives and source details for MuchFi V2, MuchFi V3, and Barkswap Algebra.

Visual direction:

- Clean DogeOS-branded app UI with warm Doge gold, high-contrast ink text, restrained surfaces, 8px or smaller radii except the primary swap container where softer product-app geometry is acceptable.
- No decorative marketing hero, no generic landing-page sections, no unrelated meme clutter.
- Doge personality should come from logo/mark, tone, and color accents, not from sacrificing trading clarity.
- Keep the app dense enough for repeat use, but not a pro terminal in the first viewport.

### Core Interactions

- Connect wallet through an injected EIP-1193 provider.
- Detect wrong network and request DogeOS Chikyu switch/add.
- Read native DOGE and selected ERC-20 balances.
- Quote on amount/token changes with debounce and a clear stale/loading state.
- Show executable and non-executable sources separately.
- Let the user review route details before signing.
- For native DOGE input through the existing router, submit `DogeOSSwapRouter.exactInput` with `msg.value`.
- For ERC-20 input, require approval when allowance is insufficient, then submit the route.
- Show pending, confirmed, failed, and reverted transaction states with Blockscout links.
- Persist harmless UI preferences only: slippage, last selected tokens, and panel expansion. Do not persist private keys or sensitive wallet data.

## Routing Scope

### Route Families In Scope

1. Direct executable route:
   - DOGE/WDOGE to USDC through MuchFi V2.
   - DOGE/WDOGE to USDT through MuchFi V2 if liquidity and tests pass.

2. Direct quote routes:
   - MuchFi V3 pools listed in the source registry.
   - Barkswap Algebra pools listed in the source registry.

3. Multihop route families:
   - DOGE/WDOGE -> USDC -> USDT.
   - DOGE/WDOGE -> USDT -> USDC.
   - Official-token routes through WDOGE, USDC, and USDT as intermediate nodes.

4. Future split routes:
   - Model route data types now so split routes can be represented.
   - Do not enable split execution until direct and 2-hop execution are tested and canaried.

### Route Scoring

The pathfinder should rank routes by net output, not just gross quote.

Score inputs:

- Expected amount out.
- Pool fee.
- Price impact.
- Estimated router/adapter gas.
- DogeOS data/finality fee estimate from `L1GasPriceOracle` when available.
- Source execution status.
- Quote freshness block and TTL.
- Adapter certification stage.

Disabled or uncertified execution routes may be shown as quote alternatives, but must never be returned as executable transaction plans.

## Architecture

```text
apps/swap-web
  -> wallet + UI state
  -> quote-service client
  -> transaction builder/client execution

apps/quote-service
  -> DogeOS RPC reads
  -> source registry
  -> token registry
  -> pool readers
  -> pathfinder
  -> gas and L1 fee estimator
  -> route response API

packages/aggregator
  -> source registry
  -> adapter readers
  -> quote math
  -> graph/pathfinder
  -> route scoring
  -> executable route guards

contracts/src/adapters
  -> DogeOSV2PairAdapter
  -> DogeOSV3Adapter
  -> DogeOSAlgebraAdapter

scripts/deploy and scripts/analysis
  -> deploy adapters
  -> source verify
  -> allowlist
  -> route preflight
  -> canary swaps
  -> evidence capture
```

### Frontend App

Path: `apps/swap-web`.

Recommended stack:

- React + Vite + TypeScript.
- `ethers` for provider, wallet, and contract interactions.
- CSS modules or a small app-level stylesheet for design tokens. Avoid a heavy UI framework for V1.
- Unit tests with Vitest and component tests where practical.
- Browser verification through the installed browser tooling once the app runs.

Frontend modules:

- `src/config/dogeos.ts`: chain, explorer, router, adapter, token defaults.
- `src/wallet/`: connect, switch chain, account state, balance reads.
- `src/quotes/`: quote API client, polling/debounce, stale quote handling.
- `src/swap/`: transaction review, approval checks, exact-input execution.
- `src/components/SwapCard.tsx`: primary swap controls.
- `src/components/RoutePanel.tsx`: best route, alternatives, adapter/source evidence.
- `src/components/SourceStatus.tsx`: executable, quote-active, watchlist states.
- `src/components/TransactionTimeline.tsx`: approval/swap lifecycle and Blockscout links.

### Quote Service

Path: `apps/quote-service`.

Recommended stack:

- Small Node TypeScript HTTP service.
- Use `ethers` and existing package code.
- Keep storage optional for V1; reads can be RPC-backed with in-memory TTL cache.
- Return JSON only. No private key. No signing. No transaction broadcast.

Initial API:

- `GET /health`: chain ID, latest block, RPC health, known router/adapter addresses.
- `GET /sources`: source registry with execution/quote status and evidence links.
- `GET /tokens`: DogeOS token list with decimals and addresses.
- `GET /quote?tokenIn=&tokenOut=&amountIn=&slippageBps=`: best route, alternatives, gross/net output, gas, min out, source status, route data, executable flag.
- `GET /evidence`: router, adapter, allowlist, canary, and latest on-chain validation summary.

### Shared Aggregator Package

Extend `packages/aggregator`.

New modules:

- `src/routes/types.ts`: `Route`, `RouteHop`, `RouteQuote`, `ExecutableRoutePlan`, `RouteStatus`.
- `src/pathfinder/graph.ts`: token/source graph from known pools.
- `src/pathfinder/findRoutes.ts`: direct and 2-hop route enumeration.
- `src/scoring/scoreRoute.ts`: net output after gas and DogeOS fee.
- `src/guards/executionGuards.ts`: executable route gating by source, adapter, evidence, and route family.
- `src/quotes/v2.ts`: existing V2 math generalized for pathfinder.
- `src/quotes/v3.ts`: CLAMM quote support after adapter math/API is confirmed.
- `src/quotes/algebra.ts`: Algebra quote support after pool formula/API is confirmed.

## Adapter Expansion

### MuchFi V2

Current status: executable for direct pair route through `DogeOSV2PairAdapter`.

Next work:

- Expand route support to the USDT pair.
- Add multihop support either by composing multiple router calls safely or by adding a typed multihop adapter/route format.
- Add canary for DOGE -> USDT if sufficient liquidity exists.

### MuchFi V3

Current status: quote-active only.

Required work:

- Confirm exact router/quoter ABI provenance for the MuchFi V3 deployment, or implement an adapter that can execute safely against a verified V3 pool interface.
- Add V3 interfaces needed for exact-input single-hop and eventual multihop.
- Add `DogeOSV3Adapter` with typed route data, canonical pool validation, token order validation, min-out enforcement, and no arbitrary calldata.
- Add unit tests, fork/testnet preflight, source verification, allowlist, and canary before setting `executionSupport: "enabled"`.

### Barkswap Algebra

Current status: quote-active only.

Required work:

- Confirm Algebra pool and swap callback behavior on DogeOS.
- Add Algebra interfaces for exact-input execution.
- Add `DogeOSAlgebraAdapter` with typed route data, canonical pool validation, token order validation, min-out enforcement, and no arbitrary calldata.
- Add unit tests, fork/testnet preflight, source verification, allowlist, and canary before setting `executionSupport: "enabled"`.

## Security Model

The UI and quote service must make uncertified routes visible without making them executable.

Execution gate for any new source:

1. Source registry entry exists with stable source ID.
2. Contract addresses and ABIs are mapped.
3. Quote math/read path is tested against live on-chain state.
4. Solidity adapter is implemented with typed route data.
5. Adapter unit tests cover success, wrong token order, wrong pool, zero amount, zero address, min-out, native value rejection, and malformed route data.
6. Integration tests cover router allowlist, pause, deadline, min-out, approvals, native DOGE wrap/unwrap where relevant, and allowance reset.
7. Fork/testnet preflight estimates gas and simulates representative route.
8. Adapter is deployed and source verified on Blockscout.
9. Adapter is explicitly allowlisted by router owner.
10. Dust-size canary swap succeeds and captures evidence.
11. Registry changes to `executionSupport: "enabled"` only after the evidence exists.

Frontend safety requirements:

- Never ask for or store private keys.
- Never use the deployer private key in the browser or quote service.
- Require wallet confirmation for approvals and swaps.
- Show approval spender as the deployed router.
- Show route source and adapter address before swap.
- Enforce slippage/min-out in calldata.
- Reject stale quotes.
- Reject wrong-chain transactions.
- Show testnet-only status clearly.

## Testing And Verification

### Frontend

- Unit tests for token amount parsing/formatting with 18 decimals.
- Unit tests for chain switching request payload.
- Unit tests for quote stale-state handling.
- Unit tests for approval-required decision.
- Component tests for source status and route panel rendering.
- Browser tests for desktop and mobile layout, wallet disconnected state, wrong network state, quote loading, review modal, and transaction timeline.

### Quote Service And Aggregator

- Unit tests for route graph generation.
- Unit tests for direct and 2-hop route enumeration.
- Unit tests for source execution guards.
- Unit tests for route scoring with gas and L1 fee inputs.
- Tests proving quote-active V3/Barkswap routes are not executable until evidence gates pass.
- Live read-only analysis command for source bytecode, pools, liquidity, and Blockscout verification status.

### Solidity

- Keep existing router/V2 adapter tests passing.
- Add tests for every public/external adapter function.
- Add mock V3 and Algebra pools before live adapter work.
- Add fork/testnet gas profiles for each adapter.
- Add canary scripts per adapter and route family.
- Add coverage gates before deployment.

### Acceptance Commands

Minimum commands before a frontend/aggregator PR is called ready:

```bash
pnpm test
pnpm compile
pnpm lint:placeholders
pnpm lint:secrets
pnpm security:local
pnpm analysis:dogeos
```

Additional commands before adapter deployment or allowlisting:

```bash
pnpm coverage
pnpm gas:router
pnpm gas:dogeos-v2-adapter
pnpm deploy:preflight:adapter
pnpm deploy:verify:adapter
pnpm deploy:preflight:allowlist:adapter
pnpm deploy:preflight:route:v2
```

New commands should be added for V3 and Algebra adapter gas, deployment, route preflight, and canaries as those adapters are implemented.

## Implementation Phases

### Phase 1: Real Swap UI For Existing Live Route

- Scaffold `apps/swap-web`.
- Implement DogeOS Chikyu wallet connection.
- Implement real DOGE -> USDC quote through the quote service or direct RPC reads.
- Implement review and execution through the deployed router/adapter.
- Show route intelligence panel with current evidence.
- Verify with browser screenshots and at least one dry-run transaction preparation path.

Acceptance:

- User can connect wallet on DogeOS Chikyu.
- User can quote the current MuchFi V2 route from live state.
- User can submit a real dust-sized testnet swap through the existing router.
- UI shows transaction hash and Blockscout link.

### Phase 2: Quote Service And Pathfinder

- Add `apps/quote-service`.
- Add direct and 2-hop route graph in `packages/aggregator`.
- Add source status and evidence APIs.
- Add route scoring and TTL.
- Wire frontend to quote service.

Acceptance:

- Quotes include best route and alternatives.
- MuchFi V2 executable route is marked executable.
- MuchFi V3 and Barkswap are visible but marked quote-only.
- DOGE -> USDC -> USDT and DOGE -> USDT -> USDC are enumerated when pools exist.

### Phase 3: MuchFi V2 Multihop Execution

- Decide whether multihop is safest as router-level sequential adapter calls or as a dedicated typed multihop adapter.
- Implement only after tests define token custody and residual-balance invariants.
- Add DOGE -> USDC -> USDT preflight and canary.

Acceptance:

- Multihop execution cannot leave residual tokens in the router.
- Min-out is enforced on final output.
- Intermediate route data is typed and source-gated.
- Dust canary evidence exists before frontend marks route executable.

### Phase 4: MuchFi V3 Adapter

- Confirm ABI/provenance.
- Implement adapter and quote integration.
- Add deployment, verification, allowlist, preflight, gas profile, and canary.

Acceptance:

- V3 direct route is executable only after evidence gate.
- Frontend changes source status automatically from quote-only to executable based on registry/evidence.

### Phase 5: Barkswap Algebra Adapter

- Confirm Algebra swap/callback behavior.
- Implement adapter and quote integration.
- Add deployment, verification, allowlist, preflight, gas profile, and canary.

Acceptance:

- Algebra direct route is executable only after evidence gate.
- Frontend shows route source, adapter, gas, min-out, and canary evidence.

## Out Of Scope For This Spec

- Mainnet launch.
- Cross-chain swaps.
- Limit orders.
- Intent auctions/solvers.
- RFQ market makers.
- Production indexer with persistent database.
- Split-route execution before direct and 2-hop execution are proven.
- Owned Pancake V3 deployment.

## Open Decisions Resolved For Planning

- Layout skeleton: Option B, Swap + Route Intelligence.
- Product mode: real DogeOS Chikyu testnet app, not a static demo.
- Aggregator direction: full pathfinder and backend service are in scope.
- Initial live execution: MuchFi V2 only until new adapters pass evidence gates.
- V3 and Algebra: in scope for adapter implementation, not automatic execution.
- Multihop: in scope, with DOGE/WDOGE, USDC, and USDT as the first route graph.

## Spec Self-Review

- Placeholder scan: no unresolved placeholder markers remain.
- Consistency check: frontend, quote service, package, contract, and script boundaries all align with the Option 3 direction.
- Scope check: broad but coherent; implementation should be split into phases and not attempted as one patch.
- Ambiguity check: quote-active and executable states are explicitly separate, and adapter activation gates are concrete.
