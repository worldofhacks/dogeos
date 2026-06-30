import assert from "node:assert/strict";
import test from "node:test";

import { createRoundTripProbe, readBaseLiquidity } from "../src/discovery/routability.mjs";

const WDOGE = "0x" + "b".repeat(40);
const HEALTHY = "0x" + "1".repeat(40); // round-trips fully
const LOSSY = "0x" + "3".repeat(40); // recovers < 60%
const HONEYPOT = "0x" + "2".repeat(40); // buyable, sell blocked

// Mock quoteProbe: buy (WDOGE->token) returns tokensOut = amountIn; sell
// (token->WDOGE) returns amountIn * retentionBps / 10000 (or no route).
function mockProbe(behaviors) {
  return async ({ sellToken, buyToken, amountIn }) => {
    const isBuy = sellToken.toLowerCase() === WDOGE.toLowerCase();
    const token = (isBuy ? buyToken : sellToken).toLowerCase();
    const b = behaviors[token];
    if (!b) return { ok: false };
    if (isBuy) return { ok: true, amountOut: BigInt(amountIn), priceImpactBps: 0 };
    if (b.sellBlocked) return { ok: false };
    return { ok: true, amountOut: (BigInt(amountIn) * BigInt(b.retentionBps)) / 10000n, priceImpactBps: 0 };
  };
}

test("round-trip probe: healthy passes; honeypot, lossy, and no-route fail", async () => {
  const probe = createRoundTripProbe({
    quoteProbe: mockProbe({
      [HEALTHY]: { retentionBps: 10000 },
      [LOSSY]: { retentionBps: 5000 },
      [HONEYPOT]: { sellBlocked: true },
    }),
    base: WDOGE,
  });
  assert.equal(await probe(HEALTHY), true, "full round trip passes");
  assert.equal(await probe(LOSSY), false, "< 60% retention dropped");
  assert.equal(await probe(HONEYPOT), false, "sell-blocked honeypot dropped");
  assert.equal(await probe("0x" + "9".repeat(40)), false, "no route at all dropped");
});

test("round-trip probe is a no-op when no quoteProbe is wired", async () => {
  const probe = createRoundTripProbe({ base: WDOGE });
  assert.equal(await probe(HEALTHY), true);
});

test("readBaseLiquidity sums balanceOf(base) across a token's pools", async () => {
  const client = { call: async () => "0x" + (3n * 10n ** 16n).toString(16).padStart(64, "0") }; // 0.03 each
  const pools = [{ poolAddress: "0x" + "a".repeat(40) }, { poolAddress: "0x" + "c".repeat(40) }];
  assert.equal(await readBaseLiquidity({ client, base: WDOGE, pools }), 6n * 10n ** 16n);
});
