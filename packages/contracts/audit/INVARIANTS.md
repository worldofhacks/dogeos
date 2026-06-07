# Invariants I1–I8 — DogeSwapRouter

Invariants transcribed verbatim from the spec
(`docs/superpowers/specs/2026-06-06-dogeos-aggregation-router-spec.md`, lines 193–200) and from
the Hardening Revisions' fuzz-coverage note (lines 365–373). For each: how it is **enforced**
(structural mechanism in `src/DogeSwapRouter.sol`) and how it is **verified**.

Verification key:
- **Fuzzed (Foundry):** stateful invariant in `RouterInvariants.t.sol`, sole target
  `RouterHandler.swap`, `runs = 256 × depth = 100 = 25,600 calls` per invariant (config in
  `foundry.toml [invariant]`; confirmed in test output: "runs: 256, calls: 25600, reverts: 0").
- **Fuzzed (Echidna/Medusa):** assertion property in `test/echidna/EchidnaRouter.sol`
  (Echidna `testLimit = 50000`; Medusa `testLimit = 100000`, assertion mode).
- **Deterministic unit:** explicit non-fuzzed test (named below).
- **Argued-structural:** guaranteed by construction; the structural argument is what the fuzz
  campaigns exercise indirectly.

---

## I1 — Router token balance == 0 after `execute`.
- **Enforced (structural):** all spend/refund/min-out logic operates on per-execute **deltas**
  (`_delta = current − entry`), and `_settle` refunds every non-buyToken input delta to
  `msg.sender` and pays the buyToken delta out, so a settled `execute` leaves ~0 of every touched
  token. The native entry is seeded `address(this).balance − msg.value`, excluding incoming value.
  (Note: `s.recipient == address(0)` is a deliberate no-op-settlement used only by unit tests that
  intentionally leave funds in the router — those tests are not invariant-targeted.)
- **Verified — Fuzzed:** `RouterInvariants.t.sol::invariant_I1_zeroResidual` (asserts `tin` and
  `tout` router balances are 0 after 25,600 settled swaps). Also asserted as P2 (stranded
  preserved) in Echidna `EchidnaRouter.sol::fuzz_cannot_drain_via_execute`.

## I2 — Recipient receives ≥ `minOut` of `buyToken`, or the tx reverts.
- **Enforced (structural):** `_settle` computes `out = _delta(buyToken)`, subtracts the fee, and
  reverts `MinOutNotMet` if `out < s.minOut` **before** paying the recipient — enforced after the
  command loop regardless of the command program (H2 enforced settlement).
- **Verified — Fuzzed:** `RouterInvariants.t.sol::invariant_I2_minOutHonored` (ghost
  `ghost_minOutHonored` must stay true across all settled fuzzed swaps). Echidna P3
  (`EchidnaRouter.sol::fuzz_cannot_drain_via_execute`, real-inflow path). Deterministic:
  `RouterSwaps.integration.t.sol::test_minOut_breach_revertsWholeTx`.

## I3 — User spends ≤ the Permit2-authorized amount.
- **Enforced (structural):** funds are only pulled via `_permit2TransferFrom`, which calls
  `PERMIT2.transferFrom(msg.sender, …)`; Permit2 itself bounds the pull to the user's live,
  unexpired allowance. The router never supplies a third-party owner.
- **Verified — Fuzzed:** `RouterInvariants.t.sol::invariant_I3_spendBounded` (asserts
  `ghost_pulled == USER_INITIAL − user balance`, i.e. the user's tin debit equals exactly the sum
  pulled, across 25,600 calls). Deterministic:
  `RouterPermit2.t.sol::test_permitAndTransferFrom_pullsFromCaller`.

## I4 — Fee charged ≤ `feeBps · notional` and ≤ `MAX_FEE`; fee only to `feeRecipient`.
- **Enforced (structural):** `setFee` rejects `bps > MAX_FEE_BPS` (`FeeTooHigh`). In `_settle`
  `fee = (out * feeBps) / BPS_DENOMINATOR` (floor; only when `feeBps != 0 && out != 0`) and is
  paid solely to `feeRecipient`.
- **Verified — Fuzzed:** `RouterInvariants.t.sol::invariant_I4_feeExactAndCapped` (relative bound
  `feeOut*10000 ≤ grossOut*feeBps`, `feeBps ≤ MAX_FEE_BPS`, and `feeRecipient`'s balance ==
  accrued fee — no leakage). Deterministic: `RouterSwaps.integration.t.sol::test_fee_takenInSettlement`;
  `DogeSwapRouter.t.sol::test_setFee_revertsAboveCap_andOwnerOnly`.

## I5 — Funds only move to `{recipient, feeRecipient, whitelisted venue, user refund}`.
- **Enforced (structural):** every payout/refund routes through `_pay`, whose destinations are
  exactly `s.recipient`, `feeRecipient`, or `msg.sender` (refunds). Venue transfers go only to the
  immutable venue routers via `forceApprove` + the venue's own swap call. Amounts are bounded by
  per-execute deltas, so stranded funds never move.
- **Verified — Fuzzed:** `RouterInvariants.t.sol::invariant_I5_conservation` (total `tout` supply
  is fully held by `{recipient, feeRecipient}` only; router/venue/burn/user/handler hold 0),
  fuzzing arbitrary amounts. Echidna P1/P2 (`EchidnaRouter.sol`) fuzz arbitrary
  attacker recipients/amounts and assert no drain. Deterministic:
  `RouterPermit2.t.sol::test_strandedFunds_notExtractable`.

## I6 — `execute` reverts when paused or past `deadline`.
- **Enforced (structural):** `execute` carries the `whenNotPaused` modifier (OZ `Pausable`,
  `EnforcedPause` revert) and the first body statement reverts `DeadlineExpired` when
  `block.timestamp > deadline`.
- **Verified — Deterministic** (I6 is deterministic, not fuzzed):
  `RouterInvariants.t.sol::test_I6_pausedReverts` and
  `RouterInvariants.t.sol::test_I6_expiredDeadlineReverts` (both also assert no state change /
  no funds pulled). Also `DogeSwapRouter.t.sol::test_execute_revertsOnExpiredDeadline`
  and `test_pause_blocksExecute_andRolesEnforced`.

## I7 — Only whitelisted venues are ever called.
- **Enforced (structural):** venue addresses are `immutable`; swap helpers call only
  `MUCHFI_V2_ROUTER` / `MUCHFI_V3_ROUTER` / `BARKSWAP_ALGEBRA_ROUTER`. No command supplies a call
  target; `_dispatch` reverts `UnknownCommand` on any unknown byte.
- **Verified — Fuzzed (call-tracing mock):**
  `RouterInvariants.t.sol::invariant_I7_onlyWhitelistedVenue` asserts the V3 mock's recorded
  `lastCaller()` is only ever `address(router)` (or zero) across 25,600 calls. Deterministic:
  `DogeSwapRouter.t.sol::test_execute_revertsOnUnknownCommand`.

## I8 — Input value per `execute` ≤ the active notional cap.
- **Enforced (structural):** `_accrueInput` maintains a running per-token `pulled` total over the
  whole `execute` (summed across `PERMIT2_TRANSFER_FROM` and `WRAP_NATIVE`) and reverts
  `NotionalCapExceeded` once `total > _capOf(token)`. `_capOf` resolves per-token cap →
  `defaultMaxInputPerTx` → `type(uint256).max` (explicit uncapped).
- **Verified — Deterministic** (I8 is deterministic, not fuzzed):
  `RouterInvariants.t.sol::test_I8_aggregateInputOverCapReverts` and
  `RouterInvariants.t.sol::test_I8_inputAtCapSucceeds` (inclusive boundary). Also
  `RouterPermit2.t.sol::test_cap_aggregateAcrossPulls`, `test_cap_defaultApplies`, and
  `RouterEdges.t.sol::test_wrapNative_overCap_reverts` (native counts toward the cap).

---

## Summary of verification class

| Invariant | Class | Primary verifier |
|-----------|-------|------------------|
| I1 | Fuzzed (Foundry 25,600 + Echidna P2) | `invariant_I1_zeroResidual` |
| I2 | Fuzzed (Foundry 25,600 + Echidna P3) | `invariant_I2_minOutHonored` |
| I3 | Fuzzed (Foundry 25,600) | `invariant_I3_spendBounded` |
| I4 | Fuzzed (Foundry 25,600) | `invariant_I4_feeExactAndCapped` |
| I5 | Fuzzed (Foundry 25,600 + Echidna P1/P2) | `invariant_I5_conservation` |
| I6 | Deterministic unit (argued-structural) | `test_I6_pausedReverts`, `test_I6_expiredDeadlineReverts` |
| I7 | Fuzzed (Foundry 25,600, call-tracing mock) | `invariant_I7_onlyWhitelistedVenue` |
| I8 | Deterministic unit (argued-structural) | `test_I8_aggregateInputOverCapReverts`, `test_I8_inputAtCapSucceeds` |

I6 and I8 are deterministic by nature (a single boolean gate / a single comparison), so they are
verified as explicit unit tests rather than via fuzz exploration; their underlying mechanisms are
nonetheless exercised on every fuzzed `execute`. I1–I5 and I7 are fuzzed at 25,600 calls each.
