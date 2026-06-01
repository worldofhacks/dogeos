import { listSources } from "../sources/registry.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const SELECTORS = Object.freeze({
  token0: "0x0dfe1681",
  token1: "0xd21220a7",
  liquidity: "0x1a686502",
  slot0: "0x3850c7bd",
  globalState: "0xe76c01e4",
  v3QuoteExactInputSingle: "0xc6a5026a",
  v3QuoteExactOutputSingle: "0xbd21704a",
  algebraQuoteExactInputSingle: "0xe94764c4",
  algebraQuoteExactOutputSingle: "0x62086e24",
});

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

function encodeUint(value) {
  const bigint = BigInt(value);
  if (bigint < 0n) throw new Error("ABI uint value cannot be negative.");
  return bigint.toString(16).padStart(64, "0");
}

function decodeWord(result, wordIndex, fieldName) {
  const normalized = String(result ?? "").toLowerCase();
  const wordStart = 2 + wordIndex * 64;
  const word = normalized.slice(wordStart, wordStart + 64);

  if (!/^0x[0-9a-f]*$/.test(normalized) || word.length !== 64) {
    throw new Error(`${fieldName} must contain ABI-encoded uint256 words.`);
  }

  return BigInt(`0x${word}`);
}

function decodeAddress(result, fieldName) {
  const normalized = String(result ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${fieldName} must be an ABI-encoded address.`);
  }
  return `0x${normalized.slice(26)}`;
}

function blockTagFor(blockNumber) {
  return blockNumber === undefined ? "latest" : `0x${BigInt(blockNumber).toString(16)}`;
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

function feeTierToBps(feeTier) {
  return BigInt(feeTier) / 100n;
}

function matchingPools(source, sellToken, buyToken) {
  const normalizedSell = normalizeAddress(sellToken, "sellToken");
  const normalizedBuy = normalizeAddress(buyToken, "buyToken");

  return (source.pools ?? []).filter((pool) => {
    const token0 = normalizeAddress(pool.token0, "pool.token0");
    const token1 = normalizeAddress(pool.token1, "pool.token1");
    return (
      (token0 === normalizedSell && token1 === normalizedBuy) ||
      (token0 === normalizedBuy && token1 === normalizedSell)
    );
  });
}

function decodePoolState({ rawToken0, rawToken1, rawLiquidity, rawState, protocolType }) {
  return {
    token0: decodeAddress(rawToken0, "token0 result"),
    token1: decodeAddress(rawToken1, "token1 result"),
    liquidity: decodeWord(rawLiquidity, 0, "liquidity result"),
    sqrtPriceX96: decodeWord(rawState, 0, protocolType === "algebra" ? "globalState result" : "slot0 result"),
    dynamicFeeTier: protocolType === "algebra" ? decodeWord(rawState, 2, "globalState result") : null,
  };
}

function encodeV3QuoteExactInputSingle({ sellToken, buyToken, amountIn, feeTier }) {
  return `${SELECTORS.v3QuoteExactInputSingle}${encodeAddress(sellToken)}${encodeAddress(buyToken)}${encodeUint(amountIn)}${encodeUint(feeTier)}${encodeUint(0n)}`;
}

function encodeV3QuoteExactOutputSingle({ sellToken, buyToken, amountOut, feeTier }) {
  return `${SELECTORS.v3QuoteExactOutputSingle}${encodeAddress(sellToken)}${encodeAddress(buyToken)}${encodeUint(amountOut)}${encodeUint(feeTier)}${encodeUint(0n)}`;
}

function encodeAlgebraQuoteExactInputSingle({ sellToken, buyToken, amountIn, deployer }) {
  return `${SELECTORS.algebraQuoteExactInputSingle}${encodeAddress(sellToken)}${encodeAddress(buyToken)}${encodeAddress(deployer)}${encodeUint(amountIn)}${encodeUint(0n)}`;
}

function encodeAlgebraQuoteExactOutputSingle({ sellToken, buyToken, amountOut, deployer }) {
  return `${SELECTORS.algebraQuoteExactOutputSingle}${encodeAddress(sellToken)}${encodeAddress(buyToken)}${encodeAddress(deployer)}${encodeUint(amountOut)}${encodeUint(0n)}`;
}

async function quotePool({
  client,
  source,
  pool,
  sellToken,
  buyToken,
  quoteMode,
  amountIn,
  amountOut,
  blockTag,
}) {
  const poolAddress = normalizeAddress(pool.address, "pool.address");

  if (source.protocolType === "v3") {
    const feeTier = BigInt(pool.feeTier);
    const [rawToken0, rawToken1, rawLiquidity, rawState, result] = await callMany(
      client,
      [
        { to: poolAddress, data: SELECTORS.token0 },
        { to: poolAddress, data: SELECTORS.token1 },
        { to: poolAddress, data: SELECTORS.liquidity },
        { to: poolAddress, data: SELECTORS.slot0 },
        {
          to: source.quoter,
          data: quoteMode === "exactOutput"
            ? encodeV3QuoteExactOutputSingle({
                sellToken,
                buyToken,
                amountOut,
                feeTier,
              })
            : encodeV3QuoteExactInputSingle({
                sellToken,
                buyToken,
                amountIn,
                feeTier,
              }),
        },
      ],
      blockTag,
    );
    const poolState = decodePoolState({
      rawToken0,
      rawToken1,
      rawLiquidity,
      rawState,
      protocolType: source.protocolType,
    });

    return {
      poolAddress: pool.address,
      token0: poolState.token0,
      token1: poolState.token1,
      ...(quoteMode === "exactOutput"
        ? { quotedAmountIn: decodeWord(result, 0, "V3 quoter result") }
        : { quotedAmountOut: decodeWord(result, 0, "V3 quoter result") }),
      feeBps: feeTierToBps(feeTier),
      sqrtPriceX96: poolState.sqrtPriceX96,
      liquidity: poolState.liquidity,
      gasUnits: decodeWord(result, 3, "V3 quoter result"),
      quoterProvenance: source.quoterAbiProvenance ?? "onchain-bytecode",
    };
  }

  if (source.protocolType === "algebra") {
    const [rawToken0, rawToken1, rawLiquidity, rawState, result] = await callMany(
      client,
      [
        { to: poolAddress, data: SELECTORS.token0 },
        { to: poolAddress, data: SELECTORS.token1 },
        { to: poolAddress, data: SELECTORS.liquidity },
        { to: poolAddress, data: SELECTORS.globalState },
        {
          to: source.quoter,
          data: quoteMode === "exactOutput"
            ? encodeAlgebraQuoteExactOutputSingle({
                sellToken,
                buyToken,
                amountOut,
                deployer: source.quoterPoolDeployer ?? ZERO_ADDRESS,
              })
            : encodeAlgebraQuoteExactInputSingle({
                sellToken,
                buyToken,
                amountIn,
                deployer: source.quoterPoolDeployer ?? ZERO_ADDRESS,
              }),
        },
      ],
      blockTag,
    );
    const poolState = decodePoolState({
      rawToken0,
      rawToken1,
      rawLiquidity,
      rawState,
      protocolType: source.protocolType,
    });
    const quotedFeeTier = decodeWord(result, 5, "Algebra quoter result");
    const feeTier = quotedFeeTier > 0n ? quotedFeeTier : poolState.dynamicFeeTier;

    return {
      poolAddress: pool.address,
      token0: poolState.token0,
      token1: poolState.token1,
      ...(quoteMode === "exactOutput"
        ? { quotedAmountIn: decodeWord(result, 0, "Algebra quoter result") }
        : { quotedAmountOut: decodeWord(result, 0, "Algebra quoter result") }),
      feeBps: feeTierToBps(feeTier),
      sqrtPriceX96: poolState.sqrtPriceX96,
      liquidity: poolState.liquidity,
      gasUnits: decodeWord(result, 4, "Algebra quoter result"),
      quoterProvenance: source.quoterAbiProvenance ?? "onchain-bytecode",
    };
  }

  return null;
}

export function createLiveConcentratedLiquidityQuoterOutputProvider({
  client,
  sources = listSources(),
} = {}) {
  return async function liveConcentratedLiquidityQuoterOutputProvider({
    source,
    sourceId,
    sellToken,
    buyToken,
    quoteMode = "exactInput",
    amountIn,
    amountOut,
    blockNumber,
  }) {
    const configuredSource =
      source ?? sources.find((candidate) => candidate.sourceId === sourceId);
    if (!configuredSource?.quoter || configuredSource.quoterAbiProvenance === "none") return null;
    if (!["v3", "algebra"].includes(configuredSource.protocolType)) return null;

    const pools = matchingPools(configuredSource, sellToken, buyToken);
    if (pools.length === 0) return null;

    const blockTag = blockTagFor(blockNumber);
    const outputs = await Promise.all(
      pools.map((pool) =>
        quotePool({
          client,
          source: configuredSource,
          pool,
          sellToken,
          buyToken,
          quoteMode,
          amountIn,
          amountOut,
          blockTag,
        }).catch(() => null),
      ),
    );

    return outputs
      .filter(Boolean)
      .sort((left, right) => {
        if (quoteMode === "exactOutput") {
          if (left.quotedAmountIn < right.quotedAmountIn) return -1;
          if (left.quotedAmountIn > right.quotedAmountIn) return 1;
          if (left.gasUnits < right.gasUnits) return -1;
          if (left.gasUnits > right.gasUnits) return 1;
          return left.poolAddress.localeCompare(right.poolAddress);
        }

        if (left.quotedAmountOut > right.quotedAmountOut) return -1;
        if (left.quotedAmountOut < right.quotedAmountOut) return 1;
        if (left.gasUnits < right.gasUnits) return -1;
        if (left.gasUnits > right.gasUnits) return 1;
        return left.poolAddress.localeCompare(right.poolAddress);
      })[0] ?? null;
  };
}
