import assert from "node:assert/strict";
import test from "node:test";

import { createJsonRpcClient } from "../src/jsonRpcClient.mjs";

function responseQueue(responses) {
  const calls = [];

  return {
    calls,
    fetchFn: async (url, init) => {
      calls.push({
        url,
        body: JSON.parse(init.body),
      });

      return new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

test("createJsonRpcClient sends JSON-RPC requests and parses DogeOS chain values", async () => {
  const rpc = responseQueue([
    { jsonrpc: "2.0", id: 1, result: "0x5fdaf3" },
    { jsonrpc: "2.0", id: 2, result: "0x3b9aca00" },
    { jsonrpc: "2.0", id: 3, result: "0x4f7900" },
  ]);
  const client = createJsonRpcClient({
    rpcUrl: "https://rpc.testnet.dogeos.com",
    fetchFn: rpc.fetchFn,
  });

  assert.equal(await client.getChainId(), 6_281_971);
  assert.equal(await client.getGasPriceWei(), 1_000_000_000n);
  assert.equal(await client.getBlockNumber(), 5_208_320n);
  assert.deepEqual(
    rpc.calls.map((call) => call.body.method),
    ["eth_chainId", "eth_gasPrice", "eth_blockNumber"],
  );
});

test("createJsonRpcClient reads contract bytecode at a block tag", async () => {
  const rpc = responseQueue([{ jsonrpc: "2.0", id: 1, result: "0x60016002" }]);
  const client = createJsonRpcClient({
    rpcUrl: "https://rpc.testnet.dogeos.com",
    fetchFn: rpc.fetchFn,
  });

  const bytecode = await client.getCode("0x1111111111111111111111111111111111111111", "latest");

  assert.equal(bytecode, "0x60016002");
  assert.deepEqual(rpc.calls[0].body.params, [
    "0x1111111111111111111111111111111111111111",
    "latest",
  ]);
});

test("createJsonRpcClient reads native DOGE balance at a block tag", async () => {
  const rpc = responseQueue([{ jsonrpc: "2.0", id: 1, result: "0xde0b6b3a7640000" }]);
  const client = createJsonRpcClient({
    rpcUrl: "https://rpc.testnet.dogeos.com",
    fetchFn: rpc.fetchFn,
  });

  const balance = await client.getBalance("0x1111111111111111111111111111111111111111", "latest");

  assert.equal(balance, 1_000_000_000_000_000_000n);
  assert.deepEqual(rpc.calls[0].body.params, [
    "0x1111111111111111111111111111111111111111",
    "latest",
  ]);
});

test("createJsonRpcClient estimates gas with sender and native value", async () => {
  const rpc = responseQueue([{ jsonrpc: "2.0", id: 1, result: "0x1d4c0" }]);
  const client = createJsonRpcClient({
    rpcUrl: "https://rpc.testnet.dogeos.com",
    fetchFn: rpc.fetchFn,
  });

  const gas = await client.estimateGas({
    from: "0x2222222222222222222222222222222222222222",
    to: "0x1111111111111111111111111111111111111111",
    data: "0x38ed1739",
    value: 5n,
  });

  assert.equal(gas, 120_000n);
  assert.deepEqual(rpc.calls[0].body, {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_estimateGas",
    params: [
      {
        from: "0x2222222222222222222222222222222222222222",
        to: "0x1111111111111111111111111111111111111111",
        data: "0x38ed1739",
        value: "0x5",
      },
    ],
  });
});

test("createJsonRpcClient surfaces RPC errors with method context", async () => {
  const rpc = responseQueue([
    {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "upstream unavailable" },
    },
  ]);
  const client = createJsonRpcClient({
    rpcUrl: "https://rpc.testnet.dogeos.com",
    fetchFn: rpc.fetchFn,
  });

  await assert.rejects(() => client.getGasPriceWei(), /eth_gasPrice.*upstream unavailable/);
});
