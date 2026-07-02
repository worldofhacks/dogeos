---
name: trail-of-bits-security
description: Security review workflow for DogeSwap contracts and calldata paths. Use when asked to "security review this diff", "is this safe", "can this be drained", "run the security checklist", "audit" anything, run "slither" / "echidna" / "medusa", write or check an "invariant", or before merging any packages/contracts change. Indexes the installed Trail of Bits plugins and grounds them in this repo's router, invariants I1-I8, and audit package.
---

# Trail of Bits security workflow — DogeSwap

The on-chain surface is one immutable command/executor router, `packages/contracts/src/DogeSwapRouter.sol`
(381 lines w/ NatSpec; whole `src/` is 515 raw lines incl. registry/libs/interfaces — `wc -l` 2026-07-02;
the 307 in `audit/REPRODUCIBILITY.md` predates the hardening), on DogeOS zkEVM testnet (chain 6281971,
Prague EVM).
Venues (immutable, whitelisted): MuchFi V2 `0xC653e745FC613a03D156DACB924AE8e9148B18dc`, MuchFi V3
`0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB`, Barkswap Algebra `0x77147f436cE9739D2A54Ffe428DBe02b90c0205e`,
WDOGE `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE`. Funds ingress only via canonical Permit2
`0x000000000022D473030F116dDEE9F6B43aC78BA3` (live on DogeOS since 2026-06-12). The off-chain
calldata-composition path lives in `packages/aggregator/src/swap/` behind `POST /swap` / `POST /approval`
(`packages/api/src/handler.mjs`, `live.mjs`).

**The #1 standing risk (read before saying "safe"):** the LIVE production router
`0xa3158549f38400F355aDf20C92DA1769620Aa35A` is the immutable **pre-hardening** build — it lacks all of
H1-H11 (bytecode verified 2026-06-26 to lack the `InvalidRecipient`/`InvalidFeeRecipient` selectors) —
and the EOA `0xE659A8d3745b1355CA47B3d92925997Ef93a2873` still owns both it and the registry
`0xC596081d427E8296e089eDD59a62E73Da3191215`; the timelock (`0xf3410B762Db55aA3CBAfaa5707899b3d3A7F1773`)
handover was never executed. Only the source in this repo is hardened. Cutover procedure:
`packages/contracts/audit/REDEPLOY-RUNBOOK.md`.

## 1. Trail of Bits plugins (thin index)

Three ToB plugins are installed at user scope and enabled in this repo's `.claude/settings.json`
(versions verified 2026-07-02 in `~/.claude/plugins/cache/trailofbits/`). Fresh machine:

```bash
claude plugin marketplace add trailofbits/skills
claude plugin install building-secure-contracts@trailofbits
claude plugin install property-based-testing@trailofbits
claude plugin install testing-handbook-skills@trailofbits
```

| Plugin (installed ver.) | Key skills | Reach for it when |
|---|---|---|
| `building-secure-contracts` (1.1.2) | `audit-prep-assistant` (ToB pre-review checklist: goals, static analysis, coverage, docs), `secure-workflow-guide` (5-step secure dev workflow incl. Slither + security-property docs), `code-maturity-assessor` (the 9-category scorecard behind our `audit/CODE_MATURITY.md`), `token-integration-analyzer` (ERC20 weird-token checklist — 20+ patterns), `guidelines-advisor` (ToB best practices). Also chain scanners we don't need (Solana/Cosmos/Cairo/TON/Algorand/Substrate). | Preparing a new audit round, re-scoring maturity after governance handover, and **any new token integration** (run `token-integration-analyzer` before listing/routing a new token — pairs with the `dogeos-pool-scanner` skill). |
| `property-based-testing` (1.1.1) | single `property-based-testing` skill: property catalog (roundtrip/idempotence/invariant/oracle...), smart-contract state invariants rated HIGH priority, multi-language. | Designing invariants for a **new code path** (new command, new venue, calldata builder) before writing the Foundry handler; also for the JS calldata encoders (encode/decode roundtrips). |
| `testing-handbook-skills` (1.0.2) | fuzzer skills (`aflpp`, `cargo-fuzz`, `libfuzzer`, `libafl`, `atheris`, `ruzzy`) + techniques (`harness-writing`, `coverage-analysis`, `fuzzing-dictionary`, `fuzzing-obstacles`, `ossfuzz`, `address-sanitizer`) + `wycheproof`, `constant-time-testing`. | Mostly non-Solidity. Useful here: `harness-writing` and `coverage-analysis` concepts when extending `RouterHandler.sol` / `EchidnaRouter.sol`. **No Echidna/Medusa skill exists in these plugins** — that knowledge lives in this repo (`audit/REPRODUCIBILITY.md`, §2 below). |

## 2. Tooling workflow for this repo

All commands run from `packages/contracts/` with `export PATH="$HOME/.foundry/bin:$HOME/.local/bin:$PATH"`.

**Gotcha first (verified 2026-07-02):** `packages/contracts/lib/` is **gitignored**
(`packages/contracts/.gitignore:9`), so a fresh clone/worktree will not build. Restore deps either by
copying from an existing checkout (`cp -r /home/actlabs/dogeswap-prod/packages/contracts/lib .` — the
vendored copies match the pins in `audit/REPRODUCIBILITY.md`: forge-std 1.9.7, OZ 5.6.1, permit2 1.0.0)
or the CI way: `forge install foundry-rs/forge-std@v1.9.7 Uniswap/permit2 OpenZeppelin/openzeppelin-contracts@v5.6.1 --no-git`.
Note CI installs `Uniswap/permit2` **untagged** — a known reproducibility risk vs the vendored 1.0.0.

### Foundry (the gate)

```bash
forge build --sizes     # runtime must stay < 24,576 B (currently 11,831 B)
forge test              # MUST be 60 passed / 0 failed  (verified 2026-07-02: 8 suites, 60/0)
# CI parity (102,400 calls per invariant, 4x local):
FOUNDRY_INVARIANT_RUNS=512 FOUNDRY_INVARIANT_DEPTH=200 forge test -vvv
```

Local `foundry.toml [invariant]`: runs=256, depth=100 (25,600 calls per invariant), `fail_on_revert=false`.
Test inventory: 53 unit/adversarial tests + 6 stateful invariants (`test/RouterInvariants.t.sol` +
`test/handlers/RouterHandler.sol`) + 1 live-fork differential (`test/fork/RouterFork.t.sol` — **skips
silently** without a fork URL/pool liquidity; CI has no fork job, so real-venue coverage can quietly
vanish while CI stays green). CI: `.github/workflows/contracts-security.yml` (forge + slither jobs on
any `packages/contracts/**` change; Echidna/Medusa are NOT in CI).

### Slither

Binary: `~/.local/bin/slither`, v0.11.5 (verified 2026-07-02). Run from `packages/contracts` — it
auto-picks `slither.config.json` (`filter_paths: lib|test|script`, `exclude_dependencies`, `fail_on: high`):

```bash
cd packages/contracts && slither .   # exit 0 expected
```

Expected residual (verified 2026-07-02: exits 0, 9 results): 2 MEDIUM `incorrect-equality`
(`_settle` `d == 0` at src:344 and `_payReceived` `amount == 0` at src:364 — the same intentional
zero-amount short-circuit class as triage #2, at sites the H3/H10 hardening added *after* the triage
pass, so they carry no inline suppression yet), 3 LOW `missing-zero-check` on owner-only setters
(partly intentional — `guardian = address(0)` is a valid disable state), 4 INFO `naming-convention`
on the UPPER_SNAKE immutables. **Triage protocol** for anything new: (1) check it
against the balance-delta/enforced-settlement design before believing it — the initial run's 1 HIGH
(`arbitrary-send-eth` in `_pay`) and 3 MEDIUMs were all false positives of that design; (2) if false
positive, suppress with a comment-only `// slither-disable-next-line <detector>` plus a one-line
in-source justification (never change logic to appease Slither); (3) record the disposition in
[`audit/SLITHER_TRIAGE.md`](../../../packages/contracts/audit/SLITHER_TRIAGE.md). Zero unjustified
HIGH/MEDIUM is the merge bar.

### Echidna / Medusa (local/manual only — not in CI, not installed on this server as of 2026-07-02)

Configs exist and work: `echidna.yaml` (assertion mode, testLimit 50k), `medusa.json` (100k, 8 workers,
target `EchidnaRouter`), harness `test/echidna/EchidnaRouter.sol`. Versions used for the audit record:
Echidna 2.3.2, Medusa 1.5.1 (`audit/REPRODUCIBILITY.md`).

```bash
echidna test/echidna/EchidnaRouter.sol --contract EchidnaRouter --config echidna.yaml
medusa fuzz --config medusa.json
```

**Why the signed-Permit2 path is unfuzzable externally:** every fund pull requires a valid EIP-712
secp256k1 signature over a `PermitSingle` from the caller's private key. Echidna/Medusa have no
`vm.sign` — they cannot produce valid signatures — so the external harness deliberately covers only
the **unsigned attack surface**: pre-seeded stranded funds + attacker-shaped `execute` calls (P1
no-drain, P2 stranded preserved, P3 minOut on real inflow; see the harness header, lines 10-26).
The signed pull path is fuzzed **only** by the Foundry handler (`RouterHandler.sol`, which signs with
`vm.sign` via `test/utils/PermitSignature.sol`). Any change to the Permit2 path therefore needs
Foundry-invariant coverage, not Echidna coverage.

### When manual review is mandatory (no tool substitutes)

- **Calldata composition** — anything in `packages/aggregator/src/swap/` (builders, registry, router
  program builder) or `packages/api/src/handler.mjs` `/swap` / `/approval` flow. The server composes
  the exact bytes users sign; a bug here bypasses every on-chain test.
- **Settlement changes** — `_settle`/`_payReceived`/`_pay` (`DogeSwapRouter.sol:328-380`). Fee, minOut,
  refund, and the H10 anti-evasion tax all live here; the invariants assume its current shape.
- **New venue commands** — a new byte in `Commands.sol` + `_dispatch` arm widens I7's surface;
  requires new invariant coverage (§3 template) + a calldata builder + registry entry + this review.
- **Approval planner changes** — `permit2Approval.mjs` / `erc20Approval.mjs` (the one-time
  `approve(Permit2, MAX)` is a deliberate, documented deviation from exact-amount discipline).

## 3. Invariants I1-I8 (the router's contract)

Authoritative text: [`audit/INVARIANTS.md`](../../../packages/contracts/audit/INVARIANTS.md). Summary:

| # | Invariant | Verification |
|---|---|---|
| I1 | Router token balance == 0 after `execute` (no residue) | Fuzzed 25,600 calls (`invariant_I1_zeroResidual`) + Echidna P2 |
| I2 | Recipient receives >= `minOut` of `buyToken`, or the whole tx reverts | Fuzzed (`invariant_I2_minOutHonored`) + Echidna P3 |
| I3 | User spends <= the Permit2-authorized amount | Fuzzed (`invariant_I3_spendBounded`) |
| I4 | Fee <= `feeBps * notional`, <= MAX_FEE (100 bps); paid only to `feeRecipient` | Fuzzed (`invariant_I4_feeExactAndCapped`) |
| I5 | Funds move only to {recipient, feeRecipient, whitelisted venue, caller refund} | Fuzzed (`invariant_I5_conservation`) + Echidna P1/P2 |
| I6 | `execute` reverts when paused or past `deadline` | Deterministic units (`test_I6_*`) |
| I7 | Only whitelisted venues are ever called | Fuzzed w/ call-tracing mock (`invariant_I7_onlyWhitelistedVenue`) |
| I8 | Aggregate input per `execute` <= the active notional cap | Deterministic units (`test_I8_*`, inclusive boundary) |

Coverage honesty: the stateful handler fuzzes **only the V3 venue with one token pair**
(`RouterHandler.sol:86` — commands `[PERMIT2_PERMIT, PERMIT2_TRANSFER_FROM, V3_SWAP]`). V2, Algebra,
wrap/unwrap, and multi-token programs are unit-tested but not stateful-fuzzed.

**Property template for any new code path** (new command, venue, settlement branch, calldata builder) —
instantiate all five, then map each to fuzzed/deterministic/structural exactly like `INVARIANTS.md`:

1. **No token stranding** — extend I1: after a settled `execute` through the new path, the router's
   balance of every touched token is 0; pre-existing balances are untouched.
2. **Fee correctness** — extend I4 + H10: fee binds the *real* economic output (including undeclared
   output tokens with `pulled == 0`), is floor-rounded, capped at 100 bps, and reaches only `feeRecipient`.
3. **Slippage bounds honored** — extend I2: the recipient's *measured receipt* (not the router delta,
   not a venue return value) >= minOut, else full revert — including fee-on-transfer output tokens.
4. **No arbitrary-call escalation** — extend I7: the new path introduces no caller-controlled call
   target, no delegatecall, no approval to a non-immutable address; unknown command bytes still revert.
5. **Cap enforcement** — extend I8: every new ingress (pull/wrap/msg.value variant) accrues against
   `_capOf` once and exactly once.

Handler skeleton + how to extend the fuzz campaigns: [references/new-path-properties.md](references/new-path-properties.md).

## 4. Aggregator/router attack surface (the review lens)

Read any contracts or swap-path diff against these classes. `Router:N` = `packages/contracts/src/DogeSwapRouter.sol:N`.

- **Arbitrary external call injection via route calldata.** On-chain: `_dispatch` is a fixed 7-command
  if/else (Router:229-238, `UnknownCommand` at :237); no command input carries a call target; venues
  immutable (Router:61-67). Off-chain: `calldataRegistry.mjs:89-112` only builds for ACTIVE+verified
  sources, requires `quote.router` == the registry's verified router, and asserts the produced
  selector matches the builder's registered selector (:106). Review question for every diff: *did a
  caller-influenced address become a call/approval target?*
- **Approval / Permit2 abuse.** Permit2 owner/from is ALWAYS `msg.sender` (Router:254, :260 —
  UniversalRouter pattern; no third-party allowance drain), `p.spender == address(this)` is a hard
  revert (:243). Venue approvals are delta-exact and ephemeral: `forceApprove(venue, amountIn)` then
  `forceApprove(venue, 0)` (Router:275-282, H4) — no standing allowance survives a call. **H11
  front-run tolerance:** `try PERMIT2.permit(...) {} catch {}` (Router:254) tolerates a replayed
  permit; a genuinely missing allowance fails closed at the next pull. Residual: the catch swallows
  *all* permit failures (bad sig, expired sigDeadline), so errors surface later as a generic
  allowance revert — error attribution only, not a security hole. API side: the Permit2 planner
  (`permit2Approval.mjs:129-227`) plans a one-time `approve(Permit2, MAX)` (deliberate, documented —
  spend authority lives in the exact-amount, 30-day-expiring signed permit).
- **Fee-on-transfer / rebasing tokens.** All amounts are balance deltas, never return values
  (Router:214-216, venue returns deliberately ignored :288/:297/:308); minOut binds the *recipient's*
  measured receipt via `_payReceived` (Router:363-373, H3); `SafeERC20`/`forceApprove` handle
  USDT-style tokens. GAP: no rebasing or ERC777-callback token mock exists in the suite.
- **V3/Algebra callback reentrancy.** `execute` is `nonReentrant` via OZ `ReentrancyGuardTransient`
  (Router:173; EIP-1153 probe-confirmed on DogeOS, `audit/CHAIN_FACTS.md` §3); `receive()` accepts
  native only from WDOGE (Router:113); cross-command state is an in-memory ledger — no storage for a
  callback to corrupt. Note the router calls venue *SwapRouters*, never pools, so V3/Algebra swap
  callbacks terminate at the venue router, not here.
- **Quote-vs-execution price manipulation.** The server never trusts client price fields: `/swap`
  re-quotes before building (`live.mjs:196`, `refreshSwapQuoteBeforeBuild` default **true** in live
  wiring — but **false** in the base handler, `handler.mjs:541`; any new wiring must set it), only
  `recipient/deadline/sender/permit2Permit` survive from the client quote (`handler.mjs:331-341`),
  `clampRefreshedSwapQuote` fails closed if price moved past the user-accepted bound
  (`handler.mjs:349-381`), and recipient must equal sender (`handler.mjs:72-85`, :937-940). On-chain
  backstop: settlement minOut (Router:338-339).
- **MEV / sandwich.** On-chain `minOut` + `deadline` (Router:176, :339); server slippage hard-capped
  at 500 bps (`packages/aggregator/src/quoteService.mjs:11`). Venue-level price limits are disabled
  (`sqrtPriceLimitX96: 0` Router:299, `limitSqrtPrice: 0` Router:310) and router-program legs carry
  `minOut=0` (`dogeSwapRouterCalldata.mjs`, last leg spends `CONTRACT_BALANCE`) — the aggregate
  settlement floor is the **only** binding price protection; never weaken it. Accepted: slippage
  defaults live off-chain (`audit/CODE_MATURITY.md`, MEV = Satisfactory). Standing gap: **V3
  exact-output swaps execute direct at the venue with no deadline at all** (the MuchFi V3 ABI has no
  deadline param, `venueCalldataBuilders.mjs:109-121`; router commands are exact-input only).
- **Native-token edge cases.** All incoming `msg.value` is metered against the NATIVE cap once at
  entry (Router:196, H5); native ledger entry excludes `msg.value` (Router:191); NATIVE cap set at
  deploy (H9). Accepted ([`KNOWN_ISSUES.md`](../../../packages/contracts/audit/KNOWN_ISSUES.md) #2):
  a revert-on-receive recipient/feeRecipient DoSes only that tx. Footgun: if `buyToken == NATIVE`,
  unwrapped excess `msg.value` counts in the buyToken delta and is fee'd + paid to the recipient
  instead of refunded (Router:191-196, :330) — UI must never over-send value.
- **Fee evasion.** H10: undeclared output (net-positive delta on a token never pulled, `pulled == 0`)
  is taxed in the refund loop (Router:353-356). Residual: output round-tripped into a *pulled* input
  token refunds untaxed — protocol-revenue-only, latent while `feeBps == 0`.
- **Cap enforcement.** `_accrueInput`/`_capOf` (Router:217-227, I8). Accepted (KNOWN_ISSUES #3):
  per-token cap 0 + `defaultMaxInputPerTx` 0 = silently uncapped; the blast-radius guarantee is
  governance-config-dependent (deploy script sets caps in the same broadcast).

## 5. 2026-06 audit package summary

Package: `packages/contracts/audit/` (10 docs). Threat model rows 1-12 in
[`THREAT_MODEL.md`](../../../packages/contracts/audit/THREAT_MODEL.md); fix log in
[`HARDENING-2026-06.md`](../../../packages/contracts/audit/HARDENING-2026-06.md). Findings fixed:

- **H1** `setFee` couples nonzero fee to nonzero recipient (zero recipient DoSed every ERC20-output swap).
- **H2** Mandatory settlement — `execute` rejects zero/self recipient (no-settlement fund-stranding bypass closed).
- **H3** `minOut` binds the recipient's *actual* receipt (fee-on-transfer output correctness).
- **H4** Exact, ephemeral venue approvals (standing max allowance removed).
- **H5** Native `msg.value` metered once at entry against the cap (raw-value bypass closed).
- **H6** Constructor rejects zero venue/WDOGE addresses.
- **H7** Deploy ships paused (no volume during the un-timelocked handover window).
- **H8** Timelock deployed with `admin = address(0)` (no delay-free DEFAULT_ADMIN_ROLE).
- **H9** NATIVE cap set at deploy.
- **H10** (2026-06-26 re-audit) Fee binds real output — mislabeled-buyToken fee evasion closed.
- **H11** (2026-06-26 re-audit) Permit front-run tolerance — replayed-permit griefing DoS closed.

Post-fix state: `forge test` 60/0, Slither exit 0 (both re-verified 2026-07-02).

**What the 2026-06 work did NOT cover — the open list:**

- The **live router predates all of H1-H11** and is immutable; redeploy+cutover
  ([`REDEPLOY-RUNBOOK.md`](../../../packages/contracts/audit/REDEPLOY-RUNBOOK.md)) is open end-to-end. #1 standing risk.
- **Single-EOA governance**: the EOA owns the live router AND registry; timelock `acceptOwnership()`
  never executed; no guardian split (KNOWN_ISSUES #7; `CODE_MATURITY.md` Decentralization = Moderate).
- Cross-venue invariant fuzzing: the stateful handler is **single-V3-pair only**; V2/Algebra/native
  paths and multi-token ledger interactions are unfuzzed.
- **No CI fork job**; the one fork differential test skips silently when liquidity is absent.
- External fuzzers (Echidna/Medusa) **skip the entire signed-Permit2 surface** (§2) and are not in CI.
- No rebasing/ERC777 token mock; `rescue` NATIVE path untested; V2 paths >2 hops untested.
- `lib/` deps vendored without upstream commit pins (pre-mainnet gap, `REPRODUCIBILITY.md`); CI
  installs permit2 untagged.
- MyDoge EIP-712 `signTypedData` capability unconfirmed (KNOWN_ISSUES #6) — if it can't sign typed
  data, the Permit2-only design must be revisited.

**Prior repo audits** (broader scope than contracts): `docs/audit/2026-06-11-repo-audit/` (multi-agent
whole-repo audit, adversarially verified: 0 Critical / 4 High / 31 Medium / 26 Low across
architecture, trading correctness, API security, contracts, testing, ops) and
`docs/audit/2026-06-12-dogeos-experience-audit/` (ecosystem/DX audit + gap-close addendum). Check the
2026-06-11 findings before re-reporting a known issue as new.

## 6. Pre-merge checklist for any contracts change

Copy-paste runnable (the security-reviewer gate). From the repo root:

```bash
export PATH="$HOME/.foundry/bin:$HOME/.local/bin:$PATH"
cd packages/contracts
ls lib/forge-std >/dev/null 2>&1 || cp -r /home/actlabs/dogeswap-prod/packages/contracts/lib .  # lib/ is gitignored

# 1. Build + size gate
forge build --sizes                          # clean; runtime < 24,576 B

# 2. Full test suite at CI parity — bar: 60+ passed / 0 failed / 0 skipped-that-shouldn't-skip
FOUNDRY_INVARIANT_RUNS=512 FOUNDRY_INVARIANT_DEPTH=200 forge test -vvv

# 3. Slither — bar: exit 0; residual only the 9 documented results (2 MEDIUM incorrect-equality
#    zero-short-circuits at src:344/:364, 3 LOW missing-zero-check, 4 INFO naming — see §2)
slither . ; echo "slither exit: $?"
```

Then the non-automatable half — all five must be answered in the review:

- [ ] **Invariants for new paths**: does the diff add a command, venue, ingress, or settlement branch?
      If yes: instantiate the §3 five-property template, extend `RouterHandler.sol` (or add a
      deterministic unit with a structural argument), and update `audit/INVARIANTS.md`.
- [ ] **Calldata-composition review**: if `packages/aggregator/src/swap/**` or the `/swap`/`/approval`
      handler changed — verify selector/registry gating still holds, the refresh+clamp path still
      fails closed, recipient==sender still enforced, and the encoded program still ends with an
      aggregate-settlement floor at least as protective as the user-accepted quote.
- [ ] **Slither triage**: any new finding dispositioned in `audit/SLITHER_TRIAGE.md` (comment-only
      suppressions, one-line justification, zero unjustified HIGH/MEDIUM).
- [ ] **KNOWN_ISSUES / THREAT_MODEL cross-check**: does the diff invalidate an accepted trade-off or
      a threat-model row's stated mitigation? Update `audit/KNOWN_ISSUES.md` / `audit/THREAT_MODEL.md`
      in the same PR — the audit package must describe the merged code.
- [ ] **Live-router delta**: remember the deployed router does NOT get this change. If the fix is
      security-relevant, record it as redeploy-blocking in `audit/REDEPLOY-RUNBOOK.md`.

If the diff touches Permit2 handling, note that only Foundry (not Echidna/Medusa) covers the signed
path — run the invariant suite at CI parity and, for settlement/approval changes, run Echidna/Medusa
locally too (`audit/REPRODUCIBILITY.md` for versions; not installed on this server as of 2026-07-02).
