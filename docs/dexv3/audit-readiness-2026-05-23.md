# DogeOS DEX V1 Audit Readiness 2026-05-23

## Executive Summary

The V1 DogeOS router package has completed a controlled Chikyu testnet deployment of `DogeOSSwapRouter` and `DogeOSV2PairAdapter`, an explicit adapter allowlist transaction, route preflight, and one dust-size live MuchFi V2 canary swap. It is not positioned as mainnet-ready. The scope remains intentionally narrow: MuchFi V2 is the only active executable source; V3, Algebra, watchlist sources, and the owned Pancake V3 path remain non-executable.

## DogeOS-Specific Conformance

| DogeOS requirement or ecosystem fact | Project handling | Evidence |
| --- | --- | --- |
| Chikyu RPC | Uses `https://rpc.testnet.dogeos.com` | `packages/dogeos-config/src/chains.ts`, `hardhat.config.cjs` |
| Chain ID | Uses `6281971` | `packages/dogeos-config/src/chains.ts`, preflight |
| Native token | Treats native gas token as DOGE | `docs/dogeos-chikyu-testnet.md` |
| Block explorer | Uses `https://blockscout.testnet.dogeos.com` | `hardhat.config.cjs`, preflight |
| Solidity version | Uses `0.8.30` | `hardhat.config.cjs` |
| EVM target | Uses `prague` | `hardhat.config.cjs` |
| Source verification | Configured Hardhat verify custom chain for DogeOS Blockscout API | `hardhat.config.cjs`, `scripts/deploy/verify-source-router.cjs` |
| Faucet/funding | Preflight checks deployer balance before deployment | `scripts/deploy/lib/routerPlan.cjs` |
| Fee model | Preflight uses live gas estimation; read-only analysis checks `L1GasPriceOracle` bytecode and sample `getL1Fee` | `docs/dexv3/onchain-validation-2026-05-23.json` |
| Official WDOGE | Constructor uses `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE` | preflight, token config |

Official docs referenced:

- `https://docs.dogeos.com/en/developers/developer-quickstart`
- `https://docs.dogeos.com/en/developers/verifying-smart-contracts`
- `https://docs.dogeos.com/en/developers/guides/contract-deployment-tutorial`
- `https://docs.dogeos.com/en/developers/transaction-fees-on-dogeos`
- `https://docs.dogeos.com/en/getting-started/user-guide/faucet`

## Security Control Matrix

| Control | Status | Evidence |
| --- | --- | --- |
| Minimal V1 scope | Pass | No RFQ, split routing, Baseline module, launchpad, leverage, or owned CLAMM deployment |
| Execution source gating | Pass | `getExecutableSources()` requires `active && verified`; only MuchFi V2 is active after allowlist and canary evidence |
| Exact-input only | Pass | `DogeOSSwapRouter.exactInput` only |
| Slippage guard | Pass | `minAmountOut`, balance-delta accounting, `OutputBelowMinimum` tests |
| Deadline guard | Pass | `DeadlineExpired` test |
| Adapter allowlist | Pass | owner-only enable/disable tests |
| Pause control | Pass | owner-only pause/unpause and paused execution tests |
| Reentrancy protection | Pass | `nonReentrant` and adapter reentry test |
| Native DOGE safety | Pass | WDOGE-only receive path, native value match, unwrap transfer failure tests |
| ERC-20 compatibility | Pass | `SafeERC20`, no-bool token input test |
| Allowance cleanup | Pass | adapter allowance reset test |
| Realistic AMM integration fixture | Pass | seeded constant-product pool tests cover ERC20, native-in, native-out, reverse route, malformed route data, and slippage rollback |
| DogeOS V2 pair adapter | Pass | `DogeOSV2PairAdapter` verifies canonical factory pairs, avoids arbitrary calldata, and is fork-profiled against MuchFi V2 WDOGE/USDC |
| Constructor validation | Pass | zero owner and zero WDOGE tests |
| Secret handling | Pass | `.env` ignored; secret scan clean |
| DogeOS live state | Pass | Fresh read-only on-chain report at block `5184491` |
| Deployment preflight | Pass | chain, balance, WDOGE bytecode, nonce, gas, predicted address |
| Blockscout verification | Pass | `DogeOSSwapRouter` and `DogeOSV2PairAdapter` source verified on DogeOS Blockscout |
| Adapter allowlist and canary | Pass | Allowlist tx succeeded; dust canary swap produced expected USDC output and left no router token residue |

## Verification Evidence

| Command | Result |
| --- | --- |
| `pnpm test` | Pass: 45 Hardhat contract tests, 21 package/deploy/gas-helper tests |
| `pnpm lint:placeholders` | Pass |
| `pnpm lint:secrets` | Pass |
| `pnpm compile` | Pass, 31 Solidity files, Solidity `0.8.30`, EVM `prague` |
| `pnpm coverage` | Pass; router 100% statements/functions/lines, 97.62% branch; adapter 100% statements/functions/lines; all files 100% statements, 98.4% lines |
| `pnpm gas:router` | Pass; deployment/admin/fixed-output swap/DogeOS V2 adapter gas profile written |
| `pnpm gas:dogeos-v2-adapter` | Pass; Hardhat fork profile against real MuchFi V2 WDOGE/USDC pair at block `5184292` |
| `pnpm analysis:dogeos` | Pass at block `5184491`; read-only DogeOS and Blockscout evidence written |
| `pnpm audit:deps` | Pass at moderate threshold; only low findings remain after overriding `tmp` to `0.2.6` |
| `pnpm audit:deps:prod` | Pass: no known production vulnerabilities |
| `pnpm deploy:preflight:router` | Pass at block `5094550`; router deployed at block `5094556` |
| `pnpm deploy:preflight:adapter` | Pass at block `5094558`; adapter deployed at block `5094563` |
| `pnpm deploy:verify-source:router` | Pass; source verified on Blockscout |
| `pnpm deploy:verify-source:adapter` | Pass; source verified on Blockscout |
| `pnpm deploy:preflight:allowlist:adapter` | Pass before allowlist; transaction confirmed at block `5184437` |
| `pnpm deploy:preflight:route:v2` | Pass at block `5184459`; estimated swap gas `223969` |
| `pnpm deploy:canary:swap:v2` | Pass at block `5184451`; tx `0x5249ba34c3a021a243d01ade3080575f86d3eeaeb98423c86236d37db744d832` |
| `pnpm preflight:full` | Pass before allowlist/canary broadcast |

Coverage artifact hash:

```text
coverage/lcov.info sha256 ee26fa854c79af4f52a417bc291f6b7492066be0ef2ecc07f640b1b0e2eb08dd
```

Gas profile evidence:

- `docs/dexv3/router-gas-profile-2026-05-23.md`
- `docs/dexv3/router-gas-profile-2026-05-23.json`
- `docs/dexv3/dogeos-v2-adapter-fork-gas-profile-2026-05-23.md`
- `docs/dexv3/dogeos-v2-adapter-fork-gas-profile-2026-05-23.json`

## Dependency Audit Position

High and moderate dependency audit findings were removed by updating the Hardhat toolchain and adding pnpm overrides for vulnerable transitive packages. The remaining advisories are low severity, dev-only, and not in the production dependency set.

Remaining low dev-only advisories:

| Package | Severity | Position |
| --- | --- | --- |
| `cookie` | Low | Dev-tooling only; no production runtime |
| `elliptic` | Low | Dev-tooling only; no production runtime |

Raw dependency audit evidence: `docs/dexv3/pnpm-audit-2026-05-27.json`.

## Deployment Plan

Router deployment:

| Field | Value |
| --- | --- |
| Chain ID | `6281971` |
| Deployer | `0x00B6F77d55967669Ea37f47Fc469FF47782007E4` |
| Router owner | `0x00B6F77d55967669Ea37f47Fc469FF47782007E4` |
| WDOGE | `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE` |
| Nonce | `0` |
| Predicted router | `0xBBf7ECC134350a9aF2BCA49A1420ac5E15fe54c3` |
| Deployed router | `0xBBf7ECC134350a9aF2BCA49A1420ac5E15fe54c3` |
| Deployment tx | `0x19156ceee4ef1f4dcd8c4c8870a8a76b206eb3b3907221f00772f207868c839a` |
| Deployment block | `5094556` |
| Estimated gas | `1101534` |
| Actual gas used | `1101534` |
| Estimated cost | `0.000017272172085672 DOGE` |

Adapter deployment:

| Field | Value |
| --- | --- |
| Adapter | `0xe3D7979C510a3eBc7e3C60dB0F9f69c60E3D7A0E` |
| Factory | `0x7864071B532894216e3C045a74814EafEB92ae20` |
| WDOGE/USDC pair | `0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4` |
| Deployment tx | `0x42658effb209e5b72cd57c8a33d054dcd3ed2ef94d46c5c92ad4d7d5cab8d82a` |
| Deployment block | `5094563` |
| Actual gas used | `771110` |
| Source verification | Pass |

Allowlist preflight:

| Field | Value |
| --- | --- |
| Already allowed | `false` |
| Estimated gas | `47822` |
| Estimated cost | `0.000000749854124776 DOGE` |
| Quote amount out for `0.001 DOGE` via WDOGE/USDC | `115834107382279` |

Allowlist and canary execution:

| Field | Value |
| --- | --- |
| Allowlist tx | `0x919029a596982eea40d0b9267e6ab20dc9dff9a5c448feb58db80e64edae045f` |
| Allowlist block | `5184437` |
| Route preflight gas estimate | `223969` |
| Canary tx | `0x5249ba34c3a021a243d01ade3080575f86d3eeaeb98423c86236d37db744d832` |
| Canary block | `5184451` |
| Canary input | `0.0001 DOGE` |
| Canary actual output | `0.000016075550163793 USDC` |
| Canary gas used | `191150` |

Representative future-operation gas profile at reference gas price `15680108` wei:

| Category | Action | Gas Used |
| --- | --- | ---: |
| admin | `setAdapterAllowed(adapter,true)` | `47822` |
| admin | `setAdapterAllowed(adapter,false)` | `25910` |
| admin | `pause()` | `46878` |
| admin | `unpause()` | `24861` |
| admin | `transferOwnership(pendingOwner)` | `47831` |
| admin | `acceptOwnership()` | `28310` |
| swap | `exactInput ERC20 -> ERC20` | `161708` |
| swap | `exactInput native DOGE -> ERC20` | `148040` |
| swap | `exactInput ERC20 -> native DOGE` | `160647` |
| deployment | `DogeOSV2PairAdapter.constructor` | `771110` |
| integration | `exactInput DogeOS V2 ERC20 -> ERC20` | `170139` |
| integration | `exactInput DogeOS V2 native DOGE -> ERC20` | `170150` |
| integration | `exactInput DogeOS V2 ERC20 -> native DOGE` | `169058` |
| fork-swap | `exactInput MuchFi V2 native DOGE -> USDC` | `191150` |

Local DogeOS V2 rows use the production adapter with V2-shaped local pair mocks. The fork-swap row uses real DogeOS WDOGE and MuchFi V2 pair bytecode on a local Hardhat fork; no transaction was broadcast.

Router, adapter, adapter allowlist, and the first canary swap are complete. Repeat canaries should use the explicit confirmation gate:

```bash
pnpm deploy:preflight:route:v2
CONFIRM_DOGEOS_TESTNET_CANARY_SWAP=swap-dogeos-v2-canary pnpm deploy:canary:swap:v2
```

## Known Limitations

| Limitation | Severity | Current handling |
| --- | --- | --- |
| Slither not installed locally | Medium | Manual audit checklist and coverage run completed; install/run Slither before mainnet readiness |
| Foundry/cast not installed locally | Medium | Hardhat/ethers preflight used; Foundry fork/fuzz remains a mainnet-readiness gap |
| Single executable source | Medium | MuchFi V2 is active after canary; all V3/Algebra/watchlist/owned DEX routes remain non-executable |
| External MuchFi/Barkswap contracts unverified/unconfirmed for public execution | High | MuchFi V2 has direct pair adapter coverage; V3 and Algebra remain read-only until router/quoter provenance and adapter work are complete |
| Testnet key was shared in chat | High for production, low for disposable testnet | Use only for disposable testnet; mainnet must use fresh key, keystore/hardware wallet, and multisig/timelock owner |

## Go/No-Go

Controlled Chikyu testnet router and adapter deployment is complete.

No-go for broader public execution routing or mainnet readiness until monitoring, more canary routes, static analysis, expanded fork/testnet testing, and admin custody upgrades are complete.
