import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";

import {
  HttpRequestError,
  clientKeyFromMessage,
  createRateLimiter,
  readIncomingBody,
  securityHeaders,
} from "../src/httpHardening.mjs";

test("readIncomingBody resolves bodies under the cap", async () => {
  const message = new EventEmitter();
  const pending = readIncomingBody(message, { maxBodyBytes: 8 });

  message.emit("data", Buffer.from("1234"));
  message.emit("end");

  assert.deepEqual(await pending, Buffer.from("1234"));
});

test("readIncomingBody rejects bodies above the cap with a 413", async () => {
  const message = new EventEmitter();
  const pending = readIncomingBody(message, { maxBodyBytes: 8 });

  message.emit("data", Buffer.from("123456789"));

  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof HttpRequestError);
    assert.equal(error.status, 413);
    assert.equal(error.code, "payload-too-large");
    return true;
  });
});

test("createRateLimiter enforces a per-client fixed window", () => {
  let now = 0;
  const allow = createRateLimiter({ windowMs: 10_000, maxRequests: 2, nowMs: () => now });

  assert.equal(allow("a"), true);
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), false);
  assert.equal(allow("b"), true); // other clients are unaffected

  now = 10_001; // next window resets the counters
  assert.equal(allow("a"), true);
});

test("createRateLimiter is disabled at maxRequests <= 0", () => {
  const allow = createRateLimiter({ maxRequests: 0 });
  for (let i = 0; i < 1_000; i += 1) assert.equal(allow("a"), true);
});

test("clientKeyFromMessage trusts only the proxy-appended forwarded entry", () => {
  // Behind the local reverse proxy: the LAST x-forwarded-for entry is the one
  // our proxy appended; earlier entries are client-controlled.
  assert.equal(
    clientKeyFromMessage({
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "x-forwarded-for": "6.6.6.6, 1.2.3.4" },
    }),
    "1.2.3.4",
  );
  // Direct (non-loopback) connections ignore the spoofable header entirely.
  assert.equal(
    clientKeyFromMessage({
      socket: { remoteAddress: "9.9.9.9" },
      headers: { "x-forwarded-for": "1.2.3.4" },
    }),
    "9.9.9.9",
  );
});

test("securityHeaders blocks cross-origin framing and sniffing by default", () => {
  const headers = securityHeaders({ contentSecurityPolicy: "" });

  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "SAMEORIGIN");
  assert.equal(headers["content-security-policy"], "frame-ancestors 'self'");
  assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
});

test("securityHeaders lets the operator supply a full CSP", () => {
  const headers = securityHeaders({ contentSecurityPolicy: "default-src 'self'" });
  assert.equal(headers["content-security-policy"], "default-src 'self'");
});
