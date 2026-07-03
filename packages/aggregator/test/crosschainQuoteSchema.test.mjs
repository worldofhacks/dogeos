import assert from "node:assert/strict";
import test from "node:test";

import {
  CROSSCHAIN_PREVIEW_STATUS,
  CROSSCHAIN_PREVIEW_WARNING,
  buildReadOnlyCrosschainRoute,
  deriveCrosschainOrderStatus,
  isCrosschainEnabled,
  normalizeCrosschainLeg,
  validateCrosschainRoute,
} from "../src/crosschain/quoteSchema.mjs";

const now = 1_780_000_000_000;

function bridgeLeg(overrides = {}) {
  return {
    legIndex: 0,
    kind: "bridge",
    chainId: "dogecoin-testnet",
    toChainId: 6_281_971,
    adapter: "canonical-doge",
    sellToken: "DOGE",
    buyToken: "native",
    amountIn: 100_000_000_000_000_000_000n,
    amountOut: 100_000_000_000_000_000_000n,
    etaSeconds: 14_400,
    status: "pending",
    ...overrides,
  };
}

function swapLeg(overrides = {}) {
  return {
    legIndex: 1,
    kind: "swap",
    chainId: 6_281_971,
    adapter: "dogeswap",
    sourceId: "muchfi-v3",
    sellToken: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
    buyToken: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
    amountIn: 100_000_000_000_000_000_000n,
    amountOut: 94_100_000_000_000_000_000_000n,
    etaSeconds: 15,
    status: "pending",
    ...overrides,
  };
}

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

test("isCrosschainEnabled recognizes explicit truthy env values only", () => {
  assert.equal(isCrosschainEnabled({ CROSSCHAIN_ENABLED: "1" }), true);
  assert.equal(isCrosschainEnabled({ CROSSCHAIN_ENABLED: "true" }), true);
  assert.equal(isCrosschainEnabled({ CROSSCHAIN_ENABLED: "on" }), true);
  assert.equal(isCrosschainEnabled({ CROSSCHAIN_ENABLED: "0" }), false);
  assert.equal(isCrosschainEnabled({}), false);
});

test("normalizeCrosschainLeg validates bridge and swap legs without losing venue metadata", () => {
  const bridge = normalizeCrosschainLeg(bridgeLeg({ txHash: "" }));
  assert.equal(bridge.chainId, "dogecoin-testnet");
  assert.equal(bridge.toChainId, 6_281_971);
  assert.equal(bridge.txHash, null);
  assert.equal(bridge.amountIn, 100_000_000_000_000_000_000n);

  const swap = normalizeCrosschainLeg(swapLeg({ feeTier: "2500" }));
  assert.equal(swap.chainId, 6_281_971);
  assert.equal(swap.toChainId, undefined);
  assert.equal(swap.sourceId, "muchfi-v3");
  assert.equal(swap.feeTier, "2500");
});

test("buildReadOnlyCrosschainRoute creates the phase-0 multi-leg preview shape", () => {
  const route = buildReadOnlyCrosschainRoute({
    sourceId: "crosschain-canonical-doge",
    displayName: "Canonical DOGE bridge preview",
    sellToken: "DOGE@dogecoin-testnet",
    buyToken: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925@6281971",
    quoteTimestampMs: now,
    ttlMs: 60_000,
    legs: [bridgeLeg(), swapLeg()],
  });

  assert.equal(route.routeType, "crosschain");
  assert.equal(route.protocolType, "crosschain");
  assert.equal(route.status, CROSSCHAIN_PREVIEW_STATUS);
  assert.equal(route.fromChainId, "dogecoin-testnet");
  assert.equal(route.toChainId, 6_281_971);
  assert.equal(route.amountIn, 100_000_000_000_000_000_000n);
  assert.equal(route.amountOut, 94_100_000_000_000_000_000_000n);
  assert.equal(route.etaSeconds, 14_415);
  assert.deepEqual(route.warnings, [CROSSCHAIN_PREVIEW_WARNING, "bridge-relay-up-to-4h"]);
  assert.equal(route.legs[0].kind, "bridge");
  assert.equal(route.legs[1].kind, "swap");
});

test("validateCrosschainRoute fails closed for executable-looking cross-chain routes", () => {
  const route = buildReadOnlyCrosschainRoute({
    sourceId: "crosschain-canonical-doge",
    sellToken: "DOGE@dogecoin-testnet",
    buyToken: "WDOGE@6281971",
    legs: [bridgeLeg()],
  });

  assert.equal(validateCrosschainRoute(route).status, "readOnly");
  assert.throws(
    () => validateCrosschainRoute({ ...route, status: "active" }),
    /phase-0 routes must be readOnly/,
  );
  assert.throws(
    () => buildReadOnlyCrosschainRoute({ ...route, legs: [swapLeg({ legIndex: 4 })] }),
    /legIndex 4 must match/,
  );
});

test("cross-chain route serialization keeps bigint values JSON-safe", () => {
  const route = buildReadOnlyCrosschainRoute({
    sourceId: "crosschain-canonical-doge",
    sellToken: "DOGE@dogecoin-testnet",
    buyToken: "WDOGE@6281971",
    legs: [bridgeLeg()],
  });

  const body = JSON.parse(JSON.stringify(route, jsonReplacer));
  assert.equal(body.amountIn, "100000000000000000000");
  assert.equal(body.legs[0].amountOut, "100000000000000000000");
});

test("deriveCrosschainOrderStatus maps leg lifecycles to order status", () => {
  assert.equal(deriveCrosschainOrderStatus([bridgeLeg()]), "pending");
  assert.equal(deriveCrosschainOrderStatus([bridgeLeg({ status: "awaiting-user" })]), "in-progress");
  assert.equal(
    deriveCrosschainOrderStatus([
      bridgeLeg({ status: "submitted", submittedAtMs: now - 14_401_000 }),
    ], { nowMs: now }),
    "delayed",
  );
  assert.equal(deriveCrosschainOrderStatus([bridgeLeg({ status: "confirmed" })]), "success");
  assert.equal(deriveCrosschainOrderStatus([bridgeLeg({ status: "refunded" })]), "refunded");
  assert.equal(deriveCrosschainOrderStatus([bridgeLeg({ status: "failed" })]), "failed");
  assert.equal(
    deriveCrosschainOrderStatus([
      bridgeLeg({ status: "confirmed" }),
      swapLeg({ status: "failed" }),
    ]),
    "partial",
  );
});
