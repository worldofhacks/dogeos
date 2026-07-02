# Writing invariants for a new router code path

How to take the five-property template from SKILL.md §3 (no stranding, fee correctness, slippage
bounds, no arbitrary-call escalation, cap enforcement) and turn it into runnable coverage in this
repo. Read this when a diff adds a command byte, a venue, a new ingress, or a settlement branch.

All paths relative to `packages/contracts/`.

## The existing pattern (copy it, don't invent one)

The suite uses the Trail of Bits handler pattern: the invariant test (`test/RouterInvariants.t.sol`)
wires real contracts (router + real Permit2 deployed via permit2's `DeployPermit2` helper + venue
mocks) and registers a single fuzz target, `test/handlers/RouterHandler.sol`, whose one action
`swap(uint256 amount)`:

1. `bound()`s the amount (1e15..50 ether) and no-ops if the user can't fund it (`RouterHandler.sol:65-67`);
2. builds a real EIP-712 `PermitSingle` and signs it with `vm.sign` via `test/utils/PermitSignature.sol`
   (this is why Foundry is the ONLY fuzzer that covers the signed path — Echidna/Medusa cannot sign);
3. executes the program `[PERMIT2_PERMIT, PERMIT2_TRANSFER_FROM, V3_SWAP]` with the last leg spending
   `Constants.CONTRACT_BALANCE` (`RouterHandler.sol:85-92`);
4. on success, folds observed effects into **ghost variables** (`ghost_pulled`, `ghost_recipientOut`,
   `ghost_feeOut`, `ghost_minOutHonored`, `ghost_swaps`); on revert, does nothing
   (`fail_on_revert = false` in `foundry.toml [invariant]`).

The invariant functions then assert over ghosts + real balances, e.g. I5 conservation asserts the
entire `tout` supply sits at `{recipient, feeRecipient}` and every other actor holds 0.

## Extending for a new path — recipe

1. **Add an action, not a new handler.** Give `RouterHandler` a second bounded entry point (e.g.
   `swapV2(uint256)`, `wrapAndSwap(uint256)`, or `swapNewVenue(uint256)`) that drives the new
   command program. Foundry will interleave actions, which is exactly what exposes cross-command
   ledger bugs — the current suite's known blind spot (only V3, one pair; `RouterHandler.sol:86`).
2. **Map the five properties to ghosts:**
   - *No stranding* → after-call assertion in the invariant fn: `token.balanceOf(address(router)) == 0`
     for every token the new path touches, and any pre-seeded stranded balance unchanged.
   - *Fee correctness* → accumulate `ghost_feeOut` per token; assert
     `feeOut * 10_000 <= grossOut * feeBps` and feeRecipient balance == accrued fee (see
     `invariant_I4_feeExactAndCapped`). If the path can produce an undeclared output token, add an
     H10 ghost: outputs with `pulled == 0` must be taxed.
   - *Slippage bounds* → measure the recipient's own balance delta inside the try-block and trip a
     `ghost_minOutHonored = false` flag if `got < minOut` (never assert inside the handler — a
     handler revert is silently swallowed).
   - *No arbitrary-call escalation* → use/extend the call-tracing mocks (`MockV2Router`/`MockV3Router`/
     `MockAlgebraRouter` record `lastCaller`); assert only the router ever calls the venue
     (`invariant_I7_onlyWhitelistedVenue`). A new venue mock MUST record its caller.
   - *Cap enforcement* → if the new path adds an ingress, write the two deterministic boundary units
     (over-cap reverts, at-cap succeeds — inclusive) mirroring `test_I8_*`, and confirm the ingress
     accrues via `_accrueInput` exactly once (H5 regression: `msg.value` is metered at `execute`
     entry, so wrap must NOT re-accrue).
3. **Choose the verification class per property** and record it in `audit/INVARIANTS.md` using its
   exact vocabulary: Fuzzed (Foundry) / Fuzzed (Echidna/Medusa) / Deterministic unit /
   Argued-structural. Single-comparison gates (like I6/I8) are deterministic units; everything
   touching the ledger should be fuzzed.
4. **Run at CI parity before merging:**
   `FOUNDRY_INVARIANT_RUNS=512 FOUNDRY_INVARIANT_DEPTH=200 forge test -vvv --match-contract RouterInvariants`.

## Extending Echidna/Medusa (unsigned surface only)

`test/echidna/EchidnaRouter.sol` self-deploys the router + mocks in its constructor (no `vm` cheats
available) and asserts P1 (attacker gets 0 `tout`), P2 (stranded `tin` unchanged), P3 (minOut honored
on real inflow) inside fuzzed entry points — assertion mode, so a violation = failing call sequence.

Extend it only for properties reachable **without a Permit2 signature**: stranded-fund variants,
attacker-shaped settlements, wrap/unwrap native games (the harness can fund itself with native),
cap boundary probing. Do NOT try to fuzz the pull path here — a fake permit always reverts at
Permit2 and the H11 `try/catch` (src/DogeSwapRouter.sol:254) makes the permit command itself
swallow failures, so sequences just fail closed at `PERMIT2_TRANSFER_FROM` and teach the fuzzer
nothing.

Run commands and config knobs (`echidna.yaml` testLimit 50k assertion mode; `medusa.json` testLimit
100k, 8 workers, `stopOnFailedTest`): see `audit/REPRODUCIBILITY.md`. Neither tool is in CI, and
neither binary is installed on this server (checked 2026-07-02) — record versions with the run
output when you execute a campaign.

## Property ideas per class (from the ToB property-based-testing skill, specialized here)

| New-path kind | Highest-value property |
|---|---|
| New swap venue command | I7 caller-tracing + I1 residual-zero with the venue mock configured fee-on-transfer |
| New ingress (e.g. permit batch) | I3 spend == user debit (exact, not <=) + I8 double-accrual check |
| Settlement change | I2 on FoT output + H10 undeclared-output tax + refund-loop conservation (I5) |
| Calldata builder (JS side) | Roundtrip: decode built calldata with `cast calldata-decode` fixtures (existing pattern: `dogeSwapRouterCalldata.mjs` is verified against `cast calldata` fixtures) |
| Multi-hop/split program | Overspend guard: sum of leg inputs <= pulled total; last leg `CONTRACT_BALANCE` leaves no dust |
