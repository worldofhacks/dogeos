# DogeOS Security Automation Evidence 2026-05-27

Generated: `2026-05-27T15:44:43.281Z`

| Field | Value |
| --- | --- |
| Chain ID | `6281971` |
| Executable sources | `muchfi-v2` |
| Quote-active sources | `muchfi-v3, barkswap-algebra` |
| Router | `0xBBf7ECC134350a9aF2BCA49A1420ac5E15fe54c3` |
| Adapter | `0xe3D7979C510a3eBc7e3C60dB0F9f69c60E3D7A0E` |
| Canary tx | `0x5249ba34c3a021a243d01ade3080575f86d3eeaeb98423c86236d37db744d832` |
| On-chain validation | `docs/dexv3/onchain-validation-2026-05-27.json` |

## Checks

| Check | Result |
| --- | --- |
| registry keeps only MuchFi V2 executable | Pass |
| registry quote-enables MuchFi V3 and Barkswap | Pass |
| router deploy evidence is DogeOS Chikyu and successful | Pass |
| adapter deploy evidence is DogeOS Chikyu and successful | Pass |
| router and adapter addresses are well formed | Pass |
| adapter allowlist preflight confirms already allowed | Pass |
| route preflight targets deployed router and adapter | Pass |
| canary swap receipt is successful and linked to Blockscout | Pass |
| canary swap used deployed router and adapter | Pass |
| canary output and gas are within preflight bounds | Pass |
| canary post-checks preserve router safety invariants | Pass |
| MuchFi V3 quote pools have live bytecode and liquidity evidence | Pass |
| Barkswap quote pools have live bytecode and liquidity evidence | Pass |
