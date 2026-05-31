import assert from "node:assert/strict";
import test from "node:test";

import { createVerifiedCalldataBuilder } from "../src/swap/calldataRegistry.mjs";

const verifiedRouter = "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB";

function quote(overrides = {}) {
  return {
    sourceId: "muchfi-v3",
    protocolType: "v3",
    status: "active",
    chainId: 6_281_971,
    router: verifiedRouter,
    sellToken: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
    buyToken: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
    amountIn: 1_000_000n,
    minAmountOut: 900_000n,
    recipient: "0x1111111111111111111111111111111111111111",
    deadline: 1_780_000_300,
    routeData: "0xdeadbeef",
    ...overrides,
  };
}

function activeSource(overrides = {}) {
  return {
    sourceId: "muchfi-v3",
    status: "active",
    router: verifiedRouter,
    abiProvenance: "blockscout",
    verification: { execution: true },
    ...overrides,
  };
}

function v3Builder(overrides = {}) {
  return {
    sourceId: "muchfi-v3",
    protocolType: "v3",
    selector: "0x04e45aaf",
    buildCalldata: () => "0x04e45aaf",
    ...overrides,
  };
}

test("verified calldata builder rejects sources without a verified typed builder", () => {
  const calldataBuilder = createVerifiedCalldataBuilder({
    sources: [
      {
        sourceId: "muchfi-v3",
        status: "readOnly",
        router: verifiedRouter,
        abiProvenance: "none",
      },
    ],
    builders: [],
  });

  assert.throws(
    () => calldataBuilder(quote({ status: "readOnly" })),
    /no verified calldata builder/i,
  );
});

test("verified calldata builder dispatches only to active sources with ABI provenance and router match", () => {
  const calls = [];
  const calldataBuilder = createVerifiedCalldataBuilder({
    sources: [activeSource()],
    builders: [
      v3Builder({
        buildCalldata: (boundQuote) => {
          calls.push(boundQuote);
          return "0x04e45aaf12345678";
        },
      }),
    ],
  });

  const data = calldataBuilder(quote());

  assert.equal(data, "0x04e45aaf12345678");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].routeData, "0xdeadbeef");
});

test("verified calldata builder dispatches by quote mode and typed selector", () => {
  const calls = [];
  const calldataBuilder = createVerifiedCalldataBuilder({
    sources: [activeSource()],
    builders: [
      v3Builder({
        quoteMode: "exactInput",
        buildCalldata: () => {
          throw new Error("exact-input builder should not be selected");
        },
      }),
      v3Builder({
        quoteMode: "exactOutput",
        selector: "0x5023b4df",
        buildCalldata: (boundQuote) => {
          calls.push(boundQuote);
          return "0x5023b4df12345678";
        },
      }),
    ],
  });

  const data = calldataBuilder(
    quote({
      quoteMode: "exactOutput",
      amountOut: 900_000n,
      maxAmountIn: 1_050_000n,
    }),
  );

  assert.equal(data, "0x5023b4df12345678");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].quoteMode, "exactOutput");
  assert.equal(calls[0].maxAmountIn, 1_050_000n);
});

test("verified calldata builder rejects active selector-only router provenance", () => {
  const calldataBuilder = createVerifiedCalldataBuilder({
    sources: [
      activeSource({
        abiProvenance: "onchain-bytecode",
      }),
    ],
    builders: [v3Builder()],
  });

  assert.throws(() => calldataBuilder(quote()), /ABI provenance/i);
});

test("verified calldata builder allows active adapter ABI fragment sources with runtime execution evidence", () => {
  const calldataBuilder = createVerifiedCalldataBuilder({
    sources: [
      activeSource({
        abiProvenance: "adapter-fragment",
      }),
    ],
    builders: [v3Builder()],
  });

  assert.equal(calldataBuilder(quote()), "0x04e45aaf");
});

test("verified calldata builder rejects router mismatches and missing ABI provenance", () => {
  const withoutAbi = createVerifiedCalldataBuilder({
    sources: [
      activeSource({
        abiProvenance: "none",
      }),
    ],
    builders: [v3Builder()],
  });

  assert.throws(() => withoutAbi(quote()), /ABI provenance/i);

  const routerMismatch = createVerifiedCalldataBuilder({
    sources: [activeSource()],
    builders: [v3Builder()],
  });

  assert.throws(
    () => routerMismatch(quote({ router: "0x2222222222222222222222222222222222222222" })),
    /router/i,
  );
});

test("verified calldata builder rejects missing execution evidence", () => {
  const calldataBuilder = createVerifiedCalldataBuilder({
    sources: [activeSource({ verification: { execution: false } })],
    builders: [v3Builder()],
  });

  assert.throws(() => calldataBuilder(quote()), /not verified for execution/i);
});

test("verified calldata builder rejects selector drift from typed builders", () => {
  const calldataBuilder = createVerifiedCalldataBuilder({
    sources: [activeSource()],
    builders: [
      v3Builder({
        buildCalldata: () => "0xdeadbeef",
      }),
    ],
  });

  assert.throws(() => calldataBuilder(quote()), /selector/i);
});
