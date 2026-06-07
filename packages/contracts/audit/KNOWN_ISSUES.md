# Known Issues & Accepted Trade-offs — DogeOSAggregationRouter

Honest disclosure of accepted design trade-offs, residual risks, and open deploy-phase work.
None is an exploitable vulnerability; each is either a bounded footgun, a config state, or a
deploy step. Cross-references: `SLITHER_TRIAGE.md` (suppressed false positives), `THREAT_MODEL.md`,
`INVARIANTS.md`, `CHAIN_FACTS.md`.

---

## 1. Standing max allowance to immutable venues
**Status: accepted (safe by construction).**
`_approveVenue` grants `type(uint256).max` allowance from the router to each immutable venue
router (set once, refreshed only when the current allowance is below the needed amount). A
standing max allowance normally widens blast radius, but here it is safe because:
- the venues are **immutable, trusted** DEX SwapRouters validated in the constructor (no
  user-supplied target can ever receive an approval);
- the router holds **~zero balance between transactions** — the per-execute ledger (H1)
  guarantees only what *this* call brought in is ever spendable, and the residual after a settled
  `execute` is ~0 (`invariant_I1_zeroResidual`, the residual-zero invariant). A drained venue
  could therefore pull at most the in-flight amount of one transaction, which the user already
  authorized and which is bounded by the notional cap.

## 2. Native recipient / feeRecipient that reverts on receive can DoS that single tx
**Status: accepted (documented user/owner footgun).**
`_pay`'s native branch reverts `NativeTransferFailed` if the destination's `receive`/`fallback`
reverts. If a user names a `settlement.recipient` that rejects native, or the owner sets a
`feeRecipient` that rejects native, that **single transaction** reverts — it does not strand
funds (the whole tx reverts atomically) and does not affect any other user. The recipient is
caller-declared and the feeRecipient is owner-set, so this is self-inflicted and recoverable by
re-quoting to a payable recipient. Documented behavior, proven by
`RouterEdges.t.sol::test_nativeRecipient_revertOnReceive_revertsWholeTx`.

## 3. Per-token notional cap requires governance to set caps or a default
**Status: accepted (governance + off-chain UI responsibility).**
The cap protects launch blast radius (H3) but is only as tight as governance configures it. A
token with no per-token cap and `defaultMaxInputPerTx == 0` is effectively uncapped
(`_capOf` returns `type(uint256).max`). Mitigations: (a) the deploy script must set guarded-launch
caps in the same broadcast (H4 — router never live-and-uncapped); (b) `defaultMaxInputPerTx`
closes the `0 = uncapped` gap for arbitrary/unlisted tokens; (c) unlisted-token UI labeling and
screening live in Sub-project B (off-chain), which the spec designates as the front-line for
arbitrary-token risk. On-chain safety does not depend on a token allowlist (balance-delta +
`SafeERC20`).

## 4. Missing zero-address checks on guardian / feeRecipient setters
**Status: accepted (owner-only config states; documented LOW in Slither triage #9).**
`setGuardian`, `setFee` (and the immutable constructor params) accept `address(0)`. These are
owner-only (Timelock) admin paths, not attacker-reachable:
- `guardian == address(0)` is a **valid intentional state** (disables guardian-triggered pause;
  owner can still pause/unpause) — a zero-check would be wrong here;
- `feeRecipient == address(0)` is harmless because fees only pay out when `feeBps != 0`, and a
  zero-recipient fee config is an obvious owner error correctable by another `setFee`;
- zero venue/WDOGE addresses simply make the router fail to swap (no funds at risk; redeploy).
Adding constructor reverts is reasonable hardening but a **contract logic change**, out of scope
for this comment-only audit-prep pass. Left as a documented LOW (see `SLITHER_TRIAGE.md §9`).

## 5. Permit2 must be deployed on DogeOS before the router
**Status: open — deploy phase (critical-path).**
`CHAIN_FACTS.md §4` records that canonical Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`)
is **absent** on DogeOS testnet (`eth_getCode` → `0x`). The router's entire pull path depends on
it. Phase 5 must deploy canonical Permit2 deterministically via the Arachnid CREATE2 proxy
(`0x4e59b44847b379578588920cA78FbF26c0B4956C`) **before** deploying the router, and verify on
Blockscout.

## 6. MyDoge EIP-712 typed-data gate (Task 0.3) still open
**Status: open — de-risking gate.**
AllowanceTransfer requires the DogeOS-native wallet (MyDoge) to support `signTypedData`
(EIP-712). `ecrecover` is confirmed available on-chain (`CHAIN_FACTS.md §3a`), so signature
recovery works, but the wallet-side signing capability (Task 0.3) is not yet confirmed in this
package. If MyDoge cannot sign typed data, the program must revisit (per spec, no classic-approve
fallback was built up front).

## 7. TimelockController + deploy/handover (Phase 5 / H4) not yet executed
**Status: open — deploy phase.**
The `script/` directory is empty: no deploy script wires the OZ `TimelockController` as `owner`,
sets the initial guarded-launch caps in the same broadcast, or asserts the `Ownable2Step`
handover. The on-chain mechanism that consumes a timelocked owner (`onlyOwner` + `Ownable2Step`)
is in place and tested; only the deploy/wiring is outstanding. Until then the router's `owner` is
whatever EOA/contract the constructor receives — production MUST use the Timelock (min delay
24–48h; proposer/executor = the founder Safe). This is the primary unsatisfied acceptance
criterion (spec lines 261–269).

## 8. `rescue` is an owner-only escape hatch (event-after-call)
**Status: accepted (Slither triage #5, LOW).**
`rescue(token,to,amount)` lets the owner (Timelock) recover genuinely stranded/airdropped funds
that `execute` can never move. It is `onlyOwner`, not reachable from `execute`, emits its event
after the transfer (benign for an admin-only path), and `execute` is additionally `nonReentrant`.
No exploit surface.

## 9. Coarse `block.timestamp` deadline
**Status: accepted (Slither triage #7, LOW).**
The `deadline` check tolerates coarse (~seconds) miner/sequencer timestamp drift, which is the
intended and standard semantics for swap expiry. No value or branch decision depends on
fine-grained timestamp precision.

---

## Slither false positives (suppressed, see `SLITHER_TRIAGE.md`)
The HIGH `arbitrary-send-eth` and the MEDIUM `incorrect-equality`, `uninitialized-local`,
`unused-return` findings are all false positives stemming from the deliberate balance-delta
(`_delta`) accounting and enforced-settlement design. They are suppressed inline with one-line
justifications (comment-only; no logic changed). `slither .` exits 0 with `fail_on: high`; zero
unjustified HIGH/MEDIUM remain.
