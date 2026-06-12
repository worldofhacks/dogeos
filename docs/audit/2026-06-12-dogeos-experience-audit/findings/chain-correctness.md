# DogeOS Chain-Correctness Audit (config, RPC, fees)

**Audit date:** 2026-06-12
**Auditor role:** Senior DogeOS protocol engineer
**Scope:** `packages/config` (chains/tokens), `packages/dogeos-rpc` (JSON-RPC client),
`packages/aggregator/src/fees/*` (L1 oracle / data-finality / fee estimator), and the
chain-facing wiring in `packages/api/src/live.mjs`.
**Method:** static read + live probes against `https://rpc.testnet.dogeos.com`,
the unifra fallback, the `wss://ws.rpc.testnet.dogeos.com` host, and the
`L1GasPriceOracle` predeploy `0x5300…0002` on 2026-06-12.

---

## Overall assessment

DogeSwap models the DogeOS fee architecture more faithfully than most L2 aggregators:
it correctly treats total cost as `executionFee + dataFinalityFee`, reads the
chain's real `L1GasPriceOracle.getL1Fee(bytes)` predeploy for the data/finality
component, and — critically — uses the **actual signed router calldata** for the
final pre-swap fee/balance check. The chain identity (chainId, native decimals,
oracle address, reorg depth, fallback RPC) is correct and confirmed against live
reads and the official docs.

The problems are concentrated in two places. First, the **quote-time** data/finality
fee uses a hard-coded 228/260-byte calldata stand-in that bears no relation to the
real router `execute()` payload (live-measured at 900–1316 bytes), so route scoring
and the displayed fee under-count the data/finality fee by roughly 5x for every
router-mode and split swap. Second, several **config constants are cosmetically
wrong or stale**: a WebSocket URL that does not exist (live HTTP 404), a chain
display name and native-currency name that disagree with the official docs
(`Chikyu` vs `Chikyū`, `DogeOS DOGE` vs `DOGE`). There is also a chain-behavior gap:
DogeOS supports EIP-1559 (live `baseFeePerGas` and `eth_maxPriorityFeePerGas` both
respond), but the aggregator quotes and prices fees using legacy `eth_gasPrice`
only. None of these are protocol-breaking, but the fee-estimate inaccuracy directly
affects route selection quality — the aggregator's core job.

---

## Strengths

- **Correct DogeOS fee decomposition.** `dogeosFeeEstimator.mjs:1-8` computes
  `totalFeeWei = gasUnits*gasPriceWei + dataFinalityFeeWei`, exactly matching the
  documented `totalTxFee = executionFee + dataAndFinalityFee` model
  (developer-guide.md:285, networks.md:163).
- **Real oracle, real predeploy.** `l1GasPriceOracle.mjs:3,53` calls
  `getL1Fee(bytes)` (selector `0x49948e0e`) on `DOGEOS_CHAIN.l1GasPriceOracle =
  0x5300…0002`. Live-confirmed: the predeploy responds and is Scroll-Curie-derived
  (`isCurie()=true`, `scalar()=938846`, `blobScalar()=18`, `l1BaseFee()=1.5e16`).
  The selector and ABI encoding (`offset=32`, length-prefixed bytes) are correct —
  live `getL1Fee` returns sane, monotonic values.
- **The pre-swap fee check uses the actual transaction.** `live.mjs:186-192`
  wires `resolvedSwapDataFinalityFeeWei` with `payloadProvider:
  ({ transaction }) => transaction.data`, so `verifySwapTransaction`
  (`verifySwapTx.mjs:64-72`) and the balance preflight price the data/finality fee
  on the *real* router calldata. This is the correct DogeOS behavior and avoids
  on-chain "insufficient funds" surprises even though the *quote* estimate is off.
- **Oracle-failure handling is safe and non-silent.** The provider catches oracle
  read failures and falls back to `fallbackFeeWei` (`l1GasPriceOracle.mjs:100-103`),
  and `live.mjs:178-179` logs a warning on every fallback rather than silently
  zeroing the fee.
- **Bounded fee cache.** The data/finality cache is keyed by calldata and capped at
  `maxCacheEntries` with insertion-order eviction (`l1GasPriceOracle.mjs:55,95-98`),
  preventing unbounded growth on a long-running server where every swap has unique
  calldata.
- **Strict RPC hex validation.** `jsonRpcClient.mjs` validates hex quantities, data,
  and addresses before sending, and rejects values that overflow JS safe integers
  (`hexQuantityToNumber`, line 16-20) — correct for an 18-decimal native token.
- **Chain-id guard before quoting/swapping.** `live.mjs:31-53` verifies the RPC's
  `eth_chainId` equals `6281971` before serving, with the result memoized.
- **Correct native decimals.** Both config and SDK config use 18 decimals for the
  DogeOS L2 native DOGE and correctly distinguish the Dogecoin L1 8-decimal token
  (`sdkConfig.js:18-23`), matching networks.md:67-70.

---

## Findings

### CHAIN-1 — Quote-time data/finality fee uses a fixed 228/260-byte stand-in, ~5x under the real router calldata
**Severity:** high · **Confidence:** high
**Location:** `packages/aggregator/src/fees/l1GasPriceOracle.mjs:5-9,45-49`;
`packages/aggregator/src/routes/splitRoutes.mjs:90-93`;
`packages/aggregator/src/routes/splitRoutes.mjs:29-48` (wrap path)

**Evidence.** `estimatedSwapPayloadForFee` returns a fixed payload sized by
protocol — `v2:260, v3:228, algebra:260` bytes (`l1GasPriceOracle.mjs:5-9`) — and
this is what every quote-time candidate uses for its `dataFinalityFeeWei`
(`v2Pools.mjs:272-281`, `concentratedLiquidity.mjs:107-118`). But the swap that
actually executes is a single `DogeSwapRouter.execute(bytes,bytes[],…)` program.
Building a representative 2-leg split (v3+v2) with the real builder
`buildDogeSwapSplitCalldata`:

- split **with** in-tx Permit2 permit (default "all" router mode): **1316 bytes**
- split **without** permit (direct approval): **900 bytes**

Pricing these against the live oracle on 2026-06-12:

| payload | bytes | live `getL1Fee` (wei) |
|---|---|---|
| v3 quote estimate | 228 | 4.196e12 |
| v2 quote estimate | 260 | 4.785e12 |
| real split (no permit) | 900 | 1.656e13 |
| real split (with permit) | 1316 | 2.422e13 |

The real router split data/finality fee (~2.42e13) is **~5x** the v2 quote estimate
(~4.79e12). For a split, `composeSplitCandidate` makes this worse conceptually:
`splitRoutes.mjs:90-93` *sums* each leg's independent ~260-byte estimate
(≈9.5e12 for two legs), but the data fee is per-transaction on the *aggregated*
calldata, not additive per leg — so even the arithmetic model is wrong, not just
the byte count. In single-venue "all" router mode, `wrapQuoteForRouterExecution`
(`splitRoutes.mjs:29-48`) keeps the venue leg's ~228/260-byte
`dataFinalityFeeWei` even though execution goes through the router (700+ bytes with
the permit).

Note (chain-specific): on DogeOS Curie the oracle prices zero and non-zero bytes
**identically** (live-measured ~1.84e10 wei/byte for both `0xff` and `0x00`
payloads), so the all-`0xff` stand-in does *not* over-count per byte — the error is
purely the byte *count*. This means the inaccuracy cannot be hand-waved as
"conservative"; it is a straight under-estimate.

**Impact.** Route scoring (`direct.mjs` `scoreQuote`) subtracts data/finality fee
from net output. Under-counting it by ~5x for router/split routes while a true
direct-venue route (when not router-wrapped) would carry a similar real fee biases
the scorer toward router/split execution and mis-ranks routes whenever the
data/finality fee is a non-trivial share of the trade — exactly the small-trade
regime where an aggregator should be most careful. The user-displayed fee in the
quote is likewise understated (the final balance check is correct, so this is a
quote-accuracy/route-quality bug, not a fund-loss bug).

**Recommendation.** Estimate the data/finality fee at quote time from the *actual*
program that will execute: for router/split candidates, build (or size) the real
`execute()` calldata and price that single blob once per candidate, rather than
summing per-leg 260-byte stand-ins. At minimum, replace the per-protocol fixed
constants with a byte count derived from the command set (legs × per-command words
+ Permit2 permit/transfer + settlement head), and for splits price one aggregated
payload instead of summing legs. Optionally add the documented ~74-byte
signature/RLP allowance (see CHAIN-2).

---

### CHAIN-2 — `getL1Fee` is fed raw calldata, omitting the signed-RLP-tx envelope the oracle expects
**Severity:** low · **Confidence:** medium
**Location:** `packages/aggregator/src/fees/l1GasPriceOracle.mjs:26-32,83-90`

**Evidence.** `encodeGetL1FeeCall` passes the bare router calldata bytes to
`getL1Fee(bytes)`. The DogeOS docs specify the argument is a *"Signed fully
RLP-encoded transaction"* (developer-guide.md:341-350, networks.md:176-177), and
the companion `getL1GasUsed` explicitly *"Adds 74 bytes of padding to account for
the fact that the input does not have a signature."* The raw calldata omits the
RLP transaction envelope (nonce, gasPrice/maxFee, gasLimit, to, value, chainId, the
list framing) and the ~65-byte signature. Live-measured per-byte cost is
~1.84e10 wei, so the omitted ~74 bytes alone is ~1.36e12 wei (~5-6% of a real
split's data/finality fee), with additional bytes for the RLP header.

**Impact.** A small, consistent **under**-estimate of the data/finality fee on top
of CHAIN-1. Because the pre-swap balance check uses the same raw-calldata pricing
(`live.mjs:190`), the on-chain charge is slightly higher than the value the server
computed; the gas buffer (`verifySwapTx.mjs:49` 120%) and execution-fee headroom
generally absorb it, so this is low severity on its own — but it compounds CHAIN-1.

**Recommendation.** Add a fixed allowance for the missing signature + RLP envelope
(the docs' 74-byte signature figure is the documented baseline; add ~10–15 bytes
for the tx-field RLP framing) to the payload length before calling `getL1Fee`, or
construct a representative unsigned-tx RLP and pad it. Document the choice next to
`encodeGetL1FeeCall`.

---

### CHAIN-3 — Config declares a WebSocket RPC endpoint that does not exist
**Severity:** medium · **Confidence:** high
**Location:** `packages/config/src/chains.mjs:11`

**Evidence.** `wsRpcUrls: ["wss://ws.rpc.testnet.dogeos.com"]`. Live probe on
2026-06-12: `https://ws.rpc.testnet.dogeos.com` returns **HTTP 404** (empty body),
and a WebSocket upgrade handshake to that host also 404s. The official DogeOS docs
document **no** WebSocket endpoint anywhere (networks.md:24, networks.md:265:
"No WebSocket RPC URL is documented on any page; only the HTTP RPC exists").

**Impact.** Today this is latent: no code path consumes `wsRpcUrls` (grep shows zero
non-config references), so nothing breaks at runtime. But it is a correctness
landmine — any future subscription/streaming feature (pending-tx feeds, log
subscriptions, live price push) that trusts this constant will fail against a
non-existent endpoint, and the value misrepresents the chain's actual capabilities
to anyone reading the config as ground truth.

**Recommendation.** Remove `wsRpcUrls` entirely (DogeOS has no WS endpoint), or set
it to `[]` with a comment citing the docs. If a WS endpoint is ever published,
re-add the verified URL. Do not ship a fabricated endpoint.

---

### CHAIN-4 — Chain display name and native-currency name disagree with official docs
**Severity:** low · **Confidence:** high
**Location:** `packages/config/src/chains.mjs:4,6`; mirrored in
`apps/web/src/sdkConfig.js:6-7` and `apps/web/src/injected-wallet.js:5-6`

**Evidence.**
- `name: "DogeOS Chikyu Testnet"` — official docs spell it **`DogeOS Chikyū
  Testnet`** with the macron ū (networks.md:21, developer-guide.md:34). All three
  DogeSwap config sites drop the macron.
- `nativeCurrency.name: "DogeOS DOGE"` — official docs and the SDK chain definition
  use **`DOGE`** for both name and symbol (networks.md:27,35:
  `{ name: "DOGE", symbol: "DOGE", decimals: 18 }`). Note the frontend
  `sdkConfig.js:7` and `injected-wallet.js:6` already use the correct
  `name: "DOGE"`, so the canonical `chains.mjs` is the outlier on the currency name.

**Impact.** Cosmetic/identity drift. The macron mismatch is harmless for chain-id
matching but is wrong as a display string and, in a `wallet_addEthereumChain` flow,
produces a chain name that doesn't match what the docs/portal show users. The
`"DogeOS DOGE"` currency name is inconsistent with both the docs and DogeSwap's own
frontend. No functional break (decimals and symbol are correct).

**Recommendation.** Set `name: "DogeOS Chikyū Testnet"` and
`nativeCurrency.name: "DOGE"` in `chains.mjs`, and fix the `Chikyu` spelling in
`sdkConfig.js`/`injected-wallet.js` for parity. Keep symbol `DOGE`, decimals `18`.

---

### CHAIN-5 — Aggregator prices and quotes in legacy `eth_gasPrice`; DogeOS supports EIP-1559
**Severity:** low · **Confidence:** high
**Location:** `packages/dogeos-rpc/src/jsonRpcClient.mjs:144-146`;
`packages/api/src/live.mjs:288,327`; `packages/api/src/live.mjs:85-90`

**Evidence.** The client exposes only `getGasPriceWei()` (legacy `eth_gasPrice`),
and the handler wires `gasPriceWei: async () => client.getGasPriceWei()`
(`live.mjs:288`) for scoring and the balance preflight (`live.mjs:327`). Live probe
shows DogeOS is EIP-1559-enabled: latest block carries `baseFeePerGas = 0xef4208`
(~15.68M wei), `eth_feeHistory` returns base-fee and reward arrays, and
`eth_maxPriorityFeePerGas` returns `0x64` (100 wei). The execution submission
(`apps/web/src/lib/execute.js`) sets no `maxFeePerGas`/`maxPriorityFeePerGas` — it
relies entirely on the wallet's gas defaults (grep finds no 1559 fields anywhere in
`packages`/`apps/web/src`).

**Impact.** `eth_gasPrice` on a 1559 chain typically returns `baseFee + a default
tip`, so the execution-fee estimate is approximately right today but can drift from
what the wallet actually pays (the wallet builds a 1559 tx with its own
base-fee-multiplier and priority fee). Under base-fee movement on a 3s-block chain
this creates a quote-vs-charged discrepancy in the execution-fee component (the
data/finality component is already locked per the docs once sequenced). Low severity
because base fee is currently tiny and stable, and the gas buffer absorbs slack —
but it is an "assumes pre-1559 Ethereum" modeling choice on a chain that is not.

**Recommendation.** Add `eth_maxPriorityFeePerGas` + block `baseFeePerGas`
(or `eth_feeHistory`) reads to the RPC client and price the execution fee as
`baseFee + priorityTip` to match the 1559 transaction the wallet will actually
broadcast; surface the tip so the execute path can set explicit
`maxFeePerGas`/`maxPriorityFeePerGas` instead of deferring entirely to wallet
defaults.

---

### CHAIN-6 — `documentedMaxReorgDepth = 17` is surfaced but never enforced for confirmations/finality
**Severity:** low · **Confidence:** high
**Location:** `packages/config/src/chains.mjs:20`; consumed only as a status field at
`packages/api/src/live.mjs:111` and `packages/api/src/handler.mjs:92`;
receipt handling `apps/web/src/lib/execute.js:263-289`

**Evidence.** `documentedMaxReorgDepth: 17` matches the docs (networks.md:83,
developer-guide.md:263: max reorg depth 17 blocks). But the only consumers echo it
into the `/chain-status` payload — no code waits N confirmations or finalization.
`waitForTransactionReceipt` (`execute.js:274-285`) treats a transaction as final
the instant `eth_getTransactionReceipt` returns a non-null receipt with
`status != 0`, i.e. **1 inclusion, 0 confirmations**.

**Impact.** Per DogeOS docs, ordering can change within 17 blocks and absolute
certainty requires Dogecoin-side finalization. Treating first inclusion as final
means a UI "swap succeeded" can, in principle, be reorged on testnet. For an
interactive swap UI on a 3s-block chain this is a normal/acceptable UX tradeoff, so
severity is low — but the codebase imports the 17-block constant and then ignores
it, which reads as a guarantee it does not provide.

**Recommendation.** Either (a) document explicitly that the app intentionally
reports first-inclusion and treats `documentedMaxReorgDepth` as informational only,
or (b) for high-value flows, gate "final" status on `currentBlock - receipt.block
>= documentedMaxReorgDepth`. Don't leave the constant present-but-unused implying a
confirmation policy that isn't implemented.

---

### CHAIN-7 — Single-endpoint RPC client: no fallback, retry, or per-request timeout despite a configured fallback URL
**Severity:** medium · **Confidence:** high
**Location:** `packages/dogeos-rpc/src/jsonRpcClient.mjs:59-93`;
`packages/config/src/chains.mjs:12` (`fallbackRpcUrls`)

**Evidence.** `createJsonRpcClient({ rpcUrl, fetchFn })` is bound to exactly one
URL. `request`/`requestBatch` issue a single `fetchFn(rpcUrl, …)` with **no retry,
no timeout (no `AbortSignal`), and no fallback**. The config does ship a working
fallback — `fallbackRpcUrls: ["https://dogeos-testnet-public.unifra.io/"]`, and a
live probe confirms it answers `eth_chainId` → `0x5fdaf3` and `eth_blockNumber` —
but the client never consults it. `fallbackRpcUrls` is only echoed into
`/chain-status` (`live.mjs:106`, `handler.mjs:87`), never used to actually fail over.
A primary-RPC stall therefore hangs each request until the Node global-fetch /
server socket timeout, with no automatic recovery.

**Impact.** Every quote and swap depends on a single endpoint with no resilience.
A primary-RPC outage or slow response takes the whole aggregator down even though a
known-good fallback is one line away in config. The absence of a per-request
timeout also means a half-open connection can pin a request indefinitely.

**Recommendation.** Add an `AbortSignal`-based per-request timeout, a small bounded
retry, and round-robin/failover across `[rpcUrls[0], ...fallbackRpcUrls]`. The
provider only needs to thread the fallback list (it already imports `DOGEOS_CHAIN`)
into `createJsonRpcClient` and try the next URL on network error / timeout / 5xx.

---

### CHAIN-8 — Unknown `protocolType` silently yields a zero data/finality fee in quoting
**Severity:** low · **Confidence:** high
**Location:** `packages/aggregator/src/fees/l1GasPriceOracle.mjs:45-49,71-72`

**Evidence.** `estimatedSwapPayloadForFee` returns `"0x"` for any `protocolType`
not in `{v2,v3,algebra}` (line 47), and the provider returns
`BigInt(fallbackFeeWei)` (default `0n`) when payload is `"0x"` (line 72).
Live-confirmed: `getL1Fee("0x")` returns 0, so the path is internally consistent —
but it means any new venue protocol added without updating the
`ESTIMATED_SWAP_PAYLOAD_BYTES` table gets a **silent 0** data/finality fee and is
scored as if data-free.

**Impact.** A future protocol integration (or a typo in `protocolType`) silently
under-prices that route, biasing the scorer toward it. No current breakage —
the three live protocols are all covered. Defensive/forward-looking.

**Recommendation.** Make an unknown `protocolType` either throw (fail loud in dev)
or fall back to the largest known estimate rather than `0x`. Pairs naturally with
the CHAIN-1 fix (derive bytes from the command set), which removes the per-protocol
table entirely.

---

### CHAIN-9 — Stale on-chain audit docs claim Permit2 is ABSENT on DogeOS (it is deployed)
**Severity:** info · **Confidence:** high
**Location:** `packages/contracts/audit/CHAIN_FACTS.md:92-100` (and per the brief,
`packages/contracts/audit/DEPLOYMENT.md`, `KNOWN_ISSUES.md`)

**Evidence.** `CHAIN_FACTS.md:96-98` states *"Permit2 is ABSENT. The canonical
Permit2 address has no bytecode on DogeOS testnet"* and prescribes deploying it via
the Arachnid CREATE2 proxy. Ground-truth live read (2026-06-12) confirms Permit2 IS
deployed at the canonical `0x000000000022D473030F116dDEE9F6B43aC78BA3` (getCode
returns bytecode). The single-approval flow in
`dogeSwapRouterCalldata.mjs:21` already hard-codes and relies on that canonical
address, which is correct — so the *code* is right and only the *docs* are stale.

**Impact.** No runtime impact (code uses the live canonical address). But the audit
docs are a primary reference for operators and future contributors; leaving a
"Permit2 must be deployed" instruction that contradicts the live chain risks
duplicate-deploy attempts and erodes trust in the audit record.

**Recommendation.** Update `CHAIN_FACTS.md` §4, `DEPLOYMENT.md`, and
`KNOWN_ISSUES.md` to record that Permit2 is live at the canonical address on DogeOS
Chikyū Testnet (with the getCode evidence + date), and remove the
CREATE2-deploy-required action item.

---

## Confirmed-correct (verified, no action)

- `id: 6_281_971` / `idHex: "0x5fdaf3"` — live `eth_chainId` = `0x5fdaf3`. ✓
- `l1GasPriceOracle: 0x5300…0002` — predeploy has code, responds to all documented
  getters. ✓
- `fallbackRpcUrls` unifra endpoint — live `eth_chainId`/`eth_blockNumber` OK
  (correctness of the *value*; usage gap is CHAIN-7). ✓
- `rpcUrls[0]` trailing-slash: config uses `https://rpc.testnet.dogeos.com` (no
  slash); docs use both forms interchangeably (networks.md:40-43) — same endpoint,
  not a defect. ✓
- Token decimals: all six official tokens declared `decimals: 18`
  (`tokens.mjs`) — consistent with DogeOS 18-decimal EVM tokens. (Token *addresses*
  are an integrations-dimension concern, out of scope here.)
- Native decimals 18 (L2) vs 8 (Dogecoin L1) correctly separated. ✓
