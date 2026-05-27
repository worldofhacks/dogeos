# DogeOS DEX V1 On-Chain Validation

Validation date: 2026-05-22
RPC: `https://rpc.testnet.dogeos.com`
Blockscout: `https://blockscout.testnet.dogeos.com`
Block validated: `5071643`
Evidence JSON: [onchain-validation-2026-05-22.json](./onchain-validation-2026-05-22.json)

This pass used read-only RPC calls and Blockscout address reads only. No wallet, private key, signing operation, deployment, or broadcast transaction was used.

## Network And Fee Oracle

| Check | Result |
| --- | --- |
| Chain ID | `6281971` |
| `L1GasPriceOracle` | Bytecode present at `0x5300000000000000000000000000000000000002` |
| Sample `getL1Fee(0x12345678)` | `81261556192` wei |

## Official Token Metadata

All official faucet tokens have bytecode and still report `18` decimals.

| Symbol | Address | On-chain name | Decimals |
| --- | --- | --- | --- |
| WDOGE | `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE` | Wrapped Doge | `18` |
| LBTC | `0x29789F5A3e4c3113e7165c33A7E3bc592CF6fE0E` | Lombard Staked BTC | `18` |
| WETH | `0x1a6094Ac3ca3Fc9F1B4777941a5f4AAc16A72000` | Wrapped Ethereum | `18` |
| USD1 | `0x25D5E5375e01Ed39Dc856bDCA5040417fD45eA3F` | World Liberty Financial USD | `18` |
| USDC | `0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925` | USD Coin | `18` |
| USDT | `0xC81800b77D91391Ef03d7868cB81204E753093a9` | Tether | `18` |

## MuchFi V2

| Check | Result |
| --- | --- |
| Factory | `0x7864071B532894216e3C045a74814EafEB92ae20` |
| Blockscout verification | Unverified |
| `allPairsLength()` | `2` |
| WDOGE/USDC pair | `0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4` |
| WDOGE/USDT pair | `0x1498200A5D49081D8E55250aFeb13aAf3c1d9AE4` |
| Read adapter posture | Quote/read only |
| Execution posture | Disabled until canonical router ABI/address is confirmed |

Reserves were readable for both pairs. The source registry correctly keeps `muchfi-v2` as `readOnly`.

## MuchFi V3

| Check | Result |
| --- | --- |
| Factory | `0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B` |
| Position manager | `0x7932C91f3BAD326ecd6C2bE81697D732714B9eC5` |
| Router candidate | `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB` |
| Blockscout verification | Factory and router candidate are unverified |
| USDC/WDOGE `500` pool | `0x4F1c638952a23DB25a13167B83810201c4BC7299` |
| USDC/WDOGE `2500` pool | `0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC` |
| USDT/WDOGE `500` pool | `0x64A2683ae2995E1ca89FECA0c9ffc9056EF0504F` |
| Read adapter posture | Quote/read only |
| Execution posture | Disabled until router/quoter ABI provenance is confirmed |

Pool state reads succeeded for `token0`, `token1`, `fee`, `liquidity`, and `slot0`.

## Barkswap Algebra

| Check | Result |
| --- | --- |
| Newer factory | `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` |
| Newer position manager | `0x4Bb4A5CF44028519908D6B4A90C570fEaA8c9a07` |
| Blockscout verification | Factory unverified; position manager named `Barkswap Positions NFT-V2` but unverified |
| `poolByPair(WDOGE, USDC)` | `0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1` |
| `poolByPair(WDOGE, USDT)` | `0x5DC3eB0e452f464e134F854EAeDf9431B93Da624` |
| Read adapter posture | Quote/read only |
| Execution posture | Disabled until canonical deployment, router, quoter, and ABI are confirmed |

Pool state reads succeeded for `token0`, `token1`, `fee`, `liquidity`, and `globalState`.

## Risk Findings

| Finding | Severity | Decision |
| --- | --- | --- |
| MuchFi and Barkswap periphery contracts remain unverified in Blockscout reads. | High | Keep execution disabled. |
| MuchFi V3 router address remains a candidate, not a confirmed execution dependency. | High | Do not generate execution calldata for MuchFi V3. |
| Barkswap router/quoter remains unknown. | High | Do not generate execution calldata for Barkswap. |
| Official tokens still use 18 decimals, including USDC and USDT. | Medium | Keep DogeOS token registry values explicit and tested. |
| DogeOS data/finality fee oracle is live and returns non-zero estimates. | Medium | Keep fee-aware route scoring as a V1 requirement. |

## Acceptance Status

Current source execution status is intentionally conservative:

- `owned-pancake-v3`: disabled, no deployment and no GPL approval.
- `muchfi-v2`: read-only.
- `muchfi-v3`: read-only.
- `barkswap-algebra`: read-only.
- `suchswap`: watchlist.
- `dogebox`: watchlist.
