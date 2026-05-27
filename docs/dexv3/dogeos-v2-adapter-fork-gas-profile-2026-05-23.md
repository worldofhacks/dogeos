# DogeOS V2 Adapter Fork Gas Profile

Generated: `2026-05-23T04:37:32.590Z`

This profile runs on a local Hardhat fork of DogeOS Chikyu. No transaction was broadcast to DogeOS. The swap row uses the real MuchFi V2 WDOGE/USDC pair bytecode and the production `DogeOSV2PairAdapter` deployed only inside the fork.

| Field | Value |
| --- | --- |
| Fork block | `5094455` |
| RPC | `https://rpc.testnet.dogeos.com` |
| Factory | `0x7864071B532894216e3C045a74814EafEB92ae20` |
| Pair | `0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4` |
| Token in | native DOGE via WDOGE `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE` |
| Token out | USDC `0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925` |
| Amount in | `1000000000000000` wei |
| Quoted amount out | `115834107382279` |
| Reference gas price | `15680108` wei |

| Category | Action | Gas Used | Estimated Cost Wei | Notes |
| --- | --- | ---: | ---: | --- |
| deployment | `DogeOSV2PairAdapter.constructor` | `771110` | `12091088079880` | fork-local deployment bound to MuchFi V2 factory |
| deployment | `DogeOSSwapRouter.constructor` | `1101546` | `17272360246968` | fork-local router deployment with DogeOS WDOGE |
| admin | `setAdapterAllowed(adapter,true)` | `47810` | `749665963480` | fork-local allowlist transaction |
| fork-swap | `exactInput MuchFi V2 native DOGE -> USDC` | `191150` | `2997252644200` | real DogeOS WDOGE and MuchFi V2 pair bytecode on local fork |
