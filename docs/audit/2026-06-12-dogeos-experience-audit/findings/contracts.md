# Smart Contracts Audit — DogeSwapRouter, Registry, Deploy

**Dimension:** Smart contracts (DogeSwapRouter, DogeSwapRegistry, deploy stack)
**Date:** 2026-06-12
**Auditor perspective:** Senior DogeOS protocol engineer
**Chain:** DogeOS Chikyū Testnet, chainId 6281971 (0x5fdaf3), RPC https://rpc.testnet.dogeos.com
**Targets (live):**
- DogeSwapRouter `0xa3158549f38400F355aDf20C92DA1769620Aa35A`
- TimelockController `0xf3410B762Db55aA3CBAfaa5707899b3d3A7F1773`
- DogeSwapRegistry `0xC596081d427E8296e089eDD59a62E73Da3191215`
- Governance EOA `0xE659A8d3745b1355CA47B3d92925997Ef93a2873`

---

## Overall assessment

The `DogeSwapRouter` Solidity is genuinely well engineered. The movement-only command set,
the per-execute in-memory balance-delta ledger, enforced post-loop settlement, Permit2-only
pulls (`msg.sender` always the owner), `ReentrancyGuardTransient`, and `forceApprove`/`SafeERC20`
together produce a router whose worst-case loss is bounded to the in-flight notional of a single
authorized transaction. The self-audit (threat model, invariants, Slither triage) is unusually
honest and mostly correct; I could not find a way to drain stranded funds, spend a third party's
Permit2 allowance, or bypass `minOut` through the command program. The core contract logic is
solid and the Slither HIGH/MEDIUM suppressions are legitimate false positives.

The serious problems are **not** in the router's swap logic — they are in the **live governance
state** and in **stale audit documentation**. The on-chain reality contradicts every governance
claim in the audit pack: a single EOA is simultaneously the router `owner`, the router `guardian`,
the registry `owner`, and — critically — the holder of `DEFAULT_ADMIN_ROLE` on the
TimelockController, which OpenZeppelin documents as a role that **bypasses the timelock delay
entirely**. The advertised 48h timelock is therefore currently a façade. Separately, the deploy
runbook and chain-facts docs still assert "Permit2 is ABSENT" when it is in fact deployed at the
canonical address, which invalidates the deterministic-deploy step's premise and is a footgun for
the next operator. These are the findings that matter.

---

## Strengths (genuinely well done)

1. **Balance-delta accounting is the right architecture.** Every in/out amount is measured by
   `_delta = current − entry` (`DogeSwapRouter.sol:195-197`), never by a venue return value or a
   token's claimed transfer amount. This is correct-by-construction against fee-on-transfer and
   lying venues, and it structurally makes pre-existing/airdropped balances unspendable through
   `execute`. The native seed `L.entry[0] = address(this).balance - msg.value` (line 176) is the
   correct way to exclude the incoming value from the measurable delta.

2. **Permit2 owner is always `msg.sender`.** `_permit2Permit` and `_permit2TransferFrom`
   (`DogeSwapRouter.sol:221-233`) hard-code `msg.sender` as the Permit2 owner/`from`; no command
   input carries an `owner`/`from` field. A caller can never pull a third party's permitted funds
   even when many users hold live router→Permit2 allowances. This is the correct UniversalRouter
   pattern and the threat model's claim here holds up.

3. **Movement-only command set with immutable venues.** `Commands.sol` is a fixed 7-entry
   whitelist; `_dispatch` (`DogeSwapRouter.sol:210-219`) is a closed if/else that reverts
   `UnknownCommand` on any other byte. There is no `CALL`/`DELEGATECALL`/arbitrary-target command,
   and venue addresses are `immutable`. This eliminates the entire arbitrary-call attack class.

4. **Enforced settlement independent of the command program.** `_settle` (lines 287-302) runs
   after the loop, computes `out = _delta(buyToken)`, takes the capped fee, and reverts
   `MinOutNotMet` before paying — so "recipient gets ≥ minOut or the whole tx reverts" is a
   contract guarantee regardless of what commands were submitted.

5. **Correct transient-storage reentrancy guard for a Prague chain.** `ReentrancyGuardTransient`
   (EIP-1153) is the right choice and DogeOS transient storage is probe-confirmed
   (`CHAIN_FACTS.md §3`, re-confirmed live: router responds normally, no opcode reverts).

6. **DogeOS EVM-difference posture is clean.** I verified the contract and its OZ deps rely on
   **none** of the DogeOS-unsupported features: no `SELFDESTRUCT`, no `PREVRANDAO`/`DIFFICULTY`
   dependence, no `blake2f`/`ripemd`/point-eval precompiles, no blobs (EIP-4844/4788). It uses
   only `ecrecover` (via Permit2), which is available. See CONTRACTS-7.

7. **`forceApprove` + `SafeERC20` everywhere**, correct handling of USDT-style non-returning
   approve/transfer, and a checked native `call` with `NativeTransferFailed`.

---

## Findings

### CONTRACTS-1 — Live timelock is a façade: governance EOA holds DEFAULT_ADMIN_ROLE that bypasses the delay
**Severity: critical** · **Confidence: high**
**Location:** `script/DeployRouter.s.sol:85`; live TimelockController `0xf3410B762Db...1773`

**Evidence (live reads, 2026-06-12):**
- Deploy script constructs the timelock with the project "Safe" as the admin:
  `new TimelockController(timelockMinDelay, proposers, executors, routerSafe)` (`DeployRouter.s.sol:85`).
- The "Safe" (`ROUTER_SAFE`) is in reality the deployer EOA `0xE659…2873`:
  - `getMinDelay() = 172800` (48h) — the timelock is real.
  - `hasRole(DEFAULT_ADMIN_ROLE, 0xE659…2873) = true` — **the EOA still holds the admin role.**
  - `hasRole(PROPOSER, 0xE659…2873) = true`, `hasRole(EXECUTOR, …) = true`, `hasRole(CANCELLER, …) = true`.
  - `hasRole(DEFAULT_ADMIN_ROLE, timelock) = true` (self-admin).
- OpenZeppelin documents the admin role explicitly: *"The optional admin can aid with initial
  configuration of roles after deployment without being subject to delay… This role should be
  subsequently renounced in favor of administration through timelocked proposals."*
  (docs.openzeppelin.com/contracts/5.x — TimelockController).

**Impact:** The 48h delay protects nothing while the EOA retains `DEFAULT_ADMIN_ROLE`. With that
role the EOA can `grantRole`/`revokeRole` **immediately, with no delay** — e.g. grant a fresh key
PROPOSER+EXECUTOR and execute any timelock operation, or simply reconfigure roles to whatever it
wants. The advertised "min delay 24-48h, proposer/executor = founder Safe" security story
(THREAT_MODEL.md residual §H4, DEPLOYMENT.md) is not in force on the live deployment. A
compromised or malicious EOA has unconstrained, instantaneous control of governance.

**Recommendation:** The EOA MUST `renounceRole(DEFAULT_ADMIN_ROLE, self)` on the timelock (this is
the documented, mandatory final step). Before doing so, ensure proposer/executor are held by a
real multisig — not the same EOA (see CONTRACTS-2). Until the admin role is renounced, treat the
timelock as cosmetic and the governance trust model as "single EOA, no delay."

---

### CONTRACTS-2 — owner == guardian == registry owner == timelock proposer/executor == one EOA (single point of total control)
**Severity: critical** · **Confidence: high**
**Location:** live router/registry/timelock; `DeployRouter.s.sol:88-112`

**Evidence (live reads, 2026-06-12):**
- Router `owner() = 0xE659…2873`, `guardian() = 0xE659…2873` (identical).
- Router `pendingOwner() = 0xf3410B…1773` (the timelock) — i.e. `transferOwnership(timelock)` ran
  (`DeployRouter.s.sol:112`) but **`acceptOwnership()` has NOT been executed**: the live owner is
  still the EOA. The advertised owner→timelock handover (DEPLOYMENT.md §6a) is incomplete.
- Registry `owner() = 0xE659…2873` and `pendingOwner() = 0xE659…2873` — `ROUTER_SAFE` resolved to
  the EOA, and it has already accepted; the registry is owned by a bare EOA, not a Safe.
- Timelock proposer/executor/canceller/admin are all the same EOA (CONTRACTS-1).
- EOA `nonce = 15`, `balance ≈ 40 DOGE` — an ordinary funded EOA, not a contract wallet.

**Impact:** A single externally-owned key controls the entire stack with no delay and no
multisig:
- it can `setFee(100, attacker)` and immediately skim up to 1% of every swap output;
- it can `setMaxInputPerTx`/`setDefaultMaxInputPerTx` to re-open blast radius;
- it can `rescue(token,to,amount)` any genuinely stranded funds (bounded — see note);
- it can `pause()` (DoS) — and since it is also owner it can `unpause()`;
- it can repoint the registry `currentRouter` to a malicious router (CONTRACTS-3);
- because it also holds timelock admin, even the "timelock" path is instant (CONTRACTS-1).
This is the classic "single EOA owns DeFi infra" centralization risk, made worse because the docs
claim it is a TimelockController+Safe. Note the per-execute ledger still prevents draining *user*
funds at rest (router holds ~0 between txs: live `balanceOf(router)=0` for native and WDOGE), so
this is governance/centralization risk, not a direct theft-of-deposits primitive — but
`setFee` + registry repoint give meaningful value-extraction paths.

**Recommendation:** Complete the intended handover and de-duplicate keys: (1) execute
`timelock.acceptOwnership()` so the router is owned by the timelock; (2) make proposer/executor a
real multisig distinct from the guardian; (3) renounce the EOA's timelock admin (CONTRACTS-1);
(4) move registry ownership to the multisig; (5) set `guardian` to a separate hot key, not the
owner. Until then, the audit pack's governance section is aspirational, not descriptive.

---

### CONTRACTS-3 — Registry is a trusted single-writer pointer with no router validation; live owner is a bare EOA
**Severity: high** · **Confidence: high**
**Location:** `DogeSwapRegistry.sol:34-38`; live registry `0xC59608…1215`

**Evidence:** `setCurrentRouter(address router)` (`DogeSwapRegistry.sol:34`) is `onlyOwner` and
does **zero validation** — no `code.length` check, no interface probe, no event-gated timelock —
it just stores the address and bumps `version`. Off-chain integrators (web app, indexers,
partner front-ends) are documented to read `currentRouter()` to discover the live router
(`DogeSwapRegistry.sol:9-15`). Live `owner() = 0xE659…2873` (a bare EOA, see CONTRACTS-2), so a
single key can repoint it in one transaction with no delay.

**Impact:** If the EOA is compromised, the attacker repoints `currentRouter` to a malicious
contract. Any integrator that trusts the registry to discover the router would then route user
swaps and Permit2 approvals through the attacker's contract. The registry's own funds are never
at risk (it holds none), but it is a phishing/redirect primitive for the whole product surface.
Severity is high rather than critical because exploitation requires the off-chain consumers to
actually trust the registry pointer and because it inherits the EOA-compromise precondition.

**Recommendation:** (1) Own the registry with the same governance multisig/timelock as the router,
not a bare EOA; (2) consider a delay or a two-event "announce then activate" pattern for
`setCurrentRouter` so integrators (and users) can react; (3) optionally validate `router.code.length > 0`
and a cheap interface sentinel before storing. At minimum, document that integrators must pin the
router address out-of-band and treat the registry as advisory.

---

### CONTRACTS-4 — Audit docs falsely state Permit2 is ABSENT; deterministic-deploy premise is stale
**Severity: medium** · **Confidence: high**
**Location:** `audit/DEPLOYMENT.md:23-44`, `audit/CHAIN_FACTS.md:92-100`, `audit/KNOWN_ISSUES.md:56-62`

**Evidence:** DEPLOYMENT.md line 26: *"Permit2 is ABSENT on DogeOS testnet and must be deployed to
exactly that address."* CHAIN_FACTS.md §4: *"Permit2 is ABSENT. The canonical Permit2 address has
no bytecode."* KNOWN_ISSUES.md §5 (status "open — critical-path"). Live probe contradicts all of
them: `cast code 0x0000…78BA3` returns 18,307 hex chars of bytecode — Permit2 **is** deployed at
the canonical address. The router itself reads correctly against it (live `feeBps`, `WDOGE`, caps
all resolve). The deploy script's branch `if (PERMIT2.code.length == 0) { …CREATE2… }`
(`DeployRouter.s.sol:67-78`) is now dead on this chain (it will log "already present"), which is
benign — but the **runbook prose and the threat-model "open item"** are wrong.

**Impact:** No on-chain vulnerability today (the script's guard handles both cases). The risk is
operational: an operator following DEPLOYMENT.md will believe a critical-path step is outstanding,
may attempt the Arachnid CREATE2 deploy (it would revert/no-op), and may distrust an otherwise
healthy deployment. It also undermines confidence in the audit pack's freshness — KNOWN_ISSUES.md
§5/§6/§7 and THREAT_MODEL.md's "Residual to be completed" all describe a pre-deploy world that no
longer exists (router, timelock, registry are all live).

**Recommendation:** Update DEPLOYMENT.md, CHAIN_FACTS.md §4, and KNOWN_ISSUES.md §5 to record
Permit2 as PRESENT at the canonical address with the live `getCode` evidence. Re-status
KNOWN_ISSUES.md §7 (timelock/handover) against the *actual* live state (CONTRACTS-1/2), since it
currently reads as "not yet executed" when it is partially executed and partially mis-executed.

---

### CONTRACTS-5 — `s.recipient == address(0)` silently no-ops settlement in production code
**Severity: medium** · **Confidence: high**
**Location:** `DogeSwapRouter.sol:177, 288`

**Evidence:** `_settle` begins `if (s.recipient == address(0)) return;` (line 288), and `execute`
only snapshots the buyToken entry `if (s.recipient != address(0))` (line 177). The NatSpec calls
this a "no-op settlement used only by unit tests." But the guard lives in the **production**
`execute`/`_settle` path with no `whenTesting` gating. If a front-end or integrator ever encodes a
program with `recipient = address(0)` (a common default/uninitialized struct value), the contract
will: pull funds via Permit2, run the swaps (moving value into the router), then **skip the entire
settlement** — no minOut check, no payout, no refund. Funds gained during the call are left in the
router and become stranded (only recoverable by owner `rescue`, CONTRACTS-2).

**Impact:** A footgun, not an attacker primitive (the victim self-inflicts via a zero recipient).
But a zero address is the single most common "forgot to set it" bug in encoded calldata, and the
consequence here is silent loss of the swapped amount with no revert to signal it. "Tests only"
behavior should not be reachable on mainnet with real funds.

**Recommendation:** Either revert when `s.recipient == address(0)` in `execute` (cleanest — makes
the footgun impossible), or remove the no-op branch and use a dedicated test harness. Given the
router is immutable and already live, at minimum the integration layer (Sub-project B) must hard-
reject any program with a zero recipient before signing, and this must be documented as a known
contract footgun rather than buried as "tests only."

---

### CONTRACTS-6 — Native/fee recipient that reverts on receive DoSes the whole tx (accepted, but verify rounding/dust paths)
**Severity: low** · **Confidence: high**
**Location:** `DogeSwapRouter.sol:303-308` (`_pay`), `292-295` (`_settle`)

**Evidence:** `_pay`'s native branch reverts `NativeTransferFailed` if the destination rejects
native (line 307). This is already documented (KNOWN_ISSUES.md §2) and is self-inflicted for
`s.recipient`. I pressure-tested the **feeRecipient** angle: when `feeBps != 0`, settlement pays
`feeRecipient` BEFORE the user's payout (line 294 before 295). If the owner ever sets a
`feeRecipient` that reverts on native receive, **every native-output swap reverts for all users**
until the owner re-sets it — a global DoS triggered by owner misconfiguration, not just a single
self-inflicted tx. Live `feeBps = 0` so this is dormant today, but it is a sharper edge than the
"single tx" framing in KNOWN_ISSUES.md §2. Fee rounding itself is correct (floor division,
`out -= fee`, fee ≤ 1% by `MAX_FEE_BPS`, no overflow on 0.8.x).

**Impact:** Owner-configuration DoS surface on native-output swaps. Low because it requires owner
error and is fully recoverable by `setFee`; flagged because the existing doc understates it as
per-tx.

**Recommendation:** Document the feeRecipient-reverts case as a *global* (not per-tx) hazard; when
a fee is eventually turned on, set `feeRecipient` to a known payable EOA/contract and test a
native-output swap before announcing. Consider (future deployment) pull-payment for fees.

---

### CONTRACTS-7 — DogeOS EVM-difference review: clean, with one dependency caveat to track
**Severity: info** · **Confidence: high**
**Location:** whole contract + OZ deps; `references/developer-guide.md` "Ethereum & DogeOS Differences"

**Evidence:** Per the DogeOS developer guide: `SELFDESTRUCT` reverts, `PREVRANDAO`/`DIFFICULTY`
return 0, `RIPEMD-160`/`blake2f`/point-eval precompiles revert, no blob/EIP-4788 support, `modexp`
limited to ≤32-byte inputs. Review of the router: it uses none of these. No `selfdestruct`, no
`block.difficulty`/`prevrandao`, no `block.coinbase` decisions, no KZG/blob opcodes. Crypto
surface is `ecrecover` only (inside Permit2), which is available. The OZ deps in use
(`Ownable2Step`, `Pausable`, `ReentrancyGuardTransient`, `SafeERC20`, `TimelockController`) do not
invoke disabled opcodes. `ReentrancyGuardTransient` depends on EIP-1153 transient storage, which is
probe-confirmed available on DogeOS; this is safe here.

**Caveat I could not fully verify in this checkout:** `lib/` is not vendored in this tree
(`remappings.txt` points at `lib/openzeppelin-contracts/...` but the directory is absent and there
is no `.gitmodules`), so I reviewed the OZ behavior from the pinned import paths and version
semantics rather than the exact bytecode. The deployed router bytecode (live `code.length` = 23,773
hex) is what matters and behaves correctly on every live read, so this is an evidence-completeness
note, not a defect.

**Impact:** None observed — the contract is DogeOS-EVM-safe.

**Recommendation:** Vendor or pin the exact OZ commit in the repo (a `.gitmodules` or a committed
`lib/`), and add a one-line note to CHAIN_FACTS.md that the *deployed* router was re-confirmed
against live DogeOS opcode support post-deploy.

---

### CONTRACTS-8 — Ledger `cap = 2*n+2` sizing and delta accounting: correct under stress (verification note)
**Severity: info** · **Confidence: high**
**Location:** `DogeSwapRouter.sol:173-176, 189-208, 296-301`

**Evidence:** I stress-modeled the ledger against the prompt's edge cases:
- **Sizing:** worst case each command introduces ≤2 tokens (swap in+out); plus NATIVE (index 0)
  and the buyToken snapshot → `cap = 2n+2` is sufficient. Multi-hop V2 paths do NOT add
  intermediate tokens to the ledger (only `path[0]` and `path[last]` are `_touch`ed, line 249),
  and intermediates never net into the router (V2 routes through pairs), so they cannot exceed the
  cap. `_idx` additionally reverts `LedgerOverflow` if the cap is ever hit (line 191) — a hard
  backstop, not silent corruption.
- **Duplicate tokens in a path / buyToken == input:** `_idx` linear-scans and dedups by address
  (line 190), so the same token maps to one slot; `_delta` therefore nets correctly even when
  buyToken is also pulled as input, and the refund loop skips buyToken (line 298) to avoid double
  payout. Correct.
- **Fee-on-transfer / rebasing:** input side accrues nominal `amount` to the cap (slightly
  conservative) but spends the actual received `_delta`; output side pays the measured `_delta`.
  Deflationary mid-call balances make `_delta` return 0 (line 196 `cur > entry ? … : 0`), never a
  negative/underflow — conservative and safe.
- **Weird/>18 decimals (e.g. live USDC has 18 decimals on DogeOS, not 6):** the router is fully
  decimal-agnostic — it does no cross-token math, only per-token balance deltas — so non-standard
  decimals are a non-issue here.
- **Native seeding:** `entry[0] = address(this).balance - msg.value` correctly excludes incoming
  value; unwrap proceeds arriving via `receive()` (WDOGE-only) are captured by `_delta(NATIVE)`.

**Impact:** None — this is a positive verification of the trickiest part of the contract. The
self-audit's claims for I1/I5/I8 hold under the adversarial cases I could construct.

**Recommendation:** None required. Keep the `LedgerOverflow` backstop and the buyToken-skip in any
future revision.

---

## Severity summary

| ID | Title | Severity | Confidence |
|----|-------|----------|-----------|
| CONTRACTS-1 | Timelock admin role bypasses delay; still held by EOA | critical | high |
| CONTRACTS-2 | Single EOA owns router+guardian+registry+timelock; handover incomplete | critical | high |
| CONTRACTS-3 | Registry single-writer pointer, no validation, EOA-owned | high | high |
| CONTRACTS-4 | Docs falsely claim Permit2 absent; deploy premise stale | medium | high |
| CONTRACTS-5 | `recipient == address(0)` silently no-ops settlement in prod | medium | high |
| CONTRACTS-6 | feeRecipient revert-on-receive = global native-swap DoS | low | high |
| CONTRACTS-7 | DogeOS EVM-difference review clean; vendor OZ to fully verify | info | high |
| CONTRACTS-8 | Ledger sizing / delta accounting verified under stress | info | high |

**Bottom line:** The swap engine is well-built and the balance-delta design defends the
properties it claims. The exploitable risk lives in governance and documentation, not in the
command loop: ship a real renounced timelock + multisig, fix the `recipient==0` footgun at the
integration boundary, and bring the audit docs in line with the live chain (Permit2 present,
handover state).
