import { createJsonRpcClient } from "../../dogeos-rpc/src/index.mjs";
import {
  createLiveConcentratedLiquidityQuoterOutputProvider,
} from "../../aggregator/src/discovery/concentratedLiquidityPools.mjs";
import { createDogeosDataFinalityFeeProvider, swapPayloadForFee } from "../../aggregator/src/fees/l1GasPriceOracle.mjs";
import { createTokenMetadataReader } from "../../aggregator/src/discovery/tokenMetadata.mjs";
import { scanVenuePools } from "../../aggregator/src/discovery/poolScan.mjs";
import { createDiscoverableTokensProvider } from "../../aggregator/src/discovery/discoverableTokens.mjs";
import { createTokenIndexProvider } from "../../aggregator/src/discovery/tokenIndex.mjs";
import {
  createRoundTripProbe,
  readBaseLiquidity,
  MIN_BASE_LIQUIDITY_WEI,
} from "../../aggregator/src/discovery/routability.mjs";
import { createCreatorReputation } from "../../aggregator/src/discovery/creatorReputation.mjs";
import { listSources } from "../../aggregator/src/sources/registry.mjs";
import { createLiveV2QuoteCandidateProvider } from "../../aggregator/src/discovery/v2Pools.mjs";
import { isTransientError } from "../../aggregator/src/quotes/sourceQuoteRunner.mjs";
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
      // A REJECTED (transient) block-number read must not stay cached for the
      // life of the request — otherwise a retry reuses the same rejection and
      // the route is lost. Drop it on failure so the next read re-issues the call.
      blockNumberPromise.catch(() => {
        if (blockNumberByInput.get(input) === blockNumberPromise) {
          blockNumberByInput.delete(input);
        }
      });
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
    transient: isTransientError(error),
    message: errorMessage(error),
  });
}

function recordQuoteSourceError(error, { sourceId, protocolType, input, transient } = {}) {
  appendQuoteDiagnostic(input, {
    type: "source-error",
    sourceId,
    protocolType,
    // Classified by the source runner: a transient (timeout / RPC fault) miss
    // must NOT be reported to the user as a definitive no-route.
    transient: transient === true,
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
  // Build the full non-official token index once at startup so the first GET
  // /tokens is instant. Off by default — only the real server process sets it,
  // so tests that assert on exact RPC call sequences aren't perturbed.
  warmTokenIndex = false,
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
      // Charge the REAL calldata length at quote time: with router mode "all" a
      // bare venue exactInput quote executes as a DogeSwapRouter program (~644B),
      // not the direct-venue ~228-260B — and a split is ONE combined program, not
      // the sum of per-leg venue calldata. Mirrors resolvedSwapDataFinalityFeeWei.
      payloadProvider: (input) =>
        swapPayloadForFee({
          ...input,
          routerMode: dogeSwapRouterMode,
          routerExecutable: Boolean(dogeSwapRouterAddress),
        }),
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
    // A one-hop runs as ONE router program; charge its combined-program
    // data/finality fee rather than the sum of per-leg router-overhead fees.
    dataFinalityFeeProvider: resolvedDataFinalityFeeWei,
  });
  const splitQuoteRefresher = dogeSwapRouterAddress
    ? createSplitQuoteRefresher({
        routerAddress: dogeSwapRouterAddress,
        directQuoteProvider: directQuoteCandidateProvider,
        // A split executes as ONE router program; charge its combined-program
        // data/finality fee rather than the sum of per-leg venue fees.
        dataFinalityFeeProvider: resolvedDataFinalityFeeWei,
        nowMs,
      })
    : undefined;
  const splitQuoteCandidateProvider = createSplitQuoteCandidateProvider({
    enabled: splitEnabled,
    routerAddress: dogeSwapRouterAddress,
    directQuoteProvider: directQuoteCandidateProvider,
    dataFinalityFeeProvider: resolvedDataFinalityFeeWei,
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

  // Full non-official token index for GET /tokens (see wiring below). When
  // warmTokenIndex is set (real server start), build it once now (fire-and-forget)
  // so the primary token list is instant instead of paying the ~7s enumerate+
  // metadata cost on the first request.
  const wdogeAddress = OFFICIAL_DOGEOS_TOKENS.find((t) => t.symbol === "WDOGE")?.address;
  // Shared best-active-candidate quote probe (works both directions) over the
  // live direct-route provider — used by the trending list AND the /tokens index
  // round-trip gate.
  const sharedQuoteProbe = async ({ sellToken, buyToken, amountIn }) => {
    try {
      const candidates = await directQuoteCandidateProvider({
        chainId: DOGEOS_CHAIN.id,
        quoteMode: "exactInput",
        sellToken,
        buyToken,
        amountIn: BigInt(amountIn),
        includeSources: [],
        excludeSources: [],
      });
      const active = (candidates ?? []).filter(
        (c) => c.status === "active" && BigInt(c.amountOut ?? 0n) > 0n,
      );
      if (active.length === 0) return { ok: false };
      const best = active.reduce((a, b) => (BigInt(b.amountOut) > BigInt(a.amountOut) ? b : a));
      return { ok: true, amountOut: best.amountOut, priceImpactBps: Number(best.priceImpactBps ?? 0) };
    } catch {
      return { ok: false };
    }
  };
  // /tokens routability gate: cheap min-base-liquidity floor (drop dust/drained
  // pools) then a base-anchored buy-then-sell round trip (drop honeypots /
  // sell-blockers / punitive fee-on-transfer tokens) — a one-way quote can't.
  const tokenIndexRoundTrip = createRoundTripProbe({ quoteProbe: sharedQuoteProbe, base: wdogeAddress });
  const tokenIndexRouteProbe = async ({ address, pools }) => {
    const liquidity = await readBaseLiquidity({ client, base: wdogeAddress, pools: pools ?? [] });
    if (liquidity < MIN_BASE_LIQUIDITY_WEI) return false;
    return tokenIndexRoundTrip(address);
  };
  // Trust signals for ranking + tier badge: base-liquidity depth + explorer
  // holders (age is derived from firstPoolBlock inside the index).
  const fetchHolders = async (tokenAddress) => {
    try {
      const res = await fetchFn(`${DOGEOS_CHAIN.blockscoutBaseUrl}/api/v2/tokens/${tokenAddress}`);
      if (!res.ok) return 0;
      const body = await res.json();
      return Number(body.holders_count ?? body.holders ?? 0) || 0;
    } catch {
      return 0;
    }
  };
  const tokenIndexSignalProvider = async ({ address, pools }) => {
    const [liquidityWei, holders] = await Promise.all([
      readBaseLiquidity({ client, base: wdogeAddress, pools: pools ?? [] }),
      fetchHolders(address.toLowerCase()),
    ]);
    return { liquidityWei, holders };
  };
  // Guilt-by-association: in-memory deployer reputation (accumulates from round-
  // trip probe failures over the server lifetime) + a Blockscout deployer lookup.
  const deployerReputation = createCreatorReputation();
  const fetchDeployer = async (tokenAddress) => {
    try {
      const res = await fetchFn(`${DOGEOS_CHAIN.blockscoutBaseUrl}/api/v2/addresses/${tokenAddress}`);
      if (!res.ok) return null;
      const body = await res.json();
      return body.creator_address_hash ? String(body.creator_address_hash).toLowerCase() : null;
    } catch {
      return null;
    }
  };

  const tokensProvider = createTokenIndexProvider({
    client,
    nowMs,
    // Only venues we can EXECUTE through — a token whose only pool is on a
    // non-executable/watchlist venue (e.g. SuchSwap) can't be routed, so it must
    // not be indexed as a tradeable token.
    sources: listSources().filter((source) => source.verification?.execution === true),
    baseTokens: OFFICIAL_DOGEOS_TOKENS,
    officialAddresses: OFFICIAL_DOGEOS_TOKENS.map((t) => t.address),
    routeProbe: tokenIndexRouteProbe,
    signalProvider: tokenIndexSignalProvider,
    deployerProvider: fetchDeployer,
    reputation: deployerReputation,
  });
  if (warmTokenIndex) tokensProvider().catch(() => {});

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
      // Only EXECUTABLE venues — a token whose only pool is on a non-executable
      // venue (e.g. SuchSwap, router:null) can't be swapped through us, so it
      // must not be surfaced as tradeable.
      sources: listSources().filter((source) => source.verification?.execution === true),
      baseTokens: OFFICIAL_DOGEOS_TOKENS.filter(
        (t) => t.symbol === "WDOGE" || t.symbol === "USDC" || t.symbol === "USDT",
      ),
      officialAddresses: OFFICIAL_DOGEOS_TOKENS.map((t) => t.address),
      primaryBase: OFFICIAL_DOGEOS_TOKENS.find((t) => t.symbol === "WDOGE")?.address,
      // Require >= 0.1 WDOGE backing a token's pools — cheaply drops dust and
      // drained one-sided pools before the (RPC-heavy) quote gate, so far
      // fewer candidates need metadata + probing.
      minBaseLiquidity: 10n ** 17n,
      // Round-trip tradeability gate: reject honeypots / drained pools by
      // quoting both directions through the live direct-route provider.
      quoteProbe: sharedQuoteProbe,
    }),
    // Full non-official token index for GET /tokens: every token with a live pool
    // against an official token across all factory venues (incl. watchlist),
    // enriched with on-chain ERC-20 metadata and marked verified:false so the UI
    // shows it "not official". No quote/liquidity gate (unlike trending) — auto-
    // generated faucet spam and duplicate symbols are collapsed inside the provider.
    tokensProvider,
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
