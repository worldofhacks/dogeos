import { createJsonRpcClient } from "../../dogeos-rpc/src/index.mjs";
import {
  createLiveConcentratedLiquidityQuoterOutputProvider,
} from "../../aggregator/src/discovery/concentratedLiquidityPools.mjs";
import { createDogeosDataFinalityFeeProvider } from "../../aggregator/src/fees/l1GasPriceOracle.mjs";
import { createLiveV2QuoteCandidateProvider } from "../../aggregator/src/discovery/v2Pools.mjs";
import { createCompositeQuoteCandidateProvider } from "../../aggregator/src/quotes/providers/composite.mjs";
import {
  createVerifiedConcentratedLiquidityQuoteCandidateProvider,
} from "../../aggregator/src/quotes/providers/concentratedLiquidity.mjs";
import { createOneHopQuoteCandidateProvider } from "../../aggregator/src/routes/oneHop.mjs";
import { createErc20ApprovalPlanner } from "../../aggregator/src/swap/erc20Approval.mjs";
import { createSwapBalanceVerifier } from "../../aggregator/src/swap/balancePreflight.mjs";
import { createVerifiedCalldataBuilder } from "../../aggregator/src/swap/calldataRegistry.mjs";
import { createVenueCalldataBuilders } from "../../aggregator/src/swap/venueCalldataBuilders.mjs";
import { verifySwapTransaction } from "../../aggregator/src/swap/verifySwapTx.mjs";
import { createVerificationSnapshotProvider } from "../../aggregator/src/verification/verificationSnapshot.mjs";
import { DOGEOS_CHAIN } from "../../config/src/chains.mjs";
import { OFFICIAL_DOGEOS_TOKENS } from "../../config/src/tokens.mjs";

import { createAggregatorApiHandler } from "./handler.mjs";

function createChainVerifier(client, expectedChainId) {
  let verifiedChainId = null;

  return async function verifyChain() {
    if (verifiedChainId === expectedChainId) return;

    const rpcChainId = await client.getChainId();
    if (rpcChainId !== expectedChainId) {
      throw new Error(`RPC chain mismatch: expected ${expectedChainId}, received ${rpcChainId}.`);
    }

    verifiedChainId = rpcChainId;
  };
}

function defaultOneHopViaTokens() {
  return OFFICIAL_DOGEOS_TOKENS.filter((token) => token.symbol === "WDOGE").map(
    (token) => token.address,
  );
}

function createRequestBlockNumberProvider(client) {
  const blockNumberByInput = new WeakMap();

  return async function requestBlockNumber(input = {}) {
    if (input.blockNumber !== undefined) return input.blockNumber;
    if (!input || typeof input !== "object") return client.getBlockNumber();

    let blockNumberPromise = blockNumberByInput.get(input);
    if (!blockNumberPromise) {
      blockNumberPromise = client.getBlockNumber();
      blockNumberByInput.set(input, blockNumberPromise);
    }

    return blockNumberPromise;
  };
}

function errorMessage(error) {
  return error?.shortMessage ?? error?.message ?? String(error);
}

function appendQuoteDiagnostic(input, diagnostic) {
  if (!Array.isArray(input?.quoteDiagnostics)) return;
  input.quoteDiagnostics.push(diagnostic);
}

function recordQuoteProviderError(error, { providerId, input } = {}) {
  appendQuoteDiagnostic(input, {
    type: "provider-error",
    providerId,
    message: errorMessage(error),
  });
}

function recordQuoteSourceError(error, { sourceId, protocolType, input } = {}) {
  appendQuoteDiagnostic(input, {
    type: "source-error",
    sourceId,
    protocolType,
    message: errorMessage(error),
  });
}

export function createLiveAggregatorApiHandler({
  rpcUrl = DOGEOS_CHAIN.rpcUrls[0],
  fetchFn = fetch,
  nowMs,
  quoteCandidateProvider,
  quoteProviderTimeoutMs,
  oneHopEnabled = false,
  oneHopViaTokens = defaultOneHopViaTokens(),
  concentratedLiquidityQuoterProvider,
  outputWeiPerFeeWei = 1n,
  inputWeiPerFeeWei,
  dataFinalityFeeWei,
  swapDataFinalityFeeWei,
  calldataBuilder,
  calldataBuilders,
  verificationSnapshotProvider,
  verificationCacheTtlMs,
  verificationTargets,
  verificationTokens,
  verificationBlockscoutBaseUrl,
  swapVerifier,
  approvalPlanner,
  balanceVerifier,
  refreshSwapQuoteBeforeBuild = true,
} = {}) {
  const client = createJsonRpcClient({ rpcUrl, fetchFn });
  const verifyChain = createChainVerifier(client, DOGEOS_CHAIN.id);
  const resolvedDataFinalityFeeWei =
    dataFinalityFeeWei ??
    createDogeosDataFinalityFeeProvider({
      client,
    });
  const resolvedSwapDataFinalityFeeWei =
    swapDataFinalityFeeWei ??
    createDogeosDataFinalityFeeProvider({
      client,
      payloadProvider: ({ transaction }) => transaction.data,
    });
  const quoteBlockNumberProvider = createRequestBlockNumberProvider(client);
  const v2QuoteCandidateProvider = createLiveV2QuoteCandidateProvider({
    client,
    chainId: DOGEOS_CHAIN.id,
    nowMs,
    blockNumberProvider: quoteBlockNumberProvider,
    dataFinalityFeeWei: resolvedDataFinalityFeeWei,
    onSourceError: recordQuoteSourceError,
  });
  const concentratedLiquidityQuoteCandidateProvider =
    createVerifiedConcentratedLiquidityQuoteCandidateProvider({
      chainId: DOGEOS_CHAIN.id,
      nowMs,
      dataFinalityFeeWei: resolvedDataFinalityFeeWei,
      blockNumberProvider: quoteBlockNumberProvider,
      onSourceError: recordQuoteSourceError,
      quoterOutputProvider:
        concentratedLiquidityQuoterProvider ??
        createLiveConcentratedLiquidityQuoterOutputProvider({ client }),
    });
  const directQuoteCandidateProvider = createCompositeQuoteCandidateProvider({
    providerTimeoutMs: quoteProviderTimeoutMs,
    onProviderError: recordQuoteProviderError,
    providers: [
      {
        providerId: "v2",
        provider: v2QuoteCandidateProvider,
      },
      {
        providerId: "concentrated-liquidity",
        provider: concentratedLiquidityQuoteCandidateProvider,
      },
    ],
  });
  const oneHopQuoteCandidateProvider = createOneHopQuoteCandidateProvider({
    enabled: oneHopEnabled,
    viaTokens: oneHopViaTokens,
    directQuoteProvider: directQuoteCandidateProvider,
  });
  const resolvedQuoteCandidateProvider =
    quoteCandidateProvider ??
    createCompositeQuoteCandidateProvider({
      providerTimeoutMs: quoteProviderTimeoutMs,
      onProviderError: recordQuoteProviderError,
      providers: [
        {
          providerId: "direct",
          provider: directQuoteCandidateProvider,
        },
        {
          providerId: "one-hop",
          provider: oneHopQuoteCandidateProvider,
        },
      ],
    });
  const resolvedVerificationSnapshotProvider =
    verificationSnapshotProvider ??
    createVerificationSnapshotProvider({
      rpcUrl,
      fetchFn,
      nowMs,
      cacheTtlMs: verificationCacheTtlMs,
      verificationTargets,
      tokens: verificationTokens,
      blockscoutBaseUrl: verificationBlockscoutBaseUrl,
    });

  return createAggregatorApiHandler({
    nowMs,
    preQuoteVerifier: verifyChain,
    preSwapVerifier: verifyChain,
    quoteCandidateProvider: resolvedQuoteCandidateProvider,
    refreshSwapQuoteBeforeBuild,
    gasPriceWei: async () => client.getGasPriceWei(),
    outputWeiPerFeeWei,
    inputWeiPerFeeWei,
    verificationSnapshotProvider: resolvedVerificationSnapshotProvider,
    calldataBuilder:
      calldataBuilder ??
      createVerifiedCalldataBuilder({
        builders: calldataBuilders ?? createVenueCalldataBuilders(),
      }),
    approvalPlanner: approvalPlanner ?? createErc20ApprovalPlanner({ client }),
    balanceVerifier:
      balanceVerifier ??
      createSwapBalanceVerifier({
        client,
        gasPriceWei: () => client.getGasPriceWei(),
      }),
    swapVerifier:
      swapVerifier ??
      ((input) =>
        verifySwapTransaction({
          client,
          dataFinalityFeeWei: resolvedSwapDataFinalityFeeWei,
          ...input,
        })),
  });
}
