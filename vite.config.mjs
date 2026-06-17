import { defineConfig, loadEnv } from "vite";

import { createLiveAggregatorApiHandler } from "./packages/api/src/live.mjs";
import { defaultRuntimeConfig, runtimeConfigScript } from "./packages/web/src/server.mjs";

const API_PATHS = new Set([
  "/sources",
  "/tokens",
  "/chain-status",
  "/venues",
  "/intelligence",
  "/verification",
  "/activity",
  "/quote",
  "/approval",
  "/swap",
]);
const RUNTIME_CONFIG_PATH = "/runtime-config.js";

export function runtimeConfigFromEnv(env = process.env) {
  return {
    dogeosClientId: env.DOGEOS_CLIENT_ID ?? env.VITE_DOGEOS_CLIENT_ID ?? "",
    walletConnectProjectId: env.WALLETCONNECT_PROJECT_ID ?? env.VITE_WALLETCONNECT_PROJECT_ID ?? "",
  };
}

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

// NOTE: no SDK-chunk prefetch. In the hybrid Connect flow most users connect a browser wallet
// via the lightweight injected bridge and NEVER need the ~13.7MB Connect Kit chunk — prefetching
// it would waste their bandwidth. The chunk loads on demand only when a user picks email / social
// / WalletConnect (sdk-wallet.jsx swaps in the SDK provider, whose lazy import fetches it then).

const loadedEnv = {
  ...loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), ""),
  ...process.env,
};

export default defineConfig({
  root: "apps/web/src",
  publicDir: "public",
  define: {
    global: "globalThis",
    "process.browser": "true",
    "process.env": "{}",
    "process.version": JSON.stringify("v18.0.0"),
  },
  resolve: {
    alias: {
      buffer: "buffer/",
      util: "util/",
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  plugins: [dogeosApiPlugin({ runtimeConfig: runtimeConfigFromEnv(loadedEnv) })],
});
