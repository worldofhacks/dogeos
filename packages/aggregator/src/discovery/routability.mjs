// routability.mjs — shared on-chain routability gates for non-official tokens.
//
// Two pure-eth_call (no tx) gates, used by BOTH the trending list
// (discoverableTokens) and the /tokens index (tokenIndex):
//   - readBaseLiquidity: the base token (WDOGE) held across a token's pools — a
//     cheap min-liquidity floor that drops dust / drained one-sided pools.
//   - createRoundTripProbe: a base-anchored buy-then-sell round trip that rejects
//     honeypots (buyable, not sellable) and punitive fee-on-transfer tokens, which
//     a one-way quote or a liquidity check alone cannot catch.

const BALANCE_OF_SELECTOR = "0x70a08231";
export const PROBE_BASE_AMOUNT = 5n * 10n ** 16n; // 0.05 WDOGE — small so it's fair to shallow pools
export const MIN_ROUND_TRIP_BPS = 6000; // recover >= 60% of a buy->sell round trip
export const MIN_BASE_LIQUIDITY_WEI = 10n ** 17n; // 0.1 WDOGE backing a token's pools

const lower = (value) => String(value ?? "").toLowerCase();

// balanceOf(owner) of `token`, held by `owner`. 0 on any read failure.
export async function readBalance(client, token, owner) {
  try {
    const result = await client.call(
      { to: token, data: `${BALANCE_OF_SELECTOR}${lower(owner).slice(2).padStart(64, "0")}` },
      "latest",
    );
    return BigInt(result);
  } catch {
    return 0n;
  }
}

// Sum of the base token (WDOGE) held by each of a token's pools — the base-side
// liquidity backing it. Venue-agnostic (works for v2 + concentrated pools alike).
export async function readBaseLiquidity({ client, base, pools = [] }) {
  const balances = await Promise.all(
    pools.map((pool) => readBalance(client, base, pool.poolAddress ?? pool.address ?? pool)),
  );
  return balances.reduce((sum, value) => sum + value, 0n);
}

// Base-anchored round trip: buy `probeAmount` of base into the token, then sell
// exactly that back. A healthy pool recovers >= minRoundTripBps/10000 of the base
// (minus fees + a little impact); honeypots recover ~nothing, drained pools far
// too little. Returns an async (tokenAddress) => boolean.
//
// `quoteProbe` is ({ sellToken, buyToken, amountIn }) => { ok, amountOut,
// priceImpactBps } (best active candidate across venues). When no probe is wired
// the gate is a no-op (returns true).
export function createRoundTripProbe({
  quoteProbe,
  base,
  probeAmount = PROBE_BASE_AMOUNT,
  minRoundTripBps = MIN_ROUND_TRIP_BPS,
  retries = 3,
} = {}) {
  const rankBase = lower(base);
  // One direction, retried — the live testnet RPC intermittently times a single
  // source out under load; a healthy pool quotes on a retry.
  const probeDir = async (sellToken, buyToken, amountIn) => {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await quoteProbe({ sellToken, buyToken, amountIn }).catch(() => null);
      if (r?.ok && BigInt(r.amountOut ?? 0n) > 0n) return r;
    }
    return null;
  };
  return async function isTradeable(tokenAddress) {
    if (typeof quoteProbe !== "function") return true;
    const probeIn = probeAmount;
    const buy = await probeDir(rankBase, tokenAddress, probeIn);
    if (!buy) return false;
    const sell = await probeDir(tokenAddress, rankBase, BigInt(buy.amountOut));
    if (!sell) return false;
    // recovered / probeIn >= minRoundTripBps / 10000
    return BigInt(sell.amountOut) * 10000n >= probeIn * BigInt(minRoundTripBps);
  };
}
