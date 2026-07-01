import { quoteV2ExactInput, quoteV2ExactOutput } from "../quotes/adapters/v2.mjs";
import { listSources } from "../sources/registry.mjs";
import { filterSourcesByRequest, filterSourcesByTokenPair } from "../sources/sourceFilters.mjs";
import { resolveDataFinalityFeeWei } from "../fees/dataFinalityFee.mjs";
import { DEFAULT_SOURCE_TIMEOUT_MS, runSourceQuote } from "../quotes/sourceQuoteRunner.mjs";

const SELECTORS = Object.freeze({
  getPair: "0xe6a43905",
  token0: "0x0dfe1681",
  token1: "0xd21220a7",
  getReserves: "0x0902f1ac",
});

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function normalizeAddress(address, fieldName) {
  const normalized = String(address ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
  return normalized;
}

function encodeAddress(address) {
  return normalizeAddress(address, "address").slice(2).padStart(64, "0");
}

function decodeAddress(result, fieldName) {
  const normalized = String(result ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${fieldName} must be an ABI-encoded address.`);
  }
  return `0x${normalized.slice(26)}`;
}

function decodeUint256Word(result, wordIndex, fieldName) {
  const normalized = String(result ?? "").toLowerCase();
  const wordStart = 2 + wordIndex * 64;
  const word = normalized.slice(wordStart, wordStart + 64);

  if (!/^0x[0-9a-f]*$/.test(normalized) || word.length !== 64) {
    throw new Error(`${fieldName} must contain ABI-encoded uint256 words.`);
  }

  return BigInt(`0x${word}`);
}

function blockTagFor(blockNumber) {
  return `0x${BigInt(blockNumber).toString(16)}`;
}

function matchingPinnedPool(source, sellToken, buyToken) {
  const pools = source.pools ?? [];
  if (pools.length === 0) return null;

  const normalizedSellToken = normalizeAddress(sellToken, "sellToken");
  const normalizedBuyToken = normalizeAddress(buyToken, "buyToken");

  return pools.find((pool) => {
    const token0 = normalizeAddress(pool.token0, "pool.token0");
    const token1 = normalizeAddress(pool.token1, "pool.token1");
    return (
      (token0 === normalizedSellToken && token1 === normalizedBuyToken) ||
      (token0 === normalizedBuyToken && token1 === normalizedSellToken)
    );
  }) ?? null;
}

function encodeGetPairCall(tokenA, tokenB) {
  return `${SELECTORS.getPair}${encodeAddress(tokenA)}${encodeAddress(tokenB)}`;
}

async function readPairAddress({ client, factory, sellToken, buyToken, blockTag }) {
  return decodeAddress(
    await client.call(
      {
        to: factory,
        data: encodeGetPairCall(sellToken, buyToken),
      },
      blockTag,
    ),
    "getPair result",
  );
}

async function callMany(client, transactions, blockTag) {
  if (typeof client.batchCall === "function") {
    try {
      return await client.batchCall(transactions, blockTag);
    } catch {
      // Some RPC frontends reject JSON-RPC batches. Fall back to individual reads.
    }
  }

  return Promise.all(transactions.map((transaction) => client.call(transaction, blockTag)));
}

async function readPoolState({ client, poolAddress, blockTag }) {
  const [rawToken0, rawToken1, rawReserves] = await callMany(
    client,
    [
      { to: poolAddress, data: SELECTORS.token0 },
      { to: poolAddress, data: SELECTORS.token1 },
      { to: poolAddress, data: SELECTORS.getReserves },
    ],
    blockTag,
  );
  return {
    token0: decodeAddress(rawToken0, "token0 result"),
    token1: decodeAddress(rawToken1, "token1 result"),
    reserves: {
      reserve0: decodeUint256Word(rawReserves, 0, "getReserves result"),
      reserve1: decodeUint256Word(rawReserves, 1, "getReserves result"),
    },
  };
}

export async function discoverV2Pool({ client, source, sellToken, buyToken, blockNumber, pinnedPool }) {
  if (source.protocolType !== "v2" || !source.factory) return null;

  const blockTag = blockTagFor(blockNumber);
  const factory = normalizeAddress(source.factory, "source.factory");
  const poolAddress = pinnedPool
    ? normalizeAddress(pinnedPool.address, "pinnedPool.address")
    : await readPairAddress({
        client,
        factory,
        sellToken,
        buyToken,
        blockTag,
      });

  if (poolAddress === ZERO_ADDRESS) return null;

  const { token0, token1, reserves } = await readPoolState({ client, poolAddress, blockTag });

  return {
    sourceId: source.sourceId,
    status: source.status,
    protocolType: source.protocolType,
    factory,
    poolAddress,
    token0,
    token1,
    reserve0: reserves.reserve0,
    reserve1: reserves.reserve1,
    blockNumber,
    warnings: [],
  };
}

export function createLiveV2QuoteCandidateProvider({
  client,
  sources = listSources(),
  chainId,
  nowMs = () => Date.now(),
  blockNumberProvider = () => client.getBlockNumber(),
  feeBps = 30n,
  gasUnits = 135_000n,
  dataFinalityFeeWei = 0n,
  ttlMs = 5_000,
  sourceTimeoutMs = DEFAULT_SOURCE_TIMEOUT_MS,
  onSourceError,
} = {}) {
  return async function liveV2QuoteCandidateProvider(input) {
    const {
      sellToken,
      buyToken,
      quoteMode = "exactInput",
      amountIn,
      amountOut,
      includeSources,
      excludeSources,
    } = input;
    const requestedSources = filterSourcesByTokenPair(
      filterSourcesByRequest(sources, { includeSources, excludeSources }),
      input,
    );
    const eligibleSources = requestedSources.filter(
      (source) => source.protocolType === "v2" && source.factory && source.status !== "disabled",
    );
    if (eligibleSources.length === 0) return [];

    const blockNumber =
      typeof blockNumberProvider === "function"
        ? await blockNumberProvider(input)
        : await client.getBlockNumber();
    const sourceResults = await Promise.all(
      eligibleSources.map((source) =>
        runSourceQuote({
          source,
          input,
          timeoutMs: sourceTimeoutMs,
          onSourceError,
          task: async () => {
            const pool = await discoverV2Pool({
              client,
              source,
              sellToken,
              buyToken,
              blockNumber,
              pinnedPool: matchingPinnedPool(source, sellToken, buyToken),
            });

            if (!pool) return [];

            // Per-venue fee wins over the provider-wide default: V2 forks
            // commonly diverge from 30 bps (MuchFi V2 is 20 bps on-chain).
            const sourceFeeBps = source.feeBps ?? feeBps;
            const normalizedSellToken = normalizeAddress(sellToken, "sellToken");
            const normalizedBuyToken = normalizeAddress(buyToken, "buyToken");
            const preview =
              quoteMode === "exactOutput"
                ? quoteV2ExactOutput({
                    sourceId: source.sourceId,
                    chainId,
                    status: source.status,
                    router: source.router,
                    poolAddress: pool.poolAddress,
                    token0: pool.token0,
                    token1: pool.token1,
                    reserve0: pool.reserve0,
                    reserve1: pool.reserve1,
                    sellToken: normalizedSellToken,
                    buyToken: normalizedBuyToken,
                    amountOut,
                    feeBps: sourceFeeBps,
                    gasUnits,
                    dataFinalityFeeWei: 0n,
                    blockNumber,
                    quoteTimestampMs: nowMs(),
                    ttlMs,
                  })
                : null;

            const routeDataFinalityFeeWei = await resolveDataFinalityFeeWei(dataFinalityFeeWei, {
              chainId,
              quoteMode,
              sellToken,
              buyToken,
              amountIn: quoteMode === "exactOutput" ? preview.amountIn : amountIn,
              amountOut: quoteMode === "exactOutput" ? amountOut : undefined,
              blockNumber,
              sourceId: source.sourceId,
              protocolType: source.protocolType,
              poolAddress: pool.poolAddress,
            });

            return [
              quoteMode === "exactOutput"
                ? quoteV2ExactOutput({
                    sourceId: source.sourceId,
                    chainId,
                    status: source.status,
                    router: source.router,
                    poolAddress: pool.poolAddress,
                    token0: pool.token0,
                    token1: pool.token1,
                    reserve0: pool.reserve0,
                    reserve1: pool.reserve1,
                    sellToken: normalizedSellToken,
                    buyToken: normalizedBuyToken,
                    amountOut,
                    feeBps: sourceFeeBps,
                    gasUnits,
                    dataFinalityFeeWei: routeDataFinalityFeeWei,
                    blockNumber,
                    quoteTimestampMs: nowMs(),
                    ttlMs,
                  })
                : quoteV2ExactInput({
                    sourceId: source.sourceId,
                    chainId,
                    status: source.status,
                    router: source.router,
                    poolAddress: pool.poolAddress,
                    token0: pool.token0,
                    token1: pool.token1,
                    reserve0: pool.reserve0,
                    reserve1: pool.reserve1,
                    sellToken: normalizedSellToken,
                    buyToken: normalizedBuyToken,
                    amountIn,
                    feeBps: sourceFeeBps,
                    gasUnits,
                    dataFinalityFeeWei: routeDataFinalityFeeWei,
                    blockNumber,
                    quoteTimestampMs: nowMs(),
                    ttlMs,
                  }),
            ];
          },
        }),
      ),
    );

    return sourceResults.flat();
  };
}
