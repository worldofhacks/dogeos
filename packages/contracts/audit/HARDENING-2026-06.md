# Post-audit hardening — DogeSwapRouter (2026-06-16)

Contract-logic changes applied after the in-depth audit. Each entry names the finding it
resolves, the mechanism, and the test that proves it. The earlier audit docs
(`INVARIANTS.md`, `THREAT_MODEL.md`, `KNOWN_ISSUES.md`, `SLITHER_TRIAGE.md`) describe the
*pre-hardening* contract; where a fix supersedes a doc statement it is noted below.

All changes verified: `forge build` clean, `forge test` = **58 passed / 0 failed** (incl. the
6 stateful invariants at 25,600 calls each).

---

## Contract (`src/DogeSwapRouter.sol`)

### H1 — `setFee` couples a nonzero fee to a nonzero recipient (was finding N1)
`setFee` now reverts `InvalidFeeRecipient` when `bps != 0 && r == address(0)`. Previously this
state was reachable and DoSed every ERC20-output swap (`safeTransfer` to `address(0)` reverts)
or silently burned native fees. **Supersedes** `KNOWN_ISSUES #4` / `SLITHER_TRIAGE #9`'s
"`feeRecipient == address(0)` is harmless" claim. Test:
`DogeSwapRouter.t.sol::test_setFee_revertsZeroRecipientWithFee`.

### H2 — `execute` rejects `recipient == address(0)` / `address(this)` (was finding M-01)
Settlement is now mandatory: the publicly-reachable no-settlement bypass (which silently
stranded the caller's pulled/swapped funds and skipped the refund loop) is gone. **Supersedes**
the `INVARIANTS.md I1` "tests only" carve-out — the no-op path no longer exists; funds always
reach the recipient or are refunded to `msg.sender`. Tests:
`DogeSwapRouter.t.sol::test_execute_revertsOnZeroRecipient`, `…_revertsOnSelfRecipient`.

### H3 — `minOut` binds the recipient's actual receipt (was finding M-02)
`_settle` now pays the recipient and checks the *measured balance delta* of the recipient
(`_payReceived`) against `minOut`, not the router's gross delta. This makes the I2 guarantee
("recipient receives ≥ minOut") true for fee-on-transfer / deflationary output tokens, which
credit the recipient less than the router sent. **Refines** `THREAT_MODEL.md row 7` /
`INVARIANTS.md I2`. Test:
`RouterEdges.t.sol::test_feeOnTransfer_minOut_boundToRecipientReceipt_reverts`.

### H4 — Exact, ephemeral venue approvals (was finding H-01)
`_approveVenue` (standing `type(uint256).max`) is replaced by `_approveVenueExact(amountIn)`
before each swap + `_clearVenue` (reset to 0) after. No standing allowance survives a call, so a
compromised/upgraded venue can no longer reach the router's airdropped/stranded/rescue-pending
balances out-of-band. **Supersedes** `KNOWN_ISSUES #1`. Cost: one extra `forceApprove(…,0)` per
swap leg. Covered by the swap integration + invariant suites (residual-zero invariant holds).

### H5 — Native ingress metered at the single entry point (was findings N4/N5)
`execute` accrues the full incoming `msg.value` against the NATIVE cap once at entry;
`_wrapNative` no longer re-accrues. The cap now bounds *all* native a call brings in, whether it
is later wrapped or settled/refunded as native — closing the raw-`msg.value`-as-buyToken bypass.
**Refines** `INVARIANTS.md I8` / `THREAT_MODEL.md #12`. Test (boundary):
`RouterEdges.t.sol::test_wrapNative_overCap_reverts`; deploy now also sets a NATIVE cap (below).

### H6 — Constructor rejects zero venue/WDOGE addresses (was finding L-01)
`ZeroAddress` revert if any of WDOGE / V2 / V3 / Algebra is `address(0)` (guardian `0` stays
valid). Test: `DogeSwapRouter.t.sol::test_constructor_revertsOnZeroVenue`.

---

## Second-pass hardening (2026-06-26, deep adversarial re-audit)

A follow-up multi-agent audit (8 vuln classes, every finding adversarially verified) found the
audited source otherwise clean; two genuinely-undisclosed, low/medium issues were fixed. Both were
also present on the immutable deployed router (which cannot be patched — next deploy only). `forge
test` = **60 passed / 0 failed** (incl. the 6 invariants at 25,600 calls each).

### H10 — Protocol fee binds to the real output, not just the declared `buyToken`
`_settle` previously taxed only `_delta(buyToken)`, so a caller could mislabel the settlement token
(declare a zero-delta input/intermediate token as `buyToken`, `minOut: 0`) and collect the real
swap output **fee-free** via the refund-to-`msg.sender` loop. The fee is now also applied to every
net-positive OUTPUT delta in the refund loop — i.e. any token the call did NOT pull as input
(`L.pulled[i] == 0`); genuine unspent INPUT dust (`pulled > 0`) is still refunded untaxed. This
makes the protocol fee unavoidable regardless of the command program. **Refines** `INVARIANTS.md
I4` (the old bound was one-sided, fee ≤ cap; the fee was never asserted to bind the full economic
output). Impact was protocol-revenue-only (no user funds at risk) and latent at `feeBps == 0`. Test:
`RouterSwaps.integration.t.sol::test_fee_notEvadableByMislabeledBuyToken`.

### H11 — `PERMIT2_PERMIT` tolerates an already-applied (front-run) permit
`_permit2Permit` wraps `PERMIT2.permit(...)` in `try/catch` (UniversalRouter allow-revert pattern).
The signed permit rides in public calldata; a front-runner could replay it directly to Permit2,
advancing the user's ordered nonce so the bundled permit reverts `InvalidNonce` and bricked the
whole swap (griefing DoS, gas burn, no theft). Since the front-run already SET the allowance the
user signed (spender == this router), swallowing the revert lets the swap proceed; an genuinely
insufficient allowance still fails closed at the subsequent `PERMIT2_TRANSFER_FROM`. The
`p.spender == address(this)` check remains a hard revert. **Extends** `THREAT_MODEL.md #10` (which
covered third-party replay + expiry but not self-nonce pre-consumption). Test:
`RouterSwaps.integration.t.sol::test_permit2_frontRunNonce_swapStillSucceeds`. Complementary
UI mitigation (emit a bare `PERMIT2_TRANSFER_FROM` when a live allowance already exists) ships
separately for the un-patchable live router.

## Deploy script (`script/DeployRouter.s.sol`)

### H7 — Ship paused (was finding N2)
The router is `pause()`d at the end of the broadcast so no swap volume flows during the
un-timelocked Ownable2Step handover window; governance unpauses after the timelock owns it.

### H8 — Timelock admin = `address(0)` (was finding N3)
`TimelockController` is deployed with `admin = address(0)` (the timelock self-administers via
timelocked proposals) instead of granting the Safe a standalone, delay-free `DEFAULT_ADMIN_ROLE`.

### H9 — Native cap set at deploy (was finding N5)
`setMaxInputPerTx(NATIVE, capWdoge)` so native→wrap→swap cannot exceed the WDOGE-pool
blast-radius limit via the looser default cap.
