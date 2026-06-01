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
  const normalized = {
    ...quote,
    quoteMode,
    amountIn: toPositiveBigInt(quote.amountIn, "quote.amountIn"),
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
  timingNowMs = defaultTimingNowMs,
} = {}) {
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
        const candidateProviderPromise = quoteCandidateProvider(parsed.input);
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
        const quote = normalizeSwapQuote(body.quote ?? {});
        const owner = String(body.owner ?? body.sender ?? "");
        const amount = quote.quoteMode === "exactOutput" ? quote.maxAmountIn : quote.amountIn;

        if (quote.status !== "active") {
          throw new Error(`Source ${quote.sourceId} is not active for approval.`);
        }

        await preSwapVerifier(quote);

        const plan = await approvalPlanner({
          token: quote.sellToken,
          owner,
          spender: quote.router,
          amount,
        });

        return jsonResponse(plan);
      } catch (error) {
        return errorResponse(422, "approval-not-buildable", error.message);
      }
    }

    if (request.method === "POST" && url.pathname === "/swap") {
      try {
        const body = await readJson(request);
        const quote = normalizeSwapQuote(body.quote ?? {});
        const sender = String(body.sender ?? quote.sender ?? "");
        const tx = buildSwapTx({
          quote,
          nowMs: await resolveProvider(nowMs, Date.now(), quote),
          expectedChainId: DOGEOS_CHAIN.id,
          calldataBuilder,
        });

        await preSwapVerifier(quote);

        if (!swapVerifier) {
          return jsonResponse({ transaction: tx });
        }

        const verification = await swapVerifier({ transaction: tx, quote, sender });
        const balance = balanceVerifier
          ? await balanceVerifier({ transaction: tx, quote, sender, verification })
          : undefined;

        return jsonResponse({
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
