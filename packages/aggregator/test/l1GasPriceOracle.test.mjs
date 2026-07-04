import assert from "node:assert/strict";
import test from "node:test";

import { DOGEOS_CHAIN } from "../../config/src/chains.mjs";
import {
  GET_L1_FEE_SELECTOR,
  createDogeosDataFinalityFeeProvider,
  decodeUint256Result,
  encodeGetL1FeeCall,
  estimatedSwapPayloadForFee,
  swapPayloadForFee,
} from "../src/fees/l1GasPriceOracle.mjs";

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

const payloadBytes = (hex) => (hex.length - 2) / 2;

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
  // v3 direct = multicall(deadline, [singleSwap]): 4 selector + 160 head + 256 inner.
  assert.equal((estimatedSwapPayloadForFee({ protocolType: "v3" }).length - 2) / 2, 420);
  assert.equal((estimatedSwapPayloadForFee({ protocolType: "algebra" }).length - 2) / 2, 260);
  assert.equal(estimatedSwapPayloadForFee({ protocolType: "unknown" }), "0x");
});

test("swapPayloadForFee charges the real router-program length, not the direct-venue size", () => {
  // Direct-venue: router off / not executable -> the real direct calldata sizes
  // (v3 includes the multicall deadline wrapper since issue #16).
  assert.equal(payloadBytes(swapPayloadForFee({ protocolType: "v3", routerExecutable: false })), 420);
  assert.equal(payloadBytes(swapPayloadForFee({ protocolType: "v2", routerMode: "off", routerExecutable: true })), 260);

  // exactOutput stays direct-venue even under router mode "all" (router is exact-input only).
  assert.equal(
    payloadBytes(swapPayloadForFee({ protocolType: "v3", quoteMode: "exactOutput", routerMode: "all", routerExecutable: true })),
    420,
  );

  // Router-executable exactInput single venue -> a 1-leg router program (~644B),
  // ~2.8x the old v3 size — this is the under-count the audit flagged.
  assert.equal(
    payloadBytes(swapPayloadForFee({ protocolType: "v3", quoteMode: "exactInput", routerMode: "all", routerExecutable: true })),
    644,
  );

  // A split is ONE combined router program (~900B for 2 legs), NOT 2x a per-leg size.
  assert.equal(payloadBytes(swapPayloadForFee({ routeType: "split", legCount: 2 })), 900);
  assert.equal(payloadBytes(swapPayloadForFee({ routeType: "split", legCount: 3 })), 1156);

  // Unknown protocol with no router execution yields the empty (skip) payload.
  assert.equal(swapPayloadForFee({ protocolType: "unknown", routerExecutable: false }), "0x");
});

test("createDogeosDataFinalityFeeProvider bounds retained cache entries", async () => {
  let calls = 0;
  const client = {
    async call() {
      calls += 1;
      return `0x${word(1_000n)}`;
    },
  };
  const feeProvider = createDogeosDataFinalityFeeProvider({
    client,
    nowMs: () => 1_000,
    cacheTtlMs: 60_000,
    maxCacheEntries: 4,
    payloadProvider: ({ payload }) => payload,
  });

  // The swap path keys this cache by unique per-swap calldata; 100 distinct
  // payloads must not retain 100 entries.
  for (let i = 0; i < 100; i += 1) {
    await feeProvider({ payload: `0x${i.toString(16).padStart(4, "0")}` });
  }
  assert.equal(calls, 100);

  // The most recent payload is still cached…
  await feeProvider({ payload: "0x0063" });
  assert.equal(calls, 100);
  // …while evicted early payloads re-read the oracle.
  await feeProvider({ payload: "0x0000" });
  assert.equal(calls, 101);
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
