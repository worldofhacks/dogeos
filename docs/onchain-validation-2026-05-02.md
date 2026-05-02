# DogeOS Testnet On-Chain Validation

Validation date: 2026-05-02

RPC used: `https://rpc.testnet.dogeos.com`

Block validated: `4620801`

## Scope

This pass validates the repository's DogeOS Chikyu Testnet metadata, official token assumptions, current DEX discovery, and routing architecture against live testnet reads and current primary-source aggregator/Uniswap standards.

## Network And Endpoint Results

| Item | Result |
| --- | --- |
| Official RPC chain ID | `0x5fdaf3` / `6281971` |
| Unifra public RPC chain ID | `0x5fdaf3` / `6281971` |
| Blockscout | Reachable, HTTP `200` |
| DogeOS SDK docs | Reachable, HTTP `200`; confirms official React SDK and Chikyu EVM config. |
| Faucet | Reachable, HTTP `200` |
| Dev portal | Reachable, HTTP `200` |
| Wallet SDK demo | Reachable, HTTP `200` |
| L2scan explorer | Root returned HTTP `404` during validation; keep as provided but use Blockscout for validation until confirmed. |
| `L1GasPriceOracle` predeploy | `0x5300000000000000000000000000000000000002`, verified on Blockscout, bytecode present. |

## Official Token Metadata

All provided official faucet-token contracts had bytecode and standard metadata reads at block `4620801`.

| Symbol | Address | On-chain name | Decimals |
| --- | --- | --- | --- |
| WDOGE | `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE` | `Wrapped Doge` | `18` |
| LBTC | `0x29789F5A3e4c3113e7165c33A7E3bc592CF6fE0E` | `Lombard Staked BTC` | `18` |
| WETH | `0x1a6094Ac3ca3Fc9F1B4777941a5f4AAc16A72000` | `Wrapped Ethereum` | `18` |
| USD1 | `0x25D5E5375e01Ed39Dc856bDCA5040417fD45eA3F` | `World Liberty Financial USD` | `18` |
| USDC | `0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925` | `USD Coin` | `18` |
| USDT | `0xC81800b77D91391Ef03d7868cB81204E753093a9` | `Tether` | `18` |

## DEX Findings

### Barkswap

Status: confirmed V1 integration target, read-only until router/quoter/ABI confirmation.

| Surface | Address | Validation |
| --- | --- | --- |
| Older position NFT | `0xeA672006Ed9ce530e4EFb9D5580f08c1F363873A` | `Barkswap Positions NFT-V2`, total supply `74`, unverified. |
| Older factory | `0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263` | Returned by older position NFT `factory()`, unverified. |
| Newer position NFT | `0x4Bb4A5CF44028519908D6B4A90C570fEaA8c9a07` | `Barkswap Positions NFT-V2`, total supply `10`, unverified. |
| Newer factory | `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | Returned by newer position NFT `factory()`, unverified. |

Official-token pools found through Algebra-style `poolByPair(address,address)`:

| Factory | Pair | Pool |
| --- | --- | --- |
| `0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263` | WDOGE/USDC | `0xB37D91625b0Da3725989Cc8e3eF1E487f34C91C0` |
| `0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263` | WDOGE/USDT | `0x51c53CCFAD18C658f89C54377d3d90Ef8146a464` |
| `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | WDOGE/USDC | `0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1` |
| `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | WDOGE/USDT | `0x5DC3eB0e452f464e134F854EAeDf9431B93Da624` |

No Barkswap official-token pools were found for `USDC/USDT`, `WDOGE/LBTC`, `WDOGE/WETH`, or `WDOGE/USD1` in either factory during this pass.

Position summary:

| Position NFT | Pair | Count |
| --- | --- | --- |
| Newer `0x4Bb4...` | USDT/WDOGE | `6` |
| Newer `0x4Bb4...` | USDC/WDOGE | `3` |
| Older `0xeA67...` | USDT/WDOGE | `5` |
| Older `0xeA67...` | USDC/WDOGE | `3` |

Conclusion: Barkswap looks Algebra-style because `poolByPair`, `globalState`, `liquidity`, `fee`, `token0`, and `token1` reads work while vanilla Uniswap V3 factory/pool assumptions do not cleanly apply. Execution remains blocked on canonical router/quoter confirmation.

### MuchFi

Status: confirmed V1 integration target, read-only until router/quoter/ABI confirmation.

| Surface | Address | Validation |
| --- | --- | --- |
| V3 position NFT | `0x7932C91f3BAD326ecd6C2bE81697D732714B9eC5` | `MuchFi V3 Positions NFT-V1`, total supply `8`, unverified. |
| V3 factory | `0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B` | Returned by V3 position NFT `factory()`, `getPool(address,address,uint24)` works. |
| V3 pool deployer | `0x6c04e808d5FfFb597cb6a5b539f2a1dDF3529348` | Returned by V3 factory `poolDeployer()`. |
| V3 router candidate | `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB` | Unverified; deployer activity includes `exactInputSingle(...)` selector, but this is not enough for execution. |
| V2-style factory | `0x7864071B532894216e3C045a74814EafEB92ae20` | `allPairsLength()` returned `2`; `getPair(address,address)` works. |

V3 pools found:

| Pair | Fee tier | Pool |
| --- | --- | --- |
| USDC/WDOGE | `500` | `0x4F1c638952a23DB25a13167B83810201c4BC7299` |
| USDC/WDOGE | `2500` | `0xbed5ee59C0B913468253F3BB1021f2Dee5426eCc` |
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

Conclusion: MuchFi is not just upcoming; it has visible V2-style and V3-style liquidity on testnet. The user-provided MuchFi URL with `feeTier=2500&marketType=clmm` aligns with the live USDC/WDOGE `2500` pool.

### SuchSwap

Status: watchlist only.

`0xC0BAc1a8EbFA10E92f2b59638d314673FadD031e` is a `SuchSwap Positions NFT` contract with visible positions, including one USDC/WDOGE position. Factory `0x924163a558915bf685ed21809a8b8b372a79ed37` has bytecode. This is enough to keep SuchSwap in discovery, but not enough to put it in V1 routing without canonical router/quoter/pool confirmation.

### DogeBox

Status: watchlist only.

Two `DogeBox LP` contracts were inspected:

| LP | Pair read |
| --- | --- |
| `0x5F82455D6b5a6f935F0fdA96A519B8c1b82aE3a2` | Unknown token / USDT |
| `0x5AE7A8ce36D4288519b7b189632c9E81496EcDa0` | USDT / unknown token, tiny reserves |

No official WDOGE/USDC or WDOGE/USDT DogeBox pair was found in this pass.

## Probe Methods

Selectors and reads used:

| Purpose | Selector / method |
| --- | --- |
| Chain ID | `eth_chainId` |
| Block number | `eth_blockNumber` |
| Contract bytecode | `eth_getCode` |
| ERC-20 metadata | `name()`, `symbol()`, `decimals()` |
| Position NFT factory | `factory()` |
| Algebra pool discovery | `poolByPair(address,address)` |
| Uniswap V3-style pool discovery | `getPool(address,address,uint24)` |
| V2 pair discovery | `getPair(address,address)`, `allPairsLength()` |
| Pool state | `token0()`, `token1()`, `fee()`, `liquidity()`, `slot0()`, `globalState()`, `getReserves()` |
| Position state | `totalSupply()`, `positions(uint256)` over minted position IDs |
| Explorer metadata | Blockscout `/api/v2/addresses/{address}` |

## Architecture Corrections Applied

1. The architecture now treats CLAMM adapters as V1-critical because Barkswap and MuchFi's strongest surfaces are concentrated-liquidity style.
2. MuchFi V2 remains in V1 because it is simple, visible, and useful for price comparison.
3. The V1 solver target is best single executable route across Barkswap, MuchFi V2, MuchFi V3, and owned CLAMM.
4. One-hop and split routing are staged later, after execution, adapter health, and quote-vs-fill telemetry are reliable.
5. SuchSwap and DogeBox remain watchlist-only until DogeOS or the DEX teams confirm canonical routing surfaces.

## Standards Cross-Check

The repository plan now aligns with the standards shown by top aggregators:

| Standard | Repository implication |
| --- | --- |
| Uniswap V3 concentrated liquidity uses custom price ranges, ticks, and fee tiers. | Owned DEX should be CLAMM-first, with LP range/fee guidance in the UX. |
| Uniswap V3 core is mature but license-sensitive. | Do not copy code blindly; select a clean licensed/auditable implementation path. |
| 0x and Kyber separate quote, route scoring, fee logic, and transaction build. | Keep Quote API, Route Solver, Fee Estimator, and Router Contract separate. |
| ParaSwap DexLib requires state sync, pricing replication, calldata encoding, and E2E simulation per DEX. | Every DogeOS DEX adapter needs deterministic math tests and fork/testnet execution tests before routing real users. |
| OpenOcean and Velora expose broad source coverage, multi-hop/split routing, and non-custodial execution. | DogeOS should stage complexity: best single route first, then one-hop, then selective split. |

## Open Questions For DogeOS / DEX Teams

| Question | Owner |
| --- | --- |
| Are Barkswap and MuchFi the two canonical V1 DEXes aggregators should prioritize? | DogeOS ecosystem |
| Which Barkswap factory is current, and what are canonical router/quoter addresses? | Barkswap / DogeOS |
| Is Barkswap Algebra Integral, an Algebra fork, or custom CLAMM? | Barkswap engineering |
| What are canonical MuchFi V2 and V3 router/quoter addresses? | MuchFi engineering |
| Should aggregators use both MuchFi V2 and MuchFi V3 liquidity? | MuchFi engineering |
| Which MuchFi CLMM fee tiers should be scanned by default? | MuchFi engineering |
| Should SuchSwap or DogeBox be considered supported DEXes, or only test/watchlist deployments? | DogeOS ecosystem |
| Can Barkswap and MuchFi contracts be verified on Blockscout before public execution? | DEX teams |

## Source Links

- DogeOS SDK docs: https://docs.dogeos.com/en/sdk
- DogeOS faucet: https://faucet.testnet.dogeos.com
- DogeOS Blockscout: https://blockscout.testnet.dogeos.com
- Uniswap concentrated liquidity docs: https://developers.uniswap.org/docs/get-started/concepts/liquidity-providers/concentrated-liquidity
- Uniswap V3 core repository: https://github.com/Uniswap/v3-core
- 0x monetization docs: https://docs.0x.org/docs/0x-swap-api/guides/monetize-your-app-using-swap
- 1inch deprecated open-source aggregation protocol: https://github.com/1inch/1inchProtocol
- KyberSwap Aggregator docs: https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator
- Velora aggregation protocol docs: https://docs.velora.xyz/intro-to-velora/velora-overview/aggregation-protocol
- ParaSwap DexLib repository: https://github.com/VeloraDEX/paraswap-dex-lib
- OpenOcean docs: https://docs.openocean.finance/
