import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { createAggregatorApiHandler } from "./handler.mjs";
import { createLiveAggregatorApiHandler } from "./live.mjs";
import {
  HttpRequestError,
  applyServerTimeouts,
  clientKeyFromMessage,
  createRateLimiter,
  readIncomingBody,
  securityHeaders,
  writeJsonError,
} from "./httpHardening.mjs";

function hasBody(method) {
  return !["GET", "HEAD"].includes(method ?? "GET");
}

function headersFromIncomingMessage(message) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(message.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  return headers;
}

async function requestFromIncomingMessage(message) {
  const origin = `http://${message.headers.host ?? "127.0.0.1"}`;
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

export function createNodeRequestListener({
  handle = createAggregatorApiHandler(),
  rateLimiter = createRateLimiter(),
} = {}) {
  return async function nodeRequestListener(request, response) {
    try {
      if (!rateLimiter(clientKeyFromMessage(request))) {
        writeJsonError(response, 429, "rate-limited", "Too many requests. Retry shortly.");
        return;
      }

      const fetchRequest = await requestFromIncomingMessage(request);
      const fetchResponse = await handle(fetchRequest);
      await writeFetchResponse(response, fetchResponse);
    } catch (error) {
      if (error instanceof HttpRequestError) {
        writeJsonError(response, error.status, error.code, error.message);
        return;
      }

      // Raw error messages can leak internal infrastructure details; log the
      // detail here, answer generically.
      console.error("[api-server]", error);
      writeJsonError(response, 500, "api-server-error", "Internal server error.");
    }
  };
}

export function startAggregatorApiServer({
  host = process.env.HOST ?? "127.0.0.1",
  port = Number(process.env.PORT ?? 8787),
  handle,
  rpcUrl,
  fetchFn,
  nowMs,
  quoteCandidateProvider,
  outputWeiPerFeeWei,
  calldataBuilder,
  // Forwarded to the live handler: warm the non-official token index at startup.
  // Default off so tests asserting exact RPC call sequences aren't perturbed.
  warmTokenIndex = false,
} = {}) {
  const resolvedHandle =
    handle ??
    createLiveAggregatorApiHandler({
      rpcUrl,
      fetchFn,
      nowMs,
      quoteCandidateProvider,
      outputWeiPerFeeWei,
      calldataBuilder,
      warmTokenIndex,
    });
  const server = applyServerTimeouts(createServer(createNodeRequestListener({ handle: resolvedHandle })));

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Real process start: warm the non-official token index so the first /tokens
  // request is instant rather than paying the cold enumerate+metadata cost.
  const server = await startAggregatorApiServer({ warmTokenIndex: true });
  const address = server.address();
  const host = address.address === "127.0.0.1" ? "localhost" : address.address;

  console.log(`DogeOS aggregator API listening on http://${host}:${address.port}`);
}
