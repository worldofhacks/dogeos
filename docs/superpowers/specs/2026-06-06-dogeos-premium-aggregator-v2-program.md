# DogeOS Premium Aggregator v2 — Program Roadmap

Date: 2026-06-06
Status: Approved (brainstorming → specs)

## Context

The repository already ships a mature **off-chain** DEX quote aggregator and swap UI for
DogeOS Chikyu Testnet (chain id `6281971`): V2 / V3 / Algebra quote adapters, direct-route
scoring with DogeOS gas + L1 data/finality fee accounting, one-hop composition, verified
per-venue calldata builders, a full HTTP API, a React/wallet frontend (MyDoge / MetaMask /
Rainbow), and ~40 test files with strong ABI-provenance verification discipline. Today every
swap is delegated to *external* venue routers; there is no owned Solidity.

This program adds a **custom on-chain aggregation router with atomic swaps**, deliberately
reversing the "no custom router" decision recorded in
`2026-06-06-dogeos-native-premium-aggregator-design.md`. That earlier doc is **superseded on
the router question only**; its non-goals around owned DEX/pools/liquidity still hold.

## Locked decisions

| Area | Decision |
| --- | --- |
| Router model | Unified single-chain atomic router now; cross-chain settlement seam designed for, built later |
| Security bar | Mainnet-launch-ready: threat model, invariants, fuzzing, audit-prep package |
| Architecture | Command/Executor (Universal Router style), hard-constrained |
| Upgradeability | Immutable, non-proxy; versioned redeploy. Permit2 makes migration need no user re-approval |
| Approvals | Permit2 **AllowanceTransfer** mode (approve Permit2 once per token, periodic ~30d permit signature, day-to-day swaps need only the swap tx) |
| Fee | Configurable in bps, hard-capped (e.g. ≤ 1%), **default 0**, governance-set |
| Keys / governance | Owner = a Safe controlled by the founder (1/1, hardware-backed) behind a 24–48h timelock on fee/cap changes; Guardian = separate hot key, pause-only; unpause via the Safe |
| Tokens | Arbitrary tokens permitted, risk-labeled in UI; `SafeERC20` + universal balance-delta accounting mandatory |
| Guarded launch | Staged-rollout per-tx notional cap, started conservative, raisable, removable when confident |
| MEV protection | On-chain hard `minOut` + `deadline`; off-chain sender-aware simulation + price-impact warnings |
| Feature scope | Atomic split + multi-hop execution; gasless-feeling approvals (Permit2); charts / portfolio / analytics UX |
| UX | First-class, cross-cutting requirement (see Cross-cutting Principles) |

## Decomposition

This is too large for one spec. It is split into three sub-projects, each with its own
spec → plan → implementation cycle.

### A. Aggregation Router (Solidity, mainnet-grade) — gates everything
The command/executor contract suite, Permit2 AllowanceTransfer integration, fee module,
pause/guardian + timelocked owner, staged notional cap, the full security program, and
deployment + verification on DogeOS. Detailed in
`2026-06-06-dogeos-aggregation-router-spec.md`.

### B. Off-chain routing-engine upgrade
A route → command-program compiler that turns the optimizer's chosen split/multi-hop route
into `execute(commands, inputs)` calldata plus the Permit2 data to sign. Makes today's
read-only one-hop/split routes executable. Adds the `dogeos-aggregation-router` execution
source, the Permit2 approval/quote flow, off-chain token-risk screening (honeypot /
fee-on-transfer / low-liquidity), and a direct-venue fallback for when the router is paused.
Gets its own spec after A is specced.

### C. Premium UX
Permit2 signing in the wallet layer, MEV/slippage controls, multi-leg atomic transaction
lifecycle UI, route-provenance visualization, price charts, portfolio/positions, and a
source-health dashboard. Gets its own spec.

## Build order & dependencies

```
A (router) ──► B (routing engine / compiler) ──► C (premium UX)
                         ▲                          │
                         └──── C's Permit2 signing overlaps B ──┘
```

- A is the hard dependency: B's compiler targets A's command ABI, and C's swap flow targets
  A's Permit2 mode.
- The Permit2 wallet-signing work in C can start in parallel with B once A's command ABI and
  Permit2 mode are frozen.

## Cross-cutting principle: Security

Carried into every sub-project. Highlights (full treatment in the router spec):

- Least privilege: owner powers are minimal (fee, fee recipient, notional cap, unpause), all
  Safe + timelock gated; guardian can only pause.
- Immutable-where-possible; no proxies.
- Funds only ever move to `{recipient, feeRecipient, whitelisted venue, user refund}`; the
  router holds ~zero balance between transactions.
- Pre-mainnet checklist (below) before any real-money deployment.

## Cross-cutting principle: User experience

Usability is a first-class goal, not a sub-project C afterthought. Commitments that bind all
sub-projects:

- **Minimize signatures.** Permit2 AllowanceTransfer means most swaps are one tx, no extra
  signature. The rare permit re-sign and the first-time approval are explained in plain
  language ("one-time setup for this token", "expires in 30 days").
- **Legible route provenance.** Show "atomic swap via MuchFi V3 + Barkswap" rather than raw
  addresses; advanced details collapsible.
- **Best route auto-selected**, with a compact-by-default route scan and expandable detail.
- **Smart defaults**: auto slippage, sensible deadline, gas + DogeOS data/finality fee shown
  near the action with "what you'll receive" (min received / max spent) clarity.
- **Stable UI**: no balance flicker on background refresh, no layout shift, loading
  skeletons, fast quotes.
- **Actionable errors**: every failure names the failing proof point and the fix (wrong
  chain, stale quote, insufficient DOGE + faucet link, permit expired, route reverted).
- **Mobile-first**: compact execution controls, no chart/route overlap.
- **Accessible**: keyboard navigation, sufficient contrast, ARIA labels, focus management on
  modals and the transaction lifecycle panel.

## Pre-mainnet checklist (before any real-money deployment)

Recorded now; not built in the testnet phase.

- Monitoring + auto-pause guardian bot watching router events and value flow.
- Bug-bounty + responsible-disclosure policy (Immunefi-style).
- External security audit using the audit-prep package produced in sub-project A.
- Migrate keys to a true multisig (add Safe co-signers) and confirm timelock parameters.
- Raise or remove the staged notional cap per real-world confidence.

## Non-goals (program-wide)

- No owned DEX, pool factory, pool creation, liquidity management, or deployment surface.
- No arbitrary calldata execution; the router command set is a fixed whitelist.
- No cross-chain execution in this program (the router is *designed* with a settlement seam
  for a later, separately specced phase).
- No limit orders or TWAP/DCA.
- No gasless relayer / meta-transactions (Permit2 here is not gasless; the user pays gas and
  self-sends every swap).
- No in-place proxy upgrades.
