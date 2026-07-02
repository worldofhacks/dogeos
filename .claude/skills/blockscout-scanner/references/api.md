# Blockscout API catalog — DogeOS testnet instance

Every endpoint below was called live against `https://blockscout.testnet.dogeos.com` on
**2026-07-02** (backend v8.0.2 per `GET /api/v2/config/backend-version`; `CHAIN_TYPE=scroll`;
`/api/v2/main-page/indexing-status` → `finished_indexing:true`). Interactive Swagger:
`https://blockscout.testnet.dogeos.com/api-docs`. Upstream docs:
https://docs.blockscout.com/devs/apis/rest

Conventions: all wei / raw token amounts are **decimal strings** — keep them as strings
(BigInt-safe). `from`/`to` are rich address objects (`hash`, `is_contract`, `is_verified`,
`name`, `proxy_type`, `implementations`). List endpoints return
`{ items, next_page_params }`, fixed 50 per page, `?limit=` ignored.

## REST v2 — `/api/v2/…`

### Stats & chain

| Endpoint | Notes |
|---|---|
| `GET /stats` | `average_block_time` (ms; ~3505), `coin_price` (DOGE/USD feed live: "0.08616"), `gas_prices` {slow/average/fast Gwei, all 0.02}, `total_transactions`, `total_addresses`, `network_utilization_percentage`. `market_cap` "0", `tvl` null. |
| `GET /stats/charts/transactions` | daily `{date, transactions_count}` |
| `GET /stats/charts/market` | daily `closing_price` / `market_cap` |
| `GET /main-page/transactions` | quickest way to grab a recent real tx hash |
| `GET /main-page/indexing-status` | both ratios 1.00 |
| `GET /blocks` · `/blocks/{n_or_hash}` · `/blocks/{n}/transactions` | `height`, `gas_used`, `base_fee_per_gas`, `burnt_fees`, `miner` = 0x0…0 (sequencer). Blocks carry **no** `scroll` key. |
| `GET /transactions?filter=validated\|pending` | global stream |

### Transactions

| Endpoint | Notes |
|---|---|
| `GET /transactions/{hash}` | `status` "ok"/"error", `result`, **`revert_reason`**, `method` (raw 4-byte selector when the contract is unverified; name when verified), `decoded_input` (null unless verified), `raw_input`, `fee.value`, gas fields, `token_transfers` (embedded first page) + `token_transfers_overflow`, `transaction_types`, `has_error_in_internal_transactions`, `confirmations`, `type` (2 = EIP-1559), `authorization_list` (EIP-7702). |
| — `scroll` object | `{l1_fee, l1_base_fee, l1_blob_base_fee, l1_fee_scalar, l1_fee_blob_scalar, l1_fee_commit_scalar, l1_fee_overhead, l1_gas_used, l2_fee:{value}, l2_block_status}`. Verified: `fee.value = l1_fee + l2_fee.value` (12882960438579 + 5263210251340 = 18146170689919). `l2_block_status` "Confirmed by Sequencer" = batch-finality signal; other statuses (Committed/Finalized) not enumerated on this instance. |
| `GET /transactions/{hash}/token-transfers` | items: full `token` object (`decimals`, `type`, `holders_count`), `total:{decimals,value}`, `from`, `to`, `log_index`, `method` |
| `GET /transactions/{hash}/logs` | `address`, `topics[]`, `data`, `index`, `decoded` (null unless emitter verified), `smart_contract` |
| `GET /transactions/{hash}/internal-transactions` | `type` (call/staticcall/delegatecall/create), `from`, `to`, `value`, `gas_limit`, `success`, `error`, `index`, `block_index` |
| `GET /transactions/{hash}/state-changes` | works |
| `GET /transactions/{hash}/raw-trace` | debug_trace call tree with gas/input/output — the revert-decoding fallback |
| `GET /transactions/{hash}/summary` | **403 — Transaction Interpretation Service disabled** |

### Addresses

| Endpoint | Notes |
|---|---|
| `GET /addresses/{addr}` | `coin_balance` (wei string), `is_contract`, **`is_verified`**, `creation_transaction_hash`, `creator_address_hash`, `has_logs`, `has_token_transfers`, `proxy_type`, `implementations`, `token` (set if the address is a token). |
| `GET /addresses/{addr}/counters` | `{transactions_count, token_transfers_count, gas_usage_count, validations_count}` (strings) |
| `GET /addresses/{addr}/tabs-counters` | per-tab counts incl. `internal_transactions_count`, `logs_count` (capped ints) |
| `GET /addresses/{addr}/transactions?filter=to\|from` | same item shape as tx detail, minus `scroll` |
| `GET /addresses/{addr}/token-transfers?token={tokenAddr}` | token filter works |
| `GET /addresses/{addr}/internal-transactions` · `/logs` | work |
| `GET /addresses/{addr}/token-balances` | flat, no pagination |
| `GET /addresses/{addr}/tokens?type=ERC-20` | paginated variant |
| `GET /addresses/{addr}/coin-balance-history` | `delta`, `value`, `transaction_hash` per change |
| `GET /addresses/{addr}/nft` | enabled (`{"items":[]}` for non-holders) |

### Smart contracts

| Endpoint | Notes |
|---|---|
| `GET /smart-contracts/{addr}` | **Unverified → 200** with only `creation_bytecode`/`deployed_bytecode`. Verified → `abi`, `source_code`, `additional_sources[]`, `file_path`, `language`, `compiler_version`, `compiler_settings`, `evm_version`, `optimization_enabled/runs`, `constructor_args` + decoded, `is_verified`, `is_fully_verified`, `is_partially_verified`, `verified_at`, sourcify/eth_bytecode_db/verifier_alliance flags, `license_type`, `is_changed_bytecode`, `verified_twin_address_hash`, `proxy_type`, `implementations`. |
| `GET /smart-contracts?filter=` | paginated verified-contract list |
| `GET /smart-contracts/counters` | `{"smart_contracts":"9927","verified_smart_contracts":"209",…}` (2026-07-02) |
| `GET /smart-contracts/verification/config` | allowed `solidity_compiler_versions`, `license_types`, `is_rust_verifier_microservice_enabled:true`. POST verification under `/smart-contracts/{addr}/verification/via/…` should exist (unexercised). |
| `GET /smart-contracts/{addr}/methods-read` (and `-write`) | **404 — removed in v8 core.** Use the `abi` + your own `eth_call`. |

### Tokens

| Endpoint | Notes |
|---|---|
| `GET /tokens/{addr}` | `name`, `symbol`, `decimals` (string), `type`, `total_supply`, `holders_count`. `exchange_rate`/`icon_url`/`circulating_market_cap`/`volume_24h` all **null** (no pricing/icon service). Non-token address → 404 `{"message":"Not found"}`. USDC `0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925` is **18 decimals** on this testnet. |
| `GET /tokens/{addr}/counters` | `{token_holders_count, transfers_count}` |
| `GET /tokens/{addr}/holders` | `{address, value, token_id}`, sorted desc by value; cursor `{address_hash, value, items_count}` |
| `GET /tokens/{addr}/transfers` · `/instances` | work (instances for ERC-721) |
| `GET /tokens?q=&type=ERC-20\|ERC-721` | list/search |

### Search & misc

| Endpoint | Notes |
|---|---|
| `GET /search?q=` | typed items (`type`: token/address/transaction/block) |
| `GET /search/check-redirect?q=0x…` | `{"redirect":true,"type":"address"\|"transaction"\|…}` — cheap "what is this hash" classifier |
| `GET /advanced-filters` | combined tx/transfer stream with filter params — enabled |
| `GET /transactions/csv?…` | 422 without recaptcha — effectively unusable programmatically |
| `GET /withdrawals` | empty (N/A on this L2) |
| `POST /api/v1/graphql` | works (`{ block(number:…){ hash } }` → 200) |

## Pagination cursor (keyset)

`next_page_params` keys per endpoint family (echo verbatim; treat as opaque):

- address transactions: `block_number, fee, hash, index, inserted_at, items_count, value`
  (`items_count` grows 50 → 100 → … as a cumulative offset)
- token transfers: `block_number, index`
- token holders: `address_hash, value, items_count`

`null` = last page. The helper `paginate()` in `scripts/blockscout/client.mjs` handles all of this.

## `POST /api/eth-rpc` (JSON-RPC 2.0)

16 supported methods (docs: https://docs.blockscout.com/devs/apis/rpc/eth-rpc):
`eth_blockNumber, eth_getBalance, eth_getTransactionCount, eth_getCode, eth_getStorageAt,
eth_gasPrice, eth_maxPriorityFeePerGas, eth_chainId, eth_getTransactionByHash,
eth_getTransactionReceipt, eth_sendRawTransaction, eth_getBlockByNumber, eth_getBlockByHash,
eth_call, eth_estimateGas, eth_getLogs` (max 1000 logs/request). Verified live: blockNumber,
getBalance, getTransactionCount, gasPrice, call, getLogs, getTransactionByHash/Receipt.
Unsupported methods → `{"error":"Action not found."}`.

**Critical gotcha (verified live)**: this instance returns `eth_chainId` = **`0x1`** and embeds
`"chainId":"0x1"` in `eth_getTransactionByHash` results. Real DogeOS chain id is `0x5fdaf3`
(6281971). Never use `/api/eth-rpc` for chain-id / signing-domain data; `eth_sendRawTransaction`
and `eth_estimateGas` were not exercised.

## Legacy Etherscan-style — `GET /api?module=…&action=…`

All verified live (docs: https://docs.blockscout.com/devs/apis/rpc). Supports `page/offset/sort`
random access — the only random-access API here.

- `module=account`: `action=txlist&address=&page=&offset=&sort=desc` (flat Etherscan rows:
  decimal-string `blockNumber`, `input`, `confirmations`, `contractAddress`), `action=tokentx`,
  `action=txlistinternal&txhash=` (also by address), `action=balance`,
  `action=tokenbalance&contractaddress=&address=`
- `module=contract`: `action=getabi` (unverified →
  `{"status":"0","message":"Contract source code not verified","result":null}`),
  `action=getsourcecode` (includes `AdditionalSources`)
- `module=transaction`: `action=gettxreceiptstatus`
- `module=block`: `action=getblocknobytime&timestamp=&closest=before`,
  `action=eth_block_number` (head proxy — used by `scripts/scan-dogeos-pools.mjs:84-90`)
- `module=stats`: `action=coinprice`
- `module=logs`: `action=getLogs&fromBlock=&toBlock=latest&address=&topic0=` — status `"0"` +
  "No logs found" for empty sets (NOT an error; `scan-dogeos-pools.mjs:79` relies on this).
  Result sets are capped (~1000) with **no truncation signal** — window your block ranges.

## Rate limits / API keys

- Blockscout-hosted defaults (docs): 3 req/min keyless, 10 req/s with account API key
  (`apikey` query param). Those numbers are for Blockscout's own hosted instances.
- **This self-hosted DogeOS instance, empirically (2026-07-02)**: 20 back-to-back requests all
  200, zero `ratelimit-*`/`retry-after` headers, no key needed. Do not architect around that —
  the operator can enable `API_RATE_LIMIT_*` envs anytime. Keep client-side throttling and the
  helper's timeout.

## Not supported on this instance (probed 2026-07-02)

- Tx interpretation (`/summary`) → 403 disabled; ERC-4337 account-abstraction proxy → 501
- `methods-read`/`methods-write` → 404 (v8 removal)
- Name service (`ens_domain_name` always null), metadata/public tags, token pricing/icons
- CSV export without recaptcha; beacon withdrawals

## Verified reference data (2026-07-02)

- DogeSwapRouter `0xa3158549f38400F355aDf20C92DA1769620Aa35A`: **unverified**; creator
  `0xE659A8d3745b1355CA47B3d92925997Ef93a2873`; creation tx
  `0xec772d34ccb8ade539445f68d34a2b3606c339aafc7739c86a08d43c83bf277d`; 23 txs / 82 token
  transfers per counters; zero balance.
- Sample swap tx: `0x33e353d61fbf24f23c0be44fa99ad21507a9c1da317c32eaa8346997f5bbec56`
  (block 5964823; 5 token transfers, 8 logs, 23 internal txs).
- Verified-contract example: `0x04d031B63f0B6AFEe69e06564792222742BE9F03` (vyper "univ2",
  compiler v0.4.3) — useful to see the full verified response shape.
- Deep pagination test address: `0xBd6d53bad965836E19565D7b58D78e8f87d80858` (sequencer
  heartbeat, millions of txs).
- Block time ~3.5 s; gas price ~0.02 Gwei.
