# DogeOS Testnet Liquidity Discovery

Research date: 2026-05-01

Latest validation update: 2026-05-04, block `4668058`

This document records the current DogeOS Chikyū Testnet DEX and liquidity discovery work for the aggregator. It is intentionally evidence-driven: each finding is labeled as verified, inferred, or unconfirmed so we do not build on assumptions.

## Goal

Find the credible same-chain swap venues already deployed on DogeOS testnet, identify which contracts we can quote and execute against, and define the next integration path for a DogeOS-native DEX aggregator.

V1 scope remains same-chain spot swaps only. Perps, cross-chain, bridge, yield, and RFQ systems are tracked only when they affect spot liquidity or ecosystem routing.

## Sources Used

| Source | Use |
| --- | --- |
| DogeOS docs | Chain config, EVM compatibility, wallet SDK, fee model, finality/reorg behavior. |
| DogeOS Chikyū RPC | `eth_chainId`, bytecode checks, ERC-20 metadata calls, pool/factory calls. |
| Blockscout REST API | Token discovery, verified contracts, contract names, transactions, deployer activity. |
| Blockscout UI/search | Search for router, factory, pool, pair, swap, quoter, Barkswap, MuchFi, Derps, launchpad, and Uniswap-like contracts. |
| Public web search | Cross-check whether public DogeOS docs or announcements list DEX deployments. |
| DogeOS ecosystem-team provided reference | Testnet RPCs, explorers, faucet tokens, SDK links, and MuchFi sample route. |

Primary chain reference: [dogeos-chikyu-testnet.md](./dogeos-chikyu-testnet.md)

Architecture reference: [dogeos-dex-aggregator-architecture.md](./dogeos-dex-aggregator-architecture.md)

Corrected DEX map: [dogeos-testnet-dex-map.md](./dogeos-testnet-dex-map.md)

## DogeOS Facts That Matter For DEX Discovery

| Fact | Evidence | Aggregator impact |
| --- | --- | --- |
| Chain ID is `6281971` / `0x5fdaf3`. | DogeOS docs and RPC. | All route tooling, SDK config, contract registries, and indexers must key by this chain ID. |
| Native token is DOGE with 18 decimals on DogeOS. | DogeOS docs and official SDK examples. | Do not reuse Ethereum-native ETH labels or Dogecoin L1 8-decimal assumptions in swap UX. |
| Official SDK supports EVM wallet connection, social login, embedded login, browser wallets, WalletConnect, EVM provider calls, and chain switching. | DogeOS SDK docs. | Frontend should use the official DogeOS SDK as the primary wallet surface. |
| Fees are execution fee plus Data and Finality fee, denominated in DOGE. | DogeOS transaction fee docs. | Quote ranking must include calldata-size-aware fee estimates, not only `gas * gasPrice`. |
| `L1GasPriceOracle` exists at `0x5300000000000000000000000000000000000002`. | DogeOS docs and bytecode check. | Route scorer should estimate data/finality fee for every executable transaction. |
| Maximum reorg depth is documented as 17 blocks. | DogeOS docs. | Indexer analytics and pool state snapshots need rollback/finality handling. |
| Official faucet tokens report 18 decimals. | RPC `decimals()` calls. | Token registry should read decimals on-chain; do not assume USDC/USDT have 6 decimals. |

## Executive Findings

1. No canonical public DEX deployment list was found in the official DogeOS docs during this pass.

2. The two strongest current spot-liquidity candidates are Barkswap/BarkSwap and MuchFi.

3. Barkswap-like position NFTs and factories expose real pools for official faucet token pairs, including USDT/WDOGE and USDC/WDOGE. Its contracts look Algebra-style rather than vanilla Uniswap V3.

4. MuchFi is also visible on-chain. It has a V3 position NFT, a V3 factory with USDC/WDOGE and USDT/WDOGE pools, V2-style LP tokens for the same pairs, and a candidate V3 router call using `exactInputSingle`.

5. The likely Barkswap and MuchFi contracts are mostly unverified. We can discover factories and pools through RPC, but we should not ship execution until router/quoter contracts and ABIs are confirmed or verified.

6. Verified Vyper `router`, `pool`, `oracle`, and `lptoken` contracts exist, but their ABI shape suggests a non-standard pool/perps/structured product rather than a simple spot AMM. They should be reviewed with DogeOS/Derps context before inclusion.

7. Three verified `univ2` contracts and one verified `univ2router` exist, but they live under `contracts/mock/`, include caller-gated swap behavior, and show no meaningful public routing activity. They are not V1 route candidates.

8. Chainlink CCIP `Router` contracts are deployed and verified, but they are cross-chain messaging infrastructure. They are outside the current same-chain swap scope.

9. Token discovery shows many duplicate, unverified, and low-holder tokens. A curated token registry is required before public routing.

10. Public search surfaced DogenadoCash as a DogeOS testnet privacy protocol supporting the official faucet assets, but it is not a DEX or swap venue. It should not be treated as aggregator liquidity.

## Candidate Liquidity Venues

### 1. Barkswap / BarkSwap Algebra-Style CLAMM

Status: highest-priority spot DEX candidate.

Confidence: medium-high that this is real DogeOS testnet spot liquidity; medium that it is Barkswap; low until router/quoter contracts are confirmed and verified.

Evidence:

| Contract | Address | Finding |
| --- | --- | --- |
| Barkswap Positions NFT-V2 | `0xeA672006Ed9ce530e4EFb9D5580f08c1F363873A` | ERC-721 position NFT, total supply seen at 74, unverified. |
| Barkswap Positions NFT-V2 | `0x4Bb4A5CF44028519908D6B4A90C570fEaA8c9a07` | ERC-721 position NFT, total supply seen at 10, unverified. |
| Factory, older deployment | `0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263` | Returned from `factory()` on `0xeA672...`; supports Algebra-style `poolByPair`. |
| Factory, newer deployment | `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | Returned from `factory()` on `0x4Bb4...`; supports Algebra-style `poolByPair`. |
| BarkSwap ERC-20 | `0x17B436E32d30995935491ca033a9eA199A7f56fF` | Token named BarkSwap, symbol BARK, low holder count. Governance/reward token candidate only. |

Algebra-style evidence:

| Check | Result |
| --- | --- |
| `factory()` on positions NFT | Returns factory addresses above. |
| `positions(uint256)` on NFT | Returns token0/token1/tick/liquidity-style position data. |
| `poolByPair(address,address)` on factories | Returns concrete pool addresses. |
| Uniswap V3 `getPool(address,address,uint24)` | Reverted. |
| Uniswap V3 `feeAmountTickSpacing(uint24)` | Reverted. |
| Pool methods | `token0()`, `token1()`, `liquidity()`, `globalState()`, and `fee()` returned data. |

Discovered pools:

| Factory | Pair | Pool | Notes |
| --- | --- | --- | --- |
| `0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263` | USDT/WDOGE | `0x51c53CCFAD18C658f89C54377d3d90Ef8146a464` | Pool has token transfers/logs and callable CLAMM state. |
| `0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263` | USDC/WDOGE | `0xB37D91625b0Da3725989Cc8e3eF1E487f34C91C0` | Pool has token transfers/logs and callable CLAMM state. |
| `0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263` | LAIKA/WDOGE | `0x0000000000000000000000000000000000000000` | No pool in this deployment. |
| `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | USDT/WDOGE | `0x5DC3eB0e452f464e134F854EAeDf9431B93Da624` | Newer deployment; pool has token transfers/logs and callable CLAMM state. |
| `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | USDC/WDOGE | `0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1` | Newer deployment; pool has token transfers/logs and callable CLAMM state. |
| `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | LAIKA/WDOGE | `0xd8E9B2cFBeF0EEeF0Ba409BdB81661BDCBEBbaF1` | Non-faucet token pair; useful for adapter validation, not default token list. |

Observed positions in the newer position NFT include USDT/WDOGE, USDC/WDOGE, and LAIKA/WDOGE liquidity. This is enough to justify building a read-only Algebra-style discovery adapter first.

### Barkswap Deep Dive Update

Additional RPC enumeration against the official faucet token list found only two official-asset pools in each Barkswap-style factory:

| Factory | Official faucet-token pools found | Official faucet-token pools not found |
| --- | --- | --- |
| `0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263` | WDOGE/USDC, WDOGE/USDT | WDOGE/LBTC, WDOGE/WETH, WDOGE/USD1, USDC/USDT, USDC/USD1, USDC/WETH, USDC/LBTC, USDT/USD1, USDT/WETH, USDT/LBTC, USD1/WETH, USD1/LBTC, WETH/LBTC |
| `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | WDOGE/USDC, WDOGE/USDT | WDOGE/LBTC, WDOGE/WETH, WDOGE/USD1, USDC/USDT, USDC/USD1, USDC/WETH, USDC/LBTC, USDT/USD1, USDT/WETH, USDT/LBTC, USD1/WETH, USD1/LBTC, WETH/LBTC |

Position summary:

| Position manager | Official-pair positions | Other observed positions |
| --- | --- | --- |
| `0x4Bb4A5CF44028519908D6B4A90C570fEaA8c9a07` | USDT/WDOGE: 6 positions; USDC/WDOGE: 3 positions | LAIKA/WDOGE: 1 position |
| `0xeA672006Ed9ce530e4EFb9D5580f08c1F363873A` | USDT/WDOGE: 5 positions; USDC/WDOGE: 3 positions | Many one-off WDOGE/token positions, mostly unverified or unknown tokens |

Factory ownership:

| Factory | `owner()` result | Interpretation |
| --- | --- | --- |
| `0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263` | `0xFB1525e16FDA109a5180a3Ec23A7146b870E045b` | Older deployment owner/deployer candidate. |
| `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | `0xF731469f6210ECc5D4Bde8DABd69109D3ab8634d` | Newer deployment owner/deployer candidate. |

Current Barkswap integration conclusion:

1. We can confidently build read-only pool discovery for WDOGE/USDC and WDOGE/USDT.
2. We cannot yet claim executable aggregator support because router and quoter contracts are not identified.
3. LBTC, WETH, and USD1 are official DogeOS faucet tokens, but no Barkswap-style pools were found for them in either factory during this pass.
4. The older position manager contains many WDOGE/random-token pools. These should remain hidden behind token warnings until each token is verified.
5. The likely Barkswap reward/gauge proxy at `0x772F5dF6EAD1c421c9A779812c4e173AD6342E9d` decoded to methods such as `distributeAll()`, `createGauge(address,uint256)`, `whitelist(address[])`, and `vote(uint256,address[],uint256[])`. This makes it more likely to be gauge/voting/reward infrastructure than a swap router.

Open questions before execution:

| Question | Why it matters |
| --- | --- |
| Which deployment is canonical: `0x88f730...` or `0x099F459...`? | We should not route across abandoned test deployments unless explicitly useful. |
| What are the official swap router and quoter addresses? | Pool discovery is not enough; execution needs a trusted periphery path. |
| Are contracts intended to be verified on Blockscout? | Verification lowers integration risk and makes review easier for DogeOS engineering. |
| Is the implementation Algebra Integral, a fork, or custom? | Quote math, fee model, tick spacing, and callback assumptions depend on this. |
| Does Barkswap expect native DOGE wrapping/unwrapping in router flows? | The aggregator must handle native DOGE and WDOGE correctly. |

### 1b. MuchFi

Status: second high-priority spot DEX candidate.

Confidence: medium-high that MuchFi has real testnet spot liquidity; low until router/quoter contracts and ABIs are confirmed or verified.

This venue was surfaced after ecosystem input named MuchFi as one of the main DogeOS DEXes. A follow-up Blockscout and RPC pass found MuchFi contracts on-chain.

Evidence:

| Contract | Address | Finding |
| --- | --- | --- |
| MuchFi V3 Positions NFT-V1 | `0x7932C91f3BAD326ecd6C2bE81697D732714B9eC5` | ERC-721 position NFT, total supply seen at 8 on 2026-05-04, unverified. |
| MuchFi V3 factory | `0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B` | Returned by `factory()` on the MuchFi V3 position NFT; supports Uniswap V3-style `getPool(address,address,uint24)`. |
| MuchFi V3 pool deployer | `0x6c04e808d5FfFb597cb6a5b539f2a1dDF3529348` | Returned by `poolDeployer()` on the MuchFi V3 factory. |
| MuchFi V2-style factory | `0x7864071B532894216e3C045a74814EafEB92ae20` | `allPairsLength()` returned 2; `getPair(address,address)` returns MuchFi LP tokens. |
| MuchFi LP | `0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4` | V2-style ERC-20 LP for USDC/WDOGE; `token0()`, `token1()`, and `getReserves()` work. |
| MuchFi LP | `0x1498200A5D49081D8E55250aFeb13aAf3c1d9AE4` | V2-style ERC-20 LP for USDT/WDOGE; `token0()`, `token1()`, and `getReserves()` work. |
| Candidate V3 router | `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB` | Unverified contract; deployer transactions include `exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))`. |

V3 pools found through `getPool(address,address,uint24)`:

| Pair | Fee tier | Pool |
| --- | --- | --- |
| WDOGE/USDC | `500` | `0x4F1c638952a23DB25a13167B83810201c4BC7299` |
| WDOGE/USDC | `2500` | `0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC` |
| WDOGE/USDT | `500` | `0x64A2683ae2995E1ca89FECA0c9ffc9056EF0504F` |

V2-style pairs found through `getPair(address,address)`:

| Pair | LP / pair contract | Reserve surface |
| --- | --- | --- |
| WDOGE/USDC | `0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4` | `getReserves()` returns non-zero reserves. |
| WDOGE/USDT | `0x1498200A5D49081D8E55250aFeb13aAf3c1d9AE4` | `getReserves()` returns non-zero reserves. |

Position summary:

| Position manager | Official-pair positions |
| --- | --- |
| `0x7932C91f3BAD326ecd6C2bE81697D732714B9eC5` | USDC/WDOGE: 7 positions; USDT/WDOGE: 1 position |

Current MuchFi integration conclusion:

1. MuchFi should be tracked as a real second DEX candidate, not merely an upcoming venue.
2. MuchFi appears to have both V3-style concentrated-liquidity pools and V2-style LP/pair contracts on testnet.
3. Like Barkswap, MuchFi currently appears to cover only WDOGE/USDC and WDOGE/USDT among the official faucet-token set.
4. The router/quoter/periphery map still needs confirmation because contracts are unverified.
5. The likely V3 router candidate is `0x54f7...`, but this must be confirmed before execution support.

### 2. Unverified Proxy Periphery Candidate

Status: investigation lead only.

Confidence: low.

Address: `0x772F5dF6EAD1c421c9A779812c4e173AD6342E9d`

Findings:

| Field | Value |
| --- | --- |
| Proxy type | EIP-1967 |
| Implementation | `0x9cb7F8Fd1026813C260635a1A25abA64C9Dc9AeD` |
| Creator | `0xF731469f6210ECc5D4Bde8DABd69109D3ab8634d` |
| Verification | Unverified |
| Activity | Repeated calls around Barkswap pool creation/activity windows. |

Why it matters:

The same deployer involved in newer Barkswap-like contracts interacts with this proxy. Some transactions pass discovered pool addresses as calldata. It could be periphery, manager, reward, launchpad, or unrelated automation. We should not assume it is a router until ABI/source is known.

Required next step:

Ask the DEX team or DogeOS ecosystem lead whether `0x772F...` belongs to Barkswap and whether it has any swap/quote role.

### 3. Verified Vyper Router/Pool Suite

Status: non-standard product candidate; not V1 spot swap integration until classified.

Confidence: medium that these contracts are related to a pool/perps-style protocol; low that they are a spot AMM route source.

| Contract name | Address | ABI/surface notes |
| --- | --- | --- |
| `router` | `0x8c56AD2A022917D5Be52Bb2859bbaE8eCAD53f1a` | Vyper periphery router with `WDOGE`, `mint`, `burn`, `open`, `close`, `calc_mint`, `calc_burn`, `amts_out`. |
| `router` | `0xd042E02aD7076464319c982A068A227418bdBe79` | Smaller Vyper router with `mint`, `calc_mint`, `amts_out`. |
| `pool` | `0x11AB4f5b290810C92995F59C714Ac5b30bDcFF17` | Vyper pool with initialization around base token, quote token, LP token, fees, accounting. |
| `lptoken` | `0x2ECDb09e7fC3A3ca299e9eeb4E569a0DD4F2cAD1` | Vyper LP token. |
| `oracle` | `0x0dC30e2709bC5882ffe63141E362319b1ce283bb` | Vyper oracle with high transaction count. |

This may connect to the Derps perp/trading ecosystem. DogeOS has a public blog post announcing Derps as a native DOGE perpetual DEX on DogeOS, with oracle-powered leverage trading and testnet plans. That makes these contracts important for ecosystem awareness, but they should not be treated as a spot DEX until swap semantics are proven.

Questions to ask:

| Question | Why it matters |
| --- | --- |
| Are these Derps contracts? | Determines whether they belong in spot aggregation or a future perp/trading module. |
| Does `open`/`close` represent leveraged positions rather than swaps? | Spot aggregator should not route user swaps through position open/close flows. |
| Can `amts_out` be safely used as a quote primitive? | It may quote mint/burn/position accounting, not spot swaps. |
| Are there pair-level pools beyond the discovered address set? | Needed before adding a venue adapter. |

### 4. Verified `univ2` Mock Contracts

Status: exclude from V1 routing.

Confidence: high that these are fixtures, not real venues.

| Contract | Address | Reason to exclude |
| --- | --- | --- |
| `univ2` | `0x04d031B63f0B6AFEe69e06564792222742BE9F03` | Verified Vyper mock at `contracts/mock/univ2.vy`; `swap` is caller-gated "for testnet"; transaction count was zero in discovery. |
| `univ2` | `0x37be67906AF2F98B6d74284e47E423ae67FF8E2B` | Same mock pattern; no evidence of public liquidity. |
| `univ2` | `0x77220D57A7E9FA55feeA4A603b72686C1Bd7Cdad` | Same mock pattern; token0/token1 are WDOGE/USDT, but source path is `contracts/mock/univ2.vy`. |
| `univ2router` | `0x8569713F2C396d6F57775A37BF14d0ce529328FB` | Verified Vyper mock at `contracts/mock/univ2router.vy`; can return a simple quote but has zero transaction count and should not be treated as production liquidity. |

These can be useful for adapter tests, but not as production route sources.

### 4a. DogenadoCash

Status: not a DEX.

Confidence: high.

Public docs state DogenadoCash is live on DogeOS testnet and supports privacy pools for USDC, USDT, USD1, WDOGE, WETH, and LBTC. That aligns with the official faucet-token set, but its product is shielded deposits/withdrawals, not token swaps. It should not be included in the same-chain DEX aggregator route graph.

### 5. Chainlink CCIP Routers

Status: out of V1 scope.

Confidence: high.

Search for router contracts returned verified Chainlink CCIP-style routers with methods such as `ccipSend`, `getFee`, and `getSupportedTokens`. These are cross-chain messaging contracts, not same-chain DEX routers.

Keep them out of the spot aggregator until cross-chain routing becomes an explicit product line.

## Token Discovery

Official faucet tokens remain the only safe default list:

| Symbol | Address | Notes |
| --- | --- | --- |
| WDOGE | `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE` | Wrapped Doge; 18 decimals. |
| LBTC | `0x29789F5A3e4c3113e7165c33A7E3bc592CF6fE0E` | Lombard Staked BTC; 18 decimals. |
| WETH | `0x1a6094Ac3ca3Fc9F1B4777941a5f4AAc16A72000` | Wrapped Ethereum; 18 decimals. |
| USD1 | `0x25D5E5375e01Ed39Dc856bDCA5040417fD45eA3F` | World Liberty Financial USD; 18 decimals. |
| USDC | `0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925` | USD Coin; 18 decimals on DogeOS testnet. |
| USDT | `0xC81800b77D91391Ef03d7868cB81204E753093a9` | Tether; 18 decimals on DogeOS testnet. |

Other tokens seen during discovery:

| Symbol/name | Address | Default status |
| --- | --- | --- |
| WBTC | `0xa77C1A9ad5158Ebf4a049bFeA0D592CbE0de9B11` | Watchlist only until source/issuer is confirmed. |
| BarkSwap / BARK | `0x17B436E32d30995935491ca033a9eA199A7f56fF` | Watchlist only; likely DEX token, low holders. |
| LAIKA | `0xB1E9DF0F5F992CB64A504F12B6e49C1f295E2C4C` | Watchlist only; pool exists in newer Barkswap-like factory. |
| testDOGE | `0xe34558d441E4045FA039dDA542337967af987C1e` | Exclude from default list unless confirmed by DogeOS. |
| testUSD | `0x301Ec0ab703D1f4Aa77213bB532aaA69779d1315` | Exclude from default list unless confirmed by DogeOS. |
| Duplicate Zex/Bark/other low-holder tokens | Various | Exclude by default; require manual review. |

Token policy:

1. Default token picker uses official faucet tokens only.
2. Non-default tokens require an explicit warning state until verified.
3. Routing can support a token before default listing, but the API must flag it as unverified.
4. Token decimals, symbol, name, and bytecode must be read on-chain and cached with provenance.
5. Token lists should include explorer links and the source of trust.

## What DogeOS Leadership May Challenge

### Ecosystem Lead Questions

| Challenge | Our answer |
| --- | --- |
| Are you covering every DEX, or just the first one you found? | Discovery found Barkswap and MuchFi as the strongest spot candidates; the adapter model is designed to add every credible venue once contracts are confirmed. |
| Are you picking winners? | No. Routes are scored by executable net output and risk filters. Venue inclusion/exclusion is documented. |
| Will launchpads be supported? | Yes, if launchpad liquidity exposes swap, bonding curve, or migration contracts with safe quote and execution surfaces. |
| How do you prevent bad tokens from appearing beside official assets? | Curated defaults, unverified flags, liquidity thresholds, holder/activity checks, and DogeOS source provenance. |
| How does this show off DogeOS? | DOGE-native fees, DogeOS SDK onboarding, Dogecoin/DogeOS asset clarity, fast route refresh, Blockscout links, and finality-aware status. |

### Engineering Lead Questions

| Challenge | Required response |
| --- | --- |
| Why are you calling this Algebra-style? | Because `poolByPair` works, Uniswap V3 `getPool`/`feeAmountTickSpacing` revert, NFT positions expose CLAMM-like position state, and pools expose `globalState`, `liquidity`, `fee`, `token0`, `token1`. |
| Can you execute swaps safely yet? | Not yet. We need verified or confirmed router/quoter contracts and ABIs before execution. |
| Are you relying on Blockscout names? | No. Names guide discovery only; RPC calls and contract behavior drive classification. |
| How will you handle DogeOS fee differences? | Route scoring includes execution fee plus `L1GasPriceOracle` data/finality estimates. |
| What about reorgs? | Indexer buffers and analytics respect the documented 17-block reorg window. |
| How do you avoid arbitrary calldata risk? | Typed adapters, allowlisted routers, on-chain min-out/deadline, and no user-supplied arbitrary calls in V1. |

## Recommended V1 Discovery Architecture

```text
                          DogeOS Official Inputs
          docs, SDK, faucet tokens, RPC, Blockscout, L2scan once confirmed
                                      |
                                      v
                      +-------------------------------+
                      | Chain Registry / Source Cache |
                      | chain, tokens, explorers, SDK |
                      +---------------+---------------+
                                      |
                                      v
              +-----------------------+-----------------------+
              |                                               |
              v                                               v
   +-------------------------+                    +-------------------------+
   | Contract Discovery Jobs |                    | Manual Partner Intake   |
   | Blockscout + RPC probes |                    | DEX/launchpad forms     |
   +------------+------------+                    +------------+------------+
                |                                              |
                v                                              v
       +------------------+                         +----------------------+
       | Candidate Venues |                         | Confirmed Deployments |
       | confidence score |                         | owners, ABIs, docs    |
       +---------+--------+                         +----------+-----------+
                 |                                             |
                 +------------------+--------------------------+
                                    |
                                    v
                       +--------------------------+
                       | Adapter Certification    |
                       | read tests, quote tests, |
                       | execution simulations    |
                       +------------+-------------+
                                    |
                                    v
         +--------------------------+---------------------------+
         | DogeOS Quote Service                                 |
         | pool state, route search, net output scoring, fees   |
         +--------------------------+---------------------------+
                                    |
                                    v
         +--------------------------+---------------------------+
         | Aggregator Router + UI/API                           |
         | allowlisted adapters, min-out, deadlines, SDK wallet |
         +------------------------------------------------------+
```

## Integration Priority

### P0: Read-Only Discovery

1. Create a chain registry with official DogeOS endpoints and faucet tokens.
2. Build a Blockscout/RPC discovery script that records token, factory, pool, router, and quoter candidates.
3. Add an Algebra-style read adapter for:
   - factory `poolByPair(address,address)`
   - pool `token0()`
   - pool `token1()`
   - pool `liquidity()`
   - pool `globalState()`
   - pool `fee()`
4. Store venue confidence, verification status, and source evidence.

### P1: Barkswap And MuchFi Confirmation

1. Ask DogeOS/DEX contacts for canonical Barkswap deployment addresses.
2. Ask DogeOS/DEX contacts for canonical MuchFi deployment addresses.
3. Confirm factory, pool deployer, router, quoter, position manager, and wrapped native token handling for both venues.
4. Ask for verified contracts or source ABIs.
5. Run quote-vs-pool-state checks against USDT/WDOGE and USDC/WDOGE.

### P2: Quote Engine

1. Implement Algebra-style CLAMM quoting after ABI/source confirmation.
2. Score routes by gross output, price impact, gas, DogeOS data/finality fee, and reliability.
3. Add direct and two-hop routes through WDOGE.
4. Return route transparency: venue, pools, fee, estimated gas, data/finality fee, and confidence.

### P3: Execution

1. Add only verified/confirmed routers to the on-chain allowlist.
2. Enforce min-out, deadline, recipient, and adapter allowlist in the aggregator router.
3. Simulate every route before presenting it.
4. Use DogeOS SDK for transaction submission and chain switching.
5. Link every transaction and route component to Blockscout.

### P4: Ecosystem Expansion

1. Add launchpad/bonding curve adapters after contracts are confirmed.
2. Add non-default tokens with warnings and partner provenance.
3. Revisit Derps/perp-style contracts only if they expose relevant spot liquidity or settlement swaps.
4. Publish integration docs so DogeOS DEXes can self-submit adapter metadata.

## Immediate Questions For DogeOS / DEX Teams

| Question | Owner |
| --- | --- |
| What is the canonical list of deployed DogeOS testnet DEXes and launchpads? | DogeOS ecosystem |
| Are Barkswap contracts official or community/test deployments? | DogeOS ecosystem / Barkswap |
| Which Barkswap factory should we treat as current? | Barkswap |
| What are the Barkswap router and quoter addresses? | Barkswap |
| Are Barkswap contracts Algebra Integral, a fork, or custom? | Barkswap engineering |
| Can contracts be verified on Blockscout? | Barkswap engineering |
| Are LBTC, WETH, and USD1 expected to have Barkswap pools soon, or are they covered by another DEX? | DogeOS ecosystem / Barkswap |
| Is there a canonical Barkswap subgraph/API/indexer, or should we index pools directly from logs and RPC? | Barkswap engineering |
| Is `0x772F5dF6EAD1c421c9A779812c4e173AD6342E9d` Barkswap gauge/reward infrastructure, and should aggregators ignore it for swaps? | Barkswap engineering |
| What are the canonical MuchFi V2 and V3 factory/router/quoter/position-manager addresses? | MuchFi engineering |
| Is MuchFi using vanilla Uniswap V2/V3 contracts, forks, or custom contracts? | MuchFi engineering |
| Is `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB` the MuchFi V3 swap router? | MuchFi engineering |
| Does MuchFi intend aggregators to use both V2-style and V3-style liquidity, or only one surface? | MuchFi engineering |
| Can MuchFi contracts be verified on Blockscout? | MuchFi engineering |
| Are the Vyper router/pool/oracle contracts associated with Derps? | DogeOS / Derps |
| Are any launchpads live with bonding curve or migration contracts? | DogeOS ecosystem |
| Is there an official token list endpoint planned? | DogeOS ecosystem |

## Current Recommendation

Build the first aggregator workstream around DogeOS-native discovery plus Barkswap and MuchFi read adapters only. Keep SuchSwap, DogeBox, and other DEX-like surfaces on a watchlist, but do not put them in V1 routing unless the DogeOS team explicitly confirms they should be supported. Do not ship execution until the router/quoter/periphery contracts are confirmed.

This path uses what DogeOS already provides: official RPC, Blockscout, faucet tokens, DogeOS SDK, DOGE-native fee semantics, and documented finality behavior. It also gives DogeOS leadership a clear, thoughtful answer: we are not blindly forking 1inch; we are building the routing layer around the actual chain, actual deployed liquidity, and the parts of DogeOS that generic EVM aggregators will miss.
