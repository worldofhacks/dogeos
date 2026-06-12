# Gap: Live Liquidity Depth + MEV / Slippage Risk

Scope: measure REAL on-chain depth of every venue the aggregator routes through,
model price impact / revert thresholds at the shipped slippage defaults, and
assess sandwich exposure against DogeOS sequencer ordering. All reads live on
DogeOS Chikyū (chainId 6281971, `https://rpc.testnet.dogeos.com`) on 2026-06-12.

Methodology: `cast call getReserves()` / `liquidity()` + `balanceOf(pool)` for
every pool in `packages/aggregator/src/sources/registry.mjs`. All six listed
tokens are **18-decimal** (verified: USDC `0xD19d…3925` dec=18, USDT `0xC818…93a9`
dec=18, WDOGE `0xF6BD…78aE` dec=18) — note this is non-canonical (real USDC/USDT
are 6 dec), so all "$" notionals below are nominal testnet units.

---

## TL;DR

The entire DogeSwap-routable market is **dust**. Across all three venues the
deepest single pool holds ~826 WDOGE / ~227 USDT; the MuchFi-V2 pools the
aggregator leans on hold **single-digit token counts** (3–8 of each side). On the
shallowest pool a **~0.15 WDOGE (~$0.40) swap already moves price 5%**, and a
**~3 WDOGE (~$8) swap moves it ~50%**. At these depths aggregation is
**economically pointless** — the splittable size where routing across venues beats
a single venue is below the gas/data-fee floor — and the **50% "MAX" slippage
preset is a guaranteed sandwich gift** on DogeOS's public, tip-ordered mempool.

Severity: **HIGH** (product-value + user-loss), evidence-backed below.

---

## 1. Measured live depth (every routable pool)

### MuchFi V2 (`v2Pair`, fee 20bps — confirmed `feeBps=20` in registry)

| Pool | token0 | token1 | reserve0 | reserve1 |
|---|---|---|---|---|
| WDOGE/USDC `0xD826…87F4` | USDC | WDOGE | **7.847 USDC** | **3.095 WDOGE** |
| WDOGE/USDT `0x1498…9AE4` | USDT | WDOGE | **2.472 USDT** | **8.184 WDOGE** |

`getReserves()` raw: USDC pool `(7847003400903313880, 3095007897400343018, …)`;
USDT pool `(2471864667752702903, 8183755364311075516, …)`. LP totalSupply 4.83 /
4.47 — these are seed/test mints, not a market.

Implied prices are **mutually inconsistent**: USDC pool says 1 WDOGE = 2.535 USDC,
USDT pool says 1 WDOGE = 0.302 USDT — an 8x disagreement, i.e. these are arbitrary
test seeds, not priced markets. (Real arbitrage would have closed this; nobody is
trading here.)

### MuchFi V3 (UniV3-style, `liquidity()` + pool token balances)

| Pool | fee tier | `liquidity()` | USDC/USDT bal | WDOGE bal |
|---|---|---|---|---|
| USDC/WDOGE `0x4F1c…7299` | 500 | 1.03e19 | 16.52 USDC | 10.84 WDOGE |
| USDC/WDOGE `0xBeD5…6ecC` | 2500 | 6.47e17 | 0.425 USDC | 1.042 WDOGE |
| USDT/WDOGE `0x64A2…504F` | 500 | 1.80e19 | 10.07 USDT | 32.43 WDOGE |

### Barkswap Algebra (`liquidity()` + balances) — the deepest venue, still tiny

| Pool | `liquidity()` | USDC/USDT bal | WDOGE bal |
|---|---|---|---|
| USDC/WDOGE `0x9389…55B1` | 3.24e20 | **354.2 USDC** | **305.0 WDOGE** |
| USDT/WDOGE `0x5DC3…a624` | 7.52e20 | **226.7 USDT** | **826.2 WDOGE** |

**Total addressable WDOGE liquidity across all venues ≈ 1,190 WDOGE** (~$1.2–3k
nominal). The Algebra pools hold ~85% of it; the V2 + V3 pools the aggregator also
quotes are rounding error by comparison.

---

## 2. Price-impact / revert thresholds (constant-product, MuchFi-V2, 20bps)

Computed with `out = (Δin·(1−fee)·Rout)/(Rin + Δin·(1−fee))`, impact vs mid price.

**WDOGE/USDC pool `0xD826…87F4` (3.095 WDOGE / 7.847 USDC), selling WDOGE:**

| Trade in | Out | Price impact |
|---|---|---|
| 0.1 WDOGE | 0.245 USDC | **3.32%** |
| 0.5 WDOGE | 1.090 USDC | **14.06%** |
| 1.0 WDOGE | 1.913 USDC | **24.53%** |
| 3.0 WDOGE | 3.858 USDC | **49.27%** |

Solved thresholds (selling WDOGE into this pool):

- **1% impact at ~0.025 WDOGE (~$0.06)**
- **5% impact at ~0.157 WDOGE (~$0.40)**
- 25% impact at ~1.03 WDOGE (~$2.60)
- 50% impact at ~3.09 WDOGE (~$7.83)

WDOGE/USDT V2 pool is deeper on the WDOGE side (8.18 WDOGE) so it's gentler: 0.5
WDOGE → 5.94% impact, 3.0 WDOGE → 26.9%. The Algebra pools (the real depth) would
absorb proportionally more, but still: a few hundred WDOGE moves them double
digits.

**Revert behavior at default 0.5% slippage:** minOut math is
`minAmountOut = amountOut·(10000−slippageBps)/10000` (`quoteService.mjs:19-20`).
At 50 bps the on-chain minOut is 99.5% of quote. On the V2 USDC pool **any trade
above ~0.04 WDOGE already exceeds 0.5% impact** and will revert at default
slippage unless the user is the only tx in the block (no concurrent price move).
In practice, a default-slippage swap of any non-trivial size on the V2 venues
will fail with `INSUFFICIENT_OUTPUT_AMOUNT` (the exact error the UI catches at
`execute.js:114`).

---

## 3. Is the 50% "MAX" slippage dangerous? YES.

- **No server cap below 100%.** `normalizeSlippageBps` only rejects `< 0` or
  `> 10000` (`quoteService.mjs:141-145`); the API handler defaults to 50 bps but
  passes any value ≤ 10000 straight through (`handler.mjs:223`). The UI's 50%
  preset = 5000 bps is fully honored end-to-end.
- **minOut at 50% = half the quote.** With slippageBps=5000, minAmountOut =
  amountOut · 5000/10000 = **50% of quoted output**. The trade succeeds even if
  the user receives only half of what was quoted — exactly the headroom a
  sandwicher extracts.
- **Aggregate-only settlement does not save you here.** DogeSwapRouter enforces
  one floor on the measured buyToken delta (per the aggregator finding,
  `DogeSwapRouter.sol:289-293`), which is robust against *per-leg* sandwiching —
  but the floor is derived from the user's own slippage. Set it to 50% and the
  contract happily enforces a 50%-worse fill. The router math is correct; the
  *input* (user slippage) is the hole.
- **UI framing actively pushes it.** `SettingsView.jsx:175` hint:
  *"raise it to win contested launches."* The in-swap slider preset is literally
  labeled **"MAX"** and the >20% warning is themed **"gas-war mode"**
  (`SwapView.jsx:746,750`). There *is* a warning band at >5% / >20%
  (`SwapView.jsx:720-752`, good), but the copy normalizes 50% as a legitimate
  "win the launch" tactic rather than "you will almost certainly be sandwiched."
  On these dust pools, a single competing tx can capture ~half the trade.

---

## 4. DogeOS mempool / sequencer ordering — sandwich feasibility

From the dogeos skill refs (consolidated from docs.dogeos.com, fact-checked):

- **Public mempool, tip-priority ordering, NOT protocol-guaranteed.**
  `developer-guide.md:259`: *"the DogeOS sequencer aims to prioritize executable
  transactions based on their 'tip' … in most cases … in decreasing order of
  tips. This ordering is not guaranteed by the protocol. During periods of low
  mempool congestion, the sequencer processes transactions first-come-first-served."*
  (also `networks.md:178-179`).
- **No MEV protection, no private mempool / orderflow auction documented.** It is
  an ordinary single-sequencer L2 with a visible mempool. A bot watching pending
  txs can frontrun by paying a higher tip; under low congestion (the current
  state of this testnet) FCFS means even a same-tip race is winnable by timing.
- **~3s blocks, 17-block reorg window** (`networks.md:83`). Ordering can change
  within 17 blocks — a sandwich isn't even reorg-protected for the victim.

Conclusion: classic sandwich (frontrun-buy → victim → backrun-sell) is fully
feasible. The only thing standing between a user and a sandwich is their slippage
setting — which the UI invites them to set to 50%.

---

## 5. Does aggregation add value at this liquidity? NO (today).

- The two MuchFi-V2 pools disagree on WDOGE price by **8x** and hold single-digit
  token reserves. The "best of N venues" pick is dominated entirely by the two
  Algebra pools (~85% of all depth); V2/V3 quotes will lose on all but the
  tiniest trades.
- Split routing only spans **distinct venue identities** (per the aggregator
  finding, `splitRoutes.mjs:208`), and a split is only worth its extra gas +
  DogeOS data/finality fee when the marginal price improvement exceeds that
  floor. At ~1k WDOGE total depth, the trade size where splitting beats
  single-best is below the per-extra-leg fee — so the atomic split router
  (the headline feature of the last 4 commits) **adds cost, not savings**, at
  current depth.
- Aggregation becomes valuable only once any single pair has enough depth that a
  realistic trade meaningfully moves one venue but can be cushioned by another.
  Nothing here is close.

---

## Recommendations (concrete)

1. **Cap user-selectable slippage** at a sane ceiling (e.g. 5%, expert-mode
   gate to higher) and **cap server-side** (`normalizeSlippageBps`) well below
   100%. A 50% minOut floor is never a defensible default on a public-mempool
   chain.
2. **Re-label the "MAX" / "gas-war" framing.** Replace "raise it to win contested
   launches" with an explicit sandwich-loss warning that shows the *worst-case
   received* amount in tokens at the chosen slippage.
3. **Show live price impact in the UI.** The frontend currently synthesizes none
   (`quote.js:8-9` notes the backend exposes no price-impact field). On pools
   this shallow, a 0.4-token swap = 5% impact must be surfaced before confirm,
   and trades above a hard impact ceiling should block (not just warn) outside
   expert mode.
4. **Gate / hide the split-router path** until pair depth justifies its extra fee,
   or document that it is a correctness/showcase feature, not a savings feature,
   at testnet depth.
5. **Treat all WDOGE "$" values as unpriced** — there is no price feed and the V2
   pools are internally inconsistent. Do not present any implied price as a market
   rate.
