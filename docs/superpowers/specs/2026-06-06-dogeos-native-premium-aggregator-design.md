# DogeSwap Premium Aggregator Design

Date: 2026-06-06

## Objective

Build a DogeOS-native premium DEX aggregator that matches the useful parts of top aggregator products while staying honest about DogeOS testnet liquidity, verified venue metadata, wallet execution, and on-chain evidence.

The product must only show executable routes when the app can prove the route is backed by live DogeOS data, verified source metadata, fresh quote state, sender-aware simulation, gas estimation, DogeOS data/finality fee accounting, and wallet-ready transaction calldata.

## Core Architecture Decision

> **Superseded (2026-06-06):** The "no custom aggregator router contract" decision below has
> been intentionally reversed. The project now builds a mainnet-grade command/executor
> aggregation router with atomic swaps. See
> `2026-06-06-dogeos-premium-aggregator-v2-program.md` and
> `2026-06-06-dogeos-aggregation-router-spec.md`. The non-goals around owned
> DEX/pools/liquidity in this document still hold.

The next implementation phase should not deploy or depend on a custom aggregator router contract.

The safest current path is:

- Execute direct swaps through verified external DogeOS venue routers: MuchFi V2, MuchFi V3, and Barkswap Algebra where active.
- Keep WDOGE one-hop routes as read-only previews until there is a verified multi-leg execution surface.
- Keep split routing as read-only research until it has measurable net improvement after DogeOS gas plus data/finality fees and a verified execution path.
- Treat any future custom router as a separate security project with a contract address, ABI, threat model, simulation suite, and no pool creation or owned DEX deployment surface.

This keeps the current aggregator focused on real swap execution rather than adding an unaudited contract-mediated path too early.

## Current Baseline

The repository already includes:

- DogeOS Chikyu chain configuration, RPC, Blockscout, native DOGE gas handling, and L1 data/finality fee integration.
- Active MuchFi V2, MuchFi V3, and Barkswap Algebra source registry entries.
- Venue intelligence for active executable, read-only, watchlist, and rejected surfaces.
- V2, V3, and Algebra quote adapters.
- Direct route scoring with execution gas and DogeOS data/finality fee inputs.
- Sender-aware swap simulation and gas estimation before wallet signing.
- ERC-20 allowance planning.
- Wallet choices for MyDoge, MetaMask, and Rainbow.
- Blockscout-backed connected-wallet activity.
- Live chain status UI and API.

The implementation goal is to harden and extend these existing surfaces before adding broader route complexity.

## Scope

### Phase 1: Publishable Reliability

Make the existing aggregator demo dependable enough for GitHub review and DogeOS team evaluation.

Requirements:

- Commit and push the current verified changes.
- Add a README or PR-ready readiness summary with DogeOS chain ID, RPC, Blockscout, faucet, active venues, non-goals, and verification commands.
- Ensure `npm test`, focused API/web tests, production build, and rendered Playwright checks pass.
- Document known build warnings from SDK/wallet dependencies separately from runtime app errors.

### Phase 2: Wallet And Execution Correctness

Make swaps feel reliable across DogeOS-supported wallet paths.

Requirements:

- Preserve the user-selected provider so MetaMask never triggers Rainbow and Rainbow never triggers MetaMask.
- Treat MyDoge Link as either SDK-configured or injected-provider-backed, with a clear error when neither is available.
- Validate connected account, selected provider account, and DogeOS chain ID immediately before approval and swap sends.
- Use exact allowance by default for ERC-20 approvals.
- Simulate approval where possible before asking the wallet to sign.
- Build swap transactions only from fresh `/swap` responses.
- Poll receipts until terminal success or failure.
- Refresh balances only after confirmed receipt or real account/token changes.
- Show success/failure notifications tied to the actual receipt hash and block.

### Phase 3: DogeOS-Native Route Quality

Improve route quality without inventing unsupported execution surfaces.

Requirements:

- Keep direct active routes executable.
- Keep one-hop WDOGE routes read-only unless a verified multi-leg execution path exists.
- Rank all routes by net value after output amount, price impact, execution gas, DogeOS data/finality fee, and source reliability.
- Add route complexity warnings for one-hop and future split paths.
- Add source include/exclude controls that affect quote requests and are visible in route provenance.
- Add liquidity depth warnings based on live reserves, concentrated liquidity, and quoter output.
- Keep exact-output support aligned with the source adapters that can quote and build it safely.

### Phase 4: Venue Intelligence And Proof

Make the app useful to DogeOS reviewers and ecosystem partners.

Requirements:

- Expose router, quoter, factory, position manager, pool, fee tier, ABI provenance, bytecode status, selector evidence, and relationship-read status.
- Link every relevant contract and transaction to DogeOS Blockscout.
- Show why each venue is active, read-only, watchlist, or rejected.
- Record quote freshness, quote block, route TTL, gas estimate, data/finality fee sample, and simulation status in API responses.
- Keep rejected/non-spot contracts out of executable route lists.

### Phase 5: Premium Aggregator UX

Match the user-facing expectations of serious aggregators while staying data-backed.

Requirements:

- Show price impact, slippage protection, minimum received or maximum spent, gas, data/finality fee, and route provenance near the swap action.
- Use a transaction lifecycle panel with approval, simulation, signing, pending, confirmed, failed, and balance-refresh states.
- Keep route scan compact by default with expandable details.
- Show source health: quote latency, timeout/error count, and active executable count.
- Keep wallet balances visually stable during unchanged background refreshes.
- Keep mobile execution controls compact and avoid chart/route overlap.

## Data Flow

1. UI requests `/chain-status`, `/tokens`, `/sources`, `/venues`, `/intelligence`, and `/verification`.
2. User chooses wallet, source filters, tokens, amount, mode, and slippage.
3. UI requests `/quote`.
4. API runs verified source providers, quote adapters, DogeOS fee estimation, route scoring, and telemetry.
5. UI renders best route, route scan, warnings, fees, provenance, and execution readiness.
6. On swap, UI requests `/approval` if needed.
7. UI validates selected wallet provider, account, and DogeOS chain.
8. UI requests `/swap` for fresh calldata.
9. API rebuilds or refreshes the quote, simulates exact calldata, estimates gas, resolves exact DogeOS data/finality fee, and returns wallet transaction fields.
10. Wallet signs and sends.
11. UI polls receipt, refreshes balances on confirmed success, and links to Blockscout.

## Error Handling

Errors should explain the failing proof point:

- Wrong chain: show DogeOS Chikyu chain ID and switch/add-chain guidance.
- Wallet mismatch: show connected app account and provider account.
- Missing provider: show the selected wallet type and what was not announced by the browser.
- Approval failure: show spender, allowance target, and token.
- Swap simulation failure: show source, router, and revert/simulation reason.
- No route: distinguish no liquidity, read-only route only, stale quote, source timeout, inactive source, and filtered-out source.
- Insufficient DOGE: include execution fee and data/finality fee context plus DogeOS faucet link.

## Testing

Required verification for each implementation phase:

- Unit tests for route scoring, source filtering, one-hop read-only behavior, fee accounting, and wallet provider selection.
- API tests for `/quote`, `/approval`, `/swap`, `/activity`, `/chain-status`, `/venues`, `/intelligence`, and `/verification`.
- Static app tests for route scan, source filters, wallet choice, approval flow, receipt success/failure, balances, and activity.
- Rendered browser checks at desktop and mobile widths.
- Live DogeOS RPC smoke check for chain ID, block number, gas price, and data/finality fee.
- Production web build.

## Acceptance Criteria

The implementation is ready when:

- The GitHub branch contains the current working app changes and passing tests.
- The app can connect through the selected wallet path without switching to a different installed wallet.
- Direct executable routes build real wallet transactions for active verified venues only.
- Read-only one-hop and split candidates are clearly labeled as non-executable unless a verified execution path exists.
- Every displayed route, warning, fee, balance, activity item, and execution state is backed by live chain data, Blockscout metadata, verified registry metadata, or an explicit unavailable/error state.
- DogeOS reviewers can inspect chain config, venue evidence, router/quoter/factory/pool provenance, transaction links, and test output without guessing what is real.

## Non-Goals

- No owned DEX, pool factory, pool creation, liquidity management, or deployment path.
- No arbitrary calldata execution.
- No cross-chain swaps.
- No gasless/relayer system.
- No solver/RFQ system unless DogeOS liquidity and counterparties justify a separate design.
- No custom aggregator router contract in this phase.

## Spec Self-Review

- No placeholder scope remains.
- The architecture is consistent with direct external-router execution.
- Multi-hop and split routing are intentionally gated behind proof of a safe execution surface.
- Requirements are measurable through tests, live RPC checks, rendered browser checks, and Blockscout/registry evidence.
