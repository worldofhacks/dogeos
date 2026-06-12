# DogeSwap — Executive Summary

**Audit date:** 2026-06-12
**Subject:** DogeSwap, non-custodial DEX aggregator on the DogeOS Chikyū Testnet (chainId **6281971**, `0x5fdaf3`)
**Audience:** DogeOS leadership and the DogeSwap founders
**Method:** Two-track review — senior DogeOS protocol engineer + head of ecosystem — with live on-chain verification of every config claim
**Companion reports:** [`report-engineer.md`](./report-engineer.md) · [`report-ecosystem.md`](./report-ecosystem.md)

---

## 1. TL;DR

DogeSwap is the most credible DogeOS-native dApp we have reviewed: its `DogeSwapRouter` swap engine is genuinely well-built and DogeOS-correct — a balance-delta ledger, a movement-only command whitelist, Permit2-only pulls keyed to `msg.sender`, enforced post-loop settlement, and a transient-storage reentrancy guard bound worst-case loss to a single authorized transaction — and live probes found **zero mismatches** in chain identity, all six token contracts, all four immutable venue addresses, both live V2 pools, the fee oracle, and Permit2's presence. **But it is neither mainnet-ready nor featureable today, and the single most important reason is governance:** on-chain, one keyless EOA (`0xE659…2873`, sitting on the internet-facing web host) is simultaneously router owner, guardian, registry owner, and timelock proposer/executor/canceller, *and* holds the timelock's `DEFAULT_ADMIN_ROLE` which bypasses the advertised 48h delay — the owner→timelock `acceptOwnership()` handover was started but never completed — making the documented "timelock + Safe + separate guardian" model a façade. The engine is real; the trust posture is not yet the one the docs claim, and that gap is the blocker.

---

## 2. Top 5 Must-Fix (severity-ranked)

1. **[Critical] Timelock delay is bypassable.** The EOA still holds the timelock's `DEFAULT_ADMIN_ROLE`, so the advertised 48h delay is cosmetic. → Renounce `DEFAULT_ADMIN_ROLE` from the EOA so only the multisig/timelock path can reconfigure.
2. **[Critical] One EOA owns everything.** Router owner == guardian == registry owner == timelock proposer/executor, and `acceptOwnership()` was never run. → Execute `acceptOwnership()` so the timelock becomes router owner, and `setGuardian` to a distinct pause-only key.
3. **[High] False chain claims in user-facing copy.** "instant finality via PWR Chain" (unrelated chain — copy-paste leak), "10,000+ TPS" (actual ~300), and "instant finality / instant withdrawals" (bridge withdrawals take up to ~4h). → Remove the PWR Chain reference, correct TPS, drop the instant-finality/withdrawal claims.
4. **[High] Flagship contract unverified + stale "critical-path" docs.** The fund-moving router is `is_verified: false` on Blockscout, and `DEPLOYMENT.md`/`KNOWN_ISSUES.md` still say Permit2 is "ABSENT" when it is live (9,152 bytes at the canonical address). → Verify the router on Blockscout and refresh the stale audit docs.
5. **[High] Quote-time data/finality fee under-counts ~5x + dead SDK in prod.** Route scoring under-estimates the real router calldata's DogeOS data/finality fee by ~5x, and the `@dogeos/dogeos-sdk` ships with an empty `clientId` (mobile MyDoge / embedded wallets disabled). → Estimate against real router calldata and provision the production SDK `clientId`.

---

## 3. Severity Counts & Standout Strengths

### Engineering findings by final severity

| Severity | Count |
|---|---:|
| Critical | 2 |
| High | 4 |
| Medium | 12 |
| Low | 14 |
| Info | 7 |
| **Total** | **39** |

> One prior finding was **overturned by ground truth and withdrawn:** `wss://ws.rpc.testnet.dogeos.com` is a live, working RFC6455 WebSocket JSON-RPC endpoint (the earlier 404 was a load-balancer artifact). `chains.mjs` `wsRpcUrls` is **valid** and must **not** be flagged as broken.

### Standout strengths (worth backing)

- **Swap engine is hard to break.** Balance-delta ledger + movement-only command whitelist + Permit2-only pulls keyed to `msg.sender` + enforced settlement + transient-storage reentrancy guard. No path found to drain stranded funds, spend a third party's allowance, or bypass `minOut`.
- **Everything it claims on-chain is true.** All six tokens (symbol/name/decimals=18), all four immutable venue addresses, both live MuchFi V2 pools (with `feeBps=20` confirmed to the wei), the V3/Algebra router relationships, the fee-oracle selector/encoding, and Permit2's presence verified live — zero mismatches.
- **Genuinely DogeOS-native.** Official `@dogeos/dogeos-sdk` as the primary wallet layer, official faucet tokens with provenance, correct DOGE-denominated `executionFee + dataAndFinalityFee` accounting via the real `L1GasPriceOracle.getL1Fee` predeploy, Blockscout-first.
- **Unusually hardened backend for a testnet DEX.** Enforced CORS, no RPC proxy, SSRF-closed `/activity`, body caps, generic-500 policy.
- **Ecosystem-positive and neutral.** Routes users to competitors' venues (MuchFi, Barkswap) and refuses first-party liquidity.

---

## 4. Go / No-Go Recommendation

**CONDITIONAL GO — do not feature or call mainnet-ready today; clear a short, well-scoped hardening pass first.**

The architecture and discipline are real and worth DogeOS backing. The blockers are not months of work — they are essentially **two governance transactions, a set of copy edits, a Blockscout verify command, a fee-estimation fix, an SDK `clientId`, and a doc refresh**. Until they are cleared, featuring DogeSwap would embarrass DogeOS, because the app makes false statements about our own chain and its live trust posture is weaker than its own documentation.

**Conditions that must all be cleared before any "featured / official / audited / mainnet" framing:**

1. Complete the timelock handover (`acceptOwnership()`), renounce the EOA's `DEFAULT_ADMIN_ROLE`, and split the guardian to a distinct pause-only key (or stop describing governance as hardened).
2. Fix the false chain claims (remove "PWR Chain", correct TPS, drop instant-finality/withdrawal copy).
3. Verify the router on Blockscout and refresh the stale Permit2-"ABSENT" docs.

**Strongly recommended (not strict blockers):** provision the production SDK `clientId`, fix the ~5x data/finality fee under-count, add the success-screen Blockscout link, and align the chain name (macron "Chikyū") and `nativeCurrency.name` ("DOGE") to official docs.

---

## 5. Links

**Reports**
- [`report-engineer.md`](./report-engineer.md) — engineering / security / correctness
- [`report-ecosystem.md`](./report-ecosystem.md) — UX, competitive fit, ecosystem fit, featuring decision

**Per-dimension findings**
- [`findings/contracts.md`](./findings/contracts.md) — DogeSwapRouter / Registry / deploy stack
- [`findings/chain-correctness.md`](./findings/chain-correctness.md) — config, RPC client, fee model
- [`findings/aggregator.md`](./findings/aggregator.md) — quote math, routing, calldata builder
- [`findings/sdk.md`](./findings/sdk.md) — `@dogeos/dogeos-sdk` wallet integration
- [`findings/backend.md`](./findings/backend.md) — HTTP API, hardening, ops
- [`findings/ux.md`](./findings/ux.md) — wallet, swap flow, success-screen UX
- [`findings/ecosystem.md`](./findings/ecosystem.md) — DogeOS-native fit, chain claims, transparency
- [`findings/competitive.md`](./findings/competitive.md) — positioning vs MuchFi / Barkswap

**Index:** [`README.md`](./README.md)

---

## Addendum (gap-closing pass)

> A follow-up pass (2026-06-12) covered what the first audit asserted from docs rather than ran, or left unmeasured. Full write-up: [`ADDENDUM-gapclose.md`](./ADDENDUM-gapclose.md). The original go/no-go (**CONDITIONAL GO — do not feature or call mainnet-ready today**) stands; the gate gets longer.

**Confirmed / clarified (no severity change):**
- **V3/Algebra quotes are correct to the wei** (matched live MuchFi V3 + Barkswap Algebra quoters on every official pair). The earlier open question is closed — no quote-accuracy defect.
- **The audited `DogeSwapRouter` is NOT bypassed:** router mode `all` is the live default, so **~100% of UI swaps route through it**; only API-only exactOutput stays direct-to-venue.
- **Live web tree resolved:** `apps/web/src` (→ `apps/web/dist`, served by `packages/web/src/server.mjs`) is production. **Permit2 re-confirmed live** (the "ABSENT" docs are stale).

**New must-fix blockers (add to the §4 gate, all clearable pre-launch):**
- **[High] Recipient never bound to sender.** The API lets a caller build a valid swap tx paying any third party — or `address(0)` (silently stranded, recoverable only by the single-EOA owner). Bind/validate `recipient == sender` and forbid `address(0)` server-side.
- **[High] 50% "MAX" slippage = end-to-end sandwich gift** on DogeOS's public tip-ordered mempool. Cap user-selectable and server-side slippage well below 100%, surface live price impact, drop the gas-war framing.
- **[High] All routable liquidity is dust** (~1,190 WDOGE total; V2 pools disagree on price 8x). Aggregation/split-router adds cost, not savings, at current depth — gate or re-frame the split path.
- **[High] Contract test suite does not build/run in the prod checkout** (`lib/` deps absent, no `.gitmodules`); "53 tests pass" is unverifiable here.
- **[High] UX:** missing success-screen Blockscout link (**recommended → blocker**), unhandled+misdirected MetaMask nonce-desync error, no native-DOGE balance/MAX/slider, and missing OG/Twitter/description metadata.

**Severity movements:**
- **Governance concentration — impact escalated.** Same rating, but its blast radius is now confirmed to be ~100% of production flow, and it is the sole stranded-fund recovery key for the new recipient risk. Complete the timelock handover **before** promoting router mode `all` as default.
- **Success-screen Blockscout link: recommended → High** (confirmed missing despite hash availability).
- **No downgrades.** Nothing was weakened by ground truth.

**Right-sizing:** **bridge-in → swap is greenfield** (zero bridge code; both directions up to ~4h, deposit needs an L1 OP_RETURN tx) — re-tag it as multi-week, decouple from the small-fixes grant line, sequence pre-mainnet. The only durable **moat is distribution** (DogeOS featuring it), not the aggregation merits at current depths.
