# DogeOS Router Gas Profile

Generated: `2026-05-27T11:53:10.834Z`

Solidity `0.8.30`, EVM `prague`.

This is a local Hardhat gas profile for planned successful router operations. It is intended for pre-flight budgeting and regression tracking. No transaction was broadcast. Swap rows use mock tokens, a fixed-output mock adapter, and the production DogeOS V2 pair adapter against local V2-shaped pair mocks. Production source gas can still differ when the external pair bytecode differs.

Reference gas price: `15680108` wei.

| Category | Action | Gas Used | Estimated Cost Wei | Notes |
| --- | --- | ---: | ---: | --- |
| deployment | `DogeOSSwapRouter.constructor` | `1101546` | `17272360246968` | local deployment with mock WDOGE |
| deployment | `DogeOSV2PairAdapter.constructor` | `771110` | `12091088079880` | factory-bound adapter deployment |
| admin | `setAdapterAllowed(adapter,true)` | `47822` | `749854124776` | owner enables adapter |
| admin | `setAdapterAllowed(adapter,false)` | `25910` | `406271598280` | owner disables adapter |
| admin | `pause()` | `46878` | `735052102824` | owner pause |
| admin | `unpause()` | `24861` | `389823164988` | owner unpause |
| admin | `transferOwnership(pendingOwner)` | `47831` | `749995245748` | Ownable2Step owner transfer start |
| admin | `acceptOwnership()` | `28310` | `443903857480` | Ownable2Step owner transfer accept |
| swap | `exactInput ERC20 -> ERC20` | `161708` | `2535598904464` | mock ERC20 tokens and mock adapter |
| swap | `exactInput native DOGE -> ERC20` | `148040` | `2321283188320` | includes WDOGE deposit |
| swap | `exactInput ERC20 -> native DOGE` | `160647` | `2518962309876` | includes WDOGE withdraw and native transfer |
| integration | `exactInput DogeOS V2 ERC20 -> ERC20` | `170139` | `2667797895012` | production adapter with local V2-shaped pair |
| integration | `exactInput DogeOS V2 native DOGE -> ERC20` | `170150` | `2667970376200` | production adapter with local V2-shaped WDOGE input pair |
| integration | `exactInput DogeOS V2 ERC20 -> native DOGE` | `169058` | `2650847698264` | production adapter with local V2-shaped WDOGE output pair |
