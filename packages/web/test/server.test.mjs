import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createWebRequestListener,
  startAggregatorWebServer,
} from "../src/server.mjs";

const stubApi = async () => new Response("{}", { headers: { "content-type": "application/json" } });

// Pin the static root to the authored React source so the shell assertions are
// deterministic whether or not a (possibly stale) Vite `dist/` build is present.
const sourceRoot = fileURLToPath(new URL("../../../apps/web/src/", import.meta.url));

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

test("web listener serves the React app shell and static assets", async () => {
  const listener = createWebRequestListener({
    apiHandle: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
    staticRoot: sourceRoot,
  });

  const index = await collectResponse(listener, incomingRequest({ url: "/" }));
  const entry = await collectResponse(listener, incomingRequest({ url: "/main.jsx" }));
  const favicon = await collectResponse(listener, incomingRequest({ url: "/favicon.ico" }));

  // The shell the server returns is the React mount document, not the legacy
  // vanilla aggregator markup.
  assert.equal(index.statusCode, 200);
  assert.match(index.headers["content-type"], /text\/html/);
  assert.match(index.body, /DogeSwap/);
  assert.match(index.body, /<div id="root"><\/div>/);
  assert.match(index.body, /<script type="module" src="\/main\.jsx">/);
  assert.match(index.body, /src="\/runtime-config\.js"/);
  assert.doesNotMatch(index.body, /id="swap-form"/);
  assert.doesNotMatch(index.body, /route-table/);

  // The static file server resolves the React entry module that the shell loads
  // (Vite transpiles .jsx in dev/build; the dev server resolves the raw module).
  assert.equal(entry.statusCode, 200);
  assert.match(entry.body, /import App from "\.\/ui\/App\.jsx"/);

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

test("web listener delegates wallet activity through the same API boundary", async () => {
  const seen = [];
  const listener = createWebRequestListener({
    apiHandle: async (request) => {
      const url = new URL(request.url);
      seen.push([request.method, url.pathname, url.searchParams.get("address")]);
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
      url: "/activity?address=0x1111111111111111111111111111111111111111",
    }),
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen, [
    ["GET", "/activity", "0x1111111111111111111111111111111111111111"],
  ]);
  assert.deepEqual(JSON.parse(response.body), { data: [] });
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

test("web listener delegates DogeOS chain status through the same API boundary", async () => {
  const seen = [];
  const listener = createWebRequestListener({
    apiHandle: async (request) => {
      seen.push([request.method, new URL(request.url).pathname]);
      return new Response(JSON.stringify({ data: { chainMatches: true } }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    },
  });

  const response = await collectResponse(
    listener,
    incomingRequest({
      method: "GET",
      url: "/chain-status",
    }),
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen, [["GET", "/chain-status"]]);
  assert.deepEqual(JSON.parse(response.body), { data: { chainMatches: true } });
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

test("content-hashed /assets/ files are cached immutable; index.html and runtime-config stay no-store", async () => {
  const root = await mkdtemp(join(tmpdir(), "dogeweb-cache-"));
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "assets", "app-abc123.js"), "console.log(1)");
  await writeFile(join(root, "index.html"), "<!doctype html><html></html>");

  const listener = createWebRequestListener({ apiHandle: stubApi, staticRoot: root });

  const asset = await collectResponse(listener, incomingRequest({ url: "/assets/app-abc123.js" }));
  assert.equal(asset.statusCode, 200);
  assert.match(asset.headers["cache-control"], /public, max-age=31536000, immutable/);

  const html = await collectResponse(listener, incomingRequest({ url: "/" }));
  assert.equal(html.headers["cache-control"], "no-store");

  const cfg = await collectResponse(listener, incomingRequest({ url: "/runtime-config.js" }));
  assert.equal(cfg.headers["cache-control"], "no-store");
});
