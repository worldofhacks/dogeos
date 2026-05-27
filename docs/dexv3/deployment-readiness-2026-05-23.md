# DogeOS DEX V1 Deployment Readiness 2026-05-23

Scope: V1 `DogeOSSwapRouter` and `DogeOSV2PairAdapter` deployment readiness for DogeOS Chikyu testnet. No adapter allowlisting, liquidity deployment, RFQ, split routing, Baseline-style module, or owned CLAMM deployment is included.

## Security Gate Result

| Gate | Result |
| --- | --- |
| Local `.env` exists | Pass |
| `.env` ignored by git | Pass |
| Deployer private key shape | Pass |
| Derived deployer address matches `DEPLOYER_ADDRESS` | Pass |
| Hardhat contract tests | Pass: 45 tests |
| Package/deploy/gas helper tests | Pass: 16 tests |
| Placeholder/secret scan | Pass |
| Hardhat compile | Pass, `evmVersion: prague` |
| Solidity coverage | Pass: router `100%` statements/functions/lines, `97.62%` branch; adapter `100%` statements/functions/lines; all files `100%` statements, `98.4%` lines |
| Router gas profile | Pass: deployment, admin, fixed-output swap, and DogeOS V2 adapter estimates written |
| DogeOS V2 adapter fork gas profile | Pass: real MuchFi V2 WDOGE/USDC pair at fork block `5094455` |
| Dependency audit | Pass: production audit clean, moderate+ audit clean |
| DogeOS live read-only analysis | Pass at block `5094601`; deployed router and adapter are source verified on Blockscout |
| Router deployment preflight | Pass at block `5094550`; deployed at block `5094556` |
| Adapter deployment preflight | Pass at block `5094558`; deployed at block `5094563` |
| Adapter allowlist preflight | Pass at block `5094566`; `alreadyAllowed=false`, estimated gas `47822` |
| Route preflight | Correctly blocked until explicit allowlist approval |
| Transaction broadcast | Router and adapter deployment broadcasts succeeded; allowlist not broadcast |

## Deployment Plan

The router deployment succeeded with the following audited plan and receipt:

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
| Gas price | `15680108` wei |
| Estimated cost | `0.000017272172085672 DOGE` |

Raw router evidence is in `deployments/dogeos-chikyu/router-preflight-latest.json` and `deployments/dogeos-chikyu/router-latest.json`.

The adapter deployment succeeded separately:

| Field | Value |
| --- | --- |
| Adapter | `0xe3D7979C510a3eBc7e3C60dB0F9f69c60E3D7A0E` |
| Factory | `0x7864071B532894216e3C045a74814EafEB92ae20` |
| WDOGE/USDC pair | `0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4` |
| Deployment tx | `0x42658effb209e5b72cd57c8a33d054dcd3ed2ef94d46c5c92ad4d7d5cab8d82a` |
| Deployment block | `5094563` |
| Actual gas used | `771110` |
| Blockscout source verification | Pass |

Raw adapter evidence is in `deployments/dogeos-chikyu/adapter-preflight-latest.json` and `deployments/dogeos-chikyu/adapter-latest.json`.

Gas profile evidence is in:

- `docs/dexv3/router-gas-profile-2026-05-23.md`
- `docs/dexv3/router-gas-profile-2026-05-23.json`
- `docs/dexv3/dogeos-v2-adapter-fork-gas-profile-2026-05-23.md`
- `docs/dexv3/dogeos-v2-adapter-fork-gas-profile-2026-05-23.json`

Representative local gas measurements at reference gas price `15680108` wei:

| Action | Gas Used |
| --- | ---: |
| `DogeOSSwapRouter.constructor` | `1101546` |
| `setAdapterAllowed(adapter,true)` | `47822` |
| `setAdapterAllowed(adapter,false)` | `25910` |
| `pause()` | `46878` |
| `unpause()` | `24861` |
| `transferOwnership(pendingOwner)` | `47831` |
| `acceptOwnership()` | `28310` |
| `exactInput ERC20 -> ERC20` | `161708` |
| `exactInput native DOGE -> ERC20` | `148040` |
| `exactInput ERC20 -> native DOGE` | `160647` |
| `DogeOSV2PairAdapter.constructor` | `771110` |
| `exactInput DogeOS V2 ERC20 -> ERC20` | `170139` |
| `exactInput DogeOS V2 native DOGE -> ERC20` | `170150` |
| `exactInput DogeOS V2 ERC20 -> native DOGE` | `169058` |
| `exactInput MuchFi V2 native DOGE -> USDC` on DogeOS fork | `191150` |

## DogeOS Documentation Checks

The official DogeOS docs confirm:

- DogeOS Chikyu testnet uses RPC `https://rpc.testnet.dogeos.com`, chain ID `6281971`, native currency `DOGE`, and Blockscout `https://blockscout.testnet.dogeos.com`.
- DogeOS is EVM bytecode equivalent and the current docs say to use `prague` as the EVM target and avoid Solidity below `0.8.30`.
- The deployment wallet must be funded with testnet DOGE before deploying.
- DogeOS supports Hardhat source verification through the Blockscout API at `https://blockscout.testnet.dogeos.com/api`.
- The faucet directly distributes DogeOS Chikyu testnet DOGE and is rate-limited.
- DogeOS transaction cost is execution fee plus data/finality fee, and the `L1GasPriceOracle` is predeployed at `0x5300000000000000000000000000000000000002`.

References:

- `https://docs.dogeos.com/en/developers/developer-quickstart`
- `https://docs.dogeos.com/en/developers/verifying-smart-contracts`
- `https://docs.dogeos.com/en/developers/guides/contract-deployment-tutorial`
- `https://docs.dogeos.com/en/getting-started/user-guide/faucet`
- `https://docs.dogeos.com/en/developers/transaction-fees-on-dogeos`

## Current On-Chain Analysis

Fresh evidence was written to:

- `docs/dexv3/onchain-validation-2026-05-23.md`
- `docs/dexv3/onchain-validation-2026-05-23.json`

Summary:

- Official tokens are deployed and report 18 decimals.
- `L1GasPriceOracle` bytecode is present and responds to `getL1Fee`.
- MuchFi V2 pairs still expose reserves; the direct pair adapter fork profile succeeded against WDOGE/USDC.
- Deployed `DogeOSSwapRouter` and `DogeOSV2PairAdapter` are source verified on DogeOS Blockscout.
- MuchFi V3 pools still expose fee, liquidity, and slot0.
- Barkswap Algebra pools still expose fee, liquidity, and globalState.
- Blockscout still shows external MuchFi/Barkswap factory/router/position-manager surfaces as unverified or unconfirmed for public execution.

## Security Decision

The V1 router and MuchFi V2 adapter are deployed and source verified on testnet. External execution remains disabled because the adapter is not allowlisted. `deploy:preflight:allowlist:adapter` passed, and `deploy:preflight:route:v2` correctly refuses to run until the separate allowlist transaction is explicitly approved.

## Next Safe Action

Review the allowlist preflight evidence before enabling execution:

```bash
pnpm deploy:preflight:allowlist:adapter
```

If explicitly approved, broadcast only the adapter allowlist transaction:

```bash
CONFIRM_DOGEOS_TESTNET_ALLOWLIST=allowlist-dogeos-v2-adapter pnpm deploy:allowlist:adapter
pnpm deploy:preflight:route:v2
```
