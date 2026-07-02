---
name: blockscout-scanner
description: Query and scan the DogeOS testnet Blockscout explorer (blockscout.testnet.dogeos.com) and debug/extend the API endpoints built on it. Use when asked to "trace this tx", "why did this swap fail", "decode this revert", "reconstruct activity" for a wallet, "is this contract verified", "monitor router events", "scan the explorer", or when working on the /activity or /verification endpoints.
---

# Blockscout scanner — DogeOS testnet explorer

Instance: `https://blockscout.testnet.dogeos.com` — Blockscout **v8.0.2**, built with
**CHAIN_TYPE=scroll**, fully indexed. All endpoint facts below were verified live on
**2026-07-02**. Full curated endpoint catalog: [references/api.md](references/api.md) —
read it before using any endpoint not covered here.

## Canonical constants (do not hardcode the URL)

- Base URL constant: `blockscoutBaseUrl: "https://blockscout.testnet.dogeos.com"` at
  `packages/config/src/chains.mjs:13` (inside `DOGEOS_CHAIN`). Re-exported as
  `BLOCKSCOUT_BASE_URL` at `packages/aggregator/src/verification/verificationSnapshot.mjs:12`.
- Chain id: **6281971 / `0x5fdaf3`** (`chains.mjs:2-3`). Real node: `https://rpc.testnet.dogeos.com`.
- Live DogeSwapRouter: `0xa3158549f38400F355aDf20C92DA1769620Aa35A` — **unverified on
  Blockscout** (`is_verified:false`, checked 2026-07-02) and **pre-hardening**: it was deployed
  before the 2026-06 audit fixes and is immutable; only `packages/contracts/src/DogeSwapRouter.sol`
  is the hardened source. Its Blockscout `method` field shows the raw selector `0xe56964c6`
  (= `execute(bytes,bytes[],(address,uint256,address),uint256)`, pinned at
  `packages/aggregator/src/sources/registry.mjs:22-25`).
- Sample real swap tx for testing anything:
  `0x33e353d61fbf24f23c0be44fa99ad21507a9c1da317c32eaa8346997f5bbec56`
  (DogeSwapRouter execute, block 5964823, 5 token transfers, 8 logs, 23 internal txs).

## The helper client — use it instead of raw fetch

`scripts/blockscout/client.mjs` (tested in `scripts/__tests__/blockscoutClient.test.mjs`):

```js
import { createBlockscoutClient } from "./scripts/blockscout/client.mjs";
const bs = createBlockscoutClient();           // defaults to DOGEOS_CHAIN.blockscoutBaseUrl
// other instance:  createBlockscoutClient({ baseUrl: "https://eth.blockscout.com" })
// hermetic tests:  createBlockscoutClient({ baseUrl, fetchImpl: fakeFetch, timeoutMs: 25 })

const trace = await bs.traceSwap(txHash);      // tx + transfers + internal calls, ordered; null if unknown
for await (const tx of bs.paginate(`api/v2/addresses/${addr}/transactions`, { filter: "to" }, { maxPages: 4 })) { … }
await bs.isVerified(addr);                     // false for the live router
```

Semantics: single-object getters (`transaction`, `smartContract`, `tokenInfo`, `addressCounters`,
`address`) return **null on 404**; list getters (`transactionLogs`, `transactionTokenTransfers`,
`transactionInternalCalls`, `addressTransactions`, `addressTokenTransfers`, `tokenHolders`,
`search`) return the raw first-page body `{ items, next_page_params }`. HTTP failure →
`BlockscoutHttpError` (`.status`), bad JSON → `BlockscoutParseError`, deadline (default 8 s) →
`BlockscoutTimeoutError`. **All wei/token amounts stay decimal strings** — never `Number()` them.

## DogeOS-specific API facts (the gotchas)

- **`scroll` fee object** on every tx detail: `fee.value = scroll.l1_fee + scroll.l2_fee.value`
  (verified arithmetically live). `scroll.l2_block_status` (e.g. `"Confirmed by Sequencer"`) is
  the batch-finality signal — the on-chain counterpart of the repo's data-finality fee. Block
  responses do NOT carry a `scroll` key.
- **Page size is fixed at 50; `?limit=` is ignored.** Pagination is keyset-only via
  `next_page_params` (below). No random access in v2 — use the legacy `?module=` API for
  `page/offset/sort`.
- **`/api/v2/smart-contracts/{addr}/methods-read` (and -write) is removed in v8** → 404. Take
  `abi` from `GET /api/v2/smart-contracts/{addr}` and `eth_call` yourself.
- **Unverified contracts do not 404**: `GET /api/v2/smart-contracts/{addr}` returns 200 with only
  `creation_bytecode`/`deployed_bytecode` (no `abi`/`source_code`); legacy `getabi` returns
  `{"status":"0","message":"Contract source code not verified","result":null}`; tx `decoded_input`
  and log `decoded` are null. This is the everyday state for the live router.
- **`/api/eth-rpc` reports `eth_chainId` = `0x1`** (misconfigured env on the instance). Never
  source chain id / signing-domain data from it — use `rpc.testnet.dogeos.com`.
- `GET /api/v2/transactions/{hash}/summary` → 403 (interpretation service disabled). No name
  service, no token pricing/icons (`icon_url`, `exchange_rate` always null on this testnet).
- **Rate limits**: empirically unthrottled (20 rapid requests, no `ratelimit-*` headers,
  2026-07-02), no API key needed — but the operator can flip `API_RATE_LIMIT_*` on anytime, so
  keep client-side throttling/timeouts (the helper's 8 s default).

## Pagination — real example

Every list response is `{"items":[…], "next_page_params": {…}|null}`. Echo **every** cursor key
verbatim onto the same endpoint; the key set differs per endpoint (transactions:
`block_number,fee,hash,index,inserted_at,items_count,value`; holders: `address_hash,value,items_count`)
— treat it as opaque. Live sequence:

```
GET /api/v2/addresses/0xBd6d…0858/transactions
→ next_page_params = {"block_number":6063095,"fee":"1566445689512","hash":"0x7eac…731d",
   "index":0,"inserted_at":"2026-07-02T16:56:46.621534Z","items_count":50,"value":"100000000"}
GET …/transactions?block_number=6063095&fee=1566445689512&hash=0x7eac…731d&index=0
   &inserted_at=2026-07-02T16%3A56%3A46.621534Z&items_count=50&value=100000000   → next 50
```

`bs.paginate(path, params, { maxPages })` does this for you. Deep test address:
`0xBd6d53bad965836E19565D7b58D78e8f87d80858` (sequencer heartbeat, millions of txs).

## Three API families — when to use which

1. **REST v2** (`/api/v2/…`) — default. Rich objects: `revert_reason`, embedded token transfers,
   `scroll` fees, verification metadata, counters.
2. **Legacy Etherscan-style** (`GET /api?module=…&action=…`) — for Etherscan-shaped tooling,
   `page/offset/sort` random access, flat rows, and `module=logs&action=getLogs` scans. This is
   what `scripts/scan-dogeos-pools.mjs:30,73-90` already uses (factory event scans +
   `eth_block_number` head proxy).
3. **`POST /api/eth-rpc`** — 16 methods incl. `eth_getLogs` (max 1000 logs/request). Almost never
   the right choice: it is the explorer DB pretending to be a node, and its chainId lies (see
   above). Use the real RPC for anything consensus- or signing-related.

## RECIPES

### (a) Trace a swap end-to-end

`await bs.traceSwap(hash)` gives the composed summary. What it means for a DogeSwap tx, using the
real example `0x33e3…ec56`:

1. **Entry**: `to` = DogeSwapRouter `0xa315…Aa35A`, `method` = `0xe56964c6` (execute; raw selector
   because the router is unverified). Router-mode singles, one-hops and splits all land here;
   direct venue execution (always the case for exact-output) lands at a venue router instead
   (MuchFi V2 `0xC653…18dc`, MuchFi V3 `0x54f7…c1CB`, Barkswap `0x7714…205e`).
2. **Approval context** (separate, earlier tx): router mode uses Permit2 — look for an ERC-20
   `approve` (`0x095ea7b3`) of the canonical Permit2 `0x…22D473030F116dDEE9F6B43aC78BA3`, then the
   permit rides inside the swap calldata. Direct venue execution uses exact-amount `approve` to
   the venue router. Find them via `bs.addressTransactions(user)` filtering `method`/selector.
3. **Venue hops**: `trace.internalCalls` (23 for the example) shows router → venue router → pool
   `call`s and quoter `staticcall`s in execution order; match `to` against the registry addresses
   in `packages/aggregator/src/sources/registry.mjs`.
4. **Token flow**: `trace.tokenTransfers` ordered by `log_index` — input token user→router→pool,
   output pool→router→recipient. The last transfer of the buy token to the recipient is the
   settlement payout (router enforces `minOut` there).
5. **Fees**: `feeWei = l1DataFeeWei + l2ExecutionFeeWei`; `l2BlockStatus` for finality.

### (b) Reconstruct a user activity feed

How `GET /activity` does it today (see mapping table below): ONE un-timed `fetch` of
`/api/v2/addresses/{addr}/transactions`, slices `items` to `limit` (1..50, default 20), passes
**raw Blockscout items** through, returns `nextPageParams` — but accepts no cursor input, so
page 2 is unreachable through our API. To rebuild richer:

1. `bs.paginate("api/v2/addresses/{addr}/transactions", {}, { maxPages: N })` for the tx stream
   (or `{ filter: "from" }` for outbound only).
2. Classify swaps: `item.to.hash` ∈ {DogeSwapRouter, venue routers}; `method`/selector against
   the encoder table (`0xe56964c6` router execute; V2 `0x38ed1739`/`0x8803dbee`; V3
   `0x04e45aaf`/`0x5023b4df`; Algebra `0x1679c792`/`0x1764babc` — from
   `packages/aggregator/src/swap/venueCalldataBuilders.mjs`).
3. `bs.addressTokenTransfers(addr, { token: tokenAddr })` for per-token history;
   `bs.addressCounters(addr)` for totals; `bs.traceSwap(hash)` per interesting tx.
4. Extending `/activity` itself: thread the client's `next_page_params` back as query params
   (echo verbatim), and add an AbortSignal timeout — the current fetch has none.

### (c) Detect failed swaps + decode reverts

1. Failed txs of a wallet: items with `status: "error"` (`result` carries the failure kind) from
   `addressTransactions`; a "successful" tx can still contain failed inner hops —
   check `has_error_in_internal_transactions` and `trace.failedInternalCalls`.
2. **`revert_reason`** on tx detail: string reason when the revert carried `Error(string)`;
   often raw hex or null otherwise.
3. Raw hex / null → fall back to `GET /api/v2/transactions/{hash}/raw-trace` (enabled on this
   instance): find the reverting frame's `output`. `0x08c379a0…` = `Error(string)` (ABI-decode
   the string); 4-byte outputs are **custom errors**. DogeSwapRouter's (computed
   `cast sig` from `packages/contracts/src/DogeSwapRouter.sol:80-83`, 2026-07-02):
   `0x1ab7da6b DeadlineExpired` · `0xff633a38 LengthMismatch` · `0x25349118 UnknownCommand` ·
   `0x82b42900 Unauthorized` · `0xcd4e6167 FeeTooHigh` · `0xe40e70e9 NotionalCapExceeded` ·
   `0x81efc143 MinOutNotMet` · `0x5461585f InvalidSpender` · `0xf4b3b1bc NativeTransferFailed` ·
   `0x4039b988 InsufficientLedgerBalance` · `0x84f36e4c LedgerOverflow` · `0xd92e233d ZeroAddress` ·
   `0x9c8d2cd2 InvalidRecipient` · `0x768dc598 InvalidFeeRecipient`; inherited:
   `0xd93c0665 EnforcedPause()` · `0x118cdaa7 OwnableUnauthorizedAccount(address)`.
   NOTE: the LIVE router predates the hardened source — its selector set may differ; verify
   against the deployed bytecode (`bs.smartContract(addr)` → `deployed_bytecode` contains the
   selector bytes) before asserting.
4. Venue-level failures (direct execution): classic V2 strings like
   `UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT` arrive via `Error(string)` → `revert_reason`.
5. Bulk detection: legacy `module=transaction&action=gettxreceiptstatus&txhash=` for cheap
   pass/fail, or filter on `status` while paginating `addressTransactions`.

### (d) Monitor DogeSwapRouter events

The router is **unverified**, so Blockscout serves its logs with `decoded: null` — match
`topics[0]` yourself. Topic0 table computed from the local source
(`packages/contracts/src/DogeSwapRouter.sol:85-90`, `cast keccak`, 2026-07-02):

| event | topic0 |
|---|---|
| `Swapped(address indexed sender, address indexed recipient)` | `0xee1f638ee16713c8f3345a1bd43a1781e664ff9c9ff59d8372f6aabb8af8c70a` |
| `GuardianUpdated(address indexed)` | `0x6bb7ff33e730289800c62ad882105a144a74010d2bdbb9a942544a3005ad55bf` |
| `FeeUpdated(uint256,address indexed)` | `0x7cfad8b150be9751a5386cc4e0f549618032ff63d14fab4f77cd4b0aaaedc242` |
| `DefaultMaxInputUpdated(uint256)` | `0xd1b16168383f0ec7ab7af95e8f620f24a7689d16a154e0b51c037632c5d80609` |
| `MaxInputUpdated(address indexed,uint256)` | `0x61458b4d7325aa04522bfc88b549ebfaf994d14ad461a3070ab72888737180ac` |
| `Rescued(address indexed,address indexed,uint256)` | `0x3af790fafda720819b2fc6e15090606e81154e0ac9a92d38ecad006d99d20ecc` |
| OZ `Paused(address)` / `Unpaused(address)` | `0x62e78cea…b05a258` / `0x5db9ee0a…4b073aa` |
| OZ `OwnershipTransferred(address,address)` | `0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0` |

Same caveat as (c): the live pre-hardening router's event set may differ from source — confirm a
topic0 actually appears in its logs before alerting on absence. `Swapped` has both params indexed
→ addresses in `topics[1]`/`topics[2]`, empty `data`.

Polling pattern (copy `scripts/scan-dogeos-pools.mjs`): legacy
`GET /api?module=logs&action=getLogs&fromBlock={cursor}&toBlock=latest&address={router}&topic0={t}`;
status `"0"` = no logs (not an error); keep a block cursor and trail head by
`DOGEOS_CHAIN.documentedMaxReorgDepth` (17, `chains.mjs:20`); head via
`module=block&action=eth_block_number`. Blockscout caps getLogs result sets (~1000) — window
the block range. Or `topic0=`-less to catch everything, then bucket by the table. Pause/ownership
events firing = incident signal (guardian pause, timelock action).

### (e) Verify a deployed contract matches packages/contracts source

1. `bs.smartContract(addr)` → unverified gives `deployed_bytecode`; verified gives full
   `source_code`, `compiler_version`, `constructor_args`, `is_fully_verified`, etc.
   `bs.isVerified(addr)` for the quick boolean.
2. Local compile: `cd packages/contracts && forge build`, then
   `forge inspect src/DogeSwapRouter.sol:DogeSwapRouter deployedBytecode`.
3. Compare against `deployed_bytecode` **after** (i) stripping the trailing CBOR metadata section
   from both, and (ii) masking the immutable slots — `WDOGE`, `MUCHFI_V2_ROUTER`,
   `MUCHFI_V3_ROUTER`, `BARKSWAP_ALGEBRA_ROUTER` are immutables baked into runtime code
   (`DogeSwapRouter.sol:61-67`).
4. **Known result for the live router `0xa315…Aa35A`: it will NOT match.** It is immutable and
   pre-dates the 2026-06 audit fixes; a mismatch there is expected, not an alarm. A fresh deploy
   of the hardened source is the only path to a matching (and verifiable) router.
5. Publishing verification: the instance runs the Rust verifier microservice
   (`GET /api/v2/smart-contracts/verification/config` lists allowed compiler versions; POST
   endpoints under `/api/v2/smart-contracts/{addr}/verification/via/…` — unexercised as of
   2026-07-02). The `dogeos` skill covers foundry-based verification on DogeOS.
6. Cross-check what the repo itself asserts: `npm run verify:sources`
   (`scripts/verify-dogeos-sources.mjs`) runs the full registry verification ladder.

## Where the repo touches Blockscout (debug entry points)

| Consumer | File:line | What it fetches |
|---|---|---|
| `GET /activity` route | `packages/api/src/handler.mjs:768-798` | validates address (`:772`), clamps limit 1..50 (`:25-26,87-91`), 503-sanitizes failures (`:55-58,796`) |
| default activity provider | `packages/api/src/handler.mjs:120-139` | `GET /api/v2/addresses/{addr}/transactions` (URL builder `:93-95`); injectable via `activityProvider` (`:530`) |
| `GET /verification` route | `packages/api/src/handler.mjs:757-766` | serves the snapshot; static fallback provider `:509-519` |
| snapshot provider | `packages/aggregator/src/verification/verificationSnapshot.mjs:858-878` | 60 s TTL cache, **no single-flight** (cold concurrency = duplicate full builds) |
| per-target verify | `verificationSnapshot.mjs:694-758` | 3 fetches at `:703-708`: `/api/v2/addresses/{addr}` (required), `/api/v2/smart-contracts/{addr}` (optional), legacy `getabi` (optional); URL builders `:29-44`; plain `fetchJson`/`fetchOptionalJson` `:482-494` |
| token icon / holders / deployer | `packages/api/src/live.mjs:333, 384, 404` | `/api/v2/tokens/{addr}` (×2 — icon, holders_count), `/api/v2/addresses/{addr}` (`creator_address_hash` for guilt-by-association) |
| trending enrichment | `packages/aggregator/src/discovery/discoverableTokens.mjs:58-64` | `/api/v2/tokens/{addr}` holders+logo |
| pool scanner | `scripts/scan-dogeos-pools.mjs:30,73-90` | legacy `module=logs getLogs` + `eth_block_number` head |

Known weaknesses to keep in mind when debugging these (all current as of 2026-07-02): none of the
above fetches set a timeout/AbortSignal (a stalled explorer pins `/activity` until the 30 s server
requestTimeout); `/activity` can't reach page 2; the snapshot cache stampedes when cold. The
helper client exists precisely so new code doesn't repeat that — and is the drop-in fix if you're
asked to harden them.
