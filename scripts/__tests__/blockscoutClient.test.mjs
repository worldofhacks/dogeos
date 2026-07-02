import assert from "node:assert/strict";
import test from "node:test";

import {
  createBlockscoutClient,
  buildBlockscoutUrl,
  BlockscoutHttpError,
  BlockscoutParseError,
  BlockscoutTimeoutError,
} from "../blockscout/client.mjs";
import { DOGEOS_CHAIN } from "../../packages/config/src/chains.mjs";

const BASE = "https://blockscout.example";
const TX_HASH = "0x33e353d61fbf24f23c0be44fa99ad21507a9c1da317c32eaa8346997f5bbec56";
const ROUTER = "0xa3158549f38400F355aDf20C92DA1769620Aa35A";

// Fake fetch: handler(url: URL) -> { status?, body? }. Records every call.
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const result = handler(new URL(String(url)));
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => result.body ?? "",
    };
  };
  impl.calls = calls;
  return impl;
}

const jsonBody = (value) => ({ body: JSON.stringify(value) });

test("defaults to the packages/config Blockscout base URL", () => {
  const client = createBlockscoutClient({ fetchImpl: fakeFetch(() => jsonBody({})) });
  assert.equal(client.baseUrl, DOGEOS_CHAIN.blockscoutBaseUrl);
  assert.equal(client.baseUrl, "https://blockscout.testnet.dogeos.com");
});

test("getJson encodes params and preserves an existing ?query in the path", async () => {
  const fetchImpl = fakeFetch(() => jsonBody({ ok: true }));
  // Trailing slash on baseUrl must not produce a double slash.
  const client = createBlockscoutClient({ baseUrl: `${BASE}/`, fetchImpl });

  await client.getJson("/api?module=contract&action=getabi", {
    address: ROUTER,
    inserted_at: "2026-07-02T16:56:46.621534Z",
    skipped: null,
    alsoSkipped: undefined,
  });

  assert.equal(fetchImpl.calls.length, 1);
  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.origin, BASE);
  assert.equal(url.pathname, "/api");
  // Pre-existing query params survive the merge.
  assert.equal(url.searchParams.get("module"), "contract");
  assert.equal(url.searchParams.get("action"), "getabi");
  // Added params are present and round-trip through encoding.
  assert.equal(url.searchParams.get("address"), ROUTER);
  assert.equal(url.searchParams.get("inserted_at"), "2026-07-02T16:56:46.621534Z");
  // Real Blockscout cursors carry timestamps; the colons must be encoded.
  assert.ok(fetchImpl.calls[0].url.includes("2026-07-02T16%3A56%3A46.621534Z"));
  // null/undefined params are dropped, not serialized as "null".
  assert.equal(url.searchParams.has("skipped"), false);
  assert.equal(url.searchParams.has("alsoSkipped"), false);
});

test("buildBlockscoutUrl joins base and path without double slashes", () => {
  assert.equal(
    buildBlockscoutUrl(`${BASE}//`, "/api/v2/stats"),
    `${BASE}/api/v2/stats`,
  );
});

test("paginate follows next_page_params and stops at null", async () => {
  const pages = [
    {
      items: [{ id: 1 }, { id: 2 }],
      // Realistic cursor shape from the live instance (2026-07-02).
      next_page_params: { block_number: 6063095, index: 0, items_count: 50 },
    },
    { items: [{ id: 3 }], next_page_params: null },
  ];
  const fetchImpl = fakeFetch((url) =>
    jsonBody(url.searchParams.has("block_number") ? pages[1] : pages[0]),
  );
  const client = createBlockscoutClient({ baseUrl: BASE, fetchImpl });

  const ids = [];
  for await (const item of client.paginate(
    `api/v2/addresses/${ROUTER}/transactions`,
    { filter: "to" },
  )) {
    ids.push(item.id);
  }

  assert.deepEqual(ids, [1, 2, 3]);
  assert.equal(fetchImpl.calls.length, 2);
  const secondUrl = new URL(fetchImpl.calls[1].url);
  // Cursor keys are echoed verbatim AND the original params are kept.
  assert.equal(secondUrl.searchParams.get("filter"), "to");
  assert.equal(secondUrl.searchParams.get("block_number"), "6063095");
  assert.equal(secondUrl.searchParams.get("index"), "0");
  assert.equal(secondUrl.searchParams.get("items_count"), "50");
});

test("paginate stops after maxPages even when a cursor remains", async () => {
  let page = 0;
  const fetchImpl = fakeFetch(() => {
    page += 1;
    return jsonBody({ items: [{ id: page }], next_page_params: { items_count: page * 50 } });
  });
  const client = createBlockscoutClient({ baseUrl: BASE, fetchImpl });

  const ids = [];
  for await (const item of client.paginate("api/v2/blocks", {}, { maxPages: 3 })) {
    ids.push(item.id);
  }

  assert.deepEqual(ids, [1, 2, 3]);
  assert.equal(fetchImpl.calls.length, 3);
});

test("timeout aborts the request and surfaces as BlockscoutTimeoutError", async () => {
  // Never resolves; rejects only when the client's AbortSignal fires.
  const fetchImpl = (url, { signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  const client = createBlockscoutClient({ baseUrl: BASE, fetchImpl, timeoutMs: 25 });

  await assert.rejects(client.getJson("api/v2/stats"), (error) => {
    assert.ok(error instanceof BlockscoutTimeoutError);
    assert.equal(error.name, "BlockscoutTimeoutError");
    assert.equal(error.timeoutMs, 25);
    assert.match(error.message, /timed out after 25ms/);
    return true;
  });
});

test("404 maps to null for single-object getters but throws for list getters", async () => {
  const fetchImpl = fakeFetch(() => ({ status: 404, body: '{"message":"Not found"}' }));
  const client = createBlockscoutClient({ baseUrl: BASE, fetchImpl });

  assert.equal(await client.transaction(TX_HASH), null);
  assert.equal(await client.smartContract(ROUTER), null);
  assert.equal(await client.tokenInfo(ROUTER), null);
  assert.equal(await client.addressCounters(ROUTER), null);
  assert.equal(await client.address(ROUTER), null);

  // Lists keep the typed error so a missing endpoint is never mistaken for
  // an empty page.
  await assert.rejects(client.transactionLogs(TX_HASH), BlockscoutHttpError);
});

test("HTTP 500 throws BlockscoutHttpError carrying the status and message", async () => {
  const fetchImpl = fakeFetch(() => ({ status: 500, body: '{"message":"boom"}' }));
  const client = createBlockscoutClient({ baseUrl: BASE, fetchImpl });

  await assert.rejects(client.getJson("api/v2/stats"), (error) => {
    assert.ok(error instanceof BlockscoutHttpError);
    assert.equal(error.status, 500);
    assert.match(error.message, /500/);
    assert.match(error.message, /boom/);
    return true;
  });
});

test("non-JSON 200 body throws BlockscoutParseError", async () => {
  const fetchImpl = fakeFetch(() => ({ body: "<html>definitely not json</html>" }));
  const client = createBlockscoutClient({ baseUrl: BASE, fetchImpl });

  await assert.rejects(client.getJson("api/v2/stats"), (error) => {
    assert.ok(error instanceof BlockscoutParseError);
    assert.equal(error.status, 200);
    return true;
  });
});

test("isVerified reads is_verified from the address object", async () => {
  const fetchImpl = fakeFetch((url) =>
    jsonBody({ hash: url.pathname.split("/").pop(), is_contract: true, is_verified: false }),
  );
  const client = createBlockscoutClient({ baseUrl: BASE, fetchImpl });
  assert.equal(await client.isVerified(ROUTER), false);

  const verifiedClient = createBlockscoutClient({
    baseUrl: BASE,
    fetchImpl: fakeFetch(() => jsonBody({ is_contract: true, is_verified: true })),
  });
  assert.equal(await verifiedClient.isVerified(ROUTER), true);
});

test("traceSwap composes tx + transfers + internal calls, ordered, BigInt-safe", async () => {
  const routes = {
    [`/api/v2/transactions/${TX_HASH}`]: {
      hash: TX_HASH,
      status: "ok",
      result: "success",
      revert_reason: null,
      method: "0xe56964c6",
      block_number: 5964823,
      timestamp: "2026-07-01T12:00:00.000000Z",
      from: { hash: "0x1111111111111111111111111111111111111111" },
      to: { hash: ROUTER },
      // Real fee split observed live (2026-07-02): fee = l1_fee + l2_fee.
      fee: { type: "actual", value: "18146170689919" },
      scroll: {
        l1_fee: "12882960438579",
        l2_fee: { value: "5263210251340" },
        l2_block_status: "Confirmed by Sequencer",
      },
      has_error_in_internal_transactions: false,
    },
    [`/api/v2/transactions/${TX_HASH}/token-transfers`]: {
      // Deliberately out of order: traceSwap must sort by log_index.
      items: [
        {
          log_index: 7,
          token: { address_hash: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925", symbol: "USDC", decimals: "18" },
          from: { hash: ROUTER },
          to: { hash: "0x1111111111111111111111111111111111111111" },
          total: { decimals: "18", value: "250000000000000000000" },
        },
        {
          log_index: 2,
          token: { address_hash: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE", symbol: "WDOGE", decimals: "18" },
          from: { hash: "0x1111111111111111111111111111111111111111" },
          to: { hash: ROUTER },
          total: { decimals: "18", value: "1000000000000000000" },
        },
      ],
      next_page_params: null,
    },
    [`/api/v2/transactions/${TX_HASH}/internal-transactions`]: {
      items: [
        {
          index: 3,
          type: "call",
          from: { hash: ROUTER },
          to: { hash: "0xC653e745FC613a03D156DACB924AE8e9148B18dc" },
          value: "0",
          success: true,
          error: null,
        },
        {
          index: 1,
          type: "staticcall",
          from: { hash: ROUTER },
          to: { hash: "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4" },
          value: "0",
          success: false,
          error: "execution reverted",
        },
      ],
      next_page_params: null,
    },
  };
  const fetchImpl = fakeFetch((url) => {
    const route = routes[url.pathname];
    assert.ok(route, `unexpected fetch: ${url.pathname}`);
    return jsonBody(route);
  });
  const client = createBlockscoutClient({ baseUrl: BASE, fetchImpl });

  const trace = await client.traceSwap(TX_HASH);

  assert.equal(trace.hash, TX_HASH);
  assert.equal(trace.success, true);
  assert.equal(trace.method, "0xe56964c6");
  assert.equal(trace.blockNumber, 5964823);
  // Wei stays a string — never coerced to Number/BigInt by the client.
  assert.equal(trace.feeWei, "18146170689919");
  assert.equal(typeof trace.feeWei, "string");
  assert.equal(trace.l1DataFeeWei, "12882960438579");
  assert.equal(trace.l2ExecutionFeeWei, "5263210251340");
  assert.equal(trace.l2BlockStatus, "Confirmed by Sequencer");

  // Transfers sorted ascending by log_index, raw values preserved as strings.
  assert.deepEqual(
    trace.tokenTransfers.map((t) => t.logIndex),
    [2, 7],
  );
  assert.equal(trace.tokenTransfers[0].tokenSymbol, "WDOGE");
  assert.equal(trace.tokenTransfers[1].valueRaw, "250000000000000000000");
  assert.equal(typeof trace.tokenTransfers[1].valueRaw, "string");

  // Internal calls sorted ascending by index; failures collected.
  assert.deepEqual(
    trace.internalCalls.map((c) => c.index),
    [1, 3],
  );
  assert.equal(trace.failedInternalCalls.length, 1);
  assert.equal(trace.failedInternalCalls[0].index, 1);
  assert.equal(trace.failedInternalCalls[0].error, "execution reverted");
});

test("traceSwap returns null for an unknown transaction without extra fetches", async () => {
  const fetchImpl = fakeFetch(() => ({ status: 404, body: '{"message":"Not found"}' }));
  const client = createBlockscoutClient({ baseUrl: BASE, fetchImpl });

  assert.equal(await client.traceSwap(TX_HASH), null);
  // Sub-resource fetches must not fire when the tx itself is unknown.
  assert.equal(fetchImpl.calls.length, 1);
});
