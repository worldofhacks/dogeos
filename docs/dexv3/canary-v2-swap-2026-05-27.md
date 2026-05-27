# DogeOS V2 Canary Swap 2026-05-27

Generated: `2026-05-27T11:55:27.812Z`

This was a dust-size live Chikyu testnet swap through the deployed `DogeOSSwapRouter` and `DogeOSV2PairAdapter`. The route used native DOGE input, router-side WDOGE wrapping, and the canonical MuchFi V2 WDOGE/USDC pair.

| Field | Value |
| --- | --- |
| Chain ID | `6281971` |
| Block | `5184451` |
| Router | `0xBBf7ECC134350a9aF2BCA49A1420ac5E15fe54c3` |
| Adapter | `0xe3D7979C510a3eBc7e3C60dB0F9f69c60E3D7A0E` |
| Pair | `0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4` |
| Token in | native DOGE via WDOGE `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE` |
| Token out | USDC `0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925` |
| Amount in wei | `100000000000000` |
| Quoted amount out | `16075550163793` |
| Min amount out | `15754039160518` |
| Actual amount out | `16075550163793` |
| Slippage bps | `200` |
| Estimated gas | `241057` |
| Gas used | `191150` |
| Transaction | `0x5249ba34c3a021a243d01ade3080575f86d3eeaeb98423c86236d37db744d832` |
| Explorer | https://blockscout.testnet.dogeos.com/tx/0x5249ba34c3a021a243d01ade3080575f86d3eeaeb98423c86236d37db744d832 |

## Post-Swap Checks

| Check | Result |
| --- | --- |
| Router remained unpaused | Pass |
| Adapter remained allowlisted | Pass |
| Output met min amount | Pass |
| Router WDOGE delta was zero | Pass |
| Router USDC delta was zero | Pass |
| Router adapter allowance reset | Pass |
