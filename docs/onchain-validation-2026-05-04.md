# DogeOS Testnet On-Chain Validation

Validation date: 2026-05-04

RPC used: `https://rpc.testnet.dogeos.com`

Block validated: `4668058`

This is the latest repository fact-check pass. It compares every current planning document against the DogeOS ecosystem-team provided testnet reference, the official DogeOS docs, live RPC reads, and Blockscout metadata.

## Team-Provided Reference Checked

| Item | Provided value | Live / docs validation |
| --- | --- | --- |
| RPC | `https://rpc.testnet.dogeos.com` | `eth_chainId` returned `0x5fdaf3`. |
| WS RPC | `wss://ws.rpc.testnet.dogeos.com` | WebSocket `eth_chainId` returned `0x5fdaf3`. |
| Chain ID | `6281971` | Matches `0x5fdaf3`. |
| Symbol | `DOGE` | Matches official SDK and quickstart docs. |
| Block explorer | `https://blockscout.testnet.dogeos.com` | HTTP `200`; used as validation source. |
| Docs | `https://docs.dogeos.com` | HTTP `200`. |
| Faucet | `https://faucet.testnet.dogeos.com` | HTTP `200`. |
| Dev portal | `https://portal.testnet.dogeos.com` | HTTP `200`. |
| Unifra RPC | `https://dogeos-testnet-public.unifra.io/` | `eth_chainId` returned `0x5fdaf3`. |
| L2scan Explorer | `https://dogeos-testnet.l2scan.co/` | Root returned HTTP `404`; keep as provided, but do not use as source of record yet. |
| Unifra Private API Keys | `https://console.unifra.io/` | HTTP `200`. |
| Wallet SDK demo | `https://dogeos-connect-kit-v3.vercel.app/` | HTTP `200`. |
| Wallet SDK docs | `https://docs.dogeos.com/en/sdk` | HTTP `200`; official SDK docs confirm React SDK, embedded wallet login, chain config, WalletConnect config, and login options. |
| MuchFi sample route | `https://testnet.muchfi.xyz/trade?inputCurrency=0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925&outputCurrency=DOGE&feeTier=2500&marketType=clmm` | HTTP `200`; `USDC/WDOGE:2500` pool exists on-chain. |

## Official DogeOS Docs Cross-Check

| Repo claim | Official docs status |
| --- | --- |
| DogeOS is EVM compatible. | Confirmed in developer docs. |
| Chikyū Testnet RPC is `https://rpc.testnet.dogeos.com/`. | Confirmed in developer quickstart. |
| Chain ID is `6281971`. | Confirmed in developer quickstart and SDK example. |
| Native currency is `DOGE` with 18 decimals on DogeOS. | Confirmed in SDK example. |
| Block explorer is Blockscout. | Confirmed in developer quickstart and SDK example. |
| DogeOS SDK is official React library. | Confirmed in SDK docs. |
| SDK supports embedded wallet login and social-login configuration. | Confirmed in SDK and embedded-wallet docs. |
| Fees are execution fee plus Data and Finality fee. | Confirmed in transaction-fees docs. |
| `L1GasPriceOracle` predeploy is `0x5300000000000000000000000000000000000002`. | Confirmed in transaction-fees docs and bytecode/Blockscout reads. |
| Maximum reorg depth is 17 blocks. | Confirmed in Ethereum & DogeOS Differences docs. |

## Official Token Metadata

All team-provided DeFi builder token addresses have bytecode and standard ERC-20 metadata at block `4668058`.

| Symbol | Address | On-chain name | Decimals | Bytecode |
| --- | --- | --- | --- | --- |
| WDOGE | `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE` | `Wrapped Doge` | `18` | Present |
| LBTC | `0x29789F5A3e4c3113e7165c33A7E3bc592CF6fE0E` | `Lombard Staked BTC` | `18` | Present |
| WETH | `0x1a6094Ac3ca3Fc9F1B4777941a5f4AAc16A72000` | `Wrapped Ethereum` | `18` | Present |
| USD1 | `0x25D5E5375e01Ed39Dc856bDCA5040417fD45eA3F` | `World Liberty Financial USD` | `18` | Present |
| USDC | `0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925` | `USD Coin` | `18` | Present |
| USDT | `0xC81800b77D91391Ef03d7868cB81204E753093a9` | `Tether` | `18` | Present |

## DEX Fact Check

### Barkswap

Historical status at this pass: confirmed V1 integration target for read adapters; execution was blocked on router/quoter confirmation. Current aggregator update: Barkswap Algebra is now an active execution source through the newer pinned router `0x77147f436cE9739D2A54Ffe428DBe02b90c0205e` and quoter `0xcEF56157baaB2Fe9D16ccF0eB4a9Df354380257D`.

| Surface | Address | Validation |
| --- | --- | --- |
| Older position NFT | `0xeA672006Ed9ce530e4EFb9D5580f08c1F363873A` | `Barkswap Positions NFT-V2`, total supply `74`, unverified. |
| Older factory | `0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263` | Returned by older position NFT `factory()`, unverified. |
| Newer position NFT | `0x4Bb4A5CF44028519908D6B4A90C570fEaA8c9a07` | `Barkswap Positions NFT-V2`, total supply `10`, unverified. |
| Newer factory | `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | Returned by newer position NFT `factory()`, unverified. |

Official-token pools found through `poolByPair(address,address)`:

| Factory | Pair | Pool |
| --- | --- | --- |
| `0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263` | WDOGE/USDC | `0xB37D91625b0Da3725989Cc8e3eF1E487f34C91C0` |
| `0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263` | WDOGE/USDT | `0x51c53CCFAD18C658f89C54377d3d90Ef8146a464` |
| `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | WDOGE/USDC | `0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1` |
| `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | WDOGE/USDT | `0x5DC3eB0e452f464e134F854EAeDf9431B93Da624` |

No Barkswap pools were found for `USDC/USDT`, `WDOGE/LBTC`, `WDOGE/WETH`, `WDOGE/USD1`, or the other official-token combinations probed in either factory.

Position summary:

| Position NFT | Pair | Count |
| --- | --- | --- |
| Newer `0x4Bb4...` | USDT/WDOGE | `6` |
| Newer `0x4Bb4...` | USDC/WDOGE | `3` |
| Newer `0x4Bb4...` | LAIKA/WDOGE | `1` |
| Older `0xeA67...` | USDT/WDOGE | `5` |
| Older `0xeA67...` | USDC/WDOGE | `3` |
| Older `0xeA67...` | Random token/WDOGE | Many one-off positions |

Historical conclusion at this pass: Barkswap still looked Algebra-style rather than vanilla Uniswap V3, and the repo treated it as a high-priority read-adapter target until router/quoter confirmation. Current aggregator update: Barkswap Algebra is now an active execution source through pinned router/quoter contracts, committed adapter ABI fragments, typed calldata builders, and runtime simulation.

### MuchFi

Historical status at this pass: confirmed V1 integration target for read adapters; execution was blocked on router/quoter confirmation. Current aggregator update: MuchFi V2 and MuchFi V3 are now active execution sources through pinned routers, a V3 quoter, committed adapter ABI fragments, typed calldata builders, and runtime simulation.

| Surface | Address | Validation |
| --- | --- | --- |
| V3 position NFT | `0x7932C91f3BAD326ecd6C2bE81697D732714B9eC5` | `MuchFi V3 Positions NFT-V1`, total supply `8`, unverified. |
| V3 factory | `0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B` | Returned by position NFT `factory()`, `getPool(address,address,uint24)` works. |
| V3 pool deployer | `0x6c04e808d5FfFb597cb6a5b539f2a1dDF3529348` | Returned by V3 factory `poolDeployer()`. |
| V3 router candidate | `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB` | Unverified; Blockscout transactions include `0x04e45aaf`, the `exactInputSingle(...)` selector. |
| V2-style factory | `0x7864071B532894216e3C045a74814EafEB92ae20` | `allPairsLength()` returned `2`; `getPair(address,address)` works. |

V3 pools found:

| Pair | Fee tier | Pool |
| --- | --- | --- |
| USDC/WDOGE | `500` | `0x4F1c638952a23DB25a13167B83810201c4BC7299` |
| USDC/WDOGE | `2500` | `0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC` |
| USDT/WDOGE | `500` | `0x64A2683ae2995E1ca89FECA0c9ffc9056EF0504F` |

V2-style pairs found:

| Pair | Pair / LP |
| --- | --- |
| USDC/WDOGE | `0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4` |
| USDT/WDOGE | `0x1498200A5D49081D8E55250aFeb13aAf3c1d9AE4` |

Position summary:

| Position NFT | Pair | Count |
| --- | --- | --- |
| `0x7932...` | USDC/WDOGE | `7` |
| `0x7932...` | USDT/WDOGE | `1` |

Conclusion: MuchFi remains the second confirmed DEX target. The team-provided sample URL with `feeTier=2500&marketType=clmm` is consistent with the live `USDC/WDOGE:2500` pool.

### SuchSwap

Status: watchlist only.

`0xC0BAc1a8EbFA10E92f2b59638d314673FadD031e` still reads as `SuchSwap Positions NFT`, and `factory()` returns `0x924163a558915Bf685eD21809A8B8b372A79Ed37`. A sampled position set includes one USDC/WDOGE position, but no canonical router/quoter path is confirmed.

### DogeBox

Status: watchlist only.

Two `DogeBox LP` contracts still exist, but neither is an official WDOGE/USDC or WDOGE/USDT pair:

| LP | Pair read |
| --- | --- |
| `0x5F82455D6b5a6f935F0fdA96A519B8c1b82aE3a2` | Unknown token / USDT |
| `0x5AE7A8ce36D4288519b7b189632c9E81496EcDa0` | USDT / unknown token |

## Repository Fact-Check Result

| Area | Result |
| --- | --- |
| Team-provided DogeOS network metadata | Correct and revalidated. |
| Team-provided official token addresses | Correct and revalidated. |
| DogeOS SDK references | Correct, with docs now emphasizing embedded wallet login and configurable login options. |
| DogeOS fee and reorg assumptions | Correct against official docs. |
| Barkswap DEX discovery | Still accurate. |
| MuchFi DEX discovery | Still accurate; older liquidity-discovery text was patched to include the `USDC/WDOGE:2500` V3 pool. |
| SuchSwap / DogeBox treatment | Correct as watchlist-only. |
| L2scan treatment | Correct to keep as provided but not source-of-record because root still returns HTTP `404`. |
| Execution readiness | Historical note at this pass: waiting on canonical router/quoter/source verification. Current aggregator update: active direct execution uses pinned MuchFi V2, MuchFi V3, and Barkswap Algebra router/quoter provenance plus runtime simulation. |

## Remaining Questions

| Question | Owner |
| --- | --- |
| Are Barkswap and MuchFi the two canonical V1 DEXes aggregators should prioritize? | DogeOS ecosystem |
| Which Barkswap deployment is current, and what are canonical router/quoter addresses? | Barkswap / DogeOS |
| Is Barkswap Algebra Integral, an Algebra fork, or custom CLAMM? | Barkswap engineering |
| What are canonical MuchFi V2 and V3 router/quoter addresses? | MuchFi engineering |
| Should aggregators route through both MuchFi V2 and MuchFi V3? | MuchFi engineering |
| Can Barkswap and MuchFi contracts be verified on Blockscout before public execution? | DEX teams |

## Source Links

- DogeOS developer quickstart: https://docs.dogeos.com/en/developers/developer-quickstart
- DogeOS SDK docs: https://docs.dogeos.com/en/sdk
- DogeOS embedded wallet docs: https://docs.dogeos.com/en/sdk/embedded-wallets
- DogeOS transaction fees docs: https://docs.dogeos.com/en/developers/transaction-fees-on-dogeos
- DogeOS Ethereum differences docs: https://docs.dogeos.com/en/developers/ethereum-and-dogeos-differences
- DogeOS Blockscout: https://blockscout.testnet.dogeos.com
- DogeOS faucet: https://faucet.testnet.dogeos.com
