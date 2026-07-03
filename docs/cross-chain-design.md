# Cross-chain swaps design

Last verified: 2026-07-02.

This document defines DogeSwap's cross-chain direction without enabling execution. Phase 0 is a
read-only schema and design pass so future adapters can plug into the aggregator without changing
the quote surface again.

## Verified constraints

DogeOS Chikyu testnet is configured in this repo as chain `6281971`, RPC
`https://rpc.testnet.dogeos.com`, and explorer `https://blockscout.testnet.dogeos.com`
(`packages/config/src/chains.mjs`). The same network details are published in the DogeOS
developer quickstart:
https://docs.dogeos.com/en/developers/developer-quickstart

The current official bridge is DOGE-only and early testnet infrastructure:
https://docs.dogeos.com/user-guide/bridge

- Deposit is Dogecoin Testnet -> DogeOS. The user must include the bridge-provided OP_RETURN
  payload as binary data in the Dogecoin transaction.
- Withdraw is DogeOS -> Dogecoin Testnet. The UI displays a derived Ethereum address for internal
  bridge use; users must not send funds to that address directly.
- Both directions document a relay time of up to 4 hours. A slow bridge leg is normal and should be
  represented as `submitted` or `delayed`, not failed.
- The bridge documentation does not expose a stable fee schedule or a headless quote API.

Third-party support was spot-checked on 2026-07-02:

- Chainlink CCIP lists DogeOS Chikyu testnet, router `0x524B83ae8208490151339c626fd0E35b964483e3`,
  chain selector `7254999290874773717`, fee tokens LINK/WDOGE/native DOGE, and an outbound
  Ethereum Sepolia lane. It is not a usable inbound bridge route for DogeSwap today.
  https://docs.chain.link/ccip/directory/testnet/chain/dogeos-testnet-chikyu
- Relay testnet chains (`https://api.testnets.relay.link/chains`) returned no DogeOS entry.
- LayerZero metadata (`https://metadata.layerzero-api.com/v1/metadata`) contained no DogeOS or
  Chikyu entry.
- Hyperlane registry has no `chains/dogeos/metadata.yaml` entry.

Conclusion: there are no third-party bridge routes to aggregate today. The only immediately
implementable corridor is a guided DOGE route through the canonical bridge, optionally followed by
a same-chain DogeSwap swap after DOGE lands on DogeOS.

## Architecture options

### Bridge aggregation

LI.FI/Socket-style bridge aggregation is attractive once several bridges list DogeOS. It is not
useful now because the available set is empty. Keep the adapter interface compatible with this
model, but do not build UI around nonexistent bridge choices.

### Relayer fill

Relay/Across-style relayer fill gives users near-instant destination liquidity while a relayer is
repaid later. This is the best long-term UX for DogeSwap, but DogeOS is not listed by Relay or
Across today. Treat this as a business-development item and keep the schema compatible with a
future `fill` leg.

### Canonical bridge orchestration

This is available now for DOGE only. DogeSwap remains non-custodial by guiding the user through the
bridge action and tracking each leg; the server never escrows funds or signs transactions. The
tradeoff is poor latency and operational ambiguity: up to 4 hours per bridge leg and no completion
event for Dogecoin L1.

### Burn/mint and messaging

CCTP requires Circle-issued native USDC, which DogeOS does not have. LayerZero and Hyperlane are
not deployed for DogeOS in the public registries checked above. Hyperlane can be self-deployed, but
then DogeSwap becomes a bridge operator with validator/relayer keys. That is only acceptable as a
clearly labeled experiment, not the default product route.

### Intent-based swaps

The dormant repo spec at
`docs/superpowers/specs/2026-06-06-dogeos-cross-chain-near-intents-spec.md` points toward NEAR
Intents. This can be a future adapter, but it still does not remove the DogeOS canonical bridge
constraint unless DogeOS is supported directly.

## Recommended phased design

### Phase 0: schema only

Implemented by `packages/aggregator/src/crosschain/quoteSchema.mjs`.

- `CROSSCHAIN_ENABLED=0` by default.
- Cross-chain candidates are `routeType: "crosschain"` and `status: "readOnly"` only.
- Route legs carry `kind`, `chainId`, optional `toChainId`, `adapter`, amounts, ETA, status, and
  per-leg explorer fields.
- Order status derivation is explicit: `pending`, `in-progress`, `delayed`, `partial`, `success`,
  `refunded`, `failed`.
- No `/crosschain/*` endpoints are wired in Phase 0.

### Phase 1: canonical DOGE guided corridor

Add:

- `POST /crosschain/quote`
- `POST /crosschain/order`
- `GET /crosschain/status?id=<orderId>`

The route should be DOGE-only at first:

1. Source leg: Dogecoin Testnet DOGE -> DogeOS native DOGE via canonical bridge.
2. Optional destination leg: DogeOS native DOGE/WDOGE -> selected buy token through the existing
   same-chain `/quote` and `/swap` flow.

Open implementation question: whether the bridge portal exposes a stable API for deposit address
and OP_RETURN generation. If not, Phase 1 is guided mode: deep-link to the portal, display
warnings, and track by user-provided/observed transaction evidence.

### Phase 2: adapter expansion

Add adapters only when support is real:

- Relay adapter after DogeOS appears in Relay chain metadata.
- CCIP adapter only after there is a usable inbound token/messaging lane.
- NEAR Intents adapter after verifying direct DogeOS or acceptable Dogecoin-L1 composition.
- Hyperlane warp adapter only behind an explicit "DogeSwap-operated bridge experiment" gate.

## Quote schema

Top-level route:

```json
{
  "routeType": "crosschain",
  "sourceId": "crosschain-canonical-doge",
  "displayName": "Canonical DOGE bridge preview",
  "protocolType": "crosschain",
  "status": "readOnly",
  "fromChainId": "dogecoin-testnet",
  "toChainId": 6281971,
  "sellToken": "DOGE@dogecoin-testnet",
  "buyToken": "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925@6281971",
  "quoteMode": "exactInput",
  "amountIn": "100000000000000000000",
  "amountOut": "94100000000000000000000",
  "etaSeconds": 14415,
  "warnings": ["crosschain-preview-only", "bridge-relay-up-to-4h"],
  "legs": []
}
```

Legs:

```json
[
  {
    "legIndex": 0,
    "kind": "bridge",
    "chainId": "dogecoin-testnet",
    "toChainId": 6281971,
    "adapter": "canonical-doge",
    "sellToken": "DOGE",
    "buyToken": "native",
    "amountIn": "100000000000000000000",
    "amountOut": "100000000000000000000",
    "etaSeconds": 14400,
    "status": "pending",
    "txHash": null,
    "explorerUrl": null
  },
  {
    "legIndex": 1,
    "kind": "swap",
    "chainId": 6281971,
    "adapter": "dogeswap",
    "sourceId": "muchfi-v3",
    "sellToken": "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
    "buyToken": "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
    "amountIn": "100000000000000000000",
    "amountOut": "94100000000000000000000",
    "etaSeconds": 15,
    "status": "pending"
  }
]
```

## Failure handling

- Missing or malformed OP_RETURN is a prevention problem. The UI must show the exact payload,
  copy controls, and an exchange warning because exchanges commonly strip OP_RETURN data.
- Slow canonical bridge relay is `submitted` until the 4-hour ETA, then `delayed`. Do not mark it
  failed without an observable terminal signal.
- Bridge success followed by destination swap failure is `partial`, not total failure. The user
  holds the bridged asset and should be offered a fresh same-chain quote.
- Refund-capable adapters must require a refund address at quote/order time.
- Explorer/RPC polling outages must not mutate leg status to failed. Keep the last known status and
  surface status refresh delay separately.

## Frontend and activity model

The frontend should render cross-chain routes as a leg stepper, not a single `approve -> swap`
modal. Each leg needs its own status pill, ETA, action, and explorer link.

`/activity` is DogeOS Blockscout-only and cannot represent Dogecoin L1 or future Sepolia/bridge
legs. Cross-chain activity should therefore extend the local activity stream with `{type,
orderId, legs[]}` and later optionally back it with a server-side order store.

## Security posture

DogeSwap remains a non-custodial quote and transaction builder:

- The server never holds keys or bridge funds.
- Every executable action is user-signed.
- Same-chain destination swaps must reuse existing `/quote`, `/approval`, `/swap` checks and never
  replay a stale cross-chain quote after a multi-hour bridge delay.
- Self-operated bridge infrastructure is not acceptable as the default path before mainnet audit and
  explicit risk acceptance.
