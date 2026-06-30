// trustScore.mjs — a graduated 0-100 trust score for NON-OFFICIAL tokens, from
// the signals we can read cheaply on a testnet: base-liquidity depth, holder
// count, and age (older first-pool = more established). It NEVER promotes a token
// to "verified" (that stays reserved for official tokens) — it only drives the
// catalog's display ranking and a low/med/high tier badge.
//
// NOTE: on a young testnet these signals are sparse, so the score is coarse and
// is primarily a RANKING aid, not a precise trust measure. Unique-trader count
// (a stronger signal) is intentionally omitted — it needs swap-log indexing we
// don't have.

const DEFAULT_CAPS = Object.freeze({
  liquidityWdoge: 1000, // ~1000 WDOGE backing -> full liquidity credit
  holders: 500,
  ageBlocks: 1_000_000, // ~ a month of 3s blocks -> full age credit
});

// Weights — liquidity is the strongest signal on a thin testnet.
const W_LIQUIDITY = 0.6;
const W_HOLDERS = 0.25;
const W_AGE = 0.15;

// Log-scaled, capped normalization to 0..1 (so a 10x deeper pool isn't 10x the
// score — diminishing returns).
function norm(value, cap) {
  const v = Number(value);
  if (!(v > 0) || !(cap > 0)) return 0;
  return Math.min(1, Math.log10(1 + v) / Math.log10(1 + cap));
}

export function computeTrustScore(
  { liquidityWdoge = 0, holders = 0, ageBlocks = 0 } = {},
  caps = DEFAULT_CAPS,
) {
  const c = { ...DEFAULT_CAPS, ...caps };
  const score =
    100 *
    (W_LIQUIDITY * norm(liquidityWdoge, c.liquidityWdoge) +
      W_HOLDERS * norm(holders, c.holders) +
      W_AGE * norm(ageBlocks, c.ageBlocks));
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function trustTier(score) {
  if (score >= 66) return "high";
  if (score >= 33) return "med";
  return "low";
}
