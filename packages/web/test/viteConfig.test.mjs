import assert from "node:assert/strict";
import test from "node:test";

import { dogeosApiPlugin } from "../../../vite.config.mjs";

function collectMiddlewareResponse(middleware, request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let nextCalled = false;
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
          nextCalled,
          statusCode: this.statusCode,
          headers: this.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      },
    };

    const next = () => {
      nextCalled = true;
      resolve({ nextCalled, statusCode: null, headers: null, body: "" });
    };

    Promise.resolve(middleware(request, response, next)).catch(reject);
  });
}

function incomingRequest({ method = "GET", url = "/", body = "", headers = {} } = {}) {
  const listeners = {};
  return {
    method,
    url,
    headers: {
      host: "127.0.0.1:8788",
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

function middlewareFromPlugin(plugin) {
  let middleware = null;
  plugin.configureServer({
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
  });
  assert.equal(typeof middleware, "function");
  return middleware;
}

test("Vite dev server delegates every app API route and serves runtime DogeOS SDK config", async () => {
  const seen = [];
  const middleware = middlewareFromPlugin(
    dogeosApiPlugin({
      apiHandle: async (request) => {
        seen.push([request.method, new URL(request.url).pathname, await request.text()]);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      },
      runtimeConfig: {
        dogeosClientId: "dev-dogeos-client",
        walletConnectProjectId: "dev-walletconnect",
      },
    }),
  );

  const venues = await collectMiddlewareResponse(middleware, incomingRequest({ url: "/venues" }));
  const approval = await collectMiddlewareResponse(
    middleware,
    incomingRequest({
      method: "POST",
      url: "/approval",
      body: JSON.stringify({ owner: "0x1111111111111111111111111111111111111111" }),
      headers: { "content-type": "application/json" },
    }),
  );
  const runtimeConfig = await collectMiddlewareResponse(
    middleware,
    incomingRequest({ url: "/runtime-config.js" }),
  );
  const staticAsset = await collectMiddlewareResponse(
    middleware,
    incomingRequest({ url: "/styles.css" }),
  );

  assert.equal(venues.statusCode, 200);
  assert.equal(approval.statusCode, 200);
  assert.deepEqual(seen, [
    ["GET", "/venues", ""],
    ["POST", "/approval", "{\"owner\":\"0x1111111111111111111111111111111111111111\"}"],
  ]);
  assert.equal(runtimeConfig.statusCode, 200);
  assert.match(runtimeConfig.headers["content-type"], /text\/javascript/);
  assert.match(runtimeConfig.body, /"dogeosClientId":"dev-dogeos-client"/);
  assert.match(runtimeConfig.body, /"walletConnectProjectId":"dev-walletconnect"/);
  assert.equal(staticAsset.nextCalled, true);
});
