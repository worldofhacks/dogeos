import { defineConfig } from "vite";

import { createLiveAggregatorApiHandler } from "./packages/api/src/live.mjs";
import { defaultRuntimeConfig, runtimeConfigScript } from "./packages/web/src/server.mjs";

const API_PATHS = new Set([
  "/sources",
  "/tokens",
  "/venues",
  "/verification",
  "/quote",
  "/approval",
  "/swap",
]);
const RUNTIME_CONFIG_PATH = "/runtime-config.js";

function hasBody(method) {
  return !["GET", "HEAD"].includes(method ?? "GET");
}

function headersFromIncomingMessage(message) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(message.headers ?? {})) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  return headers;
}

function readIncomingBody(message) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    message.on("data", (chunk) => chunks.push(chunk));
    message.on("end", () => resolveBody(Buffer.concat(chunks)));
    message.on("error", reject);
  });
}

async function requestFromIncomingMessage(message) {
  const origin = `http://${message.headers?.host ?? "127.0.0.1"}`;
  const url = new URL(message.url ?? "/", origin);
  const body = hasBody(message.method) ? await readIncomingBody(message) : undefined;

  return new Request(url, {
    method: message.method,
    headers: headersFromIncomingMessage(message),
    body,
  });
}

async function writeFetchResponse(serverResponse, fetchResponse) {
  serverResponse.writeHead(fetchResponse.status, Object.fromEntries(fetchResponse.headers));
  const body = Buffer.from(await fetchResponse.arrayBuffer());
  serverResponse.end(body);
}

export function dogeosApiPlugin({
  apiHandle = createLiveAggregatorApiHandler(),
  runtimeConfig = defaultRuntimeConfig(),
} = {}) {
  return {
    name: "dogeos-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname === RUNTIME_CONFIG_PATH) {
          response.writeHead(200, {
            "cache-control": "no-store",
            "content-type": "text/javascript; charset=utf-8",
          });
          response.end(runtimeConfigScript(runtimeConfig));
          return;
        }

        if (!API_PATHS.has(pathname)) {
          next();
          return;
        }

        try {
          const fetchRequest = await requestFromIncomingMessage(request);
          const fetchResponse = await apiHandle(fetchRequest);
          await writeFetchResponse(response, fetchResponse);
        } catch (error) {
          response.writeHead(500, {
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({
            error: {
              code: "vite-api-error",
              message: error.message,
            },
          }));
        }
      });
    },
  };
}

export default defineConfig({
  root: "apps/web/src",
  publicDir: "public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  plugins: [dogeosApiPlugin()],
});
