# Threat Model — DogeSwapRouter

Methodology: Trail of Bits audit-prep. Each row transcribes the spec's
`Security program → Threat model → mitigation` table
(`docs/superpowers/specs/2026-06-06-dogeos-aggregation-router-spec.md`, lines 177–189),
updated by the authoritative **Hardening Revisions** (H1–H4), and maps it to:
(1) the exact mitigation in `src/DogeSwapRouter.sol` (function + mechanism), and
(2) the test(s) that prove it (`file::testName`).

Scope: single-chain router only. Cross-chain is delivered off-chain via NEAR Intents
(Sub-project D); no on-chain bridge/settlement command exists, so the audited surface is
movement-only. All line references are to `src/DogeSwapRouter.sol` unless noted.

---

## Threat → mitigation → proof

### 1. Reentrancy via token / venue callbacks
- **Spec mitigation:** `nonReentrant` + CEI + balance-delta accounting.
- **Code:** `execute()` is `nonReentrant` (OZ `ReentrancyGuardTransient`, EIP-1153 transient
  slot — DogeOS Prague-confirmed). The per-command loop makes the only external calls; a
  re-entrant `execute` is blocked by the transient guard, and cross-command state is held in an
  **in-memory** `Ledger` (`_idx`/`_delta`/`_spend`), not storage, so no callback can observe or
  corrupt half-updated accounting. Output is always measured by balance delta (`_delta`), never
  by a venue return value, and `_settle` runs **after** the loop (effects-after-interactions for
  payouts, but bounded by measured deltas, not trust). `_pay`'s native branch checks the call
  result (`NativeTransferFailed`).
- **Proof:** `RouterInvariants.t.sol::invariant_I1_zeroResidual` (residual 0 after fuzzed
  swap sequences, 25,600 calls); `RouterInvariants.t.sol::invariant_I5_conservation`;
  `RouterEdges.t.sol::test_receive_rejectsNonWdoge` (callback entry via `receive()` is rejected).

### 2. Allowance drain / third-party allowance drain
- **Spec mitigation:** Permit2 (no standing router allowance); router holds ~0 balance.
- **Code:** Users approve **Permit2**, never the router. `_permit2Permit` and
  `_permit2TransferFrom` ALWAYS pass `msg.sender` as the Permit2 owner/`from`
  (`PERMIT2.permit(msg.sender, …)`, `PERMIT2.transferFrom(msg.sender, …)`) — the UniversalRouter
  pattern. No command input carries an `owner`/`from` field, so a caller can never pull a third
  party's permitted funds even when many users hold live router allowances. `_permit2Permit`
  also enforces `p.spender == address(this)` (`InvalidSpender`).
- **Proof:** `RouterPermit2.t.sol::test_thirdParty_cannotDrainVictimAllowance` (victim holds a
  live 500e18 router allowance; attacker's bare `PERMIT2_TRANSFER_FROM` reverts because the pull
  is from the attacker, who has no allowance — victim balance unchanged, attacker gets nothing);
  `RouterPermit2.t.sol::test_permitAndTransferFrom_pullsFromCaller`;
  `RouterInvariants.t.sol::invariant_I1_zeroResidual` (router ~0 residual).

### 3. Stranded-fund extraction (H1 — per-execute ledger)
- **Spec mitigation (H1/H2):** per-execute `_spend` delta + buyToken entry snapshot.
- **Code:** The `Ledger` records each token's balance at first reference; native is seeded as
  `address(this).balance - msg.value` (line 84, excludes incoming value). buyToken's entry is
  snapshotted at `execute` start when `s.recipient != address(0)` (line 85). All payouts,
  refunds, and min-out checks use the **delta accrued during this call** (`_delta = current -
  entry`), never absolute balance. `_spend` requires an explicit amount ≤ delta (else
  `InsufficientLedgerBalance`) and resolves `CONTRACT_BALANCE` to the delta. Pre-existing /
  airdropped / stranded funds are therefore unspendable through `execute`; only the owner
  (Timelock) can recover them via `rescue` (not reachable from `execute`).
- **Proof:** `RouterPermit2.t.sol::test_strandedFunds_notExtractable` (250e18 minted to router;
  attacker's settlement extracts 0, funds remain);
  `RouterSwaps.integration.t.sol::test_contractBalance_cannotDrainStranded`;
  `RouterSwaps.integration.t.sol::test_explicitAmount_exceedingDelta_reverts`;
  Echidna `EchidnaRouter.sol::fuzz_cannot_drain_via_execute` /
  `fuzz_explicit_over_delta_reverts`; `RouterInvariants.t.sol::invariant_I1_zeroResidual`.

### 4. Arbitrary-call injection
- **Spec mitigation:** fixed command whitelist; immutable venues; no user-supplied call target.
- **Code:** `_dispatch` is a fixed `if/else if` over a 7-entry, movement-only command set
  (`Commands.sol`: `PERMIT2_PERMIT`, `PERMIT2_TRANSFER_FROM`, `V2_SWAP`, `V3_SWAP`,
  `ALGEBRA_SWAP`, `WRAP_NATIVE`, `UNWRAP_NATIVE`); any other byte reverts `UnknownCommand`.
  There is **no** `CALL`/`DELEGATECALL`/arbitrary-target command. Venue addresses
  (`MUCHFI_V2_ROUTER`, `MUCHFI_V3_ROUTER`, `BARKSWAP_ALGEBRA_ROUTER`, `WDOGE`) are `immutable`,
  set in the constructor; no input field ever supplies a call destination. Fee/min-out/payout
  are handled by enforced settlement, not by user commands.
- **Proof:** `DogeSwapRouter.t.sol::test_execute_revertsOnUnknownCommand`;
  `DogeSwapRouter.t.sol::test_constructor_setsImmutablesAndRoles`;
  `RouterInvariants.t.sol::invariant_I7_onlyWhitelistedVenue` (call-tracing mock asserts the
  only venue caller is the router).

### 5. Fee / governance abuse
- **Spec mitigation:** capped fee, timelocked Safe owner, default 0.
- **Code:** `setFee` reverts above `Constants.MAX_FEE_BPS` (100 bps = 1%) with `FeeTooHigh`; fee
  defaults to 0 (`feeBps` unset) and is a no-op in `_settle` when `feeBps == 0`. All mutating
  admin functions (`setFee`, `setGuardian`, `setDefaultMaxInputPerTx`, `setMaxInputPerTx`,
  `unpause`, `rescue`) are `onlyOwner`; ownership transfer is `Ownable2Step` (two-step, no
  accidental hand-off). The intended `owner` is an OZ `TimelockController` (H4) so changes
  carry a 24–48h delay; guardian is pause-only.
- **Proof:** `DogeSwapRouter.t.sol::test_setFee_revertsAboveCap_andOwnerOnly`;
  `RouterPermit2.t.sol::test_rescue_ownerOnly`;
  `RouterInvariants.t.sol::invariant_I4_feeExactAndCapped` (fee exact, ≤ cap, only to
  feeRecipient); `DogeSwapRouter.t.sol::test_pause_blocksExecute_andRolesEnforced`.

### 6. Sandwich / MEV
- **Spec mitigation:** on-chain `minOut` + `deadline`; off-chain tight slippage defaults.
- **Code:** `execute` reverts if `block.timestamp > deadline` (`DeadlineExpired`, line 76).
  `_settle` requires the measured `buyToken` delta (after fee) ≥ `settlement.minOut`, else
  `MinOutNotMet` — a contract guarantee enforced after the command loop regardless of the
  command program. Per-venue swaps also pass their own `amountOutMinimum`, but the binding floor
  is the settlement check on the measured delta.
- **Proof:** `RouterSwaps.integration.t.sol::test_minOut_breach_revertsWholeTx`;
  `RouterInvariants.t.sol::invariant_I2_minOutHonored` (fuzzed: recipient ≥ minOut or revert);
  `DogeSwapRouter.t.sol::test_execute_revertsOnExpiredDeadline`;
  `RouterInvariants.t.sol::test_I6_expiredDeadlineReverts`.

### 7. Fee-on-transfer / rebasing tokens
- **Spec mitigation:** balance-delta measurement + `SafeERC20`.
- **Code:** Every amount in/out is measured by `_delta` (balance difference), never by a token's
  or venue's returned value, so FoT/rebasing shortfalls are accounted correctly. `_pay`/transfers
  use `SafeERC20.safeTransfer`/`forceApprove` (handles USDT-style non-returning approve/transfer).
  Venue allowances use `forceApprove` to `type(uint256).max` only when below the needed amount.
- **Proof:** `RouterEdges.t.sol::test_feeOnTransfer_outputToken_balanceDelta` (FoT on the output
  token; recipient receives exactly the measured delta);
  `RouterSwaps.integration.t.sol::test_multiHop_twoHops` /
  `RouterSwaps.integration.t.sol::test_split_v3_plus_v2` (intermediate-token delta accounting).

### 8. Stuck / native funds
- **Spec mitigation:** wrap/unwrap + `SWEEP` refund; `receive()` only from WDOGE.
- **Code:** `_wrapNative`/`_unwrapNative` use the immutable `WDOGE` (deposit/withdraw), spending
  only the per-execute native/WDOGE delta via `_spend`. `receive()` reverts (`Unauthorized`)
  unless `msg.sender == WDOGE`, so the only native inflow is unwrap proceeds. Settlement refunds
  every leftover input-token delta to `msg.sender` and pays native output via a checked low-level
  `call` (`NativeTransferFailed` on failure). A native `buyToken` is denoted by the
  `NATIVE` sentinel (`0xEeee…EEeE`).
- **Proof:** `RouterEdges.t.sol::test_wrapNative_then_swap_to_token`;
  `RouterEdges.t.sol::test_nativeOutput_swap_unwrap_settleNative`;
  `RouterEdges.t.sol::test_receive_rejectsNonWdoge`;
  `RouterEdges.t.sol::test_nativeRecipient_revertOnReceive_revertsWholeTx`
  (native send to a revert-on-receive recipient reverts the whole tx — `NativeTransferFailed`).

### 9. Reorgs (DogeOS max depth 17)
- **Spec mitigation:** `deadline` + off-chain confirmation-depth policy; no on-chain dependence
  on recent history.
- **Code:** `execute` enforces `deadline` (line 76). The contract reads no block hashes, no
  recent-block state, and keeps no cross-tx storage of in-flight funds (in-memory ledger only),
  so a reorg cannot strand value or replay partial state on-chain. Confirmation-depth handling is
  off-chain (Sub-project B/C policy), as the spec scopes it.
- **Proof:** `DogeSwapRouter.t.sol::test_execute_revertsOnExpiredDeadline`;
  `RouterInvariants.t.sol::test_I6_expiredDeadlineReverts`. (Off-chain depth policy is out of
  this contract's scope.)

### 10. Permit2 replay / expiry
- **Spec mitigation:** Permit2 nonces + allowance expiry + `deadline`.
- **Code:** `_permit2Permit` forwards the signature to canonical Permit2's `permit`, which
  consumes an **ordered nonce** and enforces `sigDeadline` + per-allowance `expiration` — the
  router adds no replay surface of its own. A live, unexpired allowance lets a bare
  `PERMIT2_TRANSFER_FROM` succeed with no new signature; an expired/insufficient allowance
  reverts (UI-mappable). The router never accepts a caller-supplied owner, so a captured permit
  cannot be replayed against a third party.
- **Proof:** `RouterEdges.t.sol::test_permit2_liveAllowance_bareTransferFrom_succeeds`;
  `RouterEdges.t.sol::test_permit2_expiredAllowance_bareTransferFrom_reverts`;
  `RouterInvariants.t.sol` handler consumes monotonic nonces across 25,600 fuzzed pulls
  (`invariant_I3_spendBounded`).

### 11. Pause griefing
- **Spec mitigation:** guardian limited to pause; unpause is owner-only.
- **Code:** `pause()` is callable by `guardian` **or** `owner` (`Unauthorized` otherwise);
  `unpause()` is `onlyOwner`. A compromised guardian can only halt the router (non-destructive
  incident response), never unpause or change config. `guardian == address(0)` is a valid state
  (disables guardian-triggered pause; owner can still pause/unpause).
- **Proof:** `DogeSwapRouter.t.sol::test_pause_blocksExecute_andRolesEnforced`
  (guardian can pause, non-roles cannot, unpause is owner-only);
  `RouterInvariants.t.sol::test_I6_pausedReverts`.

### 12. Launch blast radius
- **Spec mitigation (H3):** staged notional cap — aggregate cap + default cap.
- **Code:** The cap is enforced on the **aggregate input within one `execute`**, summed across
  every `PERMIT2_TRANSFER_FROM` and `WRAP_NATIVE` per token via `_accrueInput` (running
  `L.pulled[j]` total vs `_capOf(t)`), reverting `NotionalCapExceeded`. `_capOf` resolves a
  per-token cap, falling back to a governance-set `defaultMaxInputPerTx` (closing the
  `0 = uncapped` gap for arbitrary tokens); `type(uint256).max` is the explicit-uncapped
  sentinel. Pre-seeded balances cannot be swapped (H1 ledger ignores them), so they cannot evade
  the cap.
- **Proof:** `RouterPermit2.t.sol::test_cap_aggregateAcrossPulls` (two 80e18 pulls > 120e18 cap
  revert); `RouterPermit2.t.sol::test_cap_defaultApplies`;
  `RouterEdges.t.sol::test_wrapNative_overCap_reverts` (native wrap counts toward the cap);
  `RouterInvariants.t.sol::test_I8_aggregateInputOverCapReverts` /
  `RouterInvariants.t.sol::test_I8_inputAtCapSucceeds` (inclusive boundary).

---

## Residual to be completed at deploy (Phase 5 — H4)

The **TimelockController** is not yet wired. `owner` is currently whatever address the
constructor is given; in production it MUST be an OZ `TimelockController` (min delay 24–48h;
proposer/executor = the founder Safe), with the guarded-launch caps set in the **same broadcast**
(router never live-and-uncapped) and the `Ownable2Step` handover asserted. The deploy script is
implemented (`script/DeployRouter.s.sol`; see `DEPLOYMENT.md`). Permit2 is **LIVE** at the canonical
address on DogeOS testnet (verified 2026-06-12; the deploy-if-absent step is a no-op — see
`CHAIN_FACTS.md §4`). These remaining items are tracked as deploy-phase work; the on-chain logic that consumes the timelocked owner
(`onlyOwner` + `Ownable2Step`) is already in place and tested.
