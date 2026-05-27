# DogeOS On-Chain Validation 2026-05-23

Read-only validation through DogeOS Chikyu RPC and Blockscout. No private key was used and no transaction was broadcast.

| Field | Value |
| --- | --- |
| Chain ID | `6281971` |
| Block | `5094601` |
| RPC | `https://rpc.testnet.dogeos.com` |
| Blockscout | `https://blockscout.testnet.dogeos.com` |

## Official Tokens

| Symbol | Address | On-chain name | Decimals | Bytecode |
| --- | --- | --- | --- | --- |
| WDOGE | `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE` | Wrapped Doge | 18 | Present |
| LBTC | `0x29789F5A3e4c3113e7165c33A7E3bc592CF6fE0E` | Lombard Staked BTC | 18 | Present |
| WETH | `0x1a6094Ac3ca3Fc9F1B4777941a5f4AAc16A72000` | Wrapped Ethereum | 18 | Present |
| USD1 | `0x25D5E5375e01Ed39Dc856bDCA5040417fD45eA3F` | World Liberty Financial USD | 18 | Present |
| USDC | `0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925` | USD Coin | 18 | Present |
| USDT | `0xC81800b77D91391Ef03d7868cB81204E753093a9` | Tether | 18 | Present |

## DEX Source Status

- MuchFi V2 pairs still expose readable reserves.
- MuchFi V3 pools still expose readable token, fee, liquidity, and slot0 state.
- Barkswap Algebra pools still expose readable token, fee, liquidity, and globalState.
- The V1 router and MuchFi V2 direct-pair adapter are deployed and source verified when listed as verified below.
- External execution remains disabled until the separate allowlist transaction is explicitly approved and route preflight passes. V3 and Algebra router/quoter ABI provenance remains incomplete.

## Blockscout Verification

| Address | Label | HTTP | Verified | Name |
| --- | --- | --- | --- | --- |
| `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB` | MuchFi V3 router candidate | 200 | No |  |
| `0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B` | MuchFi V3 factory | 200 | No |  |
| `0x7864071B532894216e3C045a74814EafEB92ae20` | MuchFi V2 factory | 200 | No |  |
| `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | Barkswap factory | 200 | No |  |
| `0x4Bb4A5CF44028519908D6B4A90C570fEaA8c9a07` | Barkswap position manager | 200 | No | Barkswap Positions NFT-V2 |
| `0xBBf7ECC134350a9aF2BCA49A1420ac5E15fe54c3` | DogeOSSwapRouter deployment | 200 | Yes | DogeOSSwapRouter |
| `0xe3D7979C510a3eBc7e3C60dB0F9f69c60E3D7A0E` | DogeOSV2PairAdapter deployment | 200 | Yes | DogeOSV2PairAdapter |

## Deployment Decision

The V1 router and MuchFi V2 adapter can remain deployed for controlled testnet review. The adapter should not be allowlisted until a separate approval confirms source verification, expected calldata, deployed adapter code, canonical MuchFi V2 pair state, and route behavior. V3 and Algebra sources additionally require router/quoter ABI provenance.

Raw evidence: `onchain-validation-2026-05-23.json`.
