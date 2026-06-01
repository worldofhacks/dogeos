import assert from "node:assert/strict";
import test from "node:test";

import { verifySwapTransaction } from "../src/swap/verifySwapTx.mjs";

const sender = "0x2222222222222222222222222222222222222222";
const transaction = {
  chainId: 6_281_971,
  to: "0x1111111111111111111111111111111111111111",
  data: "0x38ed1739",
  value: 0n,
};

test("verifySwapTransaction simulates calldata before returning a buffered gas limit", async () => {
  const calls = [];
  const client = {
    async call(request, blockTag) {
      calls.push(["call", request, blockTag]);
      return "0x";
    },
    async estimateGas(request) {
      calls.push(["estimateGas", request]);
      return 100_000n;
    },
  };

  const verification = await verifySwapTransaction({
    client,
    transaction,
    sender,
    gasBufferBps: 12_500n,
  });

  assert.deepEqual(calls, [
    [
      "call",
      {
        from: sender,
        to: transaction.to,
        data: transaction.data,
        value: 0n,
      },
      "latest",
    ],
    [
      "estimateGas",
      {
        from: sender,
        to: transaction.to,
        data: transaction.data,
        value: 0n,
      },
    ],
  ]);
  assert.deepEqual(verification, {
    status: "simulated",
    estimatedGas: 100_000n,
    gasLimit: 125_000n,
    gasBufferBps: 12_500n,
    blockTag: "latest",
  });
});

test("verifySwapTransaction resolves DogeOS data/finality fee from exact calldata", async () => {
  let feeInput;
  const client = {
    async call() {
      return "0x";
    },
    async estimateGas() {
      return 100_000n;
    },
  };

  const verification = await verifySwapTransaction({
    client,
    transaction,
    sender,
    dataFinalityFeeWei: async (input) => {
      feeInput = input;
      return 12_345n;
    },
  });

  assert.equal(feeInput.transaction.data, transaction.data);
  assert.equal(feeInput.request.from, sender);
  assert.equal(feeInput.blockTag, "latest");
  assert.equal(verification.dataFinalityFeeWei, 12_345n);
});

test("verifySwapTransaction starts simulation and gas estimation in parallel", async () => {
  let releaseSimulation;
  let estimateStarted = false;
  let markSimulationStarted;
  const simulationStarted = new Promise((resolve) => {
    markSimulationStarted = resolve;
  });
  const client = {
    async call() {
      markSimulationStarted();
      await new Promise((resolve) => {
        releaseSimulation = resolve;
      });
      return "0x";
    },
    async estimateGas() {
      estimateStarted = true;
      return 100_000n;
    },
  };

  const verificationPromise = verifySwapTransaction({
    client,
    transaction,
    sender,
  });

  await simulationStarted;
  await Promise.resolve();
  assert.equal(estimateStarted, true);

  releaseSimulation();
  const verification = await verificationPromise;

  assert.equal(verification.estimatedGas, 100_000n);
});

test("verifySwapTransaction requires a concrete sender for allowance-aware simulation", async () => {
  await assert.rejects(
    () =>
      verifySwapTransaction({
        client: {
          async call() {
            throw new Error("should not call RPC");
          },
        },
        transaction,
        sender: "",
      }),
    /sender must be a 20-byte hex address/,
  );
});
