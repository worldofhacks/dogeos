import {
  buildQuoteResponse,
  buildSwapTx,
  listSources,
  listVenueContracts,
} from "../../aggregator/src/index.mjs";
import { DOGEOS_CHAIN } from "../../config/src/chains.mjs";
import { OFFICIAL_DOGEOS_TOKENS } from "../../config/src/tokens.mjs";

const JSON_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json; charset=utf-8",
};

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

function quoteCandidateRequestKey(input) {
  return JSON.stringify({
    chainId: input.chainId,
    quoteMode: input.quoteMode,
    sellToken: input.sellToken.toLowerCase(),
    buyToken: input.buyToken.toLowerCase(),
    amountIn: input.amountIn?.toString() ?? null,
    amountOut: input.amountOut?.toString() ?? null,
    includeSources: input.includeSources,
    excludeSources: input.excludeSources,
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
  };
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

  return quoteWithSwapExecutionFields(response.best, quote);
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

  return async function handleAggregatorRequest(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (request.method === "GET" && url.pathname === "/sources") {
      return jsonResponse({
        chainId: DOGEOS_CHAIN.id,
        data: listSources(),
      });
    }

    if (request.method === "GET" && url.pathname === "/tokens") {
      return jsonResponse({
        chainId: DOGEOS_CHAIN.id,
        data: OFFICIAL_DOGEOS_TOKENS,
      });
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
        return errorResponse(503, "venues-unavailable", error.message);
      }
    }

    if (request.method === "GET" && url.pathname === "/verification") {
      try {
        return jsonResponse({
          chainId: DOGEOS_CHAIN.id,
          data: await verificationSnapshotProvider(),
        });
      } catch (error) {
        return errorResponse(503, "verification-unavailable", error.message);
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
          ? await refreshSwapQuote({
              quote: originalQuote,
              quoteCandidateProvider: resolveQuoteCandidates,
              nowMs,
              gasPriceWei,
              outputWeiPerFeeWei,
              inputWeiPerFeeWei,
            })
          : originalQuote;
        const amount = quote.quoteMode === "exactOutput" ? quote.maxAmountIn : quote.amountIn;

        const plan = await approvalPlanner({
          token: quote.sellToken,
          owner,
          spender: quote.router,
          amount,
        });

        return jsonResponse({ ...plan, quote });
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

        const quote = refreshSwapQuoteBeforeBuild
          ? await refreshSwapQuote({
              quote: originalQuote,
              quoteCandidateProvider: resolveQuoteCandidates,
              nowMs,
              gasPriceWei,
              outputWeiPerFeeWei,
              inputWeiPerFeeWei,
            })
          : originalQuote;
        const tx = buildSwapTx({
          quote,
          nowMs: await resolveProvider(nowMs, Date.now(), quote),
          expectedChainId: DOGEOS_CHAIN.id,
          calldataBuilder,
        });

        if (!swapVerifier) {
          return jsonResponse({ transaction: tx, quote });
        }

        const verification = await swapVerifier({ transaction: tx, quote, sender });
        const balance = balanceVerifier
          ? await balanceVerifier({ transaction: tx, quote, sender, verification })
          : undefined;

        return jsonResponse({
          quote,
          transaction: {
            ...tx,
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
