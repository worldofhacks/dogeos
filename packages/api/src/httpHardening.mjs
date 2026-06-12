// httpHardening.mjs — shared hardening for the public HTTP servers
// (2026-06-11 repo audit, security-backend #1 + gap sweep): request-body
// caps, a per-client rate limiter, tightened socket timeouts, baseline
// security headers, and sanitized 500 responses.

export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 10_000;
export const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 300;
const RATE_LIMIT_MAX_TRACKED_CLIENTS = 10_000;

export class HttpRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Read an incoming request body with a hard size cap. Without the cap a
// single unauthenticated POST can buffer an arbitrarily large body into
// memory before any validation runs.
export function readIncomingBody(message, { maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let failed = false;

    message.on("data", (chunk) => {
      if (failed) return;
      received += chunk.length;
      if (received > maxBodyBytes) {
        failed = true;
        chunks.length = 0;
        reject(new HttpRequestError(413, "payload-too-large", `Request body exceeds ${maxBodyBytes} bytes.`));
        return;
      }
      chunks.push(chunk);
    });
    message.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    message.on("error", (error) => {
      if (!failed) reject(error);
    });
  });
}

// Identify the client for rate limiting. Behind the local reverse proxy the
// socket address is always loopback, so use the LAST x-forwarded-for entry —
// the one our own proxy appended; earlier entries are client-controlled and
// spoofable. Direct connections use the socket address.
export function clientKeyFromMessage(message) {
  const socketAddress = message.socket?.remoteAddress ?? "";
  const isLoopback =
    socketAddress === "127.0.0.1" || socketAddress === "::1" || socketAddress === "::ffff:127.0.0.1";

  if (isLoopback) {
    const forwarded = String(message.headers?.["x-forwarded-for"] ?? "");
    const last = forwarded.split(",").pop()?.trim();
    if (last) return last;
  }

  return socketAddress || "unknown";
}

// Fixed-window per-client limiter. maxRequests <= 0 disables it. The counter
// map is cleared every window (and capped) so retained state stays bounded.
export function createRateLimiter({
  windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
  maxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS),
  nowMs = () => Date.now(),
} = {}) {
  if (!(maxRequests > 0)) return () => true;

  const counters = new Map();
  let windowStartMs = nowMs();

  return function allowRequest(clientKey) {
    const now = nowMs();
    if (now - windowStartMs >= windowMs || counters.size > RATE_LIMIT_MAX_TRACKED_CLIENTS) {
      counters.clear();
      windowStartMs = now;
    }

    const count = (counters.get(clientKey) ?? 0) + 1;
    counters.set(clientKey, count);
    return count <= maxRequests;
  };
}

// Baseline security headers for every response. x-frame-options stays
// SAMEORIGIN (not DENY) because the vendored TradingView chart renders in a
// same-origin iframe; cross-origin embedding — the clickjacking vector for a
// wallet-connected swap UI — stays blocked. A full Content-Security-Policy
// needs an allowlist of wallet/RPC origins, so it is operator-supplied via
// the CONTENT_SECURITY_POLICY env var rather than hard-coded here (set it to
// include frame-ancestors if you do).
export function securityHeaders({ contentSecurityPolicy = process.env.CONTENT_SECURITY_POLICY } = {}) {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": contentSecurityPolicy || "frame-ancestors 'self'",
  };
}

export function writeJsonError(serverResponse, status, code, message) {
  serverResponse.writeHead(status, {
    ...securityHeaders(),
    "content-type": "application/json; charset=utf-8",
  });
  serverResponse.end(JSON.stringify({ error: { code, message } }));
}

// Bound how long a single connection may hold server resources. Node's
// defaults (60s headers / 300s request) are generous enough to be a slowloris
// aid on a public quote API.
export function applyServerTimeouts(server, { headersTimeoutMs = 15_000, requestTimeoutMs = 30_000 } = {}) {
  server.headersTimeout = headersTimeoutMs;
  server.requestTimeout = requestTimeoutMs;
  return server;
}
