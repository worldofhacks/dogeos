import assert from "node:assert/strict";
import test from "node:test";

import { applyGasSpeed, gasSpeedTier } from "../../../apps/web/src/lib/execute.js";

// DogeOS base fee is tiny (~0.0157 gwei). A fixed gwei tip would exceed it and
// break EIP-1559 (the original bug: maxFeePerGas 15680108 < maxPriorityFeePerGas
// 2000000000). The tip must scale to the live base fee and maxFeePerGas must
// always be >= maxPriorityFeePerGas.
const DOGEOS_BASE_FEE_HEX = "0xef4a6c"; // 15680108 wei
function provider(gasPriceHex = DOGEOS_BASE_FEE_HEX) {
  return { async request({ method }) { return method === "eth_gasPrice" ? gasPriceHex : "0x0"; } };
}

test("gasSpeedTier maps the legacy gwei presets to tiers", () => {
  assert.equal(gasSpeedTier(1), "eco");
  assert.equal(gasSpeedTier(2), "normal");
  assert.equal(gasSpeedTier(12), "fast");
  assert.equal(gasSpeedTier(0), null);
});

test("applyGasSpeed sets EIP-1559 fields with maxFee >= tip at DogeOS base fee", async () => {
  for (const gwei of [1, 2, 12]) {
    const req = {};
    await applyGasSpeed(req, provider(), gwei);
    const maxFee = BigInt(req.maxFeePerGas);
    const tip = BigInt(req.maxPriorityFeePerGas);
    assert.ok(maxFee >= tip, `maxFee (${maxFee}) must be >= tip (${tip}) for gwei=${gwei}`);
    // tip must be a sane fraction of the base fee, never the absurd 2 gwei.
    assert.ok(tip < 100_000_000n, `tip ${tip} should be << 0.1 gwei on DogeOS`);
  }
});

test("applyGasSpeed escalates the tip across tiers", async () => {
  const tip = async (g) => {
    const req = {};
    await applyGasSpeed(req, provider(), g);
    return BigInt(req.maxPriorityFeePerGas ?? 0n);
  };
  assert.equal(await tip(1), 0n); // eco: no tip
  assert.ok((await tip(2)) > 0n); // normal: some tip
  assert.ok((await tip(12)) > (await tip(2))); // fast: bigger tip
});

test("applyGasSpeed leaves gas to the wallet when the base fee can't be read", async () => {
  const req = {};
  await applyGasSpeed(req, { async request() { throw new Error("rpc down"); } }, 12);
  assert.equal(req.maxFeePerGas, undefined);
  assert.equal(req.maxPriorityFeePerGas, undefined);
});

test("applyGasSpeed is a no-op without a gas-speed setting", async () => {
  const req = {};
  await applyGasSpeed(req, provider(), 0);
  assert.equal(req.maxFeePerGas, undefined);
});
