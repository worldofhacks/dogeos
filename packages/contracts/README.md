# DogeSwap Contracts

Mainnet-grade, immutable **command/executor swap router** for DogeOS (a Prague-compatible
Dogecoin zkEVM, chain id `6281971`). Non-custodial: it executes atomic single / split /
multi-hop swaps across the verified external venues (MuchFi V2, MuchFi V3, Barkswap Algebra),
pulls funds via **Permit2 AllowanceTransfer** (owner always `msg.sender`), enforces a final
`Settlement{buyToken, minOut, recipient}`, and holds ~zero balance between transactions.

> "DogeSwap" = this product. "DogeOS" = the underlying chain/platform (RPC, SDK, predeploys).

## Contracts (`src/`)
- **`DogeSwapRouter.sol`** — the router. In-memory per-execute balance-delta ledger (funds it
  didn't pull this call are unspendable), aggregate notional cap, off-by-default capped fee,
  `Ownable2Step` owner (a `TimelockController` in prod) + guardian pause-only, transient-storage
  reentrancy guard.
- **`DogeSwapRegistry.sol`** — versioned pointer the app reads for the current router address.
- `libraries/` — `Commands` (movement-only command bytes), `Constants`.
- `interfaces/` — `IWETH9`, venue routers (V3 = SwapRouter02 no-deadline; Algebra = Integral with deployer).

## Build & test
```sh
forge build
forge test                 # 53 unit/adversarial/invariant tests
forge build --sizes        # runtime well under the 24,576-byte limit
```
Toolchain: Solidity `0.8.30`, `evm_version = "prague"` (DogeOS is Prague — verified by on-chain
opcode probe). Deps: forge-std, OpenZeppelin v5.x, Uniswap Permit2 (etched in tests).

## Security program
- Static analysis: `slither .` (config in `slither.config.json`, triage in `audit/SLITHER_TRIAGE.md`).
- Fuzzing: Echidna (`echidna.yaml`) + Medusa (`medusa.json`) over `test/echidna/`.
- Invariants I1–I8 in `test/RouterInvariants.t.sol`.
- CI: `.github/workflows/contracts-security.yml` (forge + slither-action).
- Audit-prep package: `audit/` (threat model, invariants, known issues, reproducibility, maturity, chain facts).

## Deploy
See **`audit/DEPLOYMENT.md`** for the full runbook. In short: build Permit2's creation code,
import a funded deployer to the Foundry keystore, fill `.env` (`ROUTER_SAFE`, `ROUTER_GUARDIAN`,
`CAP_DEFAULT`, `TIMELOCK_MIN_DELAY`), then `forge script script/DeployRouter.s.sol --broadcast
--verify --verifier blockscout …`. The script deploys canonical Permit2 (if absent) →
TimelockController → router (capped before live, `feeBps==0`) → registry, and begins the
Ownable2Step handover to the timelock.

**Testnet only.** Not externally audited — do not put real funds behind it until it is.
