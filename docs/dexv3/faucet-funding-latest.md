# DogeOS Chikyu Faucet Funding Plan

Generated: 2026-05-28T04:13:58.364Z

Official faucet: https://faucet.testnet.dogeos.com/

Manual claim required. The DogeOS testnet faucet is protected by reCAPTCHA and the published cadence is one claim per 24 hours, so this script does not automate claims or attempt to bypass rate limits.

## Summary

- Wallets tracked: 1
- Eligible now: 1
- Funding recommended: 0
- Total balance: 42.068782673100144711 DOGE
- Target deficit: 0.0 DOGE
- Minimum claim interval: 24 hours

## Wallets

address | balance DOGE | target DOGE | deficit DOGE | eligible now | funding recommended | hours until eligible | last claim
--- | ---: | ---: | ---: | --- | --- | ---: | ---
0x00B6F77d55967669Ea37f47Fc469FF47782007E4 | 42.068782673100144711 | 5.0 | 0.0 | yes | no | 0 | not recorded

## Operator Steps

1. Open https://faucet.testnet.dogeos.com/.
2. Use only eligible project wallets with a positive target deficit.
3. Complete the faucet claim manually.
4. After a successful claim, run `pnpm faucet:plan -- --mark-claimed <address>` so the next plan preserves the 24-hour cadence.
