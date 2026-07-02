// Blockscout REST client for the DogeOS testnet explorer
// (https://blockscout.testnet.dogeos.com — Blockscout v8.0.2, CHAIN_TYPE=scroll).
//
// House style: plain ESM, zero dependencies, dependency-injected fetch so tests
// stay hermetic, per-request AbortSignal timeout (default 8 s — every other
// Blockscout fetch in this repo has none and can hang; see
// .claude/skills/blockscout-scanner/SKILL.md), and BigInt-safe by construction:
// wei / token amounts are passed through as the decimal strings Blockscout
// serves. Never Number() a `value`/`fee` field from these responses.
//
// Point at another Blockscout instance (e.g. a mainnet deployment) via the
// `baseUrl` constructor argument; the default is the repo's canonical constant
// DOGEOS_CHAIN.blockscoutBaseUrl (packages/config/src/chains.mjs:13).

import { DOGEOS_CHAIN } from "../../packages/config/src/chains.mjs";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_PAGES = 10;

export class BlockscoutError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "BlockscoutError";
    this.url = details.url ?? null;
  }
}

export class BlockscoutHttpError extends BlockscoutError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "BlockscoutHttpError";
    this.status = details.status ?? null;
    this.body = details.body ?? null;
  }
}

export class BlockscoutParseError extends BlockscoutError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "BlockscoutParseError";
    this.status = details.status ?? null;
  }
}

export class BlockscoutTimeoutError extends BlockscoutError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "BlockscoutTimeoutError";
    this.timeoutMs = details.timeoutMs ?? null;
  }
}

// Joins base + path and layers `params` onto the query string. A query already
// embedded in `path` (e.g. the legacy "api?module=contract&action=getabi") is
// preserved; added params are URL-encoded by URLSearchParams. null/undefined
// param values are skipped so cursor objects can be spread in directly.
export function buildBlockscoutUrl(baseUrl, path, params = {}) {
  const trimmedBase = String(baseUrl).replace(/\/+$/, "");
  const trimmedPath = String(path).replace(/^\/+/, "");
  const url = new URL(`${trimmedBase}/${trimmedPath}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function createBlockscoutClient({
  baseUrl = DOGEOS_CHAIN.blockscoutBaseUrl,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  // Fetch + body read under one deadline; a stalled connection or a slow body
  // both surface as BlockscoutTimeoutError instead of hanging the caller.
  async function requestText(url) {
    const controller = new AbortController();
    // Cleared in `finally`, so it never outlives the request (no unref needed —
    // an unref'd timer would let the event loop drain before the abort fires).
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      const text = await response.text();
      return { ok: response.ok === true, status: response.status, text };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new BlockscoutTimeoutError(
          `Blockscout request timed out after ${timeoutMs}ms: ${url}`,
          { url, timeoutMs },
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function getJson(path, params = {}) {
    const url = buildBlockscoutUrl(baseUrl, path, params);
    const { ok, status, text } = await requestText(url);

    let body = null;
    let parseFailed = false;
    try {
      body = text === "" ? null : JSON.parse(text);
    } catch {
      parseFailed = true;
    }

    if (!ok) {
      const detail = body?.message ?? body?.error ?? text.slice(0, 200);
      throw new BlockscoutHttpError(
        `Blockscout HTTP ${status}: ${detail || url}`,
        { status, url, body },
      );
    }
    if (parseFailed) {
      throw new BlockscoutParseError(
        `Blockscout returned non-JSON (HTTP ${status}): ${url}`,
        { url, status },
      );
    }
    return body;
  }

  // Single-object getters map a 404 ("Not found") to null; every other
  // failure keeps its typed error.
  async function getJsonOrNull(path, params = {}) {
    try {
      return await getJson(path, params);
    } catch (error) {
      if (error instanceof BlockscoutHttpError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  // Async-iterates ITEMS across pages. Blockscout v2 lists are keyset-paginated:
  // page size is fixed at 50 (?limit= is ignored) and each page carries an
  // opaque `next_page_params` cursor whose keys must be echoed verbatim onto
  // the same endpoint. Stops at `next_page_params: null` or after maxPages.
  async function* paginate(path, params = {}, { maxPages = DEFAULT_MAX_PAGES } = {}) {
    let pageParams = { ...params };
    for (let page = 0; page < maxPages; page += 1) {
      const body = await getJson(path, pageParams);
      const items = Array.isArray(body?.items) ? body.items : [];
      yield* items;
      const next = body?.next_page_params;
      if (!next || typeof next !== "object") return;
      pageParams = { ...params, ...next };
    }
  }

  // ---- domain helpers -------------------------------------------------------
  // Single-object getters return the parsed object, or null on 404.
  // List getters return the raw first-page body { items, next_page_params };
  // use paginate() for more than 50 rows.

  const transaction = (hash) => getJsonOrNull(`api/v2/transactions/${hash}`);
  const transactionLogs = (hash) => getJson(`api/v2/transactions/${hash}/logs`);
  const transactionTokenTransfers = (hash) =>
    getJson(`api/v2/transactions/${hash}/token-transfers`);
  const transactionInternalCalls = (hash) =>
    getJson(`api/v2/transactions/${hash}/internal-transactions`);

  const address = (addr) => getJsonOrNull(`api/v2/addresses/${addr}`);
  const addressTransactions = (addr, params = {}) =>
    getJson(`api/v2/addresses/${addr}/transactions`, params);
  const addressTokenTransfers = (addr, params = {}) =>
    getJson(`api/v2/addresses/${addr}/token-transfers`, params);
  const addressCounters = (addr) => getJsonOrNull(`api/v2/addresses/${addr}/counters`);

  const smartContract = (addr) => getJsonOrNull(`api/v2/smart-contracts/${addr}`);
  const tokenInfo = (addr) => getJsonOrNull(`api/v2/tokens/${addr}`);
  const tokenHolders = (addr, params = {}) =>
    getJson(`api/v2/tokens/${addr}/holders`, params);
  const search = (q) => getJson("api/v2/search", { q });

  // Blockscout's address object carries is_verified for contracts; EOAs and
  // unverified contracts (e.g. the live DogeSwapRouter) report false.
  async function isVerified(addr) {
    const info = await address(addr);
    return info?.is_verified === true;
  }

  // Composes tx detail + token transfers + internal calls into one ordered
  // summary — the "trace a swap" primitive. Returns null when the tx is
  // unknown. All monetary fields stay decimal strings (wei / raw token units).
  async function traceSwap(hash) {
    const tx = await transaction(hash);
    if (tx === null) return null;

    const [transfersBody, internalBody] = await Promise.all([
      transactionTokenTransfers(hash),
      transactionInternalCalls(hash),
    ]);

    const tokenTransfers = (Array.isArray(transfersBody?.items) ? transfersBody.items : [])
      .map((transfer) => ({
        logIndex: transfer.log_index ?? null,
        tokenAddress: transfer.token?.address_hash ?? transfer.token?.address ?? null,
        tokenSymbol: transfer.token?.symbol ?? null,
        tokenDecimals: transfer.token?.decimals ?? null,
        from: transfer.from?.hash ?? null,
        to: transfer.to?.hash ?? null,
        // Raw token units as a decimal string; scale by tokenDecimals yourself.
        valueRaw: transfer.total?.value ?? null,
      }))
      .sort((a, b) => (a.logIndex ?? 0) - (b.logIndex ?? 0));

    const internalCalls = (Array.isArray(internalBody?.items) ? internalBody.items : [])
      .map((call) => ({
        index: call.index ?? null,
        type: call.type ?? null,
        from: call.from?.hash ?? null,
        to: call.to?.hash ?? null,
        valueWei: call.value ?? null,
        success: call.success === true,
        error: call.error ?? null,
      }))
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    return {
      hash: tx.hash ?? hash,
      success: tx.status === "ok",
      status: tx.status ?? null,
      result: tx.result ?? null,
      revertReason: tx.revert_reason ?? null,
      method: tx.method ?? null,
      from: tx.from?.hash ?? null,
      to: tx.to?.hash ?? null,
      blockNumber: tx.block_number ?? tx.block ?? null,
      timestamp: tx.timestamp ?? null,
      feeWei: tx.fee?.value ?? null,
      // CHAIN_TYPE=scroll split: feeWei = l1DataFeeWei + l2ExecutionFeeWei.
      l1DataFeeWei: tx.scroll?.l1_fee ?? null,
      l2ExecutionFeeWei: tx.scroll?.l2_fee?.value ?? null,
      l2BlockStatus: tx.scroll?.l2_block_status ?? null,
      hasErrorInInternalTransactions: tx.has_error_in_internal_transactions === true,
      tokenTransfers,
      internalCalls,
      failedInternalCalls: internalCalls.filter(
        (call) => call.success !== true || call.error,
      ),
    };
  }

  return {
    baseUrl,
    getJson,
    paginate,
    transaction,
    transactionLogs,
    transactionTokenTransfers,
    transactionInternalCalls,
    address,
    addressTransactions,
    addressTokenTransfers,
    addressCounters,
    smartContract,
    tokenHolders,
    tokenInfo,
    search,
    isVerified,
    traceSwap,
  };
}
