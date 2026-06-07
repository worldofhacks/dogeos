# DogeOS Aggregation Router — Sub-project A Spec

Date: 2026-06-06
Status: Approved (brainstorming → ready for implementation plan)
Part of: `2026-06-06-dogeos-premium-aggregator-v2-program.md`
Supersedes: the "no custom aggregator router contract" decision in
`2026-06-06-dogeos-native-premium-aggregator-design.md` (router question only).

## Objective

Build a mainnet-launch-grade, immutable, command/executor **aggregation router** for DogeOS
that executes atomic single, split, and multi-hop swaps across the verified DogeOS venues
(MuchFi V2, MuchFi V3, Barkswap Algebra) in one all-or-nothing transaction, pulls funds via
Permit2 AllowanceTransfer, enforces `minOut` + `deadline` on-chain, supports an off-by-default
capped protocol fee. It stays single-chain: cross-chain (NEAR Intents, Sub-project D) is delivered
off-chain and needs only `SWEEP` to a deposit address — no contract changes.

The router must hold ~zero token balance between transactions, only ever move funds to a
known set of destinations, only ever call whitelisted immutable venues, and degrade safely
(pause) under a minimal Safe + timelock + guardian control model.

## Task #0 — De-risking gates (do first, before building the swap path)

These three unknowns can each invalidate parts of the design. Resolve them before writing
the execution path.

1. **Confirm DogeOS is OP-Stack and pin the EVM target.** Strong evidence: the chain config
   hardcodes the L1 fee oracle at `0x5300000000000000000000000000000000000002` (Optimism's
   `GasPriceOracle` predeploy) and the repo already calls `getL1Fee(bytes)` (`0x49948e0e`).
   Confirm the OP-Stack fork/EVM version and pin `evm_version` in Foundry. Verify availability
   of `PUSH0` and transient storage (`TSTORE`/`TLOAD`) before relying on them (e.g. for the
   reentrancy guard).
2. **Verify or deploy canonical Permit2.** Permit2 deploys deterministically (CREATE2) at
   `0x000000000022D473030F116dDEE9F6B43aC78BA3` on most chains. Check DogeOS; if absent,
   deploy it permissionlessly and verify on Blockscout. The router depends on it.
3. **Verify MyDoge supports EIP-712 typed-data signing on DogeOS.** AllowanceTransfer still
   requires a periodic permit signature, so MyDoge (the DogeOS-native wallet) must be able to
   `signTypedData`. If it cannot, stop and revisit (the program decided to keep pure Permit2
   and de-risk early rather than build a classic-approve fallback up front).

Each gate produces a recorded evidence artifact (RPC/Blockscout output) consistent with the
repo's verification ethos.

## Architecture — Command/Executor

### Workspace

A Foundry workspace at `packages/contracts/` (forge / cast / anvil), pinned solc, pinned
`evm_version`, NatSpec on all externals, committed build-info for reproducibility.

### Entry point

```solidity
function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)
    external payable
    whenNotPaused
    nonReentrant;
```

- `commands`: one byte per command (the command id); length = number of operations.
- `inputs[i]`: ABI-encoded arguments for command `i`.
- Reverts if `block.timestamp > deadline`.
- `payable` to support native DOGE in (wrap) flows; unused native is refunded by `SWEEP`.

### Command set (fixed whitelist — no fallback, no user-supplied call target)

| Command | Purpose |
| --- | --- |
| `PERMIT2_PERMIT` | Submit a Permit2 AllowanceTransfer permit (sets/extends the router's bounded, expiring allowance for a token). Optional per swap; only needed when allowance is missing/expired. |
| `PERMIT2_TRANSFER_FROM` | Pull `sellToken` from the user into the router via Permit2 using the existing allowance. |
| `V2_SWAP` | Swap through the whitelisted MuchFi V2 router. |
| `V3_SWAP` | Swap through the whitelisted MuchFi V3 router. |
| `ALGEBRA_SWAP` | Swap through the whitelisted Barkswap Algebra router. |
| `WRAP_NATIVE` | Wrap DOGE → WDOGE. |
| `UNWRAP_NATIVE` | Unwrap WDOGE → DOGE. |
| `PAY_FEE` | Take the capped protocol fee (no-op when fee = 0). |
| `MIN_OUT_CHECK` | Assert accumulated `buyToken` ≥ `minOut` (balance-delta based). |
| `SWEEP` | Send `buyToken` to recipient; refund any leftover sell/intermediate tokens and native to the user. |

Cross-chain note: cross-chain is delivered **off-chain** via NEAR Intents (Sub-project D), not
by a router command. The router's `SWEEP` already targets any recipient (including a 1Click
deposit address), so **no `SETTLE_REMOTE` command or on-chain bridge/settlement logic is
added** — the audited surface stays single-chain. A future on-chain settlement command would
be a separate, separately-audited addition, only if a non-1Click model ever requires it.

### Custody & accounting model

1. `PERMIT2_TRANSFER_FROM` pulls `sellToken` into the router (transient custody only).
2. Each swap command sends the working token to the whitelisted venue router and receives the
   output back to the router. **Amounts are measured by balance delta**, never by trusting the
   venue's return value — this also makes fee-on-transfer/rebasing tokens safe.
3. **Split** = multiple swap commands consuming portions of the same working balance into the
   same output token. **Multi-hop** = a swap command whose output token is the next swap's
   input token. Both are just command sequences; both are atomic.
4. `MIN_OUT_CHECK` enforces the user's floor by balance delta.
5. `SWEEP` sends the output to `recipient`, refunds dust/leftovers to the user, and refunds
   unused native.

Core invariants (fuzzed — see Security program): the router holds ~zero token balance after
`execute`; the recipient receives ≥ `minOut` or the whole transaction reverts; the user never
spends more than the Permit2-authorized amount; funds only ever move to
`{recipient, feeRecipient, whitelisted venue, user refund}`.

### Permit2 — AllowanceTransfer mode

- Users `approve(Permit2, …)` once per token (Permit2 itself, never the router).
- The router is granted a **bounded, expiring, revocable** allowance via Permit2's
  AllowanceTransfer. A `PERMIT2_PERMIT` command (an EIP-712 signature) sets/extends it; the
  default expiry follows the Uniswap convention (~30 days), after which the user re-signs.
- Day-to-day swaps with a live allowance need **no extra signature** — only the swap tx.
- Because users approve Permit2 (not the router), redeploying a new immutable router version
  needs **no user re-approval**.

### Venue execution (V2 / V3 / Algebra)

- Venue router addresses are **immutable**, set in the constructor and validated, drawn from
  the verified registry:
  - MuchFi V2 router `0xC653e745FC613a03D156DACB924AE8e9148B18dc`
  - MuchFi V3 router `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB`
  - Barkswap Algebra router `0x77147f436cE9739D2A54Ffe428DBe02b90c0205e`
- **Concentrated-liquidity callback model:** the router calls the venues' own SwapRouters
  (which own and authenticate their `uniswapV3SwapCallback` / `algebraSwapCallback`), rather
  than calling pools directly and re-implementing callback authentication. The router grants
  exact, per-swap allowances to these immutable, trusted venue routers. (If a future design
  ever calls pools directly, the router must verify `msg.sender == computed pool address`.)

### Payments, fee, access control

- **Payments lib:** WDOGE (`0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE`) wrap/unwrap;
  `SafeERC20` for all token movement (handles USDT-style non-returning `approve`/`transfer`);
  `receive()` accepts native only from WDOGE.
- **Fee module:** `feeBps ≤ MAX_FEE` (hard cap, e.g. 100 bps = 1%), `feeRecipient`, both
  settable only through the timelocked owner; **default 0** (`PAY_FEE` is a no-op when 0).
- **Access control (minimal, least privilege):**
  - `Owner` = a founder-controlled Safe (1/1, hardware-backed) behind a **24–48h timelock**.
    Owner powers: set fee (capped), set fee recipient, set notional cap, unpause. Nothing
    else.
  - `Guardian` = a separate hot key, **pause-only** (non-destructive; fast incident
    response). Unpause is owner-only.
  - Reentrancy guard on `execute` (transient storage if available, else storage slot).

### Staged-rollout notional cap (guarded launch)

- A governance-set **max input value per `execute`** (denominated against a reference unit;
  simplest: cap the pulled `sellToken` amount per its USD-stable pair, or a per-token cap
  table). Started conservative, raised over time, and removable (set to max) once confident.
- Enforced in `execute` before the swap path runs.

### Immutability & versioning

- The router is **immutable and non-upgradeable** (no proxy). Upgrades = deploy a fresh
  version.
- A tiny immutable `RouterRegistry` (or off-chain config) records the current router address;
  the app reads it. Permit2 means migration needs no user re-approval.

## Token handling

Arbitrary tokens are permitted and **risk-labeled in the UI** (sub-project C). On-chain
safety does not depend on a token allowlist: `SafeERC20` + universal balance-delta accounting
make malicious/non-standard tokens unable to corrupt accounting. Off-chain honeypot /
fee-on-transfer / low-liquidity screening and labeling live in sub-project B.

## Security program (mainnet-grade)

### Tooling (Trail-of-Bits-aligned)

- **Slither** static analysis on every PR, including custom detectors targeting the command
  dispatcher (no arbitrary external calls, no delegatecall to non-constants).
- **Echidna + Medusa** property/invariant fuzzing.
- **Foundry invariant tests** (stateful) and **fork tests** against live DogeOS pools.
- Optional **halmos** / Solidity `SMTChecker` for critical arithmetic.
- ToB *building-secure-contracts* patterns: checks-effects-interactions, `SafeERC20`,
  pull-over-push, reentrancy discipline.

### Threat model → mitigation

| Threat | Mitigation |
| --- | --- |
| Reentrancy via token / venue callbacks | `nonReentrant` + CEI + balance-delta accounting |
| Allowance drain | Permit2 (no standing router allowance); router holds ~0 balance |
| Arbitrary-call injection | Fixed command whitelist; immutable venues; no user-supplied call target |
| Fee / governance abuse | Capped fee, timelocked Safe owner, default 0 |
| Sandwich / MEV | On-chain `minOut` + `deadline`; off-chain tight slippage defaults |
| Fee-on-transfer / rebasing tokens | Balance-delta measurement + `SafeERC20` |
| Stuck native | Wrap/unwrap + `SWEEP` refund; `receive()` only from WDOGE |
| Reorgs (DogeOS max depth 17) | `deadline` + off-chain confirmation-depth policy; no on-chain dependence on recent history |
| Permit2 replay / expiry | Permit2 nonces + allowance expiry + `deadline` |
| Pause griefing | Guardian limited to pause; unpause is owner-only |
| Launch blast radius | Staged notional cap |

### Invariants (fuzzed)

- `I1` Router token balance == 0 after `execute`.
- `I2` Recipient receives ≥ `minOut` of `buyToken`, or the tx reverts.
- `I3` User spends ≤ the Permit2-authorized amount.
- `I4` Fee charged ≤ `feeBps · notional` and ≤ `MAX_FEE`; fee only to `feeRecipient`.
- `I5` Funds only move to `{recipient, feeRecipient, whitelisted venue, user refund}`.
- `I6` `execute` reverts when paused or past `deadline`.
- `I7` Only whitelisted venues are ever called.
- `I8` Input value per `execute` ≤ the active notional cap.

## Test strategy

- Unit tests per command, payments, fee, access control, cap.
- Fork tests against live DogeOS pools (each venue + split + multi-hop), via `forge --fork-url`.
- Invariant/property tests (Foundry + Echidna/Medusa) for `I1`–`I8`.
- Negative tests: permit replay, expired deadline, wrong chain, paused, `minOut` breach,
  malicious / fee-on-transfer token, non-whitelisted venue, cap exceeded.
- Gas snapshots.
- **Differential test:** router output == equivalent direct-venue swap output, minus fee.

## Off-chain integration seam (interface to sub-project B)

Defined here so the router is built to a known integration shape; the build is in B.

- New execution source `dogeos-aggregation-router` in the registry: router address, command
  ABI provenance, selector evidence — reusing the existing verification discipline.
- A command-program compiler `packages/aggregator/src/swap/routerProgram.mjs`:
  `route + sender + recipient + slippage + permit2 state → { commands, inputs, value, permit2 }`.
- `/swap` returns the router `execute` calldata plus any Permit2 permit to sign;
  `/approval` becomes "ensure a one-time Permit2 approval for the sell token."
- The existing per-venue `createVerifiedCalldataBuilder` is retained as the **paused-router
  fallback**.
- `verify-dogeos-sources` and venue ABI artifacts extend to cover the router (selectors /
  bytecode verified on Blockscout like existing venues).

## Deployment & verification on DogeOS

1. Resolve Task #0 gates.
2. Verify/deploy canonical Permit2.
3. `forge script` deploy + broadcast to DogeOS RPC; verify on Blockscout.
4. Publish the router address via the version registry the app reads.
5. Post-deploy **evidence swaps** (each venue + split + multi-hop); record tx hashes and
   Blockscout links as verification evidence.

## Data flow (router execution)

1. UI requests `/quote`; the optimizer selects the best direct/split/multi-hop route.
2. `/swap` compiles the command program and returns `execute` calldata + any Permit2 permit
   to sign.
3. User signs the Permit2 permit only if the allowance is missing/expired (≈ once per 30
   days per token; first-ever use also needs the one-time `approve(Permit2)` tx).
4. Wallet sends `router.execute(commands, inputs, deadline)`.
5. UI polls the receipt, refreshes balances on confirmed success, links to Blockscout.

## Error handling

Map router reverts to the existing user-facing error surface, each naming the failing proof
point and the fix:

- `minOut` not met → slippage / price-impact guidance.
- Past `deadline` → re-quote.
- Paused → router temporarily unavailable; offer direct-venue fallback.
- Venue swap failed → name the source/venue and the revert reason.
- Permit invalid/expired → prompt re-sign.
- Insufficient DOGE → show execution fee + DogeOS data/finality fee context + faucet link.
- Notional cap exceeded → show the current cap.

## Acceptance criteria

- Task #0 gates resolved with recorded evidence (OP-Stack/EVM confirmed, Permit2 present or
  deployed, MyDoge EIP-712 verified or escalated).
- Unit + invariant (`I1`–`I8`) + fork tests pass; differential test passes.
- Slither triaged clean; Echidna/Medusa invariants hold.
- Router deployed and verified on DogeOS with Blockscout-linked evidence swaps for each
  venue + split + multi-hop.
- Access control matches the model (Safe owner + timelock on fee/cap; guardian pause-only).
- Audit-prep package complete: threat-model doc, invariant spec, Slither/Echidna reports,
  full NatSpec, deploy/verify scripts, known-issues, SLOC/scope summary.

## Non-goals

Inherits the program non-goals. Specifically for this contract: no owned DEX/pools/liquidity;
no arbitrary calldata; no cross-chain logic in the contract (cross-chain is off-chain via NEAR
Intents; the router only needs `SWEEP`-to-any-recipient); no limit orders/TWAP; no gasless
relayer; no proxy upgrades; no on-chain token allowlist (safety is balance-delta + SafeERC20
based).

## Hardening Revisions — post pre-execution review (2026-06-06)

A pre-execution review (repo/platform/library/security fan-out + Trail of Bits methodology,
using the installed `building-secure-contracts`, `property-based-testing`, and related skills)
confirmed the design but surfaced platform facts and security gaps. The following amendments
are **authoritative and supersede any conflicting text above.**

### Platform facts (verified live on DogeOS testnet)

- **Permit2 is NOT deployed** at the canonical address on DogeOS (`eth_getCode` returned `0x`).
  Deploying canonical Permit2 (deterministic CREATE2 via the Arachnid proxy
  `0x4e59b44847b379578588920cA78FbF26c0B4956C`) is a **required, critical-path step** before
  the router and swap flow — not a contingency.
- **DogeOS is a Dogecoin zkEVM, Prague-compatible** (NOT OP-Stack Bedrock). The official docs
  (developer-quickstart, ethereum-and-dogeos-differences) say: use `evm_version = "prague"` and
  Solidity ≥ `0.8.30`. An on-chain opcode probe (`eth_call --create`, 2026-06-06) confirms
  **PUSH0, transient storage (EIP-1153 TSTORE/TLOAD), and MCOPY all execute** — so the reentrancy
  guard uses OZ `ReentrancyGuardTransient`. (An earlier OP-Stack/Bedrock heuristic wrongly
  inferred pre-Shanghai from absent `withdrawalsRoot`/`excessBlobGas` header fields — **superseded**.
  The GasPriceOracle predeploy at `0x5300…0002` is a documented fee oracle, not an OP-Stack fork
  marker.)
- **Precompile constraints (DogeOS-specific):** RIPEMD-160 (`0x3`), blake2f (`0x9`), and
  point-evaluation (`0x0a`) are unsupported; `modexp` accepts only ≤32-byte inputs; `SELFDESTRUCT`
  is disabled (reverts); blob opcodes / EIP-4788 are unavailable. `ecrecover` (`0x1`) IS available,
  so EIP-712 / Permit2 signature recovery works. The router uses none of the unsupported
  precompiles.
- Venue routers, WDOGE, and the L1 oracle are confirmed deployed with correct bytecode; chain
  id `6281971`; testnet only (no mainnet yet); `@dogeos/dogeos-sdk` unchanged.

### H1 — Per-execute balance-delta accounting (enforces I1 & I5)

The router keeps an in-memory ledger of every token it touches during a single `execute`,
recording each token's balance at first reference (native entry recorded as
`address(this).balance - msg.value`). All payouts/refunds/min-out checks operate on the
**delta accrued during this call** (`current - entry`), never absolute balance. The router can
therefore **never** move pre-existing/airdropped/stranded funds — only what this call brought
in, making I1 and I5 structurally enforced rather than argued. An owner-only `rescue(token,to,
amount)` recovers genuinely stuck pre-existing balances out-of-band (not reachable via
`execute`). Swap/wrap/unwrap commands spend only the per-execute delta of their input token via
`_spend`: an explicit amount may not exceed what this call brought in, and `CONTRACT_BALANCE`
resolves to the delta (never absolute balance) — so pre-existing/airdropped balances are
unspendable through `execute`.

### H2 — Enforced final settlement (enforces I2)

`execute` takes an explicit settlement enforced AFTER the command loop, regardless of the
command program:

```
struct Settlement { address buyToken; uint256 minOut; address recipient; }
function execute(bytes commands, bytes[] inputs, Settlement settlement, uint256 deadline) external payable;
```

Using the ledger delta of `settlement.buyToken`, the contract takes the protocol fee (≤ cap),
requires the remaining delta ≥ `settlement.minOut` (else revert), pays it to
`settlement.recipient`, and refunds any leftover input-token deltas to `msg.sender`.
`settlement.recipient == address(0)` = no-op settlement (used only by unit tests that
intentionally leave funds in the router). A native-output sentinel (`NATIVE =
0xEeee…EEeE`) lets `buyToken` denote native DOGE. This makes "recipient receives ≥ minOut or
the whole tx reverts" a **contract guarantee**. Because settlement subsumes them, the
standalone `PAY_FEE`, `MIN_OUT_CHECK`, and buyToken-`SWEEP` commands are **removed**; the
command set is movement-only (`PERMIT2_PERMIT`, `PERMIT2_TRANSFER_FROM`, `V2_SWAP`, `V3_SWAP`,
`ALGEBRA_SWAP`, `WRAP_NATIVE`, `UNWRAP_NATIVE`).

**Permit2 security (the UniversalRouter pattern):** the Permit2 owner is ALWAYS `msg.sender` —
the router never accepts a caller-supplied `from`/`owner`, so it cannot pull a third party's
permitted funds even when many users hold live router allowances. Command inputs reflect this:
`PERMIT2_PERMIT` = `(IAllowanceTransfer.PermitSingle, bytes signature)` and
`PERMIT2_TRANSFER_FROM` = `(address token, uint160 amount)` — neither carries an `owner` field.

### H3 — Per-execute aggregate notional cap + default cap (enforces I8)

The cap is enforced on the **aggregate input within one `execute`**, summed across every
`PERMIT2_TRANSFER_FROM` and `WRAP_NATIVE` (native), per token — not per pull. A governance-set
`defaultMaxInputPerTx` bounds tokens without a specific cap (closing the `0 = uncapped` gap for
arbitrary tokens); a per-token `type(uint256).max` sentinel means "explicitly uncapped."
Pre-seeded balances cannot be swapped (the H1 ledger ignores them).

### H4 — Real TimelockController governance

The router `owner` is an OpenZeppelin `TimelockController` (min delay 24–48h; proposer/executor
= the founder Safe). Fee/cap/guardian/unpause changes flow through the timelock. The deploy
script deploys/wires the timelock, sets the initial guarded-launch caps **in the same
broadcast** (router never live-and-uncapped), and asserts the Ownable2Step handover. Guardian
remains pause-only.

### Invariant coverage (I1–I8 all fuzzed, not argued)

Fuzz I1 (residual delta zero), I2 (recipient ≥ minOut or revert), I3 (spend ≤ permitted),
I4 (fee ≤ cap, exact, only to feeRecipient — relative tolerance, not absolute slack), I5
(fund destinations ∈ {recipient, feeRecipient, venue, sender-refund}, fuzzing arbitrary
recipients/tokens), I6 (paused/expired always revert), I7 (only whitelisted venues called —
via call-tracing mocks), I8 (aggregate input ≤ cap). Add an adversarial test that pre-seeds the
router with a second party's tokens + native and asserts a different caller's `execute` cannot
extract them.

### Additional required coverage

- Permit2 live-allowance path: bare `PERMIT2_TRANSFER_FROM` (no permit) within an unexpired
  allowance succeeds; expired/insufficient allowance reverts with a UI-mappable error.
- Fee-on-transfer on an **intermediate** hop token; zero working-balance swap step behavior.
- Native settlement to a recipient that reverts on receive (documented behavior); fork-probe
  whether any venue router refunds native mid-swap (would interact with the WDOGE-only
  `receive()` guard).
- Early `forge build --sizes` gate (24,576-byte limit) once the core compiles.
- Tooling: install Foundry (`foundryup`) before any `forge`/`cast`; `forge init` uses
  `--no-git` (the `--no-commit` flag was removed); pin dependency versions at install.

## Spec self-review

- No placeholders or TBDs remain; the few tunable constants (fee cap, timelock delay, permit
  expiry, notional cap units) are named with concrete defaults to be finalized in the plan.
- Internally consistent with the program roadmap and the locked decisions.
- Scoped to a single implementation plan (the router contract suite + its security program +
  deployment); off-chain compiler and UX are explicitly deferred to B and C with a defined
  interface seam.
- Ambiguities resolved: Permit2 = AllowanceTransfer; concentrated-liquidity = call venue
  SwapRouters; upgrade = immutable + versioned redeploy; tokens = arbitrary + balance-delta.
