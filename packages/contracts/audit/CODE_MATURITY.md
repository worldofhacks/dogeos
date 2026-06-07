# Code Maturity Scorecard — DogeSwapRouter

Trail of Bits code-maturity methodology. Ratings: **Strong / Satisfactory / Moderate / Weak**.
Each is grounded in the actual `src/DogeSwapRouter.sol` code and `test/` suite. Honest
assessment — launch-stage residuals (timelock, deploy) are called out where relevant.

| Category | Rating | Justification |
|----------|--------|---------------|
| **Arithmetic** | Strong | Solidity 0.8.30 checked math; the only `unchecked` is the loop counter `++i` (provably bounded by `commands.length`). Fee is a single floor `mul/div` capped at `MAX_FEE_BPS`; all amounts are balance-delta differences with explicit `cur > entry` underflow guards. No raw assembly arithmetic. Fuzzed by `invariant_I4_feeExactAndCapped`. |
| **Access controls** | Satisfactory | Least-privilege split: `onlyOwner` (intended Timelock) for fee/cap/guardian/unpause/rescue; guardian is pause-only; `Ownable2Step` prevents accidental ownership loss. Permit2 owner is always `msg.sender` (no third-party drain). Not Strong only because the production owner (`TimelockController`) is not yet wired at deploy (H4 open). Proven by `test_pause_blocksExecute_andRolesEnforced`, `test_rescue_ownerOnly`, `test_thirdParty_cannotDrainVictimAllowance`. |
| **Complexity** | Strong | Single contract, ~217 lines, flat command dispatcher (`if/else if`), no inheritance beyond well-audited OZ mixins, no proxy/delegatecall, in-memory ledger (no storage-mapping state machine). Movement-only command set; settlement is a single linear pass. Easy to reason about. |
| **Decentralization** | Moderate | Immutable, non-upgradeable router (no proxy) is strongly decentralized for the swap path. But governance is a solo founder Safe at launch and the `TimelockController` (24–48h delay) is planned but not yet deployed (H4). Guardian is a single hot key (pause-only, non-destructive). Honest: Moderate until the timelock + Safe handover is executed. |
| **Documentation** | Strong | Full NatSpec on the contract header, every external/public function, and the `Settlement`/`Ledger` structs; `@notice` on libraries/interfaces; an authoritative spec, threat model, invariant spec, Slither triage, chain-fact evidence, known-issues, and reproducibility doc all committed. |
| **Testing** | Strong | 39 Foundry tests across unit/edge/permit2/integration; 6 stateful invariants (I1–I5, I7) fuzzed at 256×100 = 25,600 calls each; I6/I8 as deterministic units; Echidna + Medusa assertion fuzzing of the stranded-fund guard; Slither clean (`fail_on: high`, exit 0). Split/multi-hop/FoT/native/cap/replay/expiry all covered. Residual: live fork tests against DogeOS pools are spec'd but pending Permit2 deployment on-chain. |
| **Low-level / assembly** | Strong | No inline assembly anywhere. The only low-level op is `to.call{value:}("")` for native sends, with the return value checked (`NativeTransferFailed`) — the correct gas-forwarding pattern vs `transfer`/`send`. SafeERC20 for all token movement. |
| **Front-running / MEV** | Satisfactory | On-chain `minOut` (enforced after the loop on the measured delta, a contract guarantee) + `deadline` revert; output measured by balance delta, never venue return. Sandwich resistance ultimately depends on the off-chain slippage defaults (Sub-project B/C) the user supplies, hence Satisfactory rather than Strong. Proven by `test_minOut_breach_revertsWholeTx`, `invariant_I2_minOutHonored`. |
| **Upgradeability** | Strong (by design) | Intentionally non-upgradeable: no proxy, no delegatecall, immutable venues/WDOGE. Upgrades = deploy a fresh version; Permit2 (user approves Permit2, not the router) means migration needs no user re-approval. Eliminates the entire upgrade-bug class. |

---

## Overall
The contract is **mainnet-grade for its on-chain surface**: simple, immutable, exhaustively
balance-delta-accounted, well-tested, and statically clean. The two ratings below Strong
(**Access controls = Satisfactory**, **Decentralization = Moderate**) both reduce to a single open
item — the **TimelockController + Safe deploy handover (H4 / Phase 5)** is not yet executed — plus
the MEV rating that correctly reflects shared responsibility with the off-chain slippage layer.
Resolving the deploy/timelock work lifts access controls toward Strong and decentralization toward
Satisfactory.
