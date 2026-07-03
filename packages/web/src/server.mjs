import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createLiveAggregatorApiHandler } from "../../api/src/live.mjs";
import {
  HttpRequestError,
  applyServerTimeouts,
  clientKeyFromMessage,
  createRateLimiter,
  readIncomingBody,
  securityHeaders,
  writeJsonError,
} from "../../api/src/httpHardening.mjs";

const DEFAULT_SOURCE_ROOT = fileURLToPath(new URL("../../../apps/web/src/", import.meta.url));
const DEFAULT_DIST_ROOT = fileURLToPath(new URL("../../../apps/web/dist/", import.meta.url));
const API_PATHS = new Set([
  "/sources",
  "/tokens",
  "/tokenlist",
  "/token",
  "/trending-tokens",
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

const CONTENT_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
});

function defaultStaticRoot() {
  return existsSync(resolve(DEFAULT_DIST_ROOT, "index.html")) ? DEFAULT_DIST_ROOT : DEFAULT_SOURCE_ROOT;
}

export function defaultRuntimeConfig() {
  return {
    dogeosClientId: process.env.DOGEOS_CLIENT_ID ?? process.env.VITE_DOGEOS_CLIENT_ID ?? "",
    walletConnectProjectId:
      process.env.WALLETCONNECT_PROJECT_ID ?? process.env.VITE_WALLETCONNECT_PROJECT_ID ?? "",
  };
}

export function runtimeConfigScript(runtimeConfig = defaultRuntimeConfig()) {
  const body = JSON.stringify({
    dogeosClientId: runtimeConfig.dogeosClientId ?? "",
    walletConnectProjectId: runtimeConfig.walletConnectProjectId ?? "",
  }).replaceAll("<", "\\u003c");

  return `window.DOGEOS_AGGREGATOR_CONFIG = Object.freeze(${body});\n`;
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
  serverResponse.writeHead(fetchResponse.status, {
    ...securityHeaders(),
    ...Object.fromEntries(fetchResponse.headers),
  });
  const body = Buffer.from(await fetchResponse.arrayBuffer());
  serverResponse.end(body);
}

function staticFilePath(pathname, staticRoot) {
  const staticPath = pathname === "/favicon.ico" ? "/favicon.svg" : pathname;
  const decodedPath = decodeURIComponent(staticPath === "/" ? "/index.html" : staticPath);
  const requestedPath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = resolve(staticRoot, `.${requestedPath}`);
  const root = resolve(staticRoot);

  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
    return null;
  }

  return absolutePath;
}

async function serveStatic({ pathname, staticRoot }) {
  const filePath = staticFilePath(pathname, staticRoot);
  if (!filePath) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const body = await readFile(filePath);
    // Files under /assets/ are content-hashed by Vite (immutable): cache them hard so the
    // browser reuses the (large) SDK chunk across visits AND so the idle `<link rel=prefetch>`
    // can actually be STORED — `no-store` was discarding the prefetched bytes and forcing the
    // SDK import to re-download. index.html / runtime-config.js must stay fresh (no-store): they
    // reference the hashed assets and carry the runtime clientId.
    const immutable = pathname.startsWith("/assets/");
    return new Response(body, {
      status: 200,
      headers: {
        "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-store",
        "content-type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
      },
    });
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      return new Response("Not found", { status: 404 });
    }
    throw error;
  }
}

function serveRuntimeConfig(runtimeConfig) {
  return new Response(runtimeConfigScript(runtimeConfig), {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": CONTENT_TYPES[".js"],
    },
  });
}

export function createWebRequestListener({
  apiHandle,
  createApiHandle = createLiveAggregatorApiHandler,
  warmTokenIndex = false,
  staticRoot = defaultStaticRoot(),
  runtimeConfig = defaultRuntimeConfig(),
  rateLimiter = createRateLimiter(),
} = {}) {
  const resolvedApiHandle = apiHandle ?? createApiHandle({ warmTokenIndex });

  return async function webRequestListener(request, response) {
    try {
      // Rate-limit the API surface (each /quote fans out into upstream RPC
      // reads) before buffering any request body. Static assets are cheap
      // local reads and stay unlimited.
      const requestPathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (API_PATHS.has(requestPathname) && !rateLimiter(clientKeyFromMessage(request))) {
        writeJsonError(response, 429, "rate-limited", "Too many requests. Retry shortly.");
        return;
      }

      const fetchRequest = await requestFromIncomingMessage(request);
      const pathname = new URL(fetchRequest.url).pathname;
      const fetchResponse = pathname === RUNTIME_CONFIG_PATH
        ? serveRuntimeConfig(runtimeConfig)
        : API_PATHS.has(pathname)
          ? await resolvedApiHandle(fetchRequest)
          : await serveStatic({ pathname, staticRoot });

      await writeFetchResponse(response, fetchResponse);
    } catch (error) {
      if (error instanceof HttpRequestError) {
        writeJsonError(response, error.status, error.code, error.message);
        return;
      }

      // Raw error messages can leak internal infrastructure details; log the
      // detail here, answer generically.
      console.error("[web-server]", error);
      writeJsonError(response, 500, "web-server-error", "Internal server error.");
    }
  };
}

export function startAggregatorWebServer({
  host = process.env.HOST ?? "127.0.0.1",
  port = Number(process.env.PORT ?? 8788),
  apiHandle,
  createApiHandle,
  staticRoot,
  runtimeConfig,
  warmTokenIndex = false,
} = {}) {
  const server = applyServerTimeouts(
    createServer(
      createWebRequestListener({
        apiHandle,
        createApiHandle,
        staticRoot,
        runtimeConfig,
        warmTokenIndex,
      }),
    ),
  );

  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolveServer(server);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startAggregatorWebServer({ warmTokenIndex: true });
  const address = server.address();
  const host = address.address === "127.0.0.1" ? "localhost" : address.address;

  console.log(`DogeOS aggregator web listening on http://${host}:${address.port}`);
}
