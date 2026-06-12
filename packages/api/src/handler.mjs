import {
  buildVenueIntelligence,
  buildQuoteResponse,
  buildSwapTx,
  listSources,
  listVenueContracts,
} from "../../aggregator/src/index.mjs";
import { SPLIT_SOURCE_ID } from "../../aggregator/src/routes/splitRoutes.mjs";
import { DOGEOS_CHAIN } from "../../config/src/chains.mjs";
import { OFFICIAL_DOGEOS_TOKENS } from "../../config/src/tokens.mjs";

// CORS stays wildcard by default — there are no cookies/sessions and every
// output is an unsigned transaction the user must sign in their own wallet.
// Set CORS_ALLOW_ORIGIN to the frontend origin before mainnet so third-party
// pages cannot script the quote/swap builders (and add browser-driven load).
const CORS_ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || "*";
const JSON_HEADERS = {
  "access-control-allow-origin": CORS_ALLOW_ORIGIN,
  ...(CORS_ALLOW_ORIGIN === "*" ? {} : { vary: "origin" }),
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json; charset=utf-8",
};
const DEFAULT_ACTIVITY_LIMIT = 20;
const MAX_ACTIVITY_LIMIT = 50;

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body, jsonReplacer), {
    status,
    headers: JSON_HEADERS,
  });
}

function errorResponse(status, code, message) {
  return jsonResponse(
    {
      error: {
        code,
        message,
      },
    },
    { status },
  );
}

// Upstream infrastructure failures (RPC, Blockscout) can embed internal hosts
// and URLs in error messages. Log the detail server-side; return a generic
// message to clients. Request-validation and build errors (4xx) keep their
// messages — the UI maps them to actionable copy.
function unavailableResponse(code, error) {
  console.error(`[api] ${code}:`, error);
  return errorResponse(503, code, "Upstream dependency is unavailable. Try again shortly.");
}

function isHexAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value ?? ""));
}

function normalizedActivityLimit(value) {
  const numericLimit = Number(value ?? DEFAULT_ACTIVITY_LIMIT);
  if (!Number.isFinite(numericLimit)) return DEFAULT_ACTIVITY_LIMIT;
  return Math.max(1, Math.min(MAX_ACTIVITY_LIMIT, Math.trunc(numericLimit)));
}

function blockscoutAddressTransactionsUrl(address, blockscoutBaseUrl = DOGEOS_CHAIN.blockscoutBaseUrl) {
  return `${blockscoutBaseUrl}/api/v2/addresses/${address}/transactions`;
}

function defaultChainStatus() {
  return {
    checkedAt: null,
    live: false,
    status: "static",
    chainId: DOGEOS_CHAIN.id,
    expectedChainId: DOGEOS_CHAIN.id,
    chainMatches: null,
    blockNumber: null,
    gasPriceWei: null,
    dataFinalityFeeWei: null,
    dataFinalityFeeSample: "v2-swap-payload",
    nativeCurrency: DOGEOS_CHAIN.nativeCurrency,
    rpcUrl: DOGEOS_CHAIN.rpcUrls[0],
    fallbackRpcUrls: DOGEOS_CHAIN.fallbackRpcUrls,
    blockscoutBaseUrl: DOGEOS_CHAIN.blockscoutBaseUrl,
    docsUrl: DOGEOS_CHAIN.docsUrl,
    faucetUrl: DOGEOS_CHAIN.faucetUrl,
    l1GasPriceOracle: DOGEOS_CHAIN.l1GasPriceOracle,
    documentedMaxReorgDepth: DOGEOS_CHAIN.documentedMaxReorgDepth,
  };
}

async function fetchBlockscoutAddressTransactions({
  address,
  limit = DEFAULT_ACTIVITY_LIMIT,
  fetchFn = fetch,
  blockscoutBaseUrl = DOGEOS_CHAIN.blockscoutBaseUrl,
} = {}) {
  const sourceUrl = blockscoutAddressTransactionsUrl(address, blockscoutBaseUrl);
  const response = await fetchFn(sourceUrl);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.message ?? body?.error ?? `Blockscout request failed: ${response.status}`);
  }

  return {
    items: (Array.isArray(body.items) ? body.items : []).slice(0, limit),
    nextPageParams: body.next_page_params ?? null,
    sourceUrl,
  };
}

function defaultTimingNowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function elapsedMs(startMs, endMs) {
  return Math.max(0, Number((endMs - startMs).toFixed(3)));
}

function attachQuoteDiagnostics(input) {
  const quoteDiagnostics = [];
  Object.defineProperty(input, "quoteDiagnostics", {
    value: quoteDiagnostics,
    enumerable: false,
    configurable: true,
  });
  return quoteDiagnostics;
}

function cloneQuoteDiagnostics(diagnostics = []) {
  return diagnostics.map((diagnostic) => ({ ...diagnostic }));
}

function quoteSourceSetKey(sourceIds = []) {
  return [...new Set(sourceIds.map((sourceId) => String(sourceId)))].sort();
}

function quoteCandidateRequestKey(input) {
  return JSON.stringify({
    chainId: input.chainId,
    quoteMode: input.quoteMode,
    sellToken: input.sellToken.toLowerCase(),
    buyToken: input.buyToken.toLowerCase(),
    amountIn: input.amountIn?.toString() ?? null,
    amountOut: input.amountOut?.toString() ?? null,
    includeSources: quoteSourceSetKey(input.includeSources),
    excludeSources: quoteSourceSetKey(input.excludeSources),
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function toPositiveBigInt(value, fieldName) {
  const normalized = BigInt(value);
  if (normalized <= 0n) {
    throw new Error(`${fieldName} must be greater than zero.`);
  }
  return normalized;
}

function toNonNegativeBigInt(value, fieldName) {
  const normalized = BigInt(value);
  if (normalized < 0n) {
    throw new Error(`${fieldName} must be zero or greater.`);
  }
  return normalized;
}

function normalizeSourceList(value = [], fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }
  return value.map((sourceId) => String(sourceId));
}

async function resolveProvider(provider, fallback, input) {
  if (typeof provider === "function") return provider(input);
  if (provider !== undefined) return provider;
  return fallback;
}

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

function parseQuoteRequest(body) {
  const chainId = Number(body.chainId);
  if (chainId !== DOGEOS_CHAIN.id) {
    return {
      error: errorResponse(
        400,
        "wrong-chain",
        `Expected DogeOS chain ${DOGEOS_CHAIN.id}, received ${body.chainId}.`,
      ),
    };
  }

  const quoteMode = body.quoteMode === undefined ? "exactInput" : String(body.quoteMode);
  if (!["exactInput", "exactOutput"].includes(quoteMode)) {
    throw new Error("quoteMode must be exactInput or exactOutput.");
  }

  return {
    input: {
      chainId,
      quoteMode,
      sellToken: String(body.sellToken ?? ""),
      buyToken: String(body.buyToken ?? ""),
      ...(quoteMode === "exactOutput"
        ? { amountOut: toPositiveBigInt(body.amountOut, "amountOut") }
        : { amountIn: toPositiveBigInt(body.amountIn, "amountIn") }),
      slippageBps: toNonNegativeBigInt(body.slippageBps ?? 50, "slippageBps"),
      includeSources: normalizeSourceList(body.includeSources, "includeSources"),
      excludeSources: normalizeSourceList(body.excludeSources, "excludeSources"),
    },
  };
}

function normalizeSwapQuote(quote) {
  const quoteMode = quote.quoteMode === "exactOutput" ? "exactOutput" : "exactInput";
  const slippageBps =
    quote.slippageBps === undefined
      ? undefined
      : toNonNegativeBigInt(quote.slippageBps, "quote.slippageBps");
  const normalized = {
    ...quote,
    quoteMode,
    amountIn: toPositiveBigInt(quote.amountIn, "quote.amountIn"),
    ...(slippageBps === undefined ? {} : { slippageBps }),
    nativeValueWei:
      quote.nativeValueWei === undefined
        ? undefined
        : toNonNegativeBigInt(quote.nativeValueWei, "quote.nativeValueWei"),
  };

  if (quoteMode === "exactOutput") {
    return {
      ...normalized,
      amountOut: toPositiveBigInt(quote.amountOut, "quote.amountOut"),
      maxAmountIn: toPositiveBigInt(
        quote.maxAmountIn ?? quote.maximumInput,
        "quote.maxAmountIn",
      ),
      minAmountOut:
        quote.minAmountOut === undefined
          ? undefined
          : toPositiveBigInt(quote.minAmountOut, "quote.minAmountOut"),
    };
  }

  return {
    ...normalized,
    minAmountOut: toPositiveBigInt(quote.minAmountOut, "quote.minAmountOut"),
  };
}

function inferredSwapSlippageBps(quote) {
  if (quote.slippageBps !== undefined) return toNonNegativeBigInt(quote.slippageBps, "quote.slippageBps");

  if (quote.quoteMode === "exactOutput") {
    const maxAmountIn = toPositiveBigInt(quote.maxAmountIn ?? quote.maximumInput, "quote.maxAmountIn");
    const amountIn = toPositiveBigInt(quote.amountIn, "quote.amountIn");
    if (maxAmountIn >= amountIn) return ceilDiv((maxAmountIn - amountIn) * 10_000n, amountIn);
  } else if (quote.amountOut !== undefined && quote.minAmountOut !== undefined) {
    const amountOut = toPositiveBigInt(quote.amountOut, "quote.amountOut");
    const minAmountOut = toPositiveBigInt(quote.minAmountOut, "quote.minAmountOut");
    if (amountOut >= minAmountOut) return ceilDiv((amountOut - minAmountOut) * 10_000n, amountOut);
  }

  return 50n;
}

function swapQuoteRefreshInput(quote) {
  return {
    chainId: quote.chainId,
    quoteMode: quote.quoteMode,
    sellToken: quote.sellToken,
    buyToken: quote.buyToken,
    ...(quote.quoteMode === "exactOutput"
      ? { amountOut: quote.amountOut }
      : { amountIn: quote.amountIn }),
    slippageBps: inferredSwapSlippageBps(quote),
    includeSources: [String(quote.sourceId ?? "")],
    excludeSources: [],
  };
}

function quoteWithSwapExecutionFields(refreshedQuote, originalQuote) {
  return {
    ...refreshedQuote,
    recipient: originalQuote.recipient,
    deadline: originalQuote.deadline,
    sender: originalQuote.sender,
    // Execution context the refresh cannot regenerate: the client's signed
    // Permit2 permit (split routes' single-approval flow).
    ...(originalQuote.permit2Permit ? { permit2Permit: originalQuote.permit2Permit } : {}),
  };
}

// The pre-build refresh exists to revalidate freshness and liquidity — never
// to weaken the execution bounds the user accepted. The on-chain floor (or
// input cap) must stay at least as protective as the bound the client
// displayed at confirmation time; if the market moved past the user's
// tolerance, fail closed with an explicit re-quote error instead of silently
// executing at a worse price.
function clampRefreshedSwapQuote(refreshed, original) {
  if (original.quoteMode === "exactOutput") {
    const acceptedMaxAmountIn = original.maxAmountIn;
    if (refreshed.amountIn > acceptedMaxAmountIn) {
      throw new Error(
        `Price moved: the refreshed ${original.sourceId} route now needs ${refreshed.amountIn} in, above the accepted maximum of ${acceptedMaxAmountIn}. Refresh the quote and try again.`,
      );
    }
    if (refreshed.maxAmountIn > acceptedMaxAmountIn) {
      return {
        ...refreshed,
        maxAmountIn: acceptedMaxAmountIn,
        maximumInput: acceptedMaxAmountIn,
      };
    }
    return refreshed;
  }

  const acceptedMinAmountOut = original.minAmountOut;
  if (refreshed.amountOut < acceptedMinAmountOut) {
    throw new Error(
      `Price moved: the refreshed ${original.sourceId} route now returns ${refreshed.amountOut} out, below the accepted minimum of ${acceptedMinAmountOut}. Refresh the quote and try again.`,
    );
  }
  if (refreshed.minAmountOut < acceptedMinAmountOut) {
    return {
      ...refreshed,
      minAmountOut: acceptedMinAmountOut,
      minimumOutput: acceptedMinAmountOut,
    };
  }
  return refreshed;
}

async function refreshSwapQuote({
  quote,
  quoteCandidateProvider,
  nowMs,
  gasPriceWei,
  outputWeiPerFeeWei,
  inputWeiPerFeeWei,
}) {
  const input = swapQuoteRefreshInput(quote);
  attachQuoteDiagnostics(input);
  const outputWeiPerFeeWeiPromise = resolveProvider(outputWeiPerFeeWei, 0n, input);
  const [
    candidates,
    now,
    resolvedGasPriceWei,
    resolvedOutputWeiPerFeeWei,
    resolvedInputWeiPerFeeWei,
  ] = await Promise.all([
    quoteCandidateProvider(input),
    resolveProvider(nowMs, Date.now(), input),
    resolveProvider(gasPriceWei, 0n, input),
    outputWeiPerFeeWeiPromise,
    inputWeiPerFeeWei === undefined
      ? outputWeiPerFeeWeiPromise
      : resolveProvider(inputWeiPerFeeWei, undefined, input),
  ]);
  const response = buildQuoteResponse({
    candidates,
    includeSources: input.includeSources,
    excludeSources: input.excludeSources,
    nowMs: now,
    expectedChainId: DOGEOS_CHAIN.id,
    gasPriceWei: resolvedGasPriceWei,
    outputWeiPerFeeWei: resolvedOutputWeiPerFeeWei,
    inputWeiPerFeeWei: resolvedInputWeiPerFeeWei,
    slippageBps: input.slippageBps,
  });

  if (!response.best) {
    throw new Error(`Live quote refresh did not return an active route for ${quote.sourceId}.`);
  }

  return clampRefreshedSwapQuote(quoteWithSwapExecutionFields(response.best, quote), quote);
}

function venueVerificationKey({ sourceId, role, address }) {
  return `${sourceId}:${role}:${String(address).toLowerCase()}`;
}

function mergeVenueVerification(venues, verificationSnapshot) {
  const verificationByContract = new Map(
    (verificationSnapshot?.sources ?? []).map((target) => [
      venueVerificationKey(target),
      target,
    ]),
  );

  return venues.map((venue) => ({
    ...venue,
    contracts: venue.contracts.map((contract) => {
      const verification = verificationByContract.get(
        venueVerificationKey({
          sourceId: venue.sourceId,
          role: contract.role,
          address: contract.address,
        }),
      );

      if (!verification) return contract;

      return {
        ...contract,
        blockscoutUrl: verification.blockscoutUrl,
        blockscoutSmartContractUrl: verification.blockscoutSmartContractUrl,
        blockscoutAbiEndpointUrl: verification.blockscoutAbiEndpointUrl,
        blockscoutContract: verification.blockscoutContract,
        blockscoutAbi: verification.blockscoutAbi,
        abiArtifact: verification.abiArtifact,
        readChecks: verification.readChecks ?? [],
        bytecodeSizeBytes: verification.bytecodeSizeBytes,
        verification: verification.verification,
        executionEvidence: verification.executionEvidence,
      };
    }),
  }));
}

export function createAggregatorApiHandler({
  nowMs = () => Date.now(),
  preQuoteVerifier = async () => {},
  preSwapVerifier = async () => {},
  quoteCandidateProvider = async () => [],
  gasPriceWei = 0n,
  outputWeiPerFeeWei = 0n,
  inputWeiPerFeeWei,
  verificationSnapshotProvider = async () => ({
    checkedAt: null,
    mode: "static-registry",
    sources: listSources(),
    tokens: OFFICIAL_DOGEOS_TOKENS,
    summary: {
      live: false,
      hasBlockingMismatch: false,
      reason: "Live verification provider is not configured.",
    },
  }),
  swapVerifier,
  approvalPlanner,
  balanceVerifier,
  // Applied to the (refreshed, clamped) quote before approval planning and
  // calldata building — the hook that retargets eligible venue quotes onto
  // the first-party router for execution. Identity by default.
  executionQuoteTransform = (quote) => quote,
  // Deterministic refresher for split quotes (re-quotes the locked legs).
  // When unset, splits fall back to the generic optimizer refresh.
  splitQuoteRefresher,
  activityProvider = fetchBlockscoutAddressTransactions,
  tokenScanProvider,
  chainStatusProvider = defaultChainStatus,
  calldataBuilder = () => {
    throw new Error("No calldata builder configured.");
  },
  refreshSwapQuoteBeforeBuild = false,
  timingNowMs = defaultTimingNowMs,
} = {}) {
  const inFlightQuoteCandidates = new Map();

  async function resolveQuoteCandidates(input) {
    const key = quoteCandidateRequestKey(input);
    const inFlight = inFlightQuoteCandidates.get(key);

    if (inFlight) {
      const result = await inFlight;
      input.quoteDiagnostics.push(...cloneQuoteDiagnostics(result.sourceErrors));
      return result.candidates;
    }

    const promise = Promise.resolve().then(async () => {
      const candidates = await quoteCandidateProvider(input);
      return {
        candidates,
        sourceErrors: cloneQuoteDiagnostics(input.quoteDiagnostics),
      };
    });
    inFlightQuoteCandidates.set(key, promise);
    promise
      .finally(() => {
        if (inFlightQuoteCandidates.get(key) === promise) {
          inFlightQuoteCandidates.delete(key);
        }
      })
      .catch(() => {});

    const result = await promise;
    return result.candidates;
  }

  // Refresh a swap quote before build. Splits use the deterministic
  // leg-re-quote refresher (the generic optimizer refresh is flaky for the
  // marginal split route and would intermittently fail to reproduce it);
  // every other quote uses the standard route refresh.
  async function refreshExecutionQuote(originalQuote) {
    if (originalQuote.sourceId === SPLIT_SOURCE_ID && splitQuoteRefresher) {
      const refreshed = await splitQuoteRefresher(originalQuote, {
        slippageBps: inferredSwapSlippageBps(originalQuote),
      });
      return clampRefreshedSwapQuote(
        quoteWithSwapExecutionFields(refreshed, originalQuote),
        originalQuote,
      );
    }
    return refreshSwapQuote({
      quote: originalQuote,
      quoteCandidateProvider: resolveQuoteCandidates,
      nowMs,
      gasPriceWei,
      outputWeiPerFeeWei,
      inputWeiPerFeeWei,
    });
  }

  return async function handleAggregatorRequest(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (request.method === "GET" && url.pathname === "/sources") {
      return jsonResponse({
        chainId: DOGEOS_CHAIN.id,
        // Hide deliberately-disabled sources (e.g. the split router before its
        // address is configured) from UI metadata; routing still sees them.
        data: listSources().filter((source) => source.status !== "disabled"),
      });
    }

    if (request.method === "GET" && url.pathname === "/tokens") {
      return jsonResponse({
        chainId: DOGEOS_CHAIN.id,
        data: OFFICIAL_DOGEOS_TOKENS,
      });
    }

    // Discover a pasted/arbitrary token: read its ERC-20 metadata and scan
    // every venue for live pools against the base tokens. Lets users trade
    // any token with on-chain liquidity without a registry edit.
    if (request.method === "GET" && url.pathname === "/token") {
      const address = url.searchParams.get("address") ?? "";
      if (!isHexAddress(address)) {
        return errorResponse(400, "invalid-token-request", "A valid 20-byte token address is required.");
      }
      if (!tokenScanProvider) {
        return errorResponse(503, "token-scan-unavailable", "Token discovery is not configured.");
      }
      try {
        const result = await tokenScanProvider({ address });
        return jsonResponse({ chainId: DOGEOS_CHAIN.id, ...result });
      } catch (error) {
        // Surface the validation reason to the UI (not-a-token / no-decimals);
        // these are user-actionable, not internal infra leaks.
        return errorResponse(422, "token-not-discoverable", error.message);
      }
    }

    if (request.method === "GET" && url.pathname === "/chain-status") {
      try {
        return jsonResponse({
          chainId: DOGEOS_CHAIN.id,
          data: await chainStatusProvider(),
        });
      } catch (error) {
        return unavailableResponse("chain-status-unavailable", error);
      }
    }

    if (request.method === "GET" && url.pathname === "/venues") {
      try {
        const verificationSnapshot = await verificationSnapshotProvider();
        return jsonResponse({
          chainId: DOGEOS_CHAIN.id,
          checkedAt: verificationSnapshot.checkedAt ?? null,
          data: mergeVenueVerification(listVenueContracts(), verificationSnapshot),
        });
      } catch (error) {
        return unavailableResponse("venues-unavailable", error);
      }
    }

    if (request.method === "GET" && url.pathname === "/intelligence") {
      try {
        const verificationSnapshot = await verificationSnapshotProvider();
        const venues = mergeVenueVerification(listVenueContracts(), verificationSnapshot);

        return jsonResponse({
          chainId: DOGEOS_CHAIN.id,
          checkedAt: verificationSnapshot.checkedAt ?? null,
          data: buildVenueIntelligence({
            sources: listSources(),
            venues,
          }),
        });
      } catch (error) {
        return unavailableResponse("intelligence-unavailable", error);
      }
    }

    if (request.method === "GET" && url.pathname === "/verification") {
      try {
        return jsonResponse({
          chainId: DOGEOS_CHAIN.id,
          data: await verificationSnapshotProvider(),
        });
      } catch (error) {
        return unavailableResponse("verification-unavailable", error);
      }
    }

    if (request.method === "GET" && url.pathname === "/activity") {
      const address = url.searchParams.get("address") ?? "";
      const limit = normalizedActivityLimit(url.searchParams.get("limit"));

      if (!isHexAddress(address)) {
        return errorResponse(400, "invalid-activity-request", "A valid 20-byte wallet address is required.");
      }

      try {
        const activity = await activityProvider({ address, limit });
        const items = Array.isArray(activity)
          ? activity
          : Array.isArray(activity?.items)
            ? activity.items
            : Array.isArray(activity?.data)
              ? activity.data
              : [];

        return jsonResponse({
          chainId: DOGEOS_CHAIN.id,
          address,
          source: "blockscout",
          blockscoutUrl:
            activity?.sourceUrl ?? blockscoutAddressTransactionsUrl(address),
          data: items.slice(0, limit),
          nextPageParams: activity?.nextPageParams ?? activity?.next_page_params ?? null,
        });
      } catch (error) {
        return unavailableResponse("activity-unavailable", error);
      }
    }

    if (request.method === "POST" && url.pathname === "/quote") {
      try {
        const quoteStartedAtMs = timingNowMs();
        const body = await readJson(request);
        const parsed = parseQuoteRequest(body);
        if (parsed.error) return parsed.error;
        const quoteDiagnostics = attachQuoteDiagnostics(parsed.input);

        await preQuoteVerifier(parsed.input);
        const afterPreQuoteVerificationMs = timingNowMs();
        const candidateProviderPromise = resolveQuoteCandidates(parsed.input);
        const outputWeiPerFeeWeiPromise = resolveProvider(outputWeiPerFeeWei, 0n, parsed.input);
        const scoringProvidersPromise = Promise.all([
          resolveProvider(nowMs, Date.now(), parsed.input),
          resolveProvider(gasPriceWei, 0n, parsed.input),
          outputWeiPerFeeWeiPromise,
          inputWeiPerFeeWei === undefined
            ? outputWeiPerFeeWeiPromise
            : resolveProvider(inputWeiPerFeeWei, undefined, parsed.input),
        ]);
        scoringProvidersPromise.catch(() => {});

        const candidates = await candidateProviderPromise;
        const afterCandidateProviderMs = timingNowMs();
        const [
          now,
          resolvedGasPriceWei,
          resolvedOutputWeiPerFeeWei,
          resolvedInputWeiPerFeeWei,
        ] = await scoringProvidersPromise;
        const afterFeeResolutionMs = timingNowMs();
        const response = buildQuoteResponse({
          candidates,
          includeSources: parsed.input.includeSources,
          excludeSources: parsed.input.excludeSources,
          nowMs: now,
          expectedChainId: DOGEOS_CHAIN.id,
          gasPriceWei: resolvedGasPriceWei,
          outputWeiPerFeeWei: resolvedOutputWeiPerFeeWei,
          inputWeiPerFeeWei: resolvedInputWeiPerFeeWei,
          slippageBps: parsed.input.slippageBps,
        });
        const quoteFinishedAtMs = timingNowMs();

        return jsonResponse({
          ...response,
          telemetry: {
            quoteLatencyMs: elapsedMs(quoteStartedAtMs, quoteFinishedAtMs),
            preQuoteVerificationMs: elapsedMs(quoteStartedAtMs, afterPreQuoteVerificationMs),
            candidateProviderMs: elapsedMs(afterPreQuoteVerificationMs, afterCandidateProviderMs),
            feeResolutionMs: elapsedMs(afterCandidateProviderMs, afterFeeResolutionMs),
            routeScoringMs: elapsedMs(afterFeeResolutionMs, quoteFinishedAtMs),
            candidateCount: candidates.length,
            executableCandidateCount:
              (response.best ? 1 : 0) + (response.alternatives?.length ?? 0),
            rejectedCandidateCount: response.rejected?.length ?? 0,
            sourceErrorCount: quoteDiagnostics.length,
            sourceErrors: quoteDiagnostics,
          },
        });
      } catch (error) {
        return errorResponse(400, "invalid-quote-request", error.message);
      }
    }

    if (request.method === "POST" && url.pathname === "/approval") {
      try {
        if (!approvalPlanner) {
          throw new Error("No approval planner configured.");
        }

        const body = await readJson(request);
        const originalQuote = normalizeSwapQuote(body.quote ?? {});
        const owner = String(body.owner ?? body.sender ?? "");

        if (originalQuote.status !== "active") {
          throw new Error(`Source ${originalQuote.sourceId} is not active for approval.`);
        }

        await preSwapVerifier(originalQuote);

        const quote = refreshSwapQuoteBeforeBuild
          ? await refreshExecutionQuote(originalQuote)
          : originalQuote;
        const executionQuote = executionQuoteTransform(quote);
        const amount =
          executionQuote.quoteMode === "exactOutput" ? executionQuote.maxAmountIn : executionQuote.amountIn;

        const plan = await approvalPlanner({
          token: executionQuote.sellToken,
          owner,
          spender: executionQuote.router,
          amount,
          quote: executionQuote,
        });

        return jsonResponse({ ...plan, quote: executionQuote });
      } catch (error) {
        return errorResponse(422, "approval-not-buildable", error.message);
      }
    }

    if (request.method === "POST" && url.pathname === "/swap") {
      try {
        const body = await readJson(request);
        const originalQuote = normalizeSwapQuote(body.quote ?? {});
        const sender = String(body.sender ?? originalQuote.sender ?? "");
        if (originalQuote.status !== "active") {
          throw new Error(`Source ${originalQuote.sourceId} is not active for execution.`);
        }

        await preSwapVerifier(originalQuote);

        const refreshedQuote = refreshSwapQuoteBeforeBuild
          ? await refreshExecutionQuote(originalQuote)
          : originalQuote;
        const quote = executionQuoteTransform(refreshedQuote);
        const tx = buildSwapTx({
          quote,
          nowMs: await resolveProvider(nowMs, Date.now(), quote),
          expectedChainId: DOGEOS_CHAIN.id,
          calldataBuilder,
        });
        const walletTransaction = {
          ...tx,
          from: sender,
        };

        if (!swapVerifier) {
          return jsonResponse({ transaction: walletTransaction, quote });
        }

        const verification = await swapVerifier({ transaction: tx, quote, sender });
        const balance = balanceVerifier
          ? await balanceVerifier({ transaction: tx, quote, sender, verification })
          : undefined;

        return jsonResponse({
          quote,
          transaction: {
            ...walletTransaction,
            gas: verification.gasLimit,
          },
          verification: {
            ...verification,
            ...(balance ? { balance } : {}),
          },
        });
      } catch (error) {
        return errorResponse(422, "swap-not-buildable", error.message);
      }
    }

    return errorResponse(404, "not-found", `No route for ${request.method} ${url.pathname}.`);
  };
}
