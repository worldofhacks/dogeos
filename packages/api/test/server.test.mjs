import { createServer } from "node:http";
import assert from "node:assert/strict";
import test from "node:test";

import { createAggregatorApiHandler } from "../src/handler.mjs";
import { createNodeRequestListener, startAggregatorApiServer } from "../src/server.mjs";

async function withServer(listener, testFn) {
  const server = createServer(listener);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address();
    await testFn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function rpcQueue(results) {
  const calls = [];

  return {
    calls,
    fetchFn: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: results.shift(),
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  };
}

test("Node API server adapter serves the aggregator handler over HTTP", async () => {
  const listener = createNodeRequestListener({
    handle: createAggregatorApiHandler({ nowMs: () => 1_780_000_000_000 }),
  });

  await withServer(listener, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/tokens`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(body.data[0].symbol, "WDOGE");
  });
});

test("Node API server adapter forwards POST bodies to the handler", async () => {
  const listener = createNodeRequestListener({
    handle: createAggregatorApiHandler({ nowMs: () => 1_780_000_000_000 }),
  });

  await withServer(listener, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chainId: 6_281_971,
        sellToken: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
        buyToken: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
        amountIn: "1000000",
        slippageBps: "50",
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "no-route");
    assert.deepEqual(body.warnings, ["no-executable-route"]);
  });
});

test("startAggregatorApiServer defaults to live DogeOS chain and gas providers", async () => {
  const rpc = rpcQueue(["0x5fdaf3", "0x2"]);
  const server = await startAggregatorApiServer({
    host: "127.0.0.1",
    port: 0,
    nowMs: () => 1_780_000_000_000,
    fetchFn: rpc.fetchFn,
    quoteCandidateProvider: async () => [],
  });

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chainId: 6_281_971,
        sellToken: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
        buyToken: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
        amountIn: "1000000",
        slippageBps: "50",
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "no-route");
    assert.deepEqual(
      rpc.calls.map((call) => call.method),
      ["eth_chainId", "eth_gasPrice"],
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
