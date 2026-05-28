const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { DEFAULT_LIVE_QUOTE_CONFIG, buildLiveQuote, readWalletSnapshot } = require("./lib/liveQuote.cjs");

const rootArg = process.argv[2] || "apps/swap";
const requestedPort = Number(process.argv[3] || process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";
const root = path.resolve(process.cwd(), rootArg);
const dogeosRpcUrl = process.env.DOGEOS_RPC_URL || "https://rpc.testnet.dogeos.com";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jsx": "text/babel; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function isWithinRoot(target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveRequest(url, port) {
  const parsed = new URL(url, `http://${host}:${port}`);
  const decodedPath = decodeURIComponent(parsed.pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/u, "");
  const target = path.resolve(root, relativePath);

  if (!isWithinRoot(target)) {
    return undefined;
  }

  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    return path.join(target, "index.html");
  }

  return target;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function proxyDogeosRpc(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }

  const body = await readBody(req);
  const upstream = await fetch(dogeosRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });

  res.writeHead(upstream.status, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8"
  });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

async function handleApiRequest(req, res) {
  const parsed = new URL(req.url || "/", `http://${host}:${server.address()?.port || requestedPort}`);

  if (parsed.pathname === "/api/config") {
    sendJson(res, 200, DEFAULT_LIVE_QUOTE_CONFIG);
    return;
  }

  if (parsed.pathname === "/api/quote") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const quote = await buildLiveQuote({
        rpcUrl: dogeosRpcUrl,
        tokenIn: parsed.searchParams.get("tokenIn"),
        tokenOut: parsed.searchParams.get("tokenOut"),
        amountIn: parsed.searchParams.get("amountIn"),
        recipient: parsed.searchParams.get("recipient") || undefined,
        slippageBps: Number(parsed.searchParams.get("slippageBps") || 50)
      });
      sendJson(res, 200, quote);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (parsed.pathname === "/api/balances") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const address = parsed.searchParams.get("address");
      if (!address) throw new Error("address is required");
      const snapshot = await readWalletSnapshot({
        rpcUrl: dogeosRpcUrl,
        address
      });
      sendJson(res, 200, snapshot);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer((req, res) => {
  if ((req.url || "").startsWith("/api/")) {
    handleApiRequest(req, res).catch((error) => {
      sendJson(res, 502, { error: "DogeOS frontend API failed", message: error.message });
    });
    return;
  }

  if ((req.url || "").startsWith("/rpc/dogeos")) {
    proxyDogeosRpc(req, res).catch((error) => {
      res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "DogeOS RPC proxy failed", message: error.message }));
    });
    return;
  }

  const target = resolveRequest(req.url || "/", server.address()?.port || requestedPort);
  if (!target || !fs.existsSync(target)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const ext = path.extname(target);
  res.writeHead(200, {
    "cache-control": "no-store",
    "content-type": contentTypes[ext] || "application/octet-stream"
  });
  fs.createReadStream(target).pipe(res);
});

let announced = false;

function listen(port, attemptsLeft = 8) {
  server.removeAllListeners("error");
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    throw error;
  });
  server.listen(port, host, () => {
    if (!announced) {
      announced = true;
      console.log(`DogeOS swap frontend: http://${host}:${server.address().port}/`);
    }
  });
}

listen(requestedPort);
