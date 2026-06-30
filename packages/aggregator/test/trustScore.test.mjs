import assert from "node:assert/strict";
import test from "node:test";

import { computeTrustScore, trustTier } from "../src/discovery/trustScore.mjs";

test("trust score is 0 with no signals and rises with each signal", () => {
  assert.equal(computeTrustScore({}), 0);
  const liqOnly = computeTrustScore({ liquidityWdoge: 1000 });
  const holdOnly = computeTrustScore({ holders: 500 });
  const ageOnly = computeTrustScore({ ageBlocks: 1_000_000 });
  assert.ok(liqOnly > 0 && holdOnly > 0 && ageOnly > 0);
  // liquidity is the dominant weight.
  assert.ok(liqOnly > holdOnly && liqOnly > ageOnly);
  // all three together caps near 100.
  assert.ok(computeTrustScore({ liquidityWdoge: 1000, holders: 500, ageBlocks: 1_000_000 }) >= 99);
});

test("trust score is monotonic in liquidity", () => {
  const a = computeTrustScore({ liquidityWdoge: 1 });
  const b = computeTrustScore({ liquidityWdoge: 10 });
  const c = computeTrustScore({ liquidityWdoge: 100 });
  assert.ok(a < b && b < c);
});

test("trust tiers split low/med/high", () => {
  assert.equal(trustTier(10), "low");
  assert.equal(trustTier(40), "med");
  assert.equal(trustTier(80), "high");
  assert.equal(trustTier(computeTrustScore({ liquidityWdoge: 1000, holders: 500, ageBlocks: 1_000_000 })), "high");
});
