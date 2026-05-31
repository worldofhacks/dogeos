import assert from "node:assert/strict";
import test from "node:test";

import {
  BALANCE_OF_SELECTOR,
  buildSwapBalancePreflight,
  createSwapBalanceVerifier,
  encodeErc20BalanceOfCall,
} from "../src/swap/balancePreflight.mjs";

const sellToken = "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925";
const sender = "0x1111111111111111111111111111111111111111";
const router = "0x2222222222222222222222222222222222222222";

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function encodedAddress(address) {
  return address.toLowerCase().slice(2).padStart(64, "0");
}

function quote(overrides = {}) {
  return {
    quoteMode: "exactInput",
    sellToken,
    router,
    amountIn: 1_000n,
    ...overrides,
  };
}

function transaction(overrides = {}) {
  return {
    to: router,
    data: "0x38ed1739",
    value: 0n,
    ...overrides,
  };
}

function verification(overrides = {}) {
  return {
    gasLimit: 100_000n,
    dataFinalityFeeWei: 5_000n,
    ...overrides,
  };
}

test("encodeErc20BalanceOfCall ABI-encodes balanceOf(owner)", () => {
  assert.equal(
    encodeErc20BalanceOfCall({ owner: sender }),
    `${BALANCE_OF_SELECTOR}${encodedAddress(sender)}`,
  );
});

test("buildSwapBalancePreflight accepts balances covering exact-output max input and DOGE fees", () => {
  const preflight = buildSwapBalancePreflight({
    quote: quote({
      quoteMode: "exactOutput",
      amountIn: 100n,
      amountOut: 90n,
      maxAmountIn: 110n,
    }),
    transaction: transaction({ value: 2n }),
    verification: verification({ gasLimit: 100n, dataFinalityFeeWei: 30n }),
    gasPriceWei: 2n,
    sellTokenBalance: 110n,
    nativeBalance: 232n,
  });

  assert.deepEqual(preflight, {
    status: "sufficient",
    requiredSellAmount: 110n,
    sellTokenBalance: 110n,
    requiredNativeWei: 232n,
    nativeBalance: 232n,
  });
});

test("buildSwapBalancePreflight rejects insufficient sell-token balance", () => {
  assert.throws(
    () =>
      buildSwapBalancePreflight({
        quote: quote({ amountIn: 1_000n }),
        transaction: transaction(),
        verification: verification(),
        gasPriceWei: 1n,
        sellTokenBalance: 999n,
        nativeBalance: 1_000_000n,
      }),
    /sell-token balance/i,
  );
});

test("buildSwapBalancePreflight rejects insufficient native DOGE balance for gas and value", () => {
  assert.throws(
    () =>
      buildSwapBalancePreflight({
        quote: quote({ amountIn: 1_000n }),
        transaction: transaction({ value: 2n }),
        verification: verification({ gasLimit: 100n, dataFinalityFeeWei: 30n }),
        gasPriceWei: 2n,
        sellTokenBalance: 1_000n,
        nativeBalance: 231n,
      }),
    /native DOGE balance/i,
  );
});

test("createSwapBalanceVerifier reads ERC-20 and native balances before swap submission", async () => {
  const calls = [];
  const verifier = createSwapBalanceVerifier({
    client: {
      async call(request, blockTag) {
        calls.push(["call", request, blockTag]);
        return `0x${word(1_000n)}`;
      },
      async getBalance(address, blockTag) {
        calls.push(["getBalance", address, blockTag]);
        return 1_000_000n;
      },
    },
    gasPriceWei: async () => 2n,
  });

  const preflight = await verifier({
    quote: quote({ amountIn: 1_000n }),
    transaction: transaction(),
    verification: verification({ gasLimit: 100n, dataFinalityFeeWei: 30n }),
    sender,
  });

  assert.equal(preflight.status, "sufficient");
  assert.deepEqual(calls, [
    [
      "call",
      {
        to: sellToken,
        data: `${BALANCE_OF_SELECTOR}${encodedAddress(sender)}`,
      },
      "latest",
    ],
    ["getBalance", sender, "latest"],
  ]);
});
