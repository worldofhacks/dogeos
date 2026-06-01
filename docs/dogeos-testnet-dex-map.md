# DogeOS Testnet DEX Map

Research date: 2026-05-01

Latest validation update: 2026-06-01, official-token liquidity discovery on DogeOS RPC

This is the current source-of-truth map for DogeOS Chikyū Testnet swap venues visible from the official RPC and Blockscout.

V1 aggregator scope is Barkswap and MuchFi only. Other DEX-like surfaces are tracked as watchlist items until the DogeOS team or the venue teams confirm that aggregators should route through them.

## Methodology Correction

The first pass over-weighted verified contracts and obvious router/factory names. That missed MuchFi because its visible public footprint is mostly unverified token/NFT names:

- `MuchFi V3 Positions NFT-V1`
- `MuchFi LPs`

The corrected discovery process now scans:

1. Official DogeOS docs and faucet token list.
2. Blockscout verified contracts.
3. Blockscout ERC-20, ERC-721, and ERC-1155 token names.
4. DEX-ish names: `swap`, `dex`, `lp`, `pair`, `pool`, `position`, `v2`, `v3`, `uniswap`, `algebra`, `bark`, `much`, `munch`, `such`, `aero`, `velo`, `sushi`, `curve`, `balancer`, `launch`, `bond`.
5. RPC probes against candidate contracts:
   - ERC-20/721 metadata and total supply.
   - V2-style `factory()`, `token0()`, `token1()`, `getReserves()`.
   - V2 factory `allPairsLength()`, `getPair(address,address)`.
   - V3-style `factory()`, `positions(uint256)`, `getPool(address,address,uint24)`.
   - Algebra-style `poolByPair(address,address)`, `globalState()`, `liquidity()`, `fee()`.

## Official Asset Coverage

Official faucet tokens:

| Symbol | Address |
| --- | --- |
| WDOGE | `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE` |
| LBTC | `0x29789F5A3e4c3113e7165c33A7E3bc592CF6fE0E` |
| WETH | `0x1a6094Ac3ca3Fc9F1B4777941a5f4AAc16A72000` |
| USD1 | `0x25D5E5375e01Ed39Dc856bDCA5040417fD45eA3F` |
| USDC | `0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925` |
| USDT | `0xC81800b77D91391Ef03d7868cB81204E753093a9` |

Current DEX-visible official pairs:

| Venue | WDOGE/USDC | WDOGE/USDT | Other official pairs |
| --- | --- | --- | --- |
| Barkswap | Yes | Yes | None found |
| MuchFi V3 | Yes | Yes | None found |
| MuchFi V2-style | Yes | Yes | None found |
| SuchSwap | Pool found | None found | Watchlist only; no confirmed router/quoter |
| DogeBox | No official pair found | No official pair found | Watchlist only |

## Venue Map

```text
DogeOS Chikyū Testnet
|
+-- Barkswap / BarkSwap
|   |
|   +-- Algebra-style CLAMM candidate
|   +-- Official pairs: WDOGE/USDC, WDOGE/USDT
|   +-- Status: active V1 execution source through pinned Algebra router/quoter
|
+-- MuchFi
|   |
|   +-- V3-style CLAMM candidate
|   |   +-- Official pairs: WDOGE/USDC, WDOGE/USDT
|   |
|   +-- V2-style constant-product candidate
|       +-- Official pairs: WDOGE/USDC, WDOGE/USDT
|   +-- Status: active V1 execution source through pinned V2/V3 routers and V3 quoter
|
+-- SuchSwap
|   |
|   +-- V3-style position NFT candidate
|   +-- Official pair position: USDC/WDOGE
|   +-- Status: watchlist only
|
+-- DogeBox
|   |
|   +-- V2-style LP tokens with non-official pairs
|   +-- Status: watchlist only
|
+-- Excluded / not spot DEX
    |
    +-- mock univ2/univ2router contracts
    +-- Derps/perps-style Vyper pool/router suite
    +-- DogenadoCash privacy pools
    +-- Chainlink CCIP / bridge routers
    +-- Tulpea/Backstop lending-style contracts
```

## Barkswap

Status: V1 integration target.

Implementation read: Algebra-style concentrated liquidity, not vanilla Uniswap V3.

Why:

- Position NFTs expose CLAMM-like position state.
- Factories support `poolByPair(address,address)`.
- Pools expose `token0()`, `token1()`, `liquidity()`, `globalState()`, and `fee()`.
- Vanilla Uniswap V3 `getPool(address,address,uint24)` and `feeAmountTickSpacing(uint24)` reverted in prior probes.

Contracts:

| Role | Address | Notes |
| --- | --- | --- |
| Older position manager | `0xeA672006Ed9ce530e4EFb9D5580f08c1F363873A` | `Barkswap Positions NFT-V2`, 74 total supply seen on 2026-05-04. |
| Older factory | `0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263` | Returned by older position manager `factory()`. |
| Newer position manager | `0x4Bb4A5CF44028519908D6B4A90C570fEaA8c9a07` | `Barkswap Positions NFT-V2`, 10 total supply seen on 2026-05-04. |
| Newer factory | `0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457` | Returned by newer position manager `factory()`. |
| Newer pool deployer | `0xeb4E9b84990C7c07D5205D35647A29de1B33dE7e` | Returned by Barkswap router/quoter `poolDeployer()`. |
| Newer Algebra router | `0x77147f436cE9739D2A54Ffe428DBe02b90c0205e` | Exposes `exactInputSingle((address,address,address,address,uint256,uint256,uint256,uint160))`; active through typed calldata plus runtime swap simulation. |
| Newer Algebra quoter | `0xcEF56157baaB2Fe9D16ccF0eB4a9Df354380257D` | `quoteExactInputSingle((address,address,address,uint256,uint160))` returns live official-token quotes with zero deployer sentinel. |
| Gauge/reward candidate | `0x772F5dF6EAD1c421c9A779812c4e173AD6342E9d` | Methods decode to voting/gauge/distribution style, not swap router. |

Official pools:

| Deployment | Pair | Pool |
| --- | --- | --- |
| Older | WDOGE/USDC | `0xB37D91625b0Da3725989Cc8e3eF1E487f34C91C0` |
| Older | WDOGE/USDT | `0x51c53CCFAD18C658f89C54377d3d90Ef8146a464` |
| Newer | WDOGE/USDC | `0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1` |
| Newer | WDOGE/USDT | `0x5DC3eB0e452f464e134F854EAeDf9431B93Da624` |

Position summary:

| Position manager | Pair | Count |
| --- | --- | --- |
| `0x4Bb4...` | USDT/WDOGE | 6 |
| `0x4Bb4...` | USDC/WDOGE | 3 |
| `0x4Bb4...` | LAIKA/WDOGE | 1 |
| `0xeA672...` | USDT/WDOGE | 5 |
| `0xeA672...` | USDC/WDOGE | 3 |
| `0xeA672...` | Many random token/WDOGE positions | Many |

Still missing:

- Blockscout verified source or venue-published ABI artifact.
- Confirmation that older deployment should remain excluded from routing.

## MuchFi

Status: V1 integration target.

Implementation read: both V3-style concentrated liquidity and V2-style pair liquidity appear to exist.

App reference:

`https://testnet.muchfi.xyz/trade?inputCurrency=0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925&outputCurrency=DOGE&feeTier=2500&marketType=clmm`

This route confirms MuchFi's UI treats the USDC to native DOGE trade as a CLMM market with fee tier `2500`. On-chain, native DOGE maps to the WDOGE pool side for CLMM routing.

Contracts:

| Role | Address | Notes |
| --- | --- | --- |
| V3 position manager | `0x7932C91f3BAD326ecd6C2bE81697D732714B9eC5` | `MuchFi V3 Positions NFT-V1`, total supply seen at 8 on 2026-05-04. |
| V3 factory | `0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B` | Returned by V3 position manager `factory()`. |
| V3 pool deployer | `0x6c04e808d5FfFb597cb6a5b539f2a1dDF3529348` | Returned by V3 factory `poolDeployer()`. |
| V3 router | `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB` | Exposes `exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))`, `factory()`, and `WETH9()`; active through typed calldata plus runtime swap simulation. |
| V3 quoter | `0x5DE1Ea595653419f295511DEb781b98387a77cc2` | QuoterV2-style `quoteExactInputSingle((address,address,uint256,uint24,uint160))`; live quotes verified against official-token pools. |
| V2-style factory | `0x7864071B532894216e3C045a74814EafEB92ae20` | `allPairsLength()` returned 2. |
| V2-style router | `0xC653e745FC613a03D156DACB924AE8e9148B18dc` | `factory()` returns MuchFi V2 factory and `WETH()` returns WDOGE; active through typed calldata plus runtime swap simulation. |
| V2-style USDC/WDOGE pair | `0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4` | `MuchFi LPs`, `getReserves()` works. |
| V2-style USDT/WDOGE pair | `0x1498200A5D49081D8E55250aFeb13aAf3c1d9AE4` | `MuchFi LPs`, `getReserves()` works. |

V3 pools:

| Pair | Fee tier probed | Pool |
| --- | --- | --- |
| WDOGE/USDC | `500` | `0x4F1c638952a23DB25a13167B83810201c4BC7299` |
| WDOGE/USDC | `2500` | `0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC` |
| WDOGE/USDT | `500` | `0x64A2683ae2995E1ca89FECA0c9ffc9056EF0504F` |

Fee-tier probe results:

| Pair | Existing fee tiers found | Missing fee tiers checked |
| --- | --- | --- |
| WDOGE/USDC | `500`, `2500` | `100`, `3000`, `10000` |
| WDOGE/USDT | `500` | `100`, `2500`, `3000`, `10000` |

V2-style pairs:

| Pair | Pair / LP contract |
| --- | --- |
| WDOGE/USDC | `0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4` |
| WDOGE/USDT | `0x1498200A5D49081D8E55250aFeb13aAf3c1d9AE4` |

Position summary:

| Position manager | Pair | Count |
| --- | --- | --- |
| `0x7932...` | USDC/WDOGE | 7 |
| `0x7932...` | USDT/WDOGE | 1 |

Still missing for strict audit provenance:

- Blockscout verified source or venue-published ABI artifact.
- Confirmation which MuchFi CLMM fee tiers should be considered canonical for routing.

Live quote smoke on 2026-05-31 for `1 USDC -> WDOGE` returned active executable route candidates from MuchFi V2, MuchFi V3, and Barkswap Algebra. `/swap` still runs sender-aware simulation, gas estimation, data/finality fee resolution, and balance preflight before returning a transaction for wallet signing.

## SuchSwap

Status: watchlist only.

Implementation read: V3-style position NFT candidate with visible positions, but factory/pool routing surface is not yet clear.

Contracts:

| Role | Address | Notes |
| --- | --- | --- |
| Position manager | `0xC0BAc1a8EbFA10E92f2b59638d314673FadD031e` | `SuchSwap Positions NFT`, unverified, holders seen at 3. |
| Factory candidate | `0x924163a558915bf685ed21809a8b8b372a79ed37` | Returned by position manager `factory()`. |

Official pool candidates from the 2026-06-01 factory scan:

| Pair | Fee tier | Pool | Liquidity state |
| --- | --- | --- | --- |
| WDOGE/USDC | `3000` | `0x1289ED890E1F58376045FdA9430100bFAD69A44b` | `slot0()` and non-zero `liquidity()` returned. |
| WDOGE/USDC | `10000` | `0xC940Fe1F7396517Cd67fC501597e3fF3C97E5850` | `slot0()` returned, but `liquidity()` is zero. |

Position summary:

| Pair | Count | Notes |
| --- | --- | --- |
| USDC/WDOGE | 1 | Only official-token pair found in sampled positions. |
| Random token/WDOGE | Many | Mostly unverified tokens. |

Observed mint method:

`0x88316456` decodes to `mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))`, consistent with Uniswap V3-style NFT minting.

Missing:

- Confirmed router.
- Confirmed quoter.
- Confirmation that SuchSwap is an active/current venue rather than a test deployment.

## DogeBox

Status: watchlist only; not a V1 integration target.

Contracts:

| Contract | Finding |
| --- | --- |
| `0x5F82455D6b5a6f935F0fdA96A519B8c1b82aE3a2` | `DogeBox LP`; V2-style `token0()`, `token1()`, and `getReserves()` work. Pair is unknown token / USDT. |
| `0x5AE7A8ce36D4288519b7b189632c9E81496EcDa0` | `DogeBox LP`; V2-style reserve surface works. Pair is USDT / unknown token with tiny reserves. |

No official WDOGE/USDC or WDOGE/USDT DogeBox pair was found in this pass.

## Excluded Or Non-Spot Surfaces

| Surface | Reason |
| --- | --- |
| Verified `univ2` / `univ2router` contracts | File paths are `contracts/mock/*`; useful for testing, not production routing. |
| Derps-looking Vyper pool/router/oracle contracts | ABI surface is `open`, `close`, `mint`, `burn`, `liquidate`, and oracle accounting; likely perps/structured trading, not spot swaps. |
| DogenadoCash | Privacy pools, not swap liquidity. |
| Chainlink CCIP routers | Cross-chain messaging, not same-chain DEX liquidity. |
| Tulpea / Backstop | Lending/vault naming and position tokens, not spot DEX routing. |

## Team Questions

Ask these as confirmation, not as blind discovery questions.

### Ecosystem-Level

1. Are Barkswap and MuchFi the two main DEXes aggregators should prioritize on testnet?
2. For V1, should we ignore SuchSwap, DogeBox, and other low-confidence LP surfaces unless told otherwise?
3. Are there any live launchpads, bonding curves, or swap venues not obvious from Blockscout names?
4. Are there upcoming DEXes that are not deployed on Chikyū yet but should be designed into the adapter model?

### Barkswap

1. Which deployment is canonical: `0x88f730...` / `0xeA672...` or `0x099F459...` / `0x4Bb4...`?
2. What are the canonical factory, router, quoter, pool deployer, and position manager addresses?
3. Is Barkswap Algebra Integral, an Algebra fork, or custom CLAMM?
4. Should aggregators route through Barkswap now, or wait for a newer deployment?
5. Can contracts be verified on Blockscout?

### MuchFi

1. What are the canonical V2 and V3 factory/router/quoter/position-manager addresses?
2. Is `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB` the V3 swap router?
3. Should aggregators use both MuchFi V2 and MuchFi V3 liquidity?
4. Is MuchFi using vanilla Uniswap V2/V3, forks, or custom contracts?
5. Which CLMM fee tiers should aggregators scan by default? The MuchFi UI uses `2500` for USDC/native DOGE, while on-chain probes also found a `500` USDC/WDOGE pool and a `500` USDT/WDOGE pool.
6. Can contracts be verified on Blockscout?

### SuchSwap

1. Is SuchSwap expected to be a supported DEX on DogeOS?
2. What are the canonical router/quoter/factory/position-manager addresses?
3. Are there official-token pools beyond the single USDC/WDOGE position seen on-chain?

## Current Integration Priority

1. MuchFi V2 execution adapter: active for live quotes and typed calldata through pinned router `0xC653e745FC613a03D156DACB924AE8e9148B18dc`.
2. MuchFi V3 execution adapter: active for live quotes and typed calldata through pinned router `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB` and quoter `0x5DE1Ea595653419f295511DEb781b98387a77cc2`.
3. Barkswap Algebra execution adapter: active for live quotes and typed calldata through pinned router `0x77147f436cE9739D2A54Ffe428DBe02b90c0205e` and quoter `0xcEF56157baaB2Fe9D16ccF0eB4a9Df354380257D`.
4. Keep SuchSwap, DogeBox, and other LP surfaces in watchlist discovery only.

Execution support requires router/quoter/periphery addresses in the source registry, ABI provenance, on-chain bytecode selector checks, relationship reads, typed calldata builders, and runtime simulation. Blockscout ABI verification remains the preferred provenance upgrade, but the current active venues use committed `adapter-fragment` ABI artifacts plus typed local builders until Blockscout publishes ABI payloads.
