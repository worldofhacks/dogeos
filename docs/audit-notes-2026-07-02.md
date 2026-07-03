# Audit notes 2026-07-02

Scope:

- `packages/contracts/`
- Aggregator calldata composition in `packages/aggregator/src/swap/`
- API `/approval` and `/swap` paths in `packages/api/src/handler.mjs` / `live.mjs`

Method:

- Trail-of-Bits-style checklist from `.claude/skills/trail-of-bits-security/SKILL.md`
- `forge build --sizes`
- `FOUNDRY_INVARIANT_RUNS=512 FOUNDRY_INVARIANT_DEPTH=200 forge test -vvv`
- `slither .`
- `npm test`
- Manual review of source gating, quote refresh/clamp, approval planning, recipient binding, and
  router-program calldata construction

## Findings

### High: live router still predates source hardening

Status: known open risk, not fixed in this pass.

The source tree is hardened, but the live Chikyu router
`0xa3158549f38400F355aDf20C92DA1769620Aa35A` is still the pre-hardening immutable deployment. It
lacks the H1-H11 source fixes recorded in `packages/contracts/audit/HARDENING-2026-06.md`. The EOA
`0xE659A8d3745b1355CA47B3d92925997Ef93a2873` also still owns the live router and registry instead of
the timelock accepting ownership.

Rationale: this remains the highest-impact mismatch between audited source and deployed behavior.

Next action: execute `packages/contracts/audit/REDEPLOY-RUNBOOK.md` and governance handover before any
mainnet path.

### Medium: exact-output direct MuchFi V3 swaps have no venue-level deadline

Status: known open risk, not fixed in this pass.

Router execution gives exact-input routes an enforced deadline, and V2/Algebra direct calldata carry
deadlines. MuchFi V3 exact-output direct calldata has no deadline parameter in the current builder, and
the first-party router command set is exact-input only. Server-side quote refresh and slippage caps
still protect price bounds, but transaction inclusion time is not bounded at the venue level for this
path.

Rationale: stale exact-output transactions are still bounded by max input, but the missing deadline is
weaker MEV/staleness posture than the router path.

Next action: add server-side deadline range validation and either route exact-output through a deadline
enforcing wrapper or explicitly disable stale exact-output submissions after the client deadline.

### Low: Solidity shadowing warning in `_payReceived`

Status: fixed in this pass.

`DogeSwapRouter._payReceived` used the local name `bal` in both native and ERC-20 branches, producing a
Solidity shadowing warning during `forge build --sizes`. Renamed them to `nativeBefore` and
`tokenBefore`; no logic changed and runtime size stayed 12,683 bytes.

## Tool results

### Foundry build

Command:

```bash
cd packages/contracts
forge build --sizes
```

Result: pass. `DogeSwapRouter` runtime size 12,683 bytes, margin 11,893 bytes. After the local rename,
the compiler run is successful without the previous Solidity shadowing warning. Remaining forge-lint
warnings are in test mocks/handlers plus the intentional production deadline timestamp check.

### Foundry tests and invariants

Command:

```bash
cd packages/contracts
FOUNDRY_INVARIANT_RUNS=512 FOUNDRY_INVARIANT_DEPTH=200 forge test -vvv
```

Result: pass. 8 suites, 60 tests passed, 0 failed, 0 skipped. Stateful invariants I1, I2, I3, I4, I5,
and I7 each ran 512 runs / 102,400 calls. The live-fork V3 differential test did not skip.

### Slither

Command:

```bash
cd packages/contracts
slither .
```

Result: exit 0. Same expected 9 residuals:

- 2 `incorrect-equality`: intentional zero short-circuits in `_settle` and `_payReceived`
- 3 `missing-zero-check`: registry router setter and guardian setter/constructor; zero guardian is an
  allowed disable state
- 4 `naming-convention`: uppercase immutable venue/router constants

No new Slither findings were introduced.

### Node tests

Command:

```bash
npm test
```

Result: pass. 364 tests passed, 0 failed.

## Manual calldata-composition review

Reviewed:

- `packages/api/src/handler.mjs`
- `packages/api/src/live.mjs`
- `packages/aggregator/src/swap/calldataRegistry.mjs`
- `packages/aggregator/src/swap/venueCalldataBuilders.mjs`
- `packages/aggregator/src/swap/dogeSwapRouterCalldata.mjs`
- `packages/aggregator/src/routes/splitRoutes.mjs`
- approval planners in `erc20Approval.mjs` and `permit2Approval.mjs`

Results:

- `/swap` rejects non-active quotes and binds `quote.recipient` to the sender before calldata is built.
- Live wiring keeps `refreshSwapQuoteBeforeBuild=true`, then `clampRefreshedSwapQuote` fails closed if
  refreshed exact-input output falls below the accepted minimum or exact-output input exceeds the
  accepted maximum.
- `createVerifiedCalldataBuilder` requires an active source, executable verification evidence, approved
  ABI provenance, matching source router, and matching typed selector.
- Router-execution mode additionally checks the venue router against the verified venue and the quote
  router against the verified DogeSwapRouter source.
- Router-program calldata pulls the total sell token once through Permit2, spends explicit amounts on
  non-last legs, spends `CONTRACT_BALANCE` on the last leg to avoid dust, and settles against the
  aggregate `minAmountOut`.
- `/approval` refreshes when live wiring is used and plans exact ERC-20 approvals for direct routes or
  Permit2 approval/signature flow for router execution.
- No caller-controlled call target or approval target was found in the reviewed path.

Residual API risks already tracked in the roadmap:

- raw error messages can still surface through some 400/422 responses;
- base `createAggregatorApiHandler` defaults `refreshSwapQuoteBeforeBuild=false`, so non-live tests or
  custom embedders must opt in explicitly;
- `/activity` pagination and several Blockscout fetches still need timeout/pagination hardening.
