import assert from "node:assert/strict";
import test from "node:test";

import { DOGEOS_CHAIN } from "../../config/src/chains.mjs";
import {
  GET_L1_FEE_SELECTOR,
  createDogeosDataFinalityFeeProvider,
  decodeUint256Result,
  encodeGetL1FeeCall,
  estimatedSwapPayloadForFee,
} from "../src/fees/l1GasPriceOracle.mjs";

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

test("encodeGetL1FeeCall ABI-encodes dynamic bytes for DogeOS L1GasPriceOracle", () => {
  assert.equal(GET_L1_FEE_SELECTOR, "0x49948e0e");
  assert.equal(
    encodeGetL1FeeCall("0xdeadbeef"),
    `0x49948e0e${word(32n)}${word(4n)}${"deadbeef".padEnd(64, "0")}`,
  );
});

test("decodeUint256Result parses oracle uint256 return values", () => {
  assert.equal(decodeUint256Result(`0x${word(12_345n)}`), 12_345n);
  assert.throws(() => decodeUint256Result("0x1234"), /uint256/);
});

test("estimatedSwapPayloadForFee uses calldata-size-aware protocol payloads", () => {
  assert.equal((estimatedSwapPayloadForFee({ protocolType: "v2" }).length - 2) / 2, 260);
  assert.equal((estimatedSwapPayloadForFee({ protocolType: "v3" }).length - 2) / 2, 228);
  assert.equal((estimatedSwapPayloadForFee({ protocolType: "algebra" }).length - 2) / 2, 260);
  assert.equal(estimatedSwapPayloadForFee({ protocolType: "unknown" }), "0x");
});

test("createDogeosDataFinalityFeeProvider reads and caches DogeOS oracle fees by payload", async () => {
  const calls = [];
  const client = {
    async call(transaction, blockTag) {
      calls.push({ transaction, blockTag });
      return `0x${word(10_000n)}`;
    },
  };
  let now = 1_000;
  const feeProvider = createDogeosDataFinalityFeeProvider({
    client,
    nowMs: () => now,
    cacheTtlMs: 15_000,
  });

  assert.equal(await feeProvider({ sourceId: "muchfi-v2", protocolType: "v2" }), 10_000n);
  now += 1_000;
  assert.equal(await feeProvider({ sourceId: "muchfi-v2", protocolType: "v2" }), 10_000n);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].transaction.to, DOGEOS_CHAIN.l1GasPriceOracle);
  assert.equal(calls[0].transaction.data.slice(0, 10), GET_L1_FEE_SELECTOR);
  assert.equal(calls[0].blockTag, "latest");
});
