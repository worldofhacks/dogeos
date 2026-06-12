import assert from "node:assert/strict";
import test from "node:test";

import {
  SPLIT_SOURCE_ID,
  composeSplitCandidate,
  createSplitQuoteCandidateProvider,
} from "../src/routes/splitRoutes.mjs";

const usdc = "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925";
const wdoge = "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE";
const router = "0x000000000000000000000000000000000000R0Ut".replace(/[^0-9a-fx]/gi, "0");

function leg(sourceId, protocolType, amountIn, amountOut, extra = {}) {
  return {
    sourceId,
    protocolType,
    status: "active",
    quoteMode: "exactInput",
    chainId: 6_281_971,
    sellToken: usdc,
    buyToken: wdoge,
    amountIn,
    amountOut,
    gasUnits: 130_000n,
    dataFinalityFeeWei: 1_000n,
    quoteTimestampMs: 1_000,
    ttlMs: 5_000,
    ...extra,
  };
}

// A direct provider whose per-venue output is concave in size (depth-aware):
// splitting beats sending the whole amount to one venue.
function depthAwareDirectProvider() {
  return async (input) => {
    const amountIn = BigInt(input.amountIn);
    const include = input.includeSources ?? [];
    const venues = [
      { sourceId: "muchfi-v2", protocolType: "v2", penaltyPerUnit: 3n },
      { sourceId: "muchfi-v3", protocolType: "v3", penaltyPerUnit: 4n, feeTier: 500n },
    ];
    return venues
      .filter((venue) => include.length === 0 || include.includes(venue.sourceId))
      .map((venue) => {
        // Concave: out = amountIn - penalty*amountIn^2/1e18 (slippage grows with size).
        const slip = (venue.penaltyPerUnit * amountIn * amountIn) / (10n ** 18n);
        const amountOut = amountIn - slip;
        return leg(venue.sourceId, venue.protocolType, amountIn, amountOut, {
          ...(venue.feeTier ? { feeTier: venue.feeTier } : {}),
        });
      });
  };
}

test("composeSplitCandidate sums leg outputs and adds router overhead gas", () => {
  const candidate = composeSplitCandidate({
    routerAddress: router,
    input: { sellToken: usdc, buyToken: wdoge, amountIn: 100n },
    legs: [
      { quote: leg("muchfi-v2", "v2", 60n, 59n), amountIn: 60n },
      { quote: leg("muchfi-v3", "v3", 40n, 39n, { feeTier: 500n }), amountIn: 40n },
    ],
  });

  assert.equal(candidate.sourceId, SPLIT_SOURCE_ID);
  assert.equal(candidate.routeType, "split");
  assert.equal(candidate.status, "active");
  assert.equal(candidate.amountOut, 98n);
  assert.equal(candidate.gasUnits, 130_000n + 130_000n + 90_000n);
  assert.equal(candidate.legs.length, 2);
  assert.equal(candidate.legs[0].amountIn, 60n);
});

test("split provider returns nothing without a configured router", async () => {
  const provider = createSplitQuoteCandidateProvider({
    routerAddress: null,
    directQuoteProvider: depthAwareDirectProvider(),
  });
  assert.deepEqual(await provider({ sellToken: usdc, buyToken: wdoge, amountIn: 10n ** 18n }), []);
});

test("split provider surfaces a candidate that beats the best single venue", async () => {
  const provider = createSplitQuoteCandidateProvider({
    routerAddress: router,
    directQuoteProvider: depthAwareDirectProvider(),
    nowMs: () => 1_000,
  });

  const [candidate] = await provider({
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 10n ** 17n, // 0.1e18 — large enough that concavity makes a split win
    quoteMode: "exactInput",
  });

  assert.ok(candidate, "expected a split candidate");
  assert.equal(candidate.sourceId, SPLIT_SOURCE_ID);
  assert.equal(candidate.legs.length, 2);
  // Two legs spanning two distinct venues, totalling the full input.
  const total = candidate.legs.reduce((sum, l) => sum + l.amountIn, 0n);
  assert.equal(total, 10n ** 17n);
  assert.notEqual(candidate.legs[0].sourceId, candidate.legs[1].sourceId);
});

test("split provider declines when one venue dominates (no real improvement)", async () => {
  // Linear (no slippage) provider: splitting can't beat a single venue.
  const linear = async (input) => {
    const amountIn = BigInt(input.amountIn);
    const include = input.includeSources ?? [];
    return [
      { sourceId: "muchfi-v2", protocolType: "v2" },
      { sourceId: "muchfi-v3", protocolType: "v3", feeTier: 500n },
    ]
      .filter((v) => include.length === 0 || include.includes(v.sourceId))
      .map((v) => leg(v.sourceId, v.protocolType, amountIn, amountIn, v.feeTier ? { feeTier: v.feeTier } : {}));
  };

  const provider = createSplitQuoteCandidateProvider({
    routerAddress: router,
    directQuoteProvider: linear,
  });
  assert.deepEqual(await provider({ sellToken: usdc, buyToken: wdoge, amountIn: 10n ** 18n }), []);
});

test("split provider respects source pinning to other venues", async () => {
  const provider = createSplitQuoteCandidateProvider({
    routerAddress: router,
    directQuoteProvider: depthAwareDirectProvider(),
  });
  const result = await provider({
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 10n ** 17n,
    includeSources: ["muchfi-v2"],
  });
  assert.deepEqual(result, []);
});
