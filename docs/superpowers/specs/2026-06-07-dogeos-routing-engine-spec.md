# DogeSwap Routing Engine (Router Integration) — Sub-project B Spec

Date: 2026-06-07
Status: Draft for review (program-approved; grounded in the built Sub-project A router)
Part of: `2026-06-06-dogeos-premium-aggregator-v2-program.md`
Depends on: Sub-project A (`packages/contracts/` — the `DogeSwapRouter`, built & audited)

## Objective

Make the aggregator's chosen routes **executable through the on-chain router**. Turn an optimizer
route (direct / split / multi-hop candidate) into a single `router.execute(commands, inputs,
settlement, deadline)` transaction plus the Permit2 approval/permit flow, so today's read-only
one-hop & split previews become real swaps. Add the router as a verified execution source, keep
the existing per-venue calldata path as a **paused-router fallback**, and add off-chain
token-risk screening for the arbitrary-token policy.

This is **off-chain only** — no contract changes. It targets the frozen A interface.

## The A interface this targets (frozen)

- `function execute(bytes commands, bytes[] inputs, Settlement settlement, uint256 deadline) payable`
- `struct Settlement { address buyToken; uint256 minOut; address recipient; }` (recipient `0x0` = no-op)
- Command bytes (movement-only): `0x00 PERMIT2_PERMIT (PermitSingle, bytes sig)` · `0x01 PERMIT2_TRANSFER_FROM (address token, uint160 amount)` · `0x02 V2_SWAP (uint256 amountIn, uint256 amountOutMin, address[] path)` · `0x03 V3_SWAP (address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 amountOutMin)` · `0x04 ALGEBRA_SWAP (address tokenIn, address tokenOut, address deployer, uint256 amountIn, uint256 amountOutMin)` · `0x05 WRAP_NATIVE (uint256 amount)` · `0x06 UNWRAP_NATIVE (uint256 amount)`
- `CONTRACT_BALANCE = type(uint256).max` means "spend the per-execute delta of that token."
- Permit2 owner is **always msg.sender**; users approve **Permit2** (not the router); AllowanceTransfer mode (approve once, periodic permit signature, per-swap pull needs only the swap tx when a live allowance exists).
- Router address is read from the on-chain `DogeSwapRegistry.currentRouter()` (immutable + versioned redeploy).

## Architecture

### B1. Route → command-program compiler — `packages/aggregator/src/swap/routerProgram.mjs`
Pure function `buildRouterProgram({ route, sender, recipient, slippageBps, deadline, permit2State, routerAddress })` →
```
{
  to: routerAddress,
  value: bigint,                 // native in (WRAP flows) else 0
  commands: "0x..",              // packed command bytes
  inputs: ["0x..", ...],         // abi-encoded per command
  settlement: { buyToken, minOut, recipient },
  permit2: {
    approvalRequired: bool,      // ERC20 approve(sellToken, Permit2) needed?
    permitRequired: bool,        // PermitSingle signature needed (allowance missing/expired)?
    permitSingle, domain, types, // EIP-712 payload to sign (when permitRequired)
  }
}
```
Mapping rules:
- **Direct** candidate → `[PERMIT2_PERMIT?, PERMIT2_TRANSFER_FROM(sell, amountIn), V?_SWAP(sell→buy, CONTRACT_BALANCE, perLegMin)]` + Settlement{buy, minOut, recipient}.
- **Multi-hop (one-hop)** → pull once, then chained swaps each with `CONTRACT_BALANCE` input; Settlement on the final buy token.
- **Split** → pull once, then N swaps with explicit per-leg `amountIn` (summing to the pulled amount; the last leg may use `CONTRACT_BALANCE`); Settlement aggregates the buy-token delta.
- **Native in/out** → prepend `WRAP_NATIVE`/append `UNWRAP_NATIVE`; `value` = native in; Settlement `buyToken = NATIVE` for native out.
- `minOut` / per-leg mins derived from the quote's slippage-adjusted bounds (reuse `quoteService` math).
- Reuse the encoding style already in `swap/venueCalldataBuilders.mjs` (hand-rolled ABI word packing) for `inputs`; add a tiny tuple/array encoder where needed (PermitSingle, address[]).

### B2. Permit2 flow — `packages/aggregator/src/swap/permit2.mjs`
- `ensurePermit2Approval({ sellToken, owner, allowanceToPermit2 })` → whether the one-time ERC20 `approve(Permit2, max)` is needed.
- `buildPermitSingle({ sellToken, amount, spender: router, nonce, expiration, sigDeadline })` → the EIP-712 `PermitSingle` payload (domain `{name:"Permit2", chainId:6281971, verifyingContract: PERMIT2}`, the verified typehashes) for the wallet to sign.
- Read the current `(amount, expiration, nonce)` from `Permit2.allowance(owner, token, router)`; **skip the permit command when a live, sufficient allowance exists** (the live-allowance optimization).

### B3. Execution source + registry — `packages/aggregator/src/sources/registry.mjs`
- Add a `dogeos-aggregation-router` source (status ACTIVE once deployed/verified): router address (from `DogeSwapRegistry`), command-ABI provenance, selector/bytecode evidence — reusing the existing verification discipline (`verification/`, `verify-dogeos-sources`).
- Routes that were `readOnly` (one-hop/split) become executable **through the router** while remaining read-only through direct venues.

### B4. API changes — `packages/api/src/handler.mjs` + `live.mjs`
- `/swap` returns the router `execute` transaction (`to/value/data` built from B1) **plus** the Permit2 payload to sign (from B2), instead of (or alongside) the direct-venue calldata.
- `/approval` becomes "ensure the one-time Permit2 approval for the sell token."
- Keep `createVerifiedCalldataBuilder` (direct per-venue) as the **paused-router fallback**: when `DogeSwapRegistry`/router is paused, `/swap` falls back to the existing direct path for direct routes (and one-hop/split revert to read-only).
- Add router-revert → user-message mapping (minOut, deadline, InsufficientLedgerBalance, NotionalCapExceeded, paused, permit invalid/expired).

### B5. Token-risk screening — `packages/aggregator/src/sources/tokenRisk.mjs`
Off-chain checks for the arbitrary-token policy: fee-on-transfer detection (simulate/compare), low-liquidity flag (reserves/quoter), honeypot heuristics (sell simulation), and a label surfaced in `/quote` provenance. Does not block; it labels (UI in Sub-project C).

## Data flow
1. `/quote` returns the best route (now incl. executable split/multi-hop via the router).
2. UI calls `/approval` → one-time `approve(Permit2)` if needed.
3. UI calls `/swap` → gets `execute` calldata + a Permit2 `PermitSingle` to sign (only if allowance missing/expired).
4. User signs the permit (if required), then sends `router.execute(...)`.
5. UI polls receipt; maps reverts to messages; links Blockscout.

## Testing (node:test, matching repo conventions)
- Compiler unit tests: direct / split / multi-hop / native-in / native-out → exact `commands`, `inputs`, `settlement`, `value` (golden-vector style, cross-checked against the contract's expected decoding).
- Permit2 unit tests: PermitSingle payload correctness (typehash/domain), live-allowance skip, approval-required logic, nonce handling.
- API tests: `/swap` returns router calldata + permit payload; `/approval` Permit2; paused-router fallback to direct path; revert→message mapping.
- Token-risk unit tests: FoT/low-liq/honeypot labels.
- A round-trip test: compiler output decoded and run against the **actual contract** via a Foundry test fixture (optional, high-value) OR an ABI-decode assertion in JS that matches `DogeSwapRouter` expectations.

## Acceptance criteria
- A chosen direct/split/multi-hop route compiles to a valid `execute` program that the deployed router accepts (verified by decoding + a contract round-trip).
- `/swap` returns router calldata + the Permit2 payload; `/approval` returns the one-time Permit2 approval.
- Live-allowance optimization works (no permit command when allowance is live).
- Paused-router fallback to the direct-venue path works for direct routes.
- Arbitrary tokens are risk-labeled in quote provenance.
- All new tests pass; existing suite unaffected.

## Non-goals
- No contract changes (targets the frozen A interface).
- No cross-chain (that's Sub-project D).
- No UI (that's Sub-project C; B exposes the data C renders).
- No gasless/relayer (user self-sends).

## Spec self-review
- Grounded in A's actual built interface (command bytes, Settlement, Permit2 msg.sender model, CONTRACT_BALANCE delta).
- Off-chain only; fallback path preserves today's behavior when the router is paused/absent.
- Testable without the live deploy (router address injectable; golden-vector + ABI-decode tests), with an optional contract round-trip once A is deployed.
