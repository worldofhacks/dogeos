# External protocol deep dives (researched 2026-07-02)

Curated reference for comparing DogeSwap's design against the major aggregation/settlement
protocols. Each section ends with "For DogeSwap" — what to adopt, what to ignore. Uncertainties
from the original research are preserved at the bottom; do not present those items as settled fact.

---

## 1. 1inch (state as of mid-2026)

Four layered systems sharing one deployment: (1) **Aggregation Protocol** ("Classic Swap") —
offchain Pathfinder routing + onchain AggregationRouterV6 executing API-built calldata; (2)
**Limit Order Protocol v4 (LOP)** — onchain signed-order settlement, same contract/address as the
router; (3) **Fusion** — intent/Dutch-auction orders as LOP extensions settled by whitelisted
resolvers; (4) **Fusion+** — cross-chain Fusion via hashlock/timelock escrows (no bridge). No
Router v7 exists — v6 (Feb 2024) is still the flagship.

### AggregationRouterV6 (= LOP v4)
- Single address on ~all EVM chains: `0x111111125421ca6dc452d289314280a0f8842a65` (zkSync Era
  differs). Router v6 and LOP v4 are the SAME deployed contract — classic swaps, limit orders, and
  Fusion fills all enter through one address.
  (https://github.com/1inch/limit-order-protocol)
- Inheritance: GenericRouter (generic `swap()`), UnoswapRouter (direct pool paths), ClipperRouter,
  OrderMixin (LOP + `permitAndCall`), Ownable/Pausable + `rescueFunds`.
  (https://www.openzeppelin.com/news/aggregation-protocol-diff-audit)
- **Two execution paths:**
  1. **`unoswap` family** — `unoswap/unoswap2/unoswap3(token, amount, minReturn, dex[, dex2,
     dex3])` + `unoswapTo*`/`ethUnoswap*` variants. Pool addresses passed externally in calldata:
     each `dex` word is a packed uint256 = pool address in low bits + high-bit flags selecting
     protocol family (UniV2-like / UniV3-like / Curve) and behaviors (WETH wrap/unwrap; the
     permit2 flag moved into the `srcToken` word in v6). Cheapest gas path for 1-3 hops. Curve
     calls are restricted to **18 preconfigured selectors picked by a 1-byte index** instead of
     free 4-byte selectors — the key v6 hardening against arbitrary-call injection.
  2. **Generic `swap(address executor, SwapDescription desc, bytes data)`** — arbitrary
     multi-venue split routes. Router pulls funds, hands execution to a 1inch-operated
     IAggregationExecutor with opaque route bytes, then **checks the resulting balance delta
     against `minReturnAmount` onchain and reverts otherwise**. The API can emit any route; user
     protection is the router's measured-return check, not API trust.
- Permits: v6 removed permit params from swap functions; `permitAndCall(bytes permit, bytes
  action)` composes ERC-2612/DAI/Permit2 approval with any router call in one tx.
- Footgun: tokens sent directly to the router can be swept by anyone via public rescue paths — the
  router is not a vault. (https://carbontec.io/blog/1inch-router-rescuefunds-exploit)

### Classic Swap API v6.1
`/quote` (route discovery), `/swap` (ready-to-send tx: `tx.to` = router, `tx.data` =
unoswap-or-generic call, `tx.value`, `gas`), `/approve` helpers; `slippage` bakes minReturn into
calldata; `referrer`/`fee` for integrators. All routing intelligence offchain and proprietary; the
chain only verifies outcomes. (https://business.1inch.com/portal/documentation/apis/swap/classic-swap/introduction)
Fees: no onchain protocol fee by default; the DAO discontinued swap-surplus capture
(https://blog.1inch.com/the-1inch-dao-discontinues-swap-surplus-collection/), but the API-provider
layer may retain ~0.3-1% of positive slippage; integrator fees via `referrer`/`fee` and LOP's
FeeTaker extension.

### Pathfinder
Closed-source. Confirmed mechanics only: liquidity as a weighted directed graph (tokens = nodes,
pools = edges); splits a trade across venues AND across multiple pools of the same pair ("market
depths"); multi-hop through intermediates; **gas-aware** — route value scored net of gas so extra
splits must pay for themselves; quote latency ~0.4s since v2.
(https://1inch.com/blog/post/introducing-1inch-v2-defis-fastest-and-most-advanced-aggregation-protocol)
Treat specific search strategies (convex splitting vs DP) as unknown.

### Fusion (intents / Dutch auction)
User signs a gasless LOP order with a decaying price curve; **resolvers** (professional MMs)
compete; first fill at the current curve price wins; user pays no gas, failed executions cost
nothing. `AuctionDetails {gasBumpEstimate, gasPriceEstimate, startTime, duration, initialRateBump,
points[]}` — piecewise-linear decay to the user's floor; gas bumps shift the curve with observed
baseFee. Settlement: resolver worker → Settlement `settleOrders` → LOP `fillOrder` → resolver
sources liquidity in the taker-interaction callback → Settlement forwards to users; batches up to
32 orders. Resolver gating: whitelist with allowed-from timestamps (priority windows); offchain
KYB + ≥5% of Unicorn Power (st1INCH staking), max 10 resolvers.
(https://github.com/1inch/limit-order-settlement, https://github.com/1inch/fusion-sdk,
https://1inch.com/blog/post/fusion-swap-resolving-onchain-component,
https://mixbytes.io/blog/modern-dex-es-how-they-re-made-1inch-limit-order-protocols)

### Fusion+ (cross-chain, live since 2024-09-18)
Fusion auction picks the resolver, then classic HTLC atomic swap: maker order embeds
`hash(secret)`; resolver deploys EscrowSrc (maker tokens via LOP post-interaction) and EscrowDst
(resolver's own tokens) as CREATE2 clones-with-immutable-args; a relayer verifies both escrows +
finality; maker discloses the secret; resolver withdraws src with the preimage. Timelock phases
per escrow: finality lock → private withdrawal → public withdrawal (anyone, earns the resolver's
native safety deposit) → private/public cancellation. Partial fills: N+1 secrets in a Merkle tree.
Ports to any chain with hashlock capability — including Bitcoin-family script (relevant if
DogeSwap ever bridges to Dogecoin L1). (https://github.com/1inch/cross-chain-swap)

### Limit Order Protocol v4 (tag 4.3.2)
Order struct: maker/taker assets+amounts, salt (binds the extension blob hash), `MakerTraits`
bit-packed word (expiry, private taker, approval scheme, partial/multiple fill, wrap, pre/post
interaction flags, epoch mass-invalidation). Fill path `_fill()`: extension-hash check → expiry →
**predicate** staticcall (arbitrary onchain condition — stop-loss/oracle triggers) → amount branch
→ BitInvalidator nonce → maker pre-interaction → transfers (transferFrom or Permit2) →
takerInteraction (resolver liquidity sourcing) → maker post-interaction (where Fusion Settlement
hooks in). Extensions: DutchAuctionCalculator, RangeAmountCalculator, PredicateHelper, ERC721Proxy,
FeeTaker. (https://github.com/1inch/limit-order-protocol)

### For DogeSwap
Adopt: (1) invariant-onchain/intelligence-offchain (we already do this — keep it); (2) two-tier
calldata — a packed direct path for single-venue swaps beside the generic program path; (3)
indexed command/selector whitelists over free calls (our command set already does this); (4)
LOP-style signed order + taker-interaction callback is the cheapest way to add an RFQ/limit-order
lane later; (5) Dutch-decay as an extension calculator is a drop-in intent primitive. Ignore:
Fusion resolver economics (staking token + 10 professional MMs + offchain auction infra), the
single-contract-forever deployment model (allowance migration pain on v4→v5→v6; our
Permit2-ingress + redeploy model avoids it).

---

## 2. 0x Settler (0x v2) — DogeSwap's design lineage

Sources: https://github.com/0xProject/0x-settler,
https://0x.org/docs/developer-resources/core-concepts/contracts,
https://0x.org/post/0x-v2-eliminate-allowance-risk-with-permit2

- **Core shift from v4:** ExchangeProxy held persistent allowances + upgradeable features. Settler
  holds **zero standing allowances**, is non-upgradeable, and is replaced by fresh deployments
  registered onchain. Approving an ERC-20 to a Settler address is a documented fund-loss footgun —
  only Permit2 or AllowanceHolder should ever be approved.
- **Two allowance targets:** Permit2 `SignatureTransfer.permitTransferFrom` (EIP-712
  `PermitTransferFrom` naming Settler as spender; single-use nonce, amount-capped,
  deadline-bounded — two signatures per trade) or **AllowanceHolder** (single-signature UX:
  standing ERC-20 allowance to AllowanceHolder, which creates an ephemeral same-tx allowance and
  forwards the authentic caller ERC-2771-style; deterministic per-hardfork addresses — Cancun
  `0x0000000000001fF3684f28c67538d4D072C22734`).
- **Execution:** `execute()` with a bytes action list (`ISettlerActions`, explicitly not a stable
  ABI). Venue "VIP" paths execute the Permit2 pull inside the pool's swap callback (user→pool, no
  Settler custody). EIP-1153 transient reentrancy guard. 30-37% gas reduction vs v4.
- **Gasless metatx:** user signs one Permit2 `PermitWitnessTransferFrom` whose witness is
  `SlippageAndActions(recipient, buyToken, minAmountOut, actions)` — the relayer can't alter
  actions or slippage without invalidating the signature; it can only censor/delay.
- **Registry:** `Deployer` at `0x00000000000004533Fe15556B1E086BB1A72cEae`, ERC721-shaped —
  feature = tokenId (2 taker, 3 metatx, 4 intents, 5 bridge); `ownerOf(featureId)` = current
  Settler, `prev()` valid during API dwell. Integrators must verify a quoted Settler via the
  registry ("CounterfeitSettler" check). 2-signer Safe for deploys + a unilateral pauser contract.

**DogeSwap lineage:** `packages/contracts/src/DogeSwapRouter.sol` explicitly follows this design —
immutable command router, Permit2-only ingress (user approves Permit2, never the router), EIP-1153
transient guard, ephemeral exact venue approvals cleared after each hop, upgrades = redeploy +
registry/env repoint. Differences: DogeSwap uses Permit2 **AllowanceTransfer** (standing Permit2
allowance with the router as spender, per-token expiry) rather than single-use SignatureTransfer;
a movement-only command set instead of venue-VIP actions; and a mandatory settlement step
(measured-delta minOut + refunds + fee) instead of per-action slippage.

### For DogeSwap
Adopt: witness-bound metatx (SlippageAndActions pattern) if gasless is ever added — it is the
minimal-trust relayer design; registry-based deployment verification for external integrators
(DogeSwapRegistry already exists, `0xC596081d427E8296e089eDD59a62E73Da3191215`, but the web app
pins by env var). Ignore: VIP callback paths (3 venues, testnet gas — no payoff) and
AllowanceHolder (our Permit2 AllowanceTransfer flow already gives single-approval UX).

---

## 3. UniswapX

Sources: https://blog.uniswap.org/uniswapx-protocol, https://github.com/Uniswap/UniswapX,
https://developers.uniswap.org/contracts/uniswapx/overview, https://www.erc7683.org/spec

- **Model:** swapper signs an offchain order (gasless; only exceptions: one-time Permit2 approval,
  native wrapping). Permissionless fillers compete to submit. The signature is a Permit2
  `permitWitnessTransferFrom` **with the order as witness** — the token pull is only valid through
  the reactor under the order's exact terms.
- **Reactors** (all `IReactor`): Limit, Dutch (linear time decay), ExclusiveDutch, V2Dutch
  (mainnet `0x00000011F84B9aa48e5f8aA8B9897600006289Be`), V3Dutch (block-based nonlinear
  multi-point decay), PriorityOrderReactor (Base/Unichain). Fill paths: direct `execute` (reactor
  pulls filler's output via Permit2) or `executeWithCallback` → filler sources liquidity in
  `reactorCallback` (sample `SwapRouter02Executor`). The reactor enforces ONLY: signature/nonce,
  deadline, decay-curve resolution at fill time, exclusivity rules, outputs reaching the swapper.
  All price discovery is offchain.
- **Auctions in production** ("RFQ + exclusive Dutch"): Dutch V2 — offchain RFQ winner gets ~24s/2
  block exclusive fill rights; a Uniswap Labs **cosigner** sets auction start within the user's
  signed bounds (adjusts to real-time price between signature and submission); exclusivity is soft
  (override premium `exclusivityOverrideBps`); unfilled orders decay block-by-block to the user's
  floor. Dutch V3 — block-number decay, ~2-4s exclusivity. Priority orders — competition in the
  priority-fee dimension: each wei above `baselinePriorityFeeWei` owes the swapper 1 milli-bps
  more output (`mpsPerPriorityFeeWei`); losers revert early.
- **Cross-chain:** ERC-7683 (co-authored with Across) — `GaslessCrossChainOrder`,
  `IOriginSettler.open/resolve`, `IDestinationSettler.fill`, `ResolvedCrossChainOrder` with
  maxSpent/minReceived/FillInstruction[]. Uniswap interface bridging is Across-powered; The
  Compact is their resource-lock primitive.
- **MEV posture:** orders filled from filler inventory can't be sandwiched; decay returns would-be
  arb to the swapper; failed fills cost the swapper nothing; residual MEV moves to the filler
  layer (exclusivity windows are a priced form of it).

### For DogeSwap
Adopt: this is the template for a DogeSwap intents V2 — open Dutch decay (no cosigner, no RFQ) is
the zero-infrastructure variant: order = {start amount = best quote, end amount = slippage-cap
floor, window}; the existing DogeSwapRouter gains one reactor-style entrypoint; the existing
aggregator becomes the first filler's routing engine. Adopt ERC-7683 structs if Dogecoin-L1
bridging ever materializes. Ignore: cosigner infrastructure (a trusted operator for surplus
capture) and priority-fee auctions (DogeOS is not a PGA chain).

---

## 4. CoW Protocol

Sources: https://docs.cow.fi/cow-protocol/concepts/introduction/cow-protocol,
https://docs.cow.fi/cow-protocol/reference/contracts/core/settlement,
https://docs.cow.fi/cow-protocol/concepts/introduction/fair-combinatorial-auction,
https://docs.cow.fi/cow-amm

- **Model:** users sign EIP-712 intents (`GPv2Order.Data`; ERC-1271 for smart accounts; onchain
  pre-sign); the autopilot cuts **batch auctions**; bonded allowlisted solvers compete to settle.
  Placement free; failed settlement costs the solver.
- **Settlement:** `GPv2Settlement` `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` (same address on
  9+ chains). `settle(tokens, clearingPrices, trades, interactions[3])` — pre/intra/post
  interaction stages are arbitrary calls for liquidity sourcing, but interactions CANNOT pull user
  funds; only **GPv2VaultRelayer** (`0xC92E8bdf79f0507f65a392b0ab4667716BFE0110`, the actual
  allowance target — never the settlement contract) moves sell tokens, and only against a
  satisfying trade.
- **Onchain enforcement:** signature, validTo, fill accounting (partial fills), and each trade
  executing at the **uniform clearing price** at-or-better than the signed limit. Everything else
  (matching, pricing, routing, scoring, EBBO checks) is offchain.
- **MEV posture:** uniform directed clearing prices make intra-batch reordering worthless; no
  public mempool exposure; CoWs (coincidence of wants) match peer-to-peer with zero AMM contact.
  **EBBO:** delivered prices must beat what baseline onchain liquidity would give.
- **Fair combinatorial auction** (current): solvers submit per-order AND batched bids; unfair
  batched bids filtered; winner set maximizes total surplus with same-directed-pair consistency;
  second-price-style rewards. Chain-specific settlement deadlines (mainnet 3 blocks … Arbitrum 11).
- **CoW AMM:** FM-AMM pools rebalanced through the batch auction — solvers bid for the right to
  rebalance so the arb spread (LVR) accrues to LPs instead of arbitrageurs.
- Residual risk surface: the Feb 2023 solver exploit drained settlement-contract **buffer** funds
  via an interaction — not user funds.

### For DogeSwap
Adopt: the allowance discipline (users approve a relayer/Permit2, never the settlement contract —
already ours), EBBO as a concept — our venue quoters are exactly the baseline-liquidity price
floor a solver system would be held to. Ignore: batch auctions and solver bonding — they require
order-flow density and a solver ecosystem DogeOS testnet cannot supply; a batch with one order is
just a worse single swap.

---

## 5. Relay (relay.link)

Sources: https://docs.relay.link/what-is-relay,
https://docs.relay.link/references/protocol/how-it-works.md,
https://docs.relay.link/references/api/get-quote-v2.md

- **Model:** cross-chain intents where **solvers fill on the destination chain with their own
  capital**, then prove the fill for repayment. No auction — the quote binds a specific solver.
- **Lifecycle:** (1) POST /quote/v2 returns a solver commitment + `steps[]`; (2) user deposits
  into the per-chain non-upgradable **Depository** (NOT the solver) with an orderId in calldata
  (~21-32k gas); (3) solver detects the deposit and fills near-instantly (observed timeEstimate
  2s Sepolia→Base Sepolia); (4) settlement per-order in real time: oracle validators sign EIP-712
  attestations → Hub ledger on the dedicated Relay Chain credits the solver (~$0.005/order); (5)
  solvers withdraw on any chain via an MPC Allocator. No challenge window, no LP pool on the
  repayment path (contrast Across: UMA optimistic oracle, ~1.5h bundles).
- **API patterns worth copying:** `steps[].items[].data` executable tx objects +
  `check.endpoint` polling; `GET /intents/status/v3` state machine
  (waiting→depositing→pending→submitted→success | delayed | refund | failure); typed quote errors
  with explicit transient classes (REQUEST_TIMED_OUT / RPC_HTTP_ERROR = retry with backoff — the
  same transient-vs-genuine split our sourceQuoteRunner enforces); `refundTo` (unset = NO
  automatic refunds); fast origin-chain refunds when the solver can't fill; deposit-address flows
  for walletless senders. Fees: $0.02 flat + fill gas + 0-15bps by pair class; read display fees
  from `details.expandedPriceImpact`.
- **DogeOS status (verified 2026-07-02):** NOT supported — testnet API serves only Sepolia and
  Base Sepolia; mainnet GET /chains returned 72 chains. Onboarding is a BD conversation
  (support@relay.link); Relay deploys the Depository and arranges solver support — not unilaterally
  integrable.

### For DogeSwap
Adopt: the status-endpoint state machine and step-execution response shape if we ever expose
multi-step flows; the explicit transient error taxonomy (we converged on the same idea
independently). Ignore for now: everything cross-chain — revisit only if DogeOS mainnet + a
Dogecoin-L1 bridge story creates demand, and then compare Relay-BD vs a Fusion+-style HTLC design
(which works on Bitcoin-family script without a partner).

---

## 6. Meta-aggregator briefs (researched 2026-07-02)

### ParaSwap → Velora (rebranded April 2025)
Two modes: **Market** (Augustus v6.2 `0x6a000f20005980200259b80c5102003040001068`, own pathfinder,
API-built calldata) and **Delta** (intents: ERC-2098 signed orders, sealed-bid solver auction on
Portikus, cross-chain via bridge-aware solvers). Fee model to note: **positive-slippage capture,
50/50 user/protocol split by default**, integrator-configurable (`isSurplusToUser`); partner fees
accrue in a FeeClaimer (pull) or push directly. (https://velora.xyz/docs/augustus-swapper,
https://www.velora.xyz/docs/delta/overview)

### KyberSwap
Own pathfinder splitting across 420+ sources incl. RFQ/PMM and its own limit orders as liquidity.
**Two-step API** — `GET /{chain}/api/v1/routes` (fast discovery, `routeSummary` + `routeID` +
`checksum`; don't cache >5-10s) then `POST /route/build` (encode at execution) — the cleanest
quote-vs-build separation in the industry. `gasInclude` gas-aware routing default-on. Single
router `MetaAggregationRouterV2` `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` everywhere.
Integrator fees fully parameterized (`chargeFeeBy currency_in|currency_out`, `feeAmount` bps,
`feeReceiver`). Positive slippage accrues to Kyber. **Smart Settlement (2026-05-14):** the route
carries multiple candidate pools per hop and the router compares them ON-CHAIN at execution,
atomically switching to the better pool — execution-time drift defense with no offchain auction.
(https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator,
https://blog.kyberswap.com/introducing-smart-settlement/)

### LI.FI
Aggregator of aggregators: 3-leg routes (source swap → bridge → destination swap) quoted across
bridges, DEX aggregators, and intent solvers; 58+ chains incl. Solana/Bitcoin/Sui. LiFiDiamond
(EIP-2535) `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` with per-venue facets — venues added/killed
without redeploy. `/status` endpoint with substatus granularity + recovery guidance is the
reference design for cross-chain status APIs. 2025-26: LI.FI Intents (standing solver quotes,
escrow/Compact resource locks, Open Intents Framework founding member).
(https://docs.li.fi/introduction/lifi-architecture/system-overview, https://docs.li.fi/llms.txt)

### Socket / Bungee
Meta-aggregation over external DEX providers (0x v2, KyberSwap, …) and bridges (Across, CCTP,
Relay, …) + **Bungee v2 Open Liquidity Marketplace** intents (solver auction, Transmitters,
whitelisted/staked/permissionless routes; "Auto" gasless vs "Manual" classic). Swap V3 API:
`quoteId` + `expiresAt` + `suggestedSlippage` + `routeTags` on every route; same native sentinel
as ours (`0xEeee…EEeE`). OpenRouter `0x50cFe7c1938dB66A1a6D2e86D36F39FBef3d5c4a` + AllowanceHolder
`0x50c4E75a512F2A14A7b304787Adf79C4531A5909`. No protocol fee; integrator `feeBps`.
(https://docs.socket.tech/, https://docs.bungee.exchange/overview/open-liquidity-marketplace/)

### Jupiter (Solana)
Three generations shipping together: **Metis** (own pathfinder; v7 spun out to metis.builders
2025-11-17), **JupiterZ** (RFQ, 20+ MMs, zero-slippage, gasless), **Juno/Ultra** (meta-engine over
Metis + JupiterZ + third-party routers with self-learning demotion of underperformers). Ultra V3
(Oct 2025): Predictive Execution (pre-submission realized-price simulation), RTSE (real-time
slippage estimator: token-category heuristics + EMA volatility + failure monitoring), private
landing infra. Fees: classic Swap API zero protocol fee + `platformFeeBps` for integrators; Ultra
~2bps stables / ~10bps others, Jupiter keeps 20% of integrator fees on Ultra.
(https://dev.jup.ag/blog/metis-v7, https://developers.jup.ag/docs/ultra)

### Cross-cutting patterns (from all five)
1. **Two-step quote→build** with route checksum + expiry (Kyber, Velora, Socket) — cheap fast
   quoting, encode only at execution. DogeSwap's /quote → /swap-with-refresh is a variant; a
   routeID+checksum would harden the /swap re-quote binding.
2. **Positive-slippage capture** is a standard, disclosed revenue lever (Velora 50/50, Kyber
   keeps it) — a future DogeSwap fee could start here rather than with a bps fee.
3. **Integrator fee params in the quote request** — universal (Kyber/Socket/LI.FI/Jupiter);
   trivially portable to our API.
4. **Everyone converged on intents in 2025** with classic pathfinder routing retained as a mode;
   Kyber Smart Settlement is the only on-chain-only alternative (execution-time pool choice).
5. **Status APIs with substatus** become mandatory the moment any multi-step/cross-chain leg
   exists.

---

## Comparison table (settlement architectures)

| Dimension | Onchain routing (DogeSwapRouter today) | Offchain quote + onchain settlement (0x Settler) | Intents: open filler auction (UniswapX) | Intents: batch auction (CoW) |
|---|---|---|---|---|
| Who submits the tx | User | User (taker) or relayer (gasless) | Filler (gasless for user) | Winning solver (gasless) |
| What user signs | Tx (+ Permit2 permit) | Tx, or Permit2 permit with actions-as-witness | Permit2 order-as-witness (Dutch params) | EIP-712 intent (limit + validTo) |
| Allowance target | Permit2 (never the router) | Permit2 / AllowanceHolder (never Settler) | Permit2 (never the reactor) | GPv2VaultRelayer (never Settlement) |
| Price discovery | Offchain quote → fixed route in calldata | Offchain API → fixed actions | Dutch decay + RFQ exclusivity + filler competition | Solver competition, uniform clearing prices, CoWs |
| Onchain enforcement | Program execution, aggregate minOut on measured delta, deadline, fund isolation | Permit bounds, minAmountOut, witness-bound actions | Sig/nonce/deadline, decay price at fill block, exclusivity | Sig/expiry, limit vs clearing-price vector, fill accounting |
| Offchain trust | Quote server route quality | 0x API + registry governance | RFQ backend + cosigner + filler set | Autopilot + solver bonds + EBBO |
| MEV posture | Public mempool; slippage bound only | Same (taker); relayer policy (gasless) | No user tx to sandwich; decay returns arb to user | Uniform prices; no mempool; CoWs bypass AMMs |
| Failure cost | User pays gas on revert | User / relayer | Filler; user pays nothing | Solver; user pays nothing |
| Upgrade model | Immutable, redeploy + registry/env repoint | Immutable instances + registry rotation | Immutable reactors, new reactor per order type | Long-lived audited singleton |

---

## Uncertainties carried over from research (do not state as fact)

- 1inch: exact bit positions of unoswap `dex`-word flags unverified — read verified Etherscan
  source before hand-encoding; Fusion resolver-fee switch status and the "5% UP / max 10
  resolvers" numbers may have changed (open governance thread); "no Router v7" is
  absence-of-evidence; Pathfinder internals beyond the confirmed mechanics are speculation.
- 0x: the `SlippageAndActions` witness type string should be re-checked against
  `src/SettlerMetaTxn.sol` before implementing signature verification.
- UniswapX: production status of ERC-7683 cross-chain orders is plausible-but-unverified
  (secondary sources only); Dutch V2 exclusivity "~24s/2 blocks" should be confirmed per order in
  the wild.
- CoW: fair-combinatorial-auction launch date (believed CIP-67, early 2025) not confirmed; CoW AMM
  contract names from prior knowledge.
- Relay: solver bonding/slashing claimed only by third parties — official docs describe threshold
  attestations + MPC without bonding; the dominant solver may still be Reservoir itself; ~7-day
  order deadlines inferred from one live quote.
- Meta-aggregators: Velora Delta "0.15% on positive slippage only" is third-party; Jupiter Ultra
  fee tiers appear dynamic; Socket/Bungee brand timeline reconstructed from doc redirects.
