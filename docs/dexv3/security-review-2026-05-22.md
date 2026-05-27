# DogeOS DEX V1 Security Review

Review date: 2026-05-22
Scope: V1 foundation only: `DogeOSSwapRouter`, interfaces, source registry, read adapters, and testnet evidence.
Out of scope: deployment, external DEX execution enablement, liquidity seeding, PancakeSwap V3 vendoring, split routing, RFQ, Baseline-like modules, launchpad mechanics, and credit/leverage.

## Tooling

| Tool | Result |
| --- | --- |
| Hardhat tests | Passing: 13 router tests |
| Vitest package tests | Passing: 7 package tests |
| Placeholder scan | Passing: no matches |
| Slither | Not installed in this environment |
| Foundry / `forge` | Not installed in this environment |

Foundry and Slither remain required before deployment-grade review. This branch does not deploy or broadcast transactions.

## Router Controls Reviewed

| Control | Evidence |
| --- | --- |
| Adapter allowlist | `allowedAdapter` gate and `AdapterNotAllowed` test |
| Slippage floor | Balance-delta output accounting plus `OutputBelowMinimum` test |
| Deadline | `DeadlineExpired` test |
| Pause | `Pausable` and pause revert test |
| Reentrancy | `nonReentrant` and adapter reentry test |
| Native DOGE wrapping | Native input test |
| Native DOGE unwrap/forward | Native output test |
| Zero amount | `ZeroAmount` test |
| Zero recipient | `ZeroAddress` test |
| No-bool ERC-20 input compatibility | `MockNoReturnERC20` test |
| Identical token guard | `IdenticalTokens` test |
| Arbitrary calldata avoidance | Router calls only typed `IDogeOSSwapAdapter.exactInput` on allowlisted adapter |

## Manual Risk Findings

| Finding | Severity | Status |
| --- | --- | --- |
| Pasted deployer private key cannot be treated as secure. | High | Do not use it. Generate a fresh deploy key locally or use multisig/hardware-backed custody. `.env` is ignored and `.env.example` contains only placeholders. |
| External MuchFi/Barkswap periphery contracts remain unverified or unconfirmed. | High | Execution disabled in source registry; quote/read only. |
| No Foundry or Slither in environment. | Medium | Hardhat/Vitest tests pass, but deployment readiness is blocked until Foundry/Slither or equivalent review runs. |
| Adapter trust boundary is intentionally narrow but still critical. | Medium | Adapter allowlist is owner-controlled and must move to multisig/timelock before mainnet. |
| Fee-on-transfer input tokens may fail if the router receives less than `amountIn`. | Low | Acceptable for V1 official-token scope; nonstandard tokens should remain unlisted or warned until adapter handling is expanded. |

## Deployment Gate

Deployment remains blocked until all are true:

1. A fresh deployer key or multisig is configured locally, never pasted into chat or committed.
2. `solidity-checklist` and `solidity-deploy` preflight are completed against the exact transaction plan.
3. Foundry or equivalent fork testing is available.
4. Static analysis is run or explicitly waived with rationale.
5. User approves the exact broadcast plan.
