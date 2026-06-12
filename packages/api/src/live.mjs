import { createJsonRpcClient } from "../../dogeos-rpc/src/index.mjs";
import {
  createLiveConcentratedLiquidityQuoterOutputProvider,
} from "../../aggregator/src/discovery/concentratedLiquidityPools.mjs";
import { createDogeosDataFinalityFeeProvider } from "../../aggregator/src/fees/l1GasPriceOracle.mjs";
import { createTokenMetadataReader } from "../../aggregator/src/discovery/tokenMetadata.mjs";
import { scanVenuePools } from "../../aggregator/src/discovery/poolScan.mjs";
import { createDiscoverableTokensProvider } from "../../aggregator/src/discovery/discoverableTokens.mjs";
import { listSources } from "../../aggregator/src/sources/registry.mjs";
import { createLiveV2QuoteCandidateProvider } from "../../aggregator/src/discovery/v2Pools.mjs";
import { createCompositeQuoteCandidateProvider } from "../../aggregator/src/quotes/providers/composite.mjs";
import {
  createVerifiedConcentratedLiquidityQuoteCandidateProvider,
} from "../../aggregator/src/quotes/providers/concentratedLiquidity.mjs";
import { createOneHopQuoteCandidateProvider } from "../../aggregator/src/routes/oneHop.mjs";
import {
  ROUTER_EXECUTION_MODE,
  SPLIT_SOURCE_ID,
  createSplitQuoteCandidateProvider,
  createSplitQuoteRefresher,
  wrapQuoteForRouterExecution,
} from "../../aggregator/src/routes/splitRoutes.mjs";
import { createErc20ApprovalPlanner } from "../../aggregator/src/swap/erc20Approval.mjs";
import { createPermit2ApprovalPlanner } from "../../aggregator/src/swap/permit2Approval.mjs";
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
  let verificationPromise = null;

  return async function verifyChain() {
    if (verifiedChainId === expectedChainId) return;

    verificationPromise ??= (async () => {
      try {
        const rpcChainId = await client.getChainId();
        if (rpcChainId !== expectedChainId) {
          throw new Error(`RPC chain mismatch: expected ${expectedChainId}, received ${rpcChainId}.`);
        }

        verifiedChainId = rpcChainId;
      } finally {
        verificationPromise = null;
      }
    })();

    await verificationPromise;
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

function createLiveChainStatusProvider({
  client,
  rpcUrl,
  dataFinalityFeeWei,
  nowMs = () => Date.now(),
}) {
  return async function liveChainStatus() {
    const [chainId, blockNumber, gasPriceWei, resolvedDataFinalityFeeWei] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
      client.getGasPriceWei(),
      dataFinalityFeeWei({ protocolType: "v2" }),
    ]);
    const chainMatches = chainId === DOGEOS_CHAIN.id;

    return {
      checkedAt: new Date(nowMs()).toISOString(),
      live: true,
      status: chainMatches ? "live" : "mismatch",
      chainId,
      expectedChainId: DOGEOS_CHAIN.id,
      chainMatches,
      blockNumber,
      gasPriceWei,
      dataFinalityFeeWei: resolvedDataFinalityFeeWei,
      dataFinalityFeeSample: "v2-swap-payload",
      nativeCurrency: DOGEOS_CHAIN.nativeCurrency,
      rpcUrl,
      fallbackRpcUrls: DOGEOS_CHAIN.fallbackRpcUrls,
      blockscoutBaseUrl: DOGEOS_CHAIN.blockscoutBaseUrl,
      docsUrl: DOGEOS_CHAIN.docsUrl,
      faucetUrl: DOGEOS_CHAIN.faucetUrl,
      l1GasPriceOracle: DOGEOS_CHAIN.l1GasPriceOracle,
      documentedMaxReorgDepth: DOGEOS_CHAIN.documentedMaxReorgDepth,
    };
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
  oneHopEnabled = true,
  oneHopViaTokens = defaultOneHopViaTokens(),
  splitEnabled = true,
  dogeSwapRouterAddress = process.env.DOGESWAP_ROUTER_ADDRESS || null,
  // "all": every eligible exact-input swap executes through the first-party
  // router (single-approval Permit2 flow, enforced settlement + deadline).
  // "split-only": only multi-venue splits use the router. Exact-output swaps
  // always go direct to the venue (the router's commands are exact-input only).
  dogeSwapRouterMode = process.env.DOGESWAP_ROUTER_MODE || (process.env.DOGESWAP_ROUTER_ADDRESS ? "all" : "off"),
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
  // Oracle failures fall back to a 0 data/finality fee (so quoting stays up),
  // but never silently: a zeroed fee skews route scoring and verification.
  const warnDataFinalityFeeError = (error) =>
    console.warn(`[aggregator] data/finality fee oracle read failed, using 0 fallback: ${errorMessage(error)}`);
  const resolvedDataFinalityFeeWei =
    dataFinalityFeeWei ??
    createDogeosDataFinalityFeeProvider({
      client,
      onProviderError: warnDataFinalityFeeError,
    });
  const resolvedSwapDataFinalityFeeWei =
    swapDataFinalityFeeWei ??
    createDogeosDataFinalityFeeProvider({
      client,
      payloadProvider: ({ transaction }) => transaction.data,
      onProviderError: warnDataFinalityFeeError,
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
  const splitQuoteRefresher = dogeSwapRouterAddress
    ? createSplitQuoteRefresher({
        routerAddress: dogeSwapRouterAddress,
        directQuoteProvider: directQuoteCandidateProvider,
        nowMs,
      })
    : undefined;
  const splitQuoteCandidateProvider = createSplitQuoteCandidateProvider({
    enabled: splitEnabled,
    routerAddress: dogeSwapRouterAddress,
    directQuoteProvider: directQuoteCandidateProvider,
    // In "all" mode single-venue swaps pay the same router overhead as a
    // split, so any strict output improvement is real — keep just a 1bp
    // anti-flap epsilon. In split-only mode the split carries extra gas vs a
    // direct venue swap, so demand a more meaningful edge.
    minImprovementBps: dogeSwapRouterMode === "all" ? 1n : 5n,
    nowMs,
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
        {
          providerId: "split",
          provider: splitQuoteCandidateProvider,
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

  const readTokenMetadata = createTokenMetadataReader({ client });

  // Best-effort token logo from the explorer (null on testnet for most
  // tokens; populated on mainnet). Never blocks discovery.
  const fetchTokenIcon = async (tokenAddress) => {
    try {
      const res = await fetchFn(`${DOGEOS_CHAIN.blockscoutBaseUrl}/api/v2/tokens/${tokenAddress}`);
      if (!res.ok) return null;
      const body = await res.json();
      return body.icon_url || null;
    } catch {
      return null;
    }
  };

  return createAggregatorApiHandler({
    nowMs,
    preQuoteVerifier: verifyChain,
    preSwapVerifier: verifyChain,
    quoteCandidateProvider: resolvedQuoteCandidateProvider,
    refreshSwapQuoteBeforeBuild,
    gasPriceWei: async () => client.getGasPriceWei(),
    outputWeiPerFeeWei,
    inputWeiPerFeeWei,
    // Discover a pasted token: read metadata, then scan every venue for live
    // pools against each official base token. `routable` = at least one live
    // pool, so the UI can immediately enable trading the token.
    tokenScanProvider: async ({ address }) => {
      const [token, iconUrl] = await Promise.all([
        readTokenMetadata(address),
        fetchTokenIcon(address.toLowerCase()),
      ]);
      if (iconUrl) token.iconUrl = iconUrl;
      const baseTokens = OFFICIAL_DOGEOS_TOKENS.filter(
        (base) => base.address.toLowerCase() !== token.address,
      );
      const scans = await Promise.all(
        baseTokens.map((base) =>
          scanVenuePools({ client, tokenA: token.address, tokenB: base.address }).then((pools) =>
            pools.map((pool) => ({
              ...pool,
              pairedWith: { symbol: base.symbol, address: base.address.toLowerCase() },
            })),
          ),
        ),
      );
      const pools = scans.flat();
      return {
        token,
        pools,
        routable: pools.length > 0,
        pairedWith: [...new Set(pools.map((pool) => pool.pairedWith.symbol))],
      };
    },
    trendingTokensProvider: createDiscoverableTokensProvider({
      client,
      fetchFn,
      blockscoutBaseUrl: DOGEOS_CHAIN.blockscoutBaseUrl,
      sources: listSources(),
      baseTokens: OFFICIAL_DOGEOS_TOKENS.filter(
        (t) => t.symbol === "WDOGE" || t.symbol === "USDC" || t.symbol === "USDT",
      ),
      officialAddresses: OFFICIAL_DOGEOS_TOKENS.map((t) => t.address),
      primaryBase: OFFICIAL_DOGEOS_TOKENS.find((t) => t.symbol === "WDOGE")?.address,
    }),
    chainStatusProvider:
      createLiveChainStatusProvider({
        client,
        rpcUrl,
        dataFinalityFeeWei: resolvedDataFinalityFeeWei,
        nowMs,
      }),
    verificationSnapshotProvider: resolvedVerificationSnapshotProvider,
    calldataBuilder:
      calldataBuilder ??
      createVerifiedCalldataBuilder({
        builders: calldataBuilders ?? createVenueCalldataBuilders(),
      }),
    executionQuoteTransform:
      dogeSwapRouterMode === "all" && dogeSwapRouterAddress
        ? (quote) => wrapQuoteForRouterExecution(quote, { routerAddress: dogeSwapRouterAddress })
        : undefined,
    splitQuoteRefresher,
    approvalPlanner:
      approvalPlanner ??
      (() => {
        // Anything executing through the first-party router (splits, and all
        // venue swaps in router mode) uses the single-approval Permit2 flow;
        // direct venue execution keeps the exact-amount ERC-20 approval.
        const erc20Planner = createErc20ApprovalPlanner({ client });
        const permit2Planner = createPermit2ApprovalPlanner({ client });
        return (request) =>
          request.quote?.sourceId === SPLIT_SOURCE_ID ||
          request.quote?.executionMode === ROUTER_EXECUTION_MODE
            ? permit2Planner(request)
            : erc20Planner(request);
      })(),
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
