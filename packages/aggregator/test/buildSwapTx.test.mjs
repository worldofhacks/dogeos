import assert from "node:assert/strict";
import test from "node:test";

import { buildSwapTx } from "../src/swap/buildSwapTx.mjs";

const now = 1_780_000_000_000;

function activeQuote(overrides = {}) {
  return {
    sourceId: "muchfi-v3",
    status: "active",
    chainId: 6_281_971,
    router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
    sellToken: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
    buyToken: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
    amountIn: 1_000_000n,
    minAmountOut: 900_000n,
    recipient: "0x1111111111111111111111111111111111111111",
    deadline: 1_780_000_300,
    quoteTimestampMs: now,
    ttlMs: 10_000,
    routeData: "0xabcdef",
    nativeValueWei: 0n,
    ...overrides,
  };
}

test("buildSwapTx rejects expired quotes", () => {
  assert.throws(
    () =>
      buildSwapTx({
        quote: activeQuote({ quoteTimestampMs: now - 20_000 }),
        nowMs: now,
        expectedChainId: 6_281_971,
        calldataBuilder: () => "0x1234",
      }),
    /expired/i,
  );
});

test("buildSwapTx rejects sources that are not active", () => {
  assert.throws(
    () =>
      buildSwapTx({
        quote: activeQuote({ status: "readOnly" }),
        nowMs: now,
        expectedChainId: 6_281_971,
        calldataBuilder: () => "0x1234",
      }),
    /not active/i,
  );
});

test("buildSwapTx rejects wrong-chain quotes", () => {
  assert.throws(
    () =>
      buildSwapTx({
        quote: activeQuote({ chainId: 1 }),
        nowMs: now,
        expectedChainId: 6_281_971,
        calldataBuilder: () => "0x1234",
      }),
    /chain/i,
  );
});

test("buildSwapTx binds amount, recipient, min output, deadline, chain, and source", () => {
  const tx = buildSwapTx({
    quote: activeQuote(),
    nowMs: now,
    expectedChainId: 6_281_971,
    calldataBuilder: (quote) => {
      assert.equal(quote.amountIn, 1_000_000n);
      assert.equal(quote.minAmountOut, 900_000n);
      assert.equal(quote.recipient, "0x1111111111111111111111111111111111111111");
      assert.equal(quote.deadline, 1_780_000_300);
      return "0x12345678";
    },
  });

  assert.deepEqual(tx, {
    chainId: 6_281_971,
    to: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
    data: "0x12345678",
    value: 0n,
    sourceId: "muchfi-v3",
    routeBinding: {
      sellToken: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
      buyToken: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
      amountIn: 1_000_000n,
      minAmountOut: 900_000n,
      recipient: "0x1111111111111111111111111111111111111111",
      deadline: 1_780_000_300,
    },
  });
});

test("buildSwapTx binds exact-output amount and max input", () => {
  const tx = buildSwapTx({
    quote: activeQuote({
      quoteMode: "exactOutput",
      amountOut: 900_000n,
      maxAmountIn: 1_050_000n,
      minAmountOut: 900_000n,
    }),
    nowMs: now,
    expectedChainId: 6_281_971,
    calldataBuilder: (quote) => {
      assert.equal(quote.amountOut, 900_000n);
      assert.equal(quote.maxAmountIn, 1_050_000n);
      return "0x5023b4df";
    },
  });

  assert.deepEqual(tx.routeBinding, {
    quoteMode: "exactOutput",
    sellToken: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
    buyToken: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
    amountOut: 900_000n,
    maxAmountIn: 1_050_000n,
    recipient: "0x1111111111111111111111111111111111111111",
    deadline: 1_780_000_300,
  });
});
