import assert from "node:assert/strict";
import test from "node:test";

import {
  createWebRequestListener,
  startAggregatorWebServer,
} from "../src/server.mjs";

function collectResponse(listener, request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const response = {
      statusCode: null,
      headers: null,
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end(chunk = "") {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      },
      on() {},
    };

    Promise.resolve(listener(request, response)).catch(reject);
  });
}

function incomingRequest({ method = "GET", url = "/", body = "", headers = {} } = {}) {
  const listeners = {};
  return {
    method,
    url,
    headers: {
      host: "127.0.0.1:0",
      ...headers,
    },
    on(event, handler) {
      listeners[event] = handler;
      if (event === "data" && body) {
        queueMicrotask(() => handler(Buffer.from(body)));
      }
      if (event === "end") {
        queueMicrotask(handler);
      }
      return this;
    },
  };
}

test("web listener serves the swap app shell and static assets", async () => {
  const listener = createWebRequestListener({
    apiHandle: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
  });

  const index = await collectResponse(listener, incomingRequest({ url: "/" }));
  const cssHref = index.body.match(/href="([^"]+\.css)"/)?.[1] ?? "/styles.css";
  const css = await collectResponse(listener, incomingRequest({ url: cssHref }));
  const favicon = await collectResponse(listener, incomingRequest({ url: "/favicon.ico" }));

  assert.equal(index.statusCode, 200);
  assert.match(index.headers["content-type"], /text\/html/);
  assert.match(index.body, /DogeOS Aggregator/);
  assert.match(index.body, /route-table/);

  assert.equal(css.statusCode, 200);
  assert.match(css.headers["content-type"], /text\/css/);
  assert.match(css.body, /@media/);

  assert.equal(favicon.statusCode, 200);
  assert.match(favicon.headers["content-type"], /image\/svg\+xml/);
});

test("web listener serves DogeOS SDK runtime config without rebuilding the frontend", async () => {
  const listener = createWebRequestListener({
    apiHandle: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
    runtimeConfig: {
      dogeosClientId: "dogeos-client-test",
      walletConnectProjectId: "walletconnect-test",
    },
  });

  const response = await collectResponse(listener, incomingRequest({ url: "/runtime-config.js" }));

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /text\/javascript/);
  assert.match(response.body, /window\.DOGEOS_AGGREGATOR_CONFIG/);
  assert.match(response.body, /"dogeosClientId":"dogeos-client-test"/);
  assert.match(response.body, /"walletConnectProjectId":"walletconnect-test"/);
});

test("web listener delegates aggregator API routes without a cross-origin proxy", async () => {
  const seen = [];
  const listener = createWebRequestListener({
    apiHandle: async (request) => {
      seen.push([request.method, new URL(request.url).pathname, await request.text()]);
      return new Response(JSON.stringify({ status: "no-route" }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    },
  });

  const response = await collectResponse(
    listener,
    incomingRequest({
      method: "POST",
      url: "/quote",
      body: JSON.stringify({ amountIn: "1000" }),
      headers: { "content-type": "application/json" },
    }),
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen, [["POST", "/quote", "{\"amountIn\":\"1000\"}"]]);
  assert.deepEqual(JSON.parse(response.body), { status: "no-route" });
});

test("web listener delegates approval preflight through the same API boundary", async () => {
  const seen = [];
  const listener = createWebRequestListener({
    apiHandle: async (request) => {
      seen.push([request.method, new URL(request.url).pathname, await request.text()]);
      return new Response(JSON.stringify({ approvalRequired: false }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    },
  });

  const response = await collectResponse(
    listener,
    incomingRequest({
      method: "POST",
      url: "/approval",
      body: JSON.stringify({ owner: "0x1111111111111111111111111111111111111111" }),
      headers: { "content-type": "application/json" },
    }),
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen, [
    ["POST", "/approval", "{\"owner\":\"0x1111111111111111111111111111111111111111\"}"],
  ]);
  assert.deepEqual(JSON.parse(response.body), { approvalRequired: false });
});

test("web listener delegates verification snapshots through the API boundary", async () => {
  const seen = [];
  const listener = createWebRequestListener({
    apiHandle: async (request) => {
      seen.push([request.method, new URL(request.url).pathname]);
      return new Response(JSON.stringify({ summary: { hasBlockingMismatch: false } }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    },
  });

  const response = await collectResponse(
    listener,
    incomingRequest({
      method: "GET",
      url: "/verification",
    }),
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen, [["GET", "/verification"]]);
  assert.deepEqual(JSON.parse(response.body), { summary: { hasBlockingMismatch: false } });
});

test("web listener delegates venue contract maps through the API boundary", async () => {
  const seen = [];
  const listener = createWebRequestListener({
    apiHandle: async (request) => {
      seen.push([request.method, new URL(request.url).pathname]);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    },
  });

  const response = await collectResponse(
    listener,
    incomingRequest({
      method: "GET",
      url: "/venues",
    }),
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen, [["GET", "/venues"]]);
  assert.deepEqual(JSON.parse(response.body), { data: [] });
});

test("startAggregatorWebServer binds a local HTTP server", async () => {
  const server = await startAggregatorWebServer({
    port: 0,
    apiHandle: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
  });

  try {
    const address = server.address();
    assert.equal(typeof address.port, "number");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
