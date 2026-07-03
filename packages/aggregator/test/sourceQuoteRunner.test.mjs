import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SOURCE_TIMEOUT_MS,
  isTransientError,
  runSourceQuote,
} from "../src/quotes/sourceQuoteRunner.mjs";

const source = { sourceId: "barkswap-algebra", protocolType: "algebra" };
const input = { sellToken: "0xsell", buyToken: "0xbuy", amountIn: 45n };

test("the default per-venue budget covers the documented 2-3s testnet quoter spike", () => {
  // Regression guard for the root cause: the old 1000ms cap was tighter than the
  // 2-3s spike and was swallowed into a route-killing []. The budget must clear
  // that spike with margin (and stay under the composite per-provider budget).
  assert.ok(DEFAULT_SOURCE_TIMEOUT_MS >= 3_000, "must clear a ~3s quoter spike");
});

test("isTransientError classifies timeouts and transport faults as transient", () => {
  assert.equal(isTransientError(new Error("Source x timed out after 3000ms.")), true);
  assert.equal(isTransientError(new Error("eth_call failed with HTTP 503.")), true);
  // jsonRpcClient throws `eth_call failed with HTTP <status>.` BEFORE reading
  // the body, so ANY status here is a transport blip (e.g. a Cloudflare 403
  // challenge or a gateway 400), never a venue verdict — reverts arrive via
  // HTTP 200 + JSON-RPC error envelope. These pin the broad HTTP match.
  assert.equal(isTransientError(new Error("eth_call failed with HTTP 400.")), true);
  assert.equal(isTransientError(new Error("eth_call failed with HTTP 403.")), true);
  assert.equal(isTransientError(new Error("fetch failed")), true);
  assert.equal(isTransientError(new Error("fetch failed: invalid JSON response body")), true);
  // Exact V8 JSON.parse message for a gateway HTML error page — the excerpt
  // embeds the page's own CRLF, so this pins that the classifier matches
  // across newlines (the c32bc98 false-"no route" class).
  assert.equal(
    isTransientError(new Error('Unexpected token \'<\', "<html>\r\n<h"... is not valid JSON')),
    true,
  );
  assert.equal(isTransientError(new Error("HTTP 502 returned non-JSON response")), true);
  // jsonRpcClient's batch shape check is a transport fault, not a venue error —
  // it must not be captured by the genuine "must be" signature.
  assert.equal(isTransientError(new Error("JSON-RPC batch response must be an array.")), true);
  assert.equal(isTransientError(new Error("unknown RPC error: missing batch response for decoded call")), true);
  assert.equal(isTransientError(new Error("socket hang up")), true);
  assert.equal(isTransientError(Object.assign(new Error("aborted"), { name: "AbortError" })), true);
  assert.equal(isTransientError(Object.assign(new Error("custom"), { transient: true })), true);
});

test("isTransientError classifies on-chain reverts and decode failures as genuine", () => {
  // A genuine venue error means that pair is deterministically unroutable on this
  // venue — it must stay a real no-route, NOT a retryable transient.
  assert.equal(isTransientError(new Error("eth_call failed: execution reverted")), false);
  // A revert marker wins even inside a transport-shaped message: revert markers
  // are checked BEFORE the (broad) HTTP transport pattern. This message shape is
  // hypothetical — jsonRpcClient never mixes an HTTP status with a revert — but
  // the precedence must hold if a future client ever does.
  assert.equal(isTransientError(new Error("eth_call failed with HTTP 400: execution reverted")), false);
  // A venue rejecting the request itself (not a transport fault) stays genuine
  // even though transport patterns run before the broader venue words.
  assert.equal(isTransientError(new Error("invalid token address")), false);
  assert.equal(isTransientError(new Error("quote failed: amount exceeds available liquidity")), false);
  assert.equal(isTransientError(new Error("V3 quoter result must contain ABI-encoded uint256 words.")), false);
  assert.equal(isTransientError(new Error("getReserves result must contain ABI-encoded uint256 words.")), false);
  assert.equal(isTransientError(null), false);
});

test("runSourceQuote returns a venue's candidates unchanged when the task resolves in time", async () => {
  const reported = [];
  const result = await runSourceQuote({
    source,
    input,
    onSourceError: (error, context) => reported.push(context),
    task: async () => [{ sourceId: source.sourceId, amountOut: 99n }],
  });

  assert.deepEqual(result, [{ sourceId: source.sourceId, amountOut: 99n }]);
  assert.deepEqual(reported, [], "a healthy quote reports no error");
});

test("runSourceQuote treats a resolved-empty task as a genuine (non-reported) no-pool", async () => {
  const reported = [];
  const result = await runSourceQuote({
    source,
    input,
    onSourceError: (error, context) => reported.push(context),
    task: async () => [],
  });

  assert.deepEqual(result, []);
  assert.deepEqual(reported, [], "an empty result is not an error");
});

test("runSourceQuote reports a per-venue TIMEOUT as transient and yields [] (preserving siblings)", async () => {
  const reported = [];
  const result = await runSourceQuote({
    source,
    input,
    timeoutMs: 5,
    onSourceError: (error, context) => reported.push({ message: error.message, ...context }),
    task: () => new Promise(() => {}), // never resolves
  });

  assert.deepEqual(result, [], "a stalled venue drops to [] so other venues survive");
  assert.equal(reported.length, 1);
  assert.equal(reported[0].sourceId, source.sourceId);
  assert.equal(reported[0].transient, true, "a timeout is transient, not a no-route");
  assert.match(reported[0].message, /timed out after 5ms/);
});

test("runSourceQuote reports a genuine venue revert as NON-transient and yields []", async () => {
  const reported = [];
  const result = await runSourceQuote({
    source,
    input,
    onSourceError: (error, context) => reported.push(context),
    task: async () => {
      throw new Error("eth_call failed: execution reverted");
    },
  });

  assert.deepEqual(result, []);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].transient, false, "a revert is a real, deterministic no-route");
});
