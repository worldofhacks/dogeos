# DogeSwap Engineering Audit — DogeOS Chikyū Testnet

**Audit date:** 2026-06-12
**Auditor role:** Senior DogeOS protocol engineer
**Chain:** DogeOS Chikyū Testnet, chainId **6281971** (`0x5fdaf3`), RPC `https://rpc.testnet.dogeos.com`
**Live targets:**
- DogeSwapRouter `0xa3158549f38400F355aDf20C92DA1769620Aa35A`
- TimelockController `0xf3410B762Db55aA3CBAfaa5707899b3d3A7F1773` (`getMinDelay()=172800`)
- DogeSwapRegistry `0xC596081d427E8296e089eDD59a62E73Da3191215`
- Governance EOA `0xE659A8d3745b1355CA47B3d92925997Ef93a2873` (code size 0, nonce 15, ~40 DOGE)
- Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` (live `getCode` = 9,152 bytes — **present**)

**Per-dimension detail files (read these for full evidence and per-finding fixes):**
- [`findings/contracts.md`](./findings/contracts.md) — DogeSwapRouter / Registry / deploy stack
- [`findings/chain-correctness.md`](./findings/chain-correctness.md) — config, RPC client, fee model
- [`findings/aggregator.md`](./findings/aggregator.md) — quote math, routing, calldata builder
- [`findings/sdk.md`](./findings/sdk.md) — `@dogeos/dogeos-sdk` 3.2.0 wallet integration
- [`findings/backend.md`](./findings/backend.md) — HTTP API, hardening, ops

---

## 1. Engineering verdict & mainnet-readiness assessment

**Verdict: the swap engine is genuinely well-built and DogeOS-correct; the product is NOT mainnet-ready, and the gap is governance and operational, not the contract's swap logic.**

The `DogeSwapRouter` is the strongest part of the codebase. Its balance-delta ledger, movement-only command whitelist, Permit2-only pulls keyed to `msg.sender`, enforced post-loop settlement, and a transient-storage reentrancy guard together bound worst-case loss to the in-flight notional of a single authorized transaction. I could not construct a path to drain stranded funds, spend a third party's Permit2 allowance, or bypass `minOut` through the command program. The aggregator's quote math (V2 constant-product, V3/Algebra concentrated-liquidity), the venue-specific 20 bps MuchFi-V2 fee, the byte-for-byte-verified `execute()` calldata, and the mandatory pre-return simulation + balance preflight are all carefully done. The backend is unusually hardened for a testnet DEX (enforced CORS, no RPC proxy, SSRF-closed `/activity`, body caps, generic-500 policy), and the chain-correctness layer models DogeOS's `executionFee + dataAndFinalityFee` cost split using the real `L1GasPriceOracle.getL1Fee` predeploy. **Live probes confirmed the chain identity, all six token contracts, all four immutable venue addresses, both live V2 pools, the fee-oracle selector/encoding, and Permit2's presence — zero mismatches in those layers.**

What blocks mainnet is the **live governance state**, which contradicts the entire governance model in `packages/contracts/audit/DEPLOYMENT.md`. On-chain, a single externally-owned key is simultaneously the router `owner`, the router `guardian`, the registry `owner`, the timelock `PROPOSER`/`EXECUTOR`/`CANCELLER`, and — decisively — the holder of the timelock's `DEFAULT_ADMIN_ROLE`, a role OpenZeppelin documents as one that **bypasses the timelock delay entirely**. The advertised "48h timelock + Safe + separate guardian" is therefore a façade in its current state: that one key can reconfigure everything instantly, and the same key file lives on the internet-facing web host. The router's owner→timelock handover was started (`transferOwnership` fired; `pendingOwner()` is the real timelock) but never finished (`acceptOwnership()` outstanding), so the EOA remains owner. Beyond governance, the deployed product ships the DogeOS SDK as dead code (empty clientId), the quote-time data/finality fee under-counts the real router calldata by ~5x (a route-quality bug), and several audit docs are stale (Permit2 "ABSENT" when it is deployed). None of these are direct theft-of-deposits primitives — the per-execute ledger keeps the router holding ~0 between transactions — but the governance/ops posture is a hard mainnet blocker and must be remediated before any value is at stake.

**Ground-truth correction applied (overturns a prior finding):** the live probe proved `wss://ws.rpc.testnet.dogeos.com` is a **working RFC6455 WebSocket JSON-RPC endpoint** (socket opened, `eth_chainId`→`0x5fdaf3`, live `eth_subscribe('newHeads')` pushed a new head). The earlier "dead WS endpoint (HTTP 404)" conclusion was a probe-methodology artifact — that AWS load balancer returns 404 to non-WebSocket HTTP requests but accepts genuine upgrades. **`chains.mjs` `wsRpcUrls` is therefore VALID** (undocumented by DogeOS, but real), and the prior CHAIN-3 "config declares a non-existent endpoint" finding and the WS portion of BACKEND-5 are **refuted and withdrawn** from this report.

---

## 2. Severity-ordered findings table

| ID | Area | Finding | Severity |
|----|------|---------|----------|
| CONTRACTS-1 | Contracts / Gov | Timelock `DEFAULT_ADMIN_ROLE` still held by the EOA — bypasses the 48h delay; advertised timelock is cosmetic | **Critical** |
| CONTRACTS-2 | Contracts / Gov | One EOA == router owner == guardian == registry owner == timelock proposer/executor; owner→timelock `acceptOwnership()` never run | **Critical** |
| CONTRACTS-3 | Contracts | Registry `setCurrentRouter` is a single-writer pointer with no validation/delay; live owner is a bare EOA (redirect/phishing primitive) | High |
| CHAIN-1 | Chain / Aggregator | Quote-time data/finality fee uses a fixed 228/260-byte stand-in; real `execute()` calldata is 900–1316 bytes → ~5x under-count, mis-ranks routes | High |
| SDK-1 | SDK | SDK is dead code in prod (empty clientId): Connect Kit, embedded wallets, mobile MyDoge never load; only injected EIP-6963 fallback runs | High |
| SDK-2 | SDK | `WalletConnectProvider` not nested in `WagmiProvider` (no Wagmi config exists); documented Wagmi sync can never engage; `wagmi` dep is dead weight | High |
| CONTRACTS-4 | Contracts / Docs | `DEPLOYMENT.md`/`CHAIN_FACTS.md`/`KNOWN_ISSUES.md` state Permit2 "ABSENT"; it is deployed at the canonical address → deterministic-deploy premise stale | Medium |
| CONTRACTS-5 | Contracts | `s.recipient == address(0)` silently no-ops settlement in production `execute`/`_settle` (no minOut, no payout, no refund) | Medium |
| CHAIN-7 | Chain / Backend | RPC client is single-endpoint: no retry, no per-request timeout, no failover, despite a working `fallbackRpcUrls` in config | Medium |
| BACKEND-1 | Backend | Public `/quote` DoS lever — multi-RPC fan-out per request behind a coarse global fixed-window limiter (boundary 2x burst) | Medium |
| BACKEND-3 | Backend / Ops | Router owner==guardian==single EOA whose key sits on the public-facing web host (ops blast radius) | Medium |
| BACKEND-4 | Backend | Prod serves framing-only CSP (`frame-ancestors 'self'`); the prepared hardened policy is left commented-out | Medium |
| SDK-3 | SDK | Live CSP lacks `tomo.inc` `frame-src`/`connect-src`; enabling clientId without the hardened CSP breaks the embedded wallet (and the prepared CSP omits one needed `connect-src` origin) | Medium |
| SDK-4 | SDK | Hand-rolled ~680-line injected EIP-6963 bridge re-implements wallet discovery the SDK owns; brittle brand heuristics + load-bearing `process`/`Buffer` shims | Medium |
| SDK-5 | SDK | Two disjoint React roots bridged by `window` globals + CustomEvents instead of SDK hooks; forfeits React context, forces manual replay reconciliation | Medium |
| AGG-1 | Aggregator | `outputWeiPerFeeWei`/`inputWeiPerFeeWei` hardcoded to `1n`; mis-scales displayed fee/net-output for any pair not priced ~1:1 vs DOGE | Medium |
| AGG-2 | Aggregator | V3/Algebra split-leg `feeTier` reconstructed as `feeBps * 100`; silently wrong for any tier not divisible by 100 | Medium |
| AGG-3 | Aggregator | Permit2 in-tx permit reuses a stale nonce on swap retry; second attempt reverts with opaque error (no fund loss) | Medium |
| CONTRACTS-6 | Contracts | A `feeRecipient` that reverts on native receive = global native-output-swap DoS (dormant: `feeBps()=0`) | Low |
| CHAIN-2 | Chain | `getL1Fee` fed raw calldata, omitting the signed-RLP-tx envelope (~74-byte sig + framing); compounds CHAIN-1 under-count | Low |
| CHAIN-4 | Chain | `chains.mjs` name `"DogeOS Chikyu Testnet"` / native `"DogeOS DOGE"` diverge from official `"DogeOS Chikyū Testnet"` / `"DOGE"` (live-confirmed cosmetic drift) | Low |
| CHAIN-5 | Chain | Aggregator prices in legacy `eth_gasPrice`; DogeOS supports EIP-1559 (live `baseFeePerGas` + `eth_maxPriorityFeePerGas`) | Low |
| CHAIN-6 | Chain | `documentedMaxReorgDepth=17` surfaced but never enforced; UI treats first inclusion (0 confirmations) as final | Low |
| CHAIN-8 | Chain / Aggregator | Unknown `protocolType` silently yields a `0x` payload → zero data/finality fee in scoring | Low |
| AGG-4 | Aggregator | No fee-on-transfer / rebasing-token handling in V2 quote math (inert: all six listed tokens are standard ERC20) | Low |
| AGG-5 | Aggregator | One-hop (via-WDOGE) candidates are preview-only and can never execute; no multi-hop command exists | Low |
| AGG-6 | Aggregator | Client-controlled `deadline` has no server-side floor; relies on simulation to reject past deadlines | Low |
| SDK-6 | SDK | App `sdkConfig.js`/`injected-wallet.js`/`sdk-chain-switch.js` use `"Chikyu"` (no macron) vs official `"Chikyū"` | Low |
| SDK-7 | SDK | `metadata.url` derived from `window.location.origin`; no WalletConnect projectId → rides SDK shared default project | Low |
| BACKEND-2 | Backend | `/quote` does not validate token-address shape before provider fan-out (fails closed, but wastes RPC + leaks venue error strings) | Low |
| BACKEND-5 | Backend / Docs | Stale Permit2-"ABSENT" docs + chain name drift (WS portion **refuted** — endpoint is live) | Low |
| BACKEND-6 | Backend / Ops | `.env.example` and Dockerfile default `HOST=0.0.0.0` (prod `.env` correctly overrides to `127.0.0.1`) | Low |
| CONTRACTS-7 | Contracts | DogeOS EVM-difference review clean; vendor/pin OZ (no `lib/`, no `.gitmodules`) to fully verify dep bytecode | Info |
| CONTRACTS-8 | Contracts | Ledger `cap = 2n+2` sizing + delta accounting verified correct under stress (positive) | Info |
| AGG-7 | Aggregator | Split optimizer cannot split across two pools of the same venue (e.g. MuchFi V3 500 vs 2500) | Info |
| AGG-8 | Aggregator | Split gas estimate uses direct-call gas + flat 90k overhead, not modeled per-leg router gas (display only; executed limit is real `estimateGas`) | Info |
| SDK-8 | SDK | `useWallet.js` Permit2-deferral rationale is partly stale (Permit2 now live; SDK still genuinely lacks `signTypedData`) | Info |
| BACKEND-7 | Backend | Vite dev middleware leaks raw error messages / no body cap (dev-only; prod path is hardened) | Info |
| BACKEND-8 | Backend | Static file serving is path-traversal-safe (positive) | Info |

**Count by final severity: Critical 2 · High 4 · Medium 12 · Low 14 · Info 7 = 39 findings.**
(The previously-listed CHAIN-3 "non-existent WS endpoint" is refuted and excluded; the WS half of BACKEND-5 is withdrawn.)

---

## 3. Findings by area

### 3.1 Smart contracts — DogeSwapRouter, Registry, deploy stack
Full detail: [`findings/contracts.md`](./findings/contracts.md)

**CONTRACTS-1 (Critical) — Timelock admin role bypasses the delay.**
Live reads: `hasRole(DEFAULT_ADMIN_ROLE, 0xE659…2873) = true`, plus `PROPOSER`/`EXECUTOR`/`CANCELLER` all held by the same EOA; `getMinDelay() = 172800` (48h). OpenZeppelin documents the admin role as one that aids initial setup "without being subject to delay" and that "should be subsequently renounced." That renounce never happened, so the 48h delay protects nothing: the EOA can `grantRole` a fresh key and execute any timelock operation immediately. Source: `script/DeployRouter.s.sol:85` constructs the timelock with the project "Safe" (the deployer EOA) as admin.
**Fix:** EOA must `renounceRole(DEFAULT_ADMIN_ROLE, self)` on the timelock — but only after proposer/executor are a real multisig (CONTRACTS-2). Until then, treat the timelock as cosmetic.

**CONTRACTS-2 (Critical) — Single EOA owns the whole stack; handover incomplete.**
Live: router `owner() = guardian() = 0xE659…2873` (identical); router `pendingOwner() = 0xf3410B…1773` (the real timelock, 7,845 bytes, `getMinDelay()=172800`), i.e. `transferOwnership` ran but `acceptOwnership()` did not (`DEPLOYMENT.md §6a` outstanding); registry `owner() = pendingOwner() = 0xE659…2873`. That one key can `setFee(100, attacker)` (skim up to 1%), `setMaxInputPerTx`/`setDefaultMaxInputPerTx`, `pause`/`unpause`, `rescue`, and repoint the registry — with no delay and no multisig. The per-execute ledger still prevents draining user funds at rest (router holds ~0; live `balanceOf(router)=0`), so this is centralization/value-extraction risk, not theft-of-deposits.
**Fix:** Execute `timelock.acceptOwnership()`; make proposer/executor a multisig distinct from the guardian; renounce timelock admin (CONTRACTS-1); move registry to the multisig; set `guardian` to a separate hot key.

**CONTRACTS-3 (High) — Registry single-writer pointer, no validation, EOA-owned.**
`DogeSwapRegistry.setCurrentRouter(address)` is `onlyOwner` with zero validation (no `code.length` check, no interface probe, no delay) and just bumps `version`. Integrators are documented to read `currentRouter()` to discover the live router. A compromised EOA repoints it in one tx and redirects user swaps + Permit2 approvals through an attacker contract.
**Fix:** Own the registry with the governance multisig/timelock; add an announce-then-activate delay; optionally validate `router.code.length > 0`; document that integrators must pin the router out-of-band.

**CONTRACTS-4 (Medium) — Docs falsely claim Permit2 ABSENT.**
`DEPLOYMENT.md:26`, `CHAIN_FACTS.md §4`, `KNOWN_ISSUES.md §5` all say Permit2 is "ABSENT"; live `getCode` at `0x0000…78BA3` returns 9,152 bytes — it is deployed. The deploy script's CREATE2 branch is now dead-but-benign; the danger is operational (an operator believes a critical-path step is outstanding).
**Fix:** Record Permit2 as PRESENT with the `getCode` evidence + date; re-status the handover items against actual live state.

**CONTRACTS-5 (Medium) — `recipient == address(0)` silently no-ops settlement in prod.**
`_settle` begins `if (s.recipient == address(0)) return;` (`DogeSwapRouter.sol:288`) and `execute` only snapshots the buyToken `if (s.recipient != address(0))` (`:177`). Labeled "tests only" but reachable in production: a zero recipient (the most common uninitialized-struct default) makes the contract pull funds, run swaps, then skip minOut/payout/refund — swapped value stranded in the router, recoverable only by owner `rescue`.
**Fix:** Revert when `s.recipient == address(0)` in `execute` (cleanest, but the contract is immutable/live), so at minimum the integration layer must hard-reject zero-recipient programs before signing, and this must be documented as a contract footgun.

**CONTRACTS-6 (Low) — feeRecipient revert-on-receive is a global native-swap DoS.**
`_settle` pays `feeRecipient` before the user payout (`:294` before `:295`). If a fee is ever turned on with a `feeRecipient` that reverts on native receive, *every* native-output swap reverts for all users until re-set. Dormant today (`feeBps()=0`).
**Fix:** Document as a global (not per-tx) hazard; when enabling a fee, set a known-payable recipient and test a native-output swap first; consider pull-payment for fees in a future deployment.

**CONTRACTS-7 (Info) / CONTRACTS-8 (Info) — EVM-difference review clean; ledger verified.**
The router uses none of the DogeOS-unsupported features (`SELFDESTRUCT`, `PREVRANDAO`/`DIFFICULTY`, blake2f/ripemd/point-eval precompiles, blobs); crypto surface is `ecrecover` (via Permit2) only; `ReentrancyGuardTransient` (EIP-1153) is probe-confirmed available. The `cap = 2n+2` ledger sizing, dedup-by-address `_idx`, conservative `_delta` (returns 0 on deflation), and native seeding (`entry[0] = balance - msg.value`) are correct under the adversarial cases modeled. **Caveat:** `lib/` is not vendored and there is no `.gitmodules`, so OZ deps were reviewed from pinned paths, not exact bytecode.
**Fix:** Vendor/pin the exact OZ commit; add a CHAIN_FACTS note that the deployed router was re-confirmed against live DogeOS opcode support post-deploy.

### 3.2 Chain-correctness — config, RPC client, fee model
Full detail: [`findings/chain-correctness.md`](./findings/chain-correctness.md)

**CHAIN-1 (High) — Quote-time data/finality fee ~5x under the real router calldata.**
`estimatedSwapPayloadForFee` returns a fixed payload sized by protocol — `v2:260, v3:228, algebra:260` bytes (`l1GasPriceOracle.mjs:5-9`). The real swap is one `DogeSwapRouter.execute(bytes,bytes[],…)` program: a representative 2-leg split builds to **900 bytes** (direct approval) or **1316 bytes** (in-tx Permit2 permit). Priced against the live oracle: v2 estimate 228B→4.20e12 wei vs real split 1316B→2.42e13 wei (~5x). Worse, `composeSplitCandidate` *sums* per-leg ~260-byte estimates, but the data fee is per-transaction on the aggregated calldata, so the arithmetic model is also wrong. Chain-specific: the DogeOS Curie oracle prices zero and non-zero bytes identically (live-measured ~1.84e10 wei/byte; `getL1Fee` returns identical results for 260 `0x00` vs 260 `0xff`), so the all-`0xff` stand-in does not over-count per byte — the error is a straight under-estimate of the byte *count*, not "conservative."
**Impact:** `scoreQuote` subtracts the data/finality fee from net output, so under-counting it by ~5x for router/split routes mis-ranks routes in exactly the small-trade regime where it matters most, and understates the displayed fee (the final balance check is correct, so this is route-quality, not fund-loss).
**Fix:** Price the data/finality fee from the actual `execute()` calldata that will run (build or size it), and price one aggregated payload per split candidate instead of summing per-leg stand-ins; remove the per-protocol fixed table.

**CHAIN-2 (Low) — `getL1Fee` fed raw calldata, omitting the signed-RLP envelope.**
The DogeOS docs specify the arg is a "signed fully RLP-encoded transaction" and that `getL1GasUsed` adds 74 bytes for the missing signature; the estimator passes only the bare router calldata, omitting the ~65-byte signature + RLP framing (~5–6% of a real split's fee). Compounds CHAIN-1.
**Fix:** Add a fixed ~74-byte (sig) + ~10–15-byte (RLP framing) allowance to the payload length, or construct a representative unsigned-tx RLP.

**CHAIN-4 (Low) — Chain/native name drift (live-confirmed cosmetic).**
`chains.mjs:4` `name: "DogeOS Chikyu Testnet"` (missing macron ū) and `:6` `nativeCurrency.name: "DogeOS DOGE"` diverge from official `"DogeOS Chikyū Testnet"` / `"DOGE"`. The frontend `sdkConfig.js` already uses `name: "DOGE"`, so `chains.mjs` is the outlier on the currency name. ChainId/idHex/symbol/decimals/RPC/fallback/oracle address all verified live as correct.
**Fix:** Set `name: "DogeOS Chikyū Testnet"` and `nativeCurrency.name: "DOGE"`.

**CHAIN-5 (Low) — Legacy `eth_gasPrice` on a 1559 chain.**
Live: DogeOS is EIP-1559-enabled (`baseFeePerGas = 0xef4208`, `eth_maxPriorityFeePerGas = 0x64`). The client exposes only `getGasPriceWei()` and the execute path sets no `maxFeePerGas`/`maxPriorityFeePerGas`. Approximately right today (base fee tiny/stable) but can drift from what the wallet pays under base-fee movement on a 3s-block chain.
**Fix:** Read `baseFeePerGas` + `eth_maxPriorityFeePerGas` (or `eth_feeHistory`), price execution as `baseFee + tip`, and set explicit 1559 fields on the broadcast tx.

**CHAIN-6 (Low) — `documentedMaxReorgDepth=17` imported but never enforced.**
`waitForTransactionReceipt` treats first inclusion (0 confirmations) as final. The 17-block constant is echoed only into `/chain-status`. Acceptable UX on a 3s-block testnet, but the present-but-unused constant implies a confirmation policy that isn't implemented.
**Fix:** Either document it as informational-only, or gate "final" on `currentBlock - receipt.block >= 17` for high-value flows.

**CHAIN-7 (Medium) — Single-endpoint RPC client, no failover/timeout/retry.**
`createJsonRpcClient({ rpcUrl })` is bound to one URL; `request`/`requestBatch` issue a single `fetch` with no `AbortSignal`, no retry, no fallback. The config ships a *working* `fallbackRpcUrls: ["https://dogeos-testnet-public.unifra.io/"]` (live-confirmed answering `eth_chainId`→`0x5fdaf3`, identical head/gasPrice to primary), but the client never consults it — it is only echoed into `/chain-status`.
**Fix:** Add an `AbortSignal` per-request timeout, a small bounded retry, and round-robin/failover across `[rpcUrls[0], ...fallbackRpcUrls]`.

**CHAIN-8 (Low) — Unknown `protocolType` silently yields zero data/finality fee.**
`estimatedSwapPayloadForFee` returns `"0x"` for any protocol not in `{v2,v3,algebra}`, and `getL1Fee("0x")` returns 0 (live-confirmed), so a new venue added without updating the table is scored as data-free.
**Fix:** Throw on unknown `protocolType` (fail loud) or fall back to the largest known estimate; this disappears entirely if CHAIN-1 derives bytes from the command set.

> **Withdrawn (CHAIN-3, refuted by live probe):** the prior "config declares a non-existent WebSocket endpoint" finding is **incorrect**. `wss://ws.rpc.testnet.dogeos.com` is a live RFC6455 WS JSON-RPC endpoint (socket opened, `eth_chainId`→`0x5fdaf3`, `eth_blockNumber`→`0x553079`, `eth_subscribe('newHeads')` returned a sub id and pushed a live head `0x55307a`). The 404 from `curl -i`/plain HTTPS GET is a load-balancer false negative for non-upgrade requests. `chains.mjs:11 wsRpcUrls` is valid (undocumented by DogeOS, but functional). Do **not** remove it.

### 3.3 Aggregator — quote math, routing, calldata
Full detail: [`findings/aggregator.md`](./findings/aggregator.md)

**AGG-1 (Medium) — `outputWeiPerFeeWei`/`inputWeiPerFeeWei` hardcoded to `1n`.**
`scoreQuote` converts the DOGE-wei fee into output-token units by `fee.totalFeeWei * outputWeiPerFeeWei` (`dogeosFeeEstimator.mjs:23`), but `outputWeiPerFeeWei` defaults to `1n` (`live.mjs:158`) and prod passes nothing. `1` is only correct when 1 wei DOGE == 1 wei output token. All tokens are 18-decimal (so no decimal mismatch), but the *price* mismatch makes the displayed `netOutput`/`feeCostInOutputToken`/`feeEstimate` off by the DOGE↔token price ratio for any non-1:1 pair. Same-output-token route *ranking* is mostly preserved (uniform wrong scale), so it is display-accuracy more than wrong-route in the common case.
**Fix:** Wire a coarse DOGE↔token mid-price (from already-fetched reserves/sqrtPrice) into `outputWeiPerFeeWei`/`inputWeiPerFeeWei` per request, or document that fee netting is approximate and DOGE-wei-denominated.

**AGG-2 (Medium) — V3/Algebra split-leg `feeTier` reconstructed as `feeBps * 100`.**
The CL adapter stores `feeBps = feeTier / 100` (integer divide) and the leg builder reconstructs `feeTier: leg.feeTier ?? BigInt(leg.feeBps) * 100n` (`dogeSwapRouterCalldata.mjs:215`; mirrored in `venueCalldataBuilders.mjs:74`). Round-trips only for tiers that are exact multiples of 100. Configured tiers (500/2500/3000/10000) all are, so it works today — but a tier like 250 → `feeBps=2` → reconstructed 200, selecting the wrong pool.
**Fix:** Carry the exact `feeTier` from `quotePool` through the quote + leg summary and use it directly; keep `feeBps*100` only as a last-resort fallback.

**AGG-3 (Medium) — Permit2 in-tx permit reuses a stale nonce on retry.**
`/approval` reads the nonce once and pins it into the signed `PermitSingle`; `/swap` forwards it unchanged. Permit2's `permit()` consumes the nonce on success, so if a swap reverts after the permit succeeded (e.g. aggregate `MinOutNotMet`) and the in-flight quote (still carrying the old `permit2Permit`) is retried, `_permit2Permit` reverts with an opaque error mapped to generic "approval missing" UI copy. No fund loss (atomic revert); partly self-healing via re-quote.
**Fix:** On `/swap`, re-check the live Permit2 allowance/nonce/expiration and drop a stale attached permit (forcing a fresh sign); or have the frontend clear `quote.permit2Permit` after any failed attempt.

**AGG-4 (Low)** No fee-on-transfer/rebasing handling in V2 math (inert — all six tokens are standard ERC20). **Fix:** document standard-ERC20-only, or detect FoT via balance-delta during discovery and exclude.
**AGG-5 (Low)** One-hop via-WDOGE candidates are `readOnly` and rejected by `chooseBestDirectRoute`; no multi-hop command exists, so they can never execute and the preview output is optimistic. **Fix:** implement chained-leg multi-hop or clearly label as non-executable estimates.
**AGG-6 (Low)** Client `deadline` has no server-side floor (`positiveUint` only); relies on the mandatory simulation to reject past deadlines (fail-safe). **Fix:** validate `deadline >= now + margin` in `buildSwapTx`/handler.
**AGG-7 (Info)** Split optimizer keys by `sourceId` and takes the top two distinct *venues*, so it can't split across two fee tiers of one venue. **Fix:** key on `(sourceId, poolAddress/feeTier)`.
**AGG-8 (Info)** Split gas = sum of direct-call leg gas + flat 90k overhead (display only; the returned tx carries the real buffered `estimateGas`). **Fix:** derive overhead empirically or document it as a refined-at-build estimate.

**Verified correct (no action):** `execute` selector `0xe56964c6` matches `cast sig` + the live router; V2/V3/Algebra venue selectors match; the `CONTRACT_BALANCE` last-leg sentinel matches the contract's `_spend`/`_delta`; aggregate-only minOut + leftover refunds; the refresh clamp cannot weaken the accepted bound; Permit2 EIP-712 domain matches canonical (no version field).

### 3.4 SDK & wallet integration — `@dogeos/dogeos-sdk` 3.2.0
Full detail: [`findings/sdk.md`](./findings/sdk.md)

The SDK *code* is faithful to the 3.2.0 type surface (every imported symbol resolves; `getConnectors()`/`connect()` distinction respected; `switchChain` by-the-book; idiomatic config; correct stylesheet import; lazy + SSR-safe mount). The problems are that the *deployed product* doesn't use it.

**SDK-1 (High) — SDK is dead code in prod.** `.env` `DOGEOS_CLIENT_ID`/`VITE_DOGEOS_CLIENT_ID` are empty; live `runtime-config.js` serves `"dogeosClientId":""`; `sdk-wallet.jsx:66` gates the whole `WalletConnectProvider` behind a truthy clientId, so it never mounts. The 13.7 MB provider chunk is built but never executed — Connect Kit, embedded wallets (email/Google/X), and mobile MyDoge via WalletConnect are all unreachable; only the injected EIP-6963 fallback runs. **Fix:** register the origin, set both client IDs, redeploy, and add a smoke test asserting a non-empty live clientId.

**SDK-2 (High) — No `WagmiProvider`.** No `WagmiProvider`/`createConfig`/`QueryClientProvider` exists in app code; `WalletConnectProvider` is rendered bare on a separate root, so the documented EVM↔Wagmi sync can never engage and the `wagmi ^2.19.5` dependency is dead weight. **Fix:** either remove `wagmi` and document intentional direct-`useAccount` usage, or mount one tree `WagmiProvider > QueryClientProvider > WalletConnectProvider > App`.

**SDK-3 (Medium) — CSP gap for the embedded wallet.** Live CSP is `frame-ancestors 'self'` only; it lacks the `tomo.inc` `frame-src`/`connect-src`, and the prepared `.env` CSP omits `https://dogeos.embedded-wallet.tomo.inc` from `connect-src`. Benign only because the SDK isn't mounted (SDK-1). **Fix:** couple the clientId and CSP switches; add the missing `connect-src` origin.
**SDK-4 (Medium)** ~680-line hand-rolled injected EIP-6963 bridge re-implements wallet discovery the SDK owns; brittle brand heuristics + load-bearing `process`/`Buffer` global shims. **Fix:** make the SDK primary, shrink the bridge to a thin fallback, pin the Tomo deps requiring the shim.
**SDK-5 (Medium)** Two disjoint React roots bridged by `window` globals + CustomEvents; forfeits React context and forces manual replay reconciliation (and makes SDK-2 impossible). **Fix:** collapse to a single React tree consuming `useWalletConnect()`/`useAccount()` directly.
**SDK-6 (Low)** `"Chikyu"` (no macron) in `sdkConfig.js:6`/`injected-wallet.js:5`/`sdk-chain-switch.js:8` vs official `"Chikyū"`. **Fix:** use the exact official string everywhere.
**SDK-7 (Low)** `metadata.url` from `window.location.origin`; no WalletConnect projectId → rides the SDK shared default project. **Fix:** set a real projectId and pin `metadata.url` to the canonical domain.
**SDK-8 (Info)** `useWallet.js` Permit2-deferral comment is partly stale (Permit2 is live), but the SDK genuinely has no `signTypedData` API. **Fix:** update the rationale; if pursuing single-approval UX, route `eth_signTypedData_v4` through the injected provider and verify MyDoge v4 support.

### 3.5 Backend API, hardening & ops
Full detail: [`findings/backend.md`](./findings/backend.md)

The backend is well-hardened: enforced (non-reflected) CORS, no arbitrary RPC proxy, SSRF-closed `/activity` (40-hex regex before fan-out), no secret leakage to the client, body caps + slowloris timeouts, generic-500 policy, correct last-XFF client-key derivation behind the loopback proxy, and method/route validation. Findings are defense-in-depth and ops hygiene.

**BACKEND-1 (Medium) — `/quote` DoS lever.** Each quote fans out into multiple upstream RPC reads (~0.5s of RPC work observed in live telemetry: `candidateProviderMs: 513`). The limiter is a global fixed window (300 req / 10s) that resets the whole map each window → a ~2x boundary-straddle burst, ~30 concurrent upstream reads/s/IP, with no separate budget for expensive POSTs vs cheap GETs. The upstream RPC, not Node, is the bottleneck. **Fix:** distinct lower budget for `/quote`/`/swap`; sliding window/token bucket; small TTL LRU on quote responses; consider Apache `mod_qos`/fail2ban.
**BACKEND-2 (Low)** `parseQuoteRequest` skips `isHexAddress` on `sellToken`/`buyToken` (the helper exists and is used for `/activity`), so garbage propagates into every venue provider before rejection. **Fix:** reject non-hex / `sellToken===buyToken` with 400 before dispatch.
**BACKEND-3 (Medium) — Governance key on the web host (ops view of CONTRACTS-2).** `owner()==guardian()==` the deployer EOA, whose key file lives on the same internet-facing box that runs the API; host compromise → control of pause/caps/fee switch. **Fix:** move the key off the web host (signer service/HW wallet); complete the timelock handover; make guardian a distinct Safe.
**BACKEND-4 (Medium) — Framing-only CSP in prod.** Live CSP is `frame-ancestors 'self'`; the full hardened policy exists only commented-out in `.env:38`, leaving no `script-src`/`connect-src`/`default-src` backstop against XSS/dependency compromise. **Fix:** enable the prepared CSP (it allowlists the tomo origins, RPC, Blockscout, fonts); test in staging; track removing `unsafe-eval`.
**BACKEND-5 (Low) — Stale docs + name drift.** Permit2-"ABSENT" docs are wrong (it is deployed); chain/native name drift per CHAIN-4. **The WS-endpoint portion is withdrawn** — the endpoint is live (see CHAIN-3 correction). **Fix:** correct the Permit2 docs and chain names; do **not** remove `wsRpcUrls`.
**BACKEND-6 (Low)** `.env.example:17` + Dockerfile default `HOST=0.0.0.0` (prod `.env` overrides to `127.0.0.1`); a verbatim copy exposes Node directly, bypassing Apache TLS and making XFF client-controlled. **Fix:** default to `127.0.0.1`; document `0.0.0.0` only for the behind-a-proxy container.
**BACKEND-7 (Info)** Vite dev middleware leaks raw errors / no body cap (dev-only). **BACKEND-8 (Info)** Static serving is path-traversal-safe (positive).

---

## 4. What is genuinely strong (credit where due)

This codebase is mature and the team has clearly done real security work. Specifically:

- **The router's balance-delta architecture is correct-by-construction.** Every amount is measured by `_delta = current − entry` (`DogeSwapRouter.sol:195-197`), never by a venue return value, and `entry[0] = address(this).balance − msg.value` (`:176`) correctly excludes incoming value. This structurally makes pre-existing/airdropped funds unspendable via `execute` and is robust against lying/fee-on-transfer venues. I stress-tested the `cap=2n+2` sizing, the dedup `_idx`, duplicate-token/`buyToken==input` paths, and deflationary `_delta` underflow — all correct, with a hard `LedgerOverflow` backstop.
- **Permit2 owner is always `msg.sender`** (`:221-233`) — no command carries an `owner`/`from` field, so a caller can never pull a third party's permitted funds even with many live router→Permit2 allowances. Correct UniversalRouter pattern.
- **Movement-only command set + immutable venues** (`Commands.sol`, `_dispatch :210-219`): a closed if/else with no `CALL`/`DELEGATECALL`/arbitrary target, eliminating the entire arbitrary-call attack class.
- **Settlement is enforced independent of the command program** (`_settle :287-302`): `out = _delta(buyToken)`, capped fee, revert `MinOutNotMet` before paying — "recipient gets ≥ minOut or the whole tx reverts" is a contract guarantee.
- **Correct DogeOS fee decomposition against the real predeploy.** `dogeosFeeEstimator` computes `executionFee + dataFinalityFee`; `l1GasPriceOracle.mjs` calls the real `getL1Fee` (selector `0x49948e0e`, verified by `cast sig`) on `0x5300…0002` (live, 3,690 bytes), and the estimator's hand-rolled encoder/decoder produced bit-for-bit-identical results to `cast` across all three protocol types. The **pre-swap balance check uses the actual signed router calldata**, so on-chain "insufficient funds" surprises are avoided even though the *quote* estimate is off (CHAIN-1).
- **Venue-specific MuchFi-V2 20 bps fee, not assumed** (`registry.mjs:80`): cross-checked against the router's own `getAmountsOut` (the CP formula at 20 bps reproduces it to the wei; canonical 30 bps is off by ~2.5e14) — and confirmed again in this audit's live probe.
- **Mandatory pre-return simulation + balance preflight** on every production `/swap` (`eth_call` + `estimateGas` + sell/native balance check), so a mis-built tx is rejected with 422 rather than handed to the user. The refresh clamp fails closed (never weakens the accepted bound).
- **Honest, mostly-correct self-audit pack** (THREAT_MODEL, INVARIANTS, SLITHER_TRIAGE): the Slither HIGH/MEDIUM suppressions are legitimate false positives, and the documented invariants (I1/I2/I5/I8) hold under the adversarial cases I could construct.
- **Backend is genuinely hardened** (Section 3.5): enforced CORS (verified live — `Origin: https://evil.example` still returns the fixed allow-origin), no RPC proxy, SSRF-closed `/activity`, body caps, generic-500 policy, path-traversal-safe static serving, `.env`/`deployer.key` discipline.
- **Chain identity and registry are accurate.** Live probes found **zero mismatches** in chainId/idHex/symbol/decimals/oracle address, all six token contracts (getCode + symbol/name/decimals, all 18-decimal), all four immutable venue addresses, the V2 router `factory()`/`WETH()` relationship reads, and both live V2 pools (non-zero reserves, correct token0/token1 ordering).
- **The SDK code itself is type-accurate and idiomatic** (Section 3.4) — the problem is activation, not correctness.

---

## 5. Prioritized remediation checklist (in order, before mainnet)

**P0 — Governance & key custody (hard mainnet blockers):**
1. Execute `timelock.acceptOwnership()` so the router `owner` is the TimelockController, not the EOA (CONTRACTS-2).
2. Make the timelock `PROPOSER`/`EXECUTOR` a real multisig (Gnosis Safe), distinct from the guardian (CONTRACTS-2).
3. **Renounce the EOA's `DEFAULT_ADMIN_ROLE`** on the timelock — until this is done the delay is cosmetic (CONTRACTS-1).
4. Set router `guardian` to a separate pause-only key, not the owner (CONTRACTS-2/BACKEND-3).
5. Move registry ownership to the governance multisig; add an announce-then-activate delay and a `code.length` check to `setCurrentRouter` (CONTRACTS-3).
6. Move the deployer/governance key **off the public-facing web host** (signer service / hardware wallet / separate ops box) (BACKEND-3).

**P1 — Correctness & resilience that affect users:**
7. Fix the quote-time data/finality fee to price the real `execute()` calldata (one aggregated payload per split), removing the ~5x under-count and the additive-per-leg model (CHAIN-1); add the ~74-byte signature/RLP allowance (CHAIN-2); fail loud on unknown `protocolType` (CHAIN-8).
8. Add RPC failover + per-request timeout + bounded retry across `[rpc, ...fallbackRpcUrls]` (CHAIN-7).
9. At the integration boundary, hard-reject any `execute` program with `recipient == address(0)` before signing, and document the contract footgun (CONTRACTS-5).
10. Carry the exact V3/Algebra `feeTier` through to the calldata builder instead of `feeBps*100` (AGG-2); fix the Permit2 stale-nonce retry path (AGG-3); wire a real DOGE↔token price into `outputWeiPerFeeWei` or document the approximation (AGG-1).
11. Give `/quote`/`/swap` a distinct, tighter rate budget with a sliding window, and add a short-TTL quote cache (BACKEND-1); validate token-address shape before provider fan-out (BACKEND-2).

**P2 — Product activation & defense-in-depth:**
12. Activate the SDK: register the origin, set both client IDs, and add a live-clientId smoke test (SDK-1); decide and document the Wagmi posture (remove the dep or mount one `WagmiProvider` tree) (SDK-2/SDK-5).
13. Enable the prepared hardened CSP in prod, coupled to the clientId switch, with the missing `dogeos.embedded-wallet.tomo.inc` `connect-src` origin added (BACKEND-4/SDK-3).
14. Price execution in EIP-1559 terms and set explicit `maxFeePerGas`/`maxPriorityFeePerGas` on the broadcast tx (CHAIN-5).

**P3 — Documentation & hygiene:**
15. Correct `DEPLOYMENT.md`/`CHAIN_FACTS.md`/`KNOWN_ISSUES.md` to record Permit2 as **present** at the canonical address (with getCode evidence), and re-status the handover items against actual live state (CONTRACTS-4/CHAIN-9/SDK-8).
16. Fix chain/native naming to `"DogeOS Chikyū Testnet"` / `"DOGE"` in `chains.mjs` and the three app sites (CHAIN-4/SDK-6). **Keep `wsRpcUrls` — it is a live endpoint (CHAIN-3 correction).**
17. Default `.env.example`/Dockerfile `HOST=127.0.0.1` (BACKEND-6); vendor/pin the exact OZ commit and add a post-deploy opcode-support note (CONTRACTS-7); enforce confirmation policy or document `documentedMaxReorgDepth` as informational (CHAIN-6).
