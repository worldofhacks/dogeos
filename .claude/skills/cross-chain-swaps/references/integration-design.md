# Cross-chain integration design — concrete contracts for this repo

Implementation-grade detail for the phases in SKILL.md §6. Grounded in the code as of
2026-07-02 (main @ c32bc98). Everything here extends the existing provider-injection
architecture: `packages/api/src/handler.mjs` stays a pure route-matcher testable without RPC;
`packages/api/src/live.mjs` is the only file that knows real upstreams.

## 1. Feature flag and wiring

Follow the router-mode precedent (`live.mjs:175-180` reads `DOGESWAP_ROUTER_ADDRESS` /
`DOGESWAP_ROUTER_MODE` from env):

```
CROSSCHAIN_ENABLED=1                 # default off; endpoints 404 when off
CROSSCHAIN_ORDER_STORE=/var/lib/dogeswap/crosschain-orders.json   # phase 1+
CROSSCHAIN_ADAPTERS=canonical-doge   # comma list; each must have an adapter module
```

`live.mjs` constructs `crosschainQuoteProvider`, `crosschainOrderStore`,
`crosschainStatusProvider` only when enabled and injects them into
`createAggregatorApiHandler` (handler.mjs:501). Handler defaults them to `null` → routes
return 404 `not-found`, exactly like an unconfigured provider elsewhere (e.g. `/token`'s 503
when unwired).

**Do not forget** `packages/web/src/server.mjs:20-34`: the prod web server (systemd
`dogeswap-prod`, 127.0.0.1:8080) dispatches only paths in the `API_PATHS` Set; add
`"/crosschain/quote"`, `"/crosschain/order"`, `"/crosschain/status"` or prod serves 404 HTML
while the standalone API server (8787) works — a classic staging-works-prod-doesn't trap.
Also note only API_PATHS get rate-limited; these must be in the set for that reason too.

## 2. Endpoint contracts

Routing style: exact `url.pathname ===` matches + query params (like `/token?address=`,
`/activity?address=`), NOT path params — handler.mjs:612-982 has no pattern matcher and
API_PATHS is exact-match. Insert the three routes after the `/swap` block (handler.mjs:921-982).

### POST /crosschain/quote

Request (validated by a new `parseCrosschainQuoteRequest` next to `parseQuoteRequest`,
handler.mjs:229-260; reuse `isHexAddress`, positive-BigInt, and slippage-cap helpers —
`MAX_SLIPPAGE_BPS = 500` applies to the swap legs):

```json
{
  "fromChainId": "dogecoin-testnet",      // string: EVM chain ids are numbers-as-strings,
  "toChainId": 6281971,                    // non-EVM chains get registered string ids
  "sellToken": "DOGE",                     // per-chain token ref: hex addr on EVM, symbol on UTXO
  "buyToken": "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
  "amountIn": "100000000000000000000",
  "slippageBps": 50,
  "sender": "<origin-chain address>",
  "recipient": "0x<dogeos address>",
  "refundAddress": "<origin-chain address>"   // MANDATORY (see relay-model.md refund rules)
}
```

Response: the standard quote envelope (`status/best/alternatives/rejected/warnings/
expiresAtMs` from `buildQuoteResponse`, `packages/aggregator/src/quoteService.mjs:156-223`)
where `best` is a crosschain Route (schema §3). Phase 0: `status:"read-only"` always, with
`warnings:["crosschain-preview-only"]` — identical mechanism to one-hop previews
(`routes/oneHop.mjs:44-46` hard-codes `readOnly`/`"one-hop-execution-preview"`). Reuse the
transient-degradation guard (handler.mjs:851-861): if a leg quote failed transiently, return
`status:"unavailable", retryable:true`, never a false "no route".

### POST /crosschain/order  (phase 1)

Freezes an accepted quote into a tracked order. Request `{quote, sender}` — mirror `/swap`'s
`normalizeSwapQuote` discipline (handler.mjs:262-298): re-derive BigInts, require
`quote.status === "active"`, re-quote server-side before freezing (the fail-closed
`clampRefreshedSwapQuote` philosophy, handler.mjs:349-381 — never let a client-supplied price
survive). Response:

```json
{
  "orderId": "cc_9f2a...",                 // random 128-bit, unguessable (it's a bearer token for status)
  "createdAtMs": 1751470000000,
  "legs": [ ...schema §3, each with status "pending" or "awaiting-user"... ],
  "instructions": {
    "type": "dogecoin-opreturn-deposit",
    "depositAddress": "<bridge-provided Dogecoin address>",
    "opReturnHex": "<exact binary payload, hex-encoded>",
    "warnings": [
      "Include the OP_RETURN data exactly as shown or funds are unrecoverable.",
      "Do not send from an exchange — exchanges strip OP_RETURN data.",
      "Relay to DogeOS can take up to 4 hours."
    ]
  }
}
```

Note on the canonical-bridge adapter: the portal (https://portal.testnet.dogeos.com/bridge)
generates the deposit address + OP_RETURN in its UI; whether that generation is available as
a callable API is UNVERIFIED — implementation must first probe the portal's network calls or
use https://github.com/DogeOS69/dogecoin-tools to construct the payload. If neither works
headlessly, phase 1 degrades to "guided mode": we deep-link the portal for the bridge leg and
track it by watching the recipient address, still owning quote + status + resume.

### GET /crosschain/status?id=cc_...

```json
{
  "orderId": "cc_9f2a...",
  "status": "in-progress",   // pending | in-progress | delayed | partial | success | refunded | failed
  "legs": [
    { "legIndex": 0, "kind": "bridge", "status": "confirmed",
      "txHash": "<dogecoin txid>", "explorerUrl": "https://sochain.com/tx/DOGETEST/...",
      "observedAtMs": 1751473600000 },
    { "legIndex": 1, "kind": "swap", "status": "awaiting-user", "actionHint": "finish-swap" }
  ],
  "updatedAtMs": 1751473610000
}
```

Order status is derived, never stored independently: `failed`/`refunded` if any leg terminal-
failed and no continuation exists; `partial` if a value-bearing leg confirmed but a later leg
terminally failed; `success` iff all legs confirmed; `delayed` if any leg exceeded its soft
ETA. Statuses are a superset of Relay's v3 set (see relay-model.md) — keep names compatible so
a future Relay adapter maps 1:1.

## 3. The legs[] schema (the phase-0 deliverable)

A crosschain Route candidate. Everything BigInt-valued serializes to decimal strings via the
existing `jsonReplacer` (handler.mjs:28-30). Fields marked ▲ are additions relative to the
split-route legs precedent (`splitRoutes.mjs:86-115`):

```json
{
  "routeType": "crosschain",
  "sourceId": "crosschain-canonical-doge",
  "status": "read-only",
  "protocolType": "crosschain",
  "sellToken": "DOGE@dogecoin-testnet",
  "buyToken": "0xD19d...@6281971",
  "amountIn": "100000000000000000000",
  "amountOut": "94100000000000000000000",
  "etaSeconds": 14400,                        // ▲ sum of leg ETAs; bridge legs dominate
  "quoteTimestampMs": 1751470000000,
  "ttlMs": 60000,                              // crosschain quotes age slower than the 5s venue TTL,
                                               // but bridge legs are re-checked at order time anyway
  "legs": [
    {
      "legIndex": 0,                           // ▲ execution order; legs run strictly sequentially
      "kind": "bridge",                        // ▲ "swap" | "bridge" | "fill"
      "chainId": "dogecoin-testnet",           // ▲ per-leg chain — split legs were all 6281971
      "toChainId": 6281971,                    // ▲ bridge/fill legs span two chains
      "adapter": "canonical-doge",             // ▲ which adapter quoted/tracks this leg
      "sellToken": "DOGE", "buyToken": "native",
      "amountIn": "100000000000000000000",
      "amountOut": "100000000000000000000",    // canonical bridge is 1:1 minus (undocumented) fees
      "feeEstimate": null,                     // honest: no bridge fee schedule is documented
      "etaSeconds": 14400,                     // "up to 4 hours" — surface, don't hide
      "status": "pending",                     // ▲ lifecycle (see below); "pending" in quotes
      "txHash": null, "explorerUrl": null      // ▲ filled in by the status poller
    },
    {
      "legIndex": 1,
      "kind": "swap",
      "chainId": 6281971,
      "adapter": "dogeswap",
      "sourceId": "muchfi-v3",                 // swap legs reuse the full venue candidate fields:
      "poolAddress": "0x4F1c...7299",          // router, feeBps, priceImpactBps, gasUnits,
      "sellToken": "0xF6BD...8aE",             // dataFinalityFeeWei, minimumOutput... — the leg IS
      "buyToken": "0xD19d...925",              // a direct-route candidate, embedded
      "amountIn": "100000000000000000000",
      "amountOut": "94100000000000000000000",
      "etaSeconds": 15,
      "status": "pending"
    }
  ],
  "score": { "...": "totalFeeWei folds ALL legs' fees; see fee note below" },
  "warnings": ["crosschain-preview-only", "bridge-relay-up-to-4h"]
}
```

Leg lifecycle (order-time; quotes always carry `pending`):

```
pending → awaiting-user → submitted → confirmed
                              ├→ delayed   (soft ETA exceeded; NOT terminal)
                              ├→ failed    (terminal, leg-level)
                              └→ refunded  (terminal; refund txHash recorded)
```

Fee/score note: `chooseBestDirectRoute` scoring (`fees/dogeosFeeEstimator.mjs`) assumes
same-chain wei. Cross-chain totals span currencies/chains; phase 0 keeps the composed
`feeEstimate` per leg and computes an *informational* all-in total in the sell-token unit
(the NEAR spec's "true all-in pricing" acceptance criterion) — do NOT feed crosschain
candidates through `scoreQuote` (its `outputWeiPerFeeWei = 1n` fee weighting is already a
known-wrong simplification same-chain; roadmap "Now" #2).

Schema home: `packages/aggregator/src/crosschain/quoteSchema.mjs` (the roadmap names
`packages/aggregator/src/quotes/types` — a `types/` dir does not exist yet; create the schema
either place, but export validation helpers from the crosschain module so handler.mjs imports
one thing).

## 4. Module layout + responsibilities

```
packages/aggregator/src/crosschain/
  quoteSchema.mjs        # leg/route shape + validators (phase 0)
  quoteProvider.mjs      # createCrosschainQuoteProvider({adapters, directQuoteProvider, nowMs})
  adapters/
    canonicalDoge.mjs    # phase 1 — quoteBridgeLeg / buildInstructions / pollLegStatus
    nearIntents.mjs      # phase 2 — 1Click client per the dormant spec (JWT via NEAR_INTENTS_JWT,
                         #   getQuote/getDepositAddress/submitDeposit/getStatus/handleRefund;
                         #   verify exact endpoints against defuse-protocol/one-click-sdk-typescript
                         #   at implementation time — the spec flags them as unverified)
    hyperlaneWarp.mjs    # stub until/unless the operate-a-bridge decision is made
    relay.mjs            # stub; maps 1:1 onto relay-model.md statuses
  orderStore.mjs         # createCrosschainOrderStore({filePath, nowMs}) — Map + atomic JSON
                         #   persistence (write-temp-rename); loads on construction; the
                         #   creatorReputation onChange pattern, actually wired this time
                         #   (live.mjs:401 famously never wired that one — don't repeat it)
  statusPoller.mjs       # createLegStatusPoller({adapters, fetchFn, intervalMs}) — advances leg
                         #   states; ALL fetches take AbortSignal timeouts (roadmap "Now" #10:
                         #   existing Blockscout fetches lack them; don't add more)
```

Adapter interface (every adapter implements exactly this):

```js
{
  id: "canonical-doge",
  corridors(): [{fromChainId, toChainId, tokens}],       // what it can quote
  quoteBridgeLeg({fromChainId, toChainId, sellToken, buyToken, amountIn}) -> leg | null,
  buildInstructions(order, leg) -> instructions,          // user-facing action payload
  pollLegStatus(order, leg, {signal}) -> {status, txHash?, explorerUrl?, detail?}
}
```

`quoteProvider.mjs` composes: bridge leg from the adapter + destination swap leg by
re-entering the existing direct composite provider (injected, same as
`routes/oneHop.mjs:72,90-116` chains leg quotes with `amountIn = firstLeg.amountOut`). Run it
under the composite's transient-aware error discipline (`quotes/sourceQuoteRunner.mjs` — `[]`
must mean "genuinely can't", never "upstream was slow").

Per-leg polling sources:
- DogeOS legs: Blockscout `GET /api/v2/transactions/{hash}` (base URL from
  `packages/config/src/chains.mjs:13`).
- Canonical-bridge deposit (L1→L2): no indexable event — poll the DogeOS recipient's balance
  / incoming txs on Blockscout. Withdrawal (L2→L1): origination via
  `/api/v2/scroll/withdrawals`, completion ONLY by polling the Dogecoin address on sochain
  (`completion_transaction_hash` is always null — verified 2026-07-02; never key success off
  it).
- Sepolia legs (future Hyperlane/CCIP): that chain's Blockscout/Etherscan.

## 5. Failure matrix (order-time)

| Failure | Detection | Order/leg state | User-visible copy | Recovery |
|---|---|---|---|---|
| Bridge relay slow (< 4 h) | elapsed < etaSeconds | leg `submitted` | "Bridging — testnet relays take up to 4 hours" + started-at time | none needed |
| Bridge relay slow (4-12 h) | soft ETA exceeded, no arrival | leg `delayed`, order `delayed` | amber: "Taking longer than the documented 4-hour window. Funds are not lost; testnet relays can be slow." | keep polling; ops log entry |
| Bridge relay silent (> 12 h) | hard threshold | leg `delayed` + `needsReview:true` | "Still relaying. If this persists, contact DogeOS support with your tx hash." + portal link | manual; we cannot force the operated relay |
| Deposit missing OP_RETURN / from an exchange | arrival never observed; L1 tx visible without payload | leg `failed`, order `failed` | "The deposit was sent without the required OP_RETURN data and cannot be credited." | none — this is why the instructions UI must make it near-impossible (copy-button payload, explicit exchange warning) |
| User sends to the withdrawal UI's derived ETH address | (not observable by us) | — | prevention only: never display that address; warn in withdrawal copy | none |
| Destination swap leg quote expired while bridging | order resume finds stale leg | leg `awaiting-user`, order `partial` | "Your DOGE arrived on DogeOS. Prices moved — review a fresh quote to finish." | re-quote via ordinary `/quote` + `/swap`; NEVER auto-execute with user funds |
| Destination swap reverts | `/swap` verification or receipt failure | leg `failed`, order `partial` | "Swap failed — your bridged DOGE is safe in your wallet." + retry button | fresh quote; funds already user-held (non-custodial) |
| Intent solver can't fill (1Click/Relay adapters) | adapter status `refunded` | leg `refunded`, order `refunded` | "Refunded to <origin address> on <chain>." + refund tx link | user retries from scratch |
| Refund below gas (Relay semantics) | adapter status `failure` | leg `failed` | "The amount was too small to refund after gas." | prevention: enforce adapter min-amounts at quote time (`AMOUNT_TOO_LOW`) |
| RPC/explorer outage during polling | fetch timeout/AbortError | leg keeps last state; order `updatedAtMs` stalls | subtle "status refresh delayed" — do NOT flip legs to failed on poller errors | transient-aware retry, same classification philosophy as sourceQuoteRunner |

Timeout policy defaults: swap legs — existing quote TTL + `/swap` expiry checks
(`swap/buildSwapTx.mjs:53-55`); fill legs (intent adapters) — adapter-reported, typically
seconds-minutes, `delayed` after 2× estimate; bridge legs — soft 4 h (documented), amber to
12 h, `needsReview` beyond; nothing bridge-related ever auto-fails (no failure signal exists
to observe).

## 6. Frontend flow (apps/web)

- `apps/web/src/lib/api.js` — add `getCrosschainQuote(body)`, `createCrosschainOrder(body)`,
  `getCrosschainStatus(orderId)` beside `getActivity` (:75).
- `apps/web/src/ui/SwapFlow.jsx` — when the selected route has `routeType:"crosschain"`,
  render `CrosschainProgress` instead of the single-chain confirm path.
- New `apps/web/src/ui/CrosschainProgress.jsx` — one card per leg: kind icon, status pill
  (reuse the confirmed/pending/failed pill vocabulary from `ActivityView.jsx`), per-leg
  explorer link, ETA countdown for bridge legs, and the instructions panel for
  `awaiting-user` legs (deposit address + OP_RETURN with copy buttons + the exchange
  warning). Poll `/crosschain/status` at the existing 10 s cadence; back off to 60 s for legs
  in `submitted` with multi-hour ETAs.
- `apps/web/src/ui/useSwapExecution.js` — unchanged for same-chain; the destination swap leg
  of a `partial` resume goes through it as a normal swap (`status: approving → swapping →
  success` with `phase` sub-steps).
- **Resumability** (spec requirement): persist `{orderId, createdAt}` list in
  `localStorage('doge.crosschain')`; on app load, re-hydrate active orders from
  `/crosschain/status` and surface a "resume" banner. The server order store is the source of
  truth; localStorage only remembers which orders are *yours*.
- **/activity surfacing**: extend the LOCAL stream — `logSwapActivity`
  (`apps/web/src/lib/execute.js:595`, localStorage `doge.history`, cap 40, merged
  newest-first by `ActivityView.jsx` with the CHAIN stream) — with an entry shape
  `{type:"crosschain", orderId, legs:[{kind, chainId, status, txHash, explorerUrl}]}`.
  ActivityView renders it as a multi-row card, each leg linking to its own chain's explorer
  (DogeOS Blockscout / sochain / Sepolia). The server `/activity` endpoint (a stateless
  single-chain Blockscout proxy, handler.mjs:768-798) is NOT the vehicle — a DogeOS-only
  explorer can never see the Dogecoin/Sepolia legs. Dedupe rule: a crosschain order's DogeOS
  swap-leg tx will ALSO appear in the CHAIN stream — suppress the bare chain row when a
  local crosschain card holds the same txHash (the existing same-hash merge rule, extended).

## 7. Tests (mirror the repo's node:test style, packages/aggregator/test/)

- `crosschainQuoteSchema.test.mjs` — leg validation, serialization (BigInt→string), status
  derivation table from §2.
- `crosschainQuoteProvider.test.mjs` — mocked adapters + mocked direct provider: leg
  chaining (amountIn = prior amountOut), transient adapter failure → no candidate + transient
  diagnostic (NOT a silent []), read-only status in phase 0, corridor filtering.
- `crosschainOrderStore.test.mjs` — persistence round-trip, restart survival, atomic write,
  unknown-order 404.
- `crosschainStatusPoller.test.mjs` — every §5 row as a case; poller error ≠ leg failure;
  delayed thresholds; partial derivation.
- `apiCrosschain.test.mjs` (packages/api/test/) — flag off → 404; flag on → contract shapes;
  refundAddress mandatory; slippage cap enforced on swap legs.
- Phase 1 acceptance (from the NEAR spec, applied to the canonical corridor): an end-to-end
  testnet dry-run both directions with recorded tx hashes committed in the repo's
  verification-evidence style (like `docs/onchain-validation-*.md`).
