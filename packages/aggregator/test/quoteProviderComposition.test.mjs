import assert from "node:assert/strict";
import test from "node:test";

import { createCompositeQuoteCandidateProvider } from "../src/quotes/providers/composite.mjs";

test("createCompositeQuoteCandidateProvider runs quote providers and flattens their candidates", async () => {
  const calls = [];
  const input = {
    sellToken: "USDC",
    buyToken: "WDOGE",
    amountIn: 1_000_000n,
  };
  const provider = createCompositeQuoteCandidateProvider({
    providers: [
      async (request) => {
        calls.push(["v2", request]);
        return [{ sourceId: "muchfi-v2", amountOut: 1_000_000n }];
      },
      async (request) => {
        calls.push(["v3", request]);
        return [{ sourceId: "muchfi-v3", amountOut: 1_100_000n }];
      },
    ],
  });

  const candidates = await provider(input);

  assert.deepEqual(
    candidates.map((candidate) => candidate.sourceId),
    ["muchfi-v2", "muchfi-v3"],
  );
  assert.deepEqual(calls, [
    ["v2", input],
    ["v3", input],
  ]);
});

test("createCompositeQuoteCandidateProvider ignores missing providers", async () => {
  const provider = createCompositeQuoteCandidateProvider({
    providers: [null, async () => [{ sourceId: "muchfi-v2" }], undefined],
  });

  assert.deepEqual(await provider({}), [{ sourceId: "muchfi-v2" }]);
});

test("createCompositeQuoteCandidateProvider keeps healthy provider results when another provider fails", async () => {
  const errors = [];
  const provider = createCompositeQuoteCandidateProvider({
    providers: [
      {
        providerId: "muchfi-v2",
        provider: async () => [{ sourceId: "muchfi-v2", amountOut: 1_000_000n }],
      },
      {
        providerId: "barkswap",
        provider: async () => {
          throw new Error("quoter unavailable");
        },
      },
    ],
    onProviderError: (error, context) => {
      errors.push([context.providerId, error.message]);
    },
  });

  const candidates = await provider({});

  assert.deepEqual(
    candidates.map((candidate) => candidate.sourceId),
    ["muchfi-v2"],
  );
  assert.deepEqual(errors, [["barkswap", "quoter unavailable"]]);
});

test("createCompositeQuoteCandidateProvider times out slow providers without blocking fast quotes", async () => {
  const errors = [];
  const provider = createCompositeQuoteCandidateProvider({
    providerTimeoutMs: 5,
    providers: [
      {
        providerId: "fast-v2",
        provider: async () => [{ sourceId: "muchfi-v2", amountOut: 1_000_000n }],
      },
      {
        providerId: "slow-v3",
        provider: async () => new Promise(() => {}),
      },
    ],
    onProviderError: (error, context) => {
      errors.push([context.providerId, error.message]);
    },
  });

  const candidates = await Promise.race([
    provider({}),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("composite provider hung")), 100);
    }),
  ]);

  assert.deepEqual(
    candidates.map((candidate) => candidate.sourceId),
    ["muchfi-v2"],
  );
  assert.deepEqual(errors, [["slow-v3", "Provider slow-v3 timed out after 5ms."]]);
});
