import { fileURLToPath } from "node:url";

import { listSources } from "../packages/aggregator/src/sources/registry.mjs";
import { DOGEOS_CHAIN } from "../packages/config/src/chains.mjs";
import { OFFICIAL_DOGEOS_TOKENS } from "../packages/config/src/tokens.mjs";
import { createJsonRpcClient } from "../packages/dogeos-rpc/src/index.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_FEE_TIERS = Object.freeze([100, 500, 2500, 3000, 10_000]);

export const DISCOVERY_SELECTORS = Object.freeze({
  getPair: "0xe6a43905",
  getPool: "0x1698ee82",
  poolByPair: "0xd9a641e1",
  token0: "0x0dfe1681",
  token1: "0xd21220a7",
  getReserves: "0x0902f1ac",
  liquidity: "0x1a686502",
  slot0: "0x3850c7bd",
  globalState: "0xe76c01e4",
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
  const normalized = BigInt(value);
  if (normalized < 0n) throw new Error("uint values cannot be negative.");
  return normalized.toString(16).padStart(64, "0");
}

function decodeAddressResult(result, fieldName) {
  const normalized = String(result ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${fieldName} must be an ABI-encoded address.`);
  }
  return `0x${normalized.slice(26)}`;
}

function decodeWord(result, wordIndex, fieldName) {
  const normalized = String(result ?? "").toLowerCase();
  const word = normalized.slice(2 + wordIndex * 64, 2 + (wordIndex + 1) * 64);
  if (!/^0x[0-9a-f]*$/.test(normalized) || word.length !== 64) {
    throw new Error(`${fieldName} must contain ABI-encoded uint256 words.`);
  }
  return BigInt(`0x${word}`);
}

function encodeGetPair(tokenA, tokenB) {
  return `${DISCOVERY_SELECTORS.getPair}${encodeAddress(tokenA)}${encodeAddress(tokenB)}`;
}

function encodeGetPool(tokenA, tokenB, feeTier) {
  return `${DISCOVERY_SELECTORS.getPool}${encodeAddress(tokenA)}${encodeAddress(tokenB)}${encodeUint(feeTier)}`;
}

function encodePoolByPair(tokenA, tokenB) {
  return `${DISCOVERY_SELECTORS.poolByPair}${encodeAddress(tokenA)}${encodeAddress(tokenB)}`;
}

async function callMany(client, transactions, blockTag) {
  if (typeof client.batchCall === "function") {
    try {
      return await client.batchCall(transactions, blockTag);
    } catch {
      // Some DogeOS RPC frontends reject batches; pair discovery can fall back safely.
    }
  }

  return Promise.all(transactions.map((transaction) => client.call(transaction, blockTag)));
}

function stringifyBigint(value) {
  return value === null || value === undefined ? null : value.toString();
}

function basePoolRecord({ source, pair, address, token0, token1 }) {
  return {
    sourceId: source.sourceId,
    displayName: source.displayName ?? source.sourceId,
    status: source.status ?? "unknown",
    protocolType: source.protocolType,
    symbolPair: pair.symbolPair,
    tokenA: pair.tokenA.symbol,
    tokenB: pair.tokenB.symbol,
    address: normalizeAddress(address, "pool.address"),
    token0: normalizeAddress(token0, "pool.token0"),
    token1: normalizeAddress(token1, "pool.token1"),
  };
}

async function readV2Pool({ client, source, pair, blockTag }) {
  const poolAddress = decodeAddressResult(
    await client.call(
      {
        to: source.factory,
        data: encodeGetPair(pair.tokenA.address, pair.tokenB.address),
      },
      blockTag,
    ),
    "getPair result",
  );
  if (poolAddress === ZERO_ADDRESS) return null;

  const [rawToken0, rawToken1, rawReserves] = await callMany(
    client,
    [
      { to: poolAddress, data: DISCOVERY_SELECTORS.token0 },
      { to: poolAddress, data: DISCOVERY_SELECTORS.token1 },
      { to: poolAddress, data: DISCOVERY_SELECTORS.getReserves },
    ],
    blockTag,
  );
  const reserve0 = decodeWord(rawReserves, 0, "getReserves result");
  const reserve1 = decodeWord(rawReserves, 1, "getReserves result");

  return {
    ...basePoolRecord({
      source,
      pair,
      address: poolAddress,
      token0: decodeAddressResult(rawToken0, "token0 result"),
      token1: decodeAddressResult(rawToken1, "token1 result"),
    }),
    reserve0: stringifyBigint(reserve0),
    reserve1: stringifyBigint(reserve1),
    hasLiveLiquidity: reserve0 > 0n && reserve1 > 0n,
  };
}

async function readV3Pool({ client, source, pair, feeTier, blockTag }) {
  const poolAddress = decodeAddressResult(
    await client.call(
      {
        to: source.factory,
        data: encodeGetPool(pair.tokenA.address, pair.tokenB.address, feeTier),
      },
      blockTag,
    ),
    "getPool result",
  );
  if (poolAddress === ZERO_ADDRESS) return null;

  const [rawToken0, rawToken1, rawLiquidity, rawSlot0] = await callMany(
    client,
    [
      { to: poolAddress, data: DISCOVERY_SELECTORS.token0 },
      { to: poolAddress, data: DISCOVERY_SELECTORS.token1 },
      { to: poolAddress, data: DISCOVERY_SELECTORS.liquidity },
      { to: poolAddress, data: DISCOVERY_SELECTORS.slot0 },
    ],
    blockTag,
  );
  const liquidity = decodeWord(rawLiquidity, 0, "liquidity result");
  const sqrtPriceX96 = decodeWord(rawSlot0, 0, "slot0 result");

  return {
    ...basePoolRecord({
      source,
      pair,
      address: poolAddress,
      token0: decodeAddressResult(rawToken0, "token0 result"),
      token1: decodeAddressResult(rawToken1, "token1 result"),
    }),
    feeTier,
    liquidity: stringifyBigint(liquidity),
    sqrtPriceX96: stringifyBigint(sqrtPriceX96),
    hasLiveLiquidity: liquidity > 0n && sqrtPriceX96 > 0n,
  };
}

async function readAlgebraPool({ client, source, pair, blockTag }) {
  const poolAddress = decodeAddressResult(
    await client.call(
      {
        to: source.factory,
        data: encodePoolByPair(pair.tokenA.address, pair.tokenB.address),
      },
      blockTag,
    ),
    "poolByPair result",
  );
  if (poolAddress === ZERO_ADDRESS) return null;

  const [rawToken0, rawToken1, rawLiquidity, rawGlobalState] = await callMany(
    client,
    [
      { to: poolAddress, data: DISCOVERY_SELECTORS.token0 },
      { to: poolAddress, data: DISCOVERY_SELECTORS.token1 },
      { to: poolAddress, data: DISCOVERY_SELECTORS.liquidity },
      { to: poolAddress, data: DISCOVERY_SELECTORS.globalState },
    ],
    blockTag,
  );
  const liquidity = decodeWord(rawLiquidity, 0, "liquidity result");
  const sqrtPriceX96 = decodeWord(rawGlobalState, 0, "globalState result");
  const dynamicFeeTier = decodeWord(rawGlobalState, 2, "globalState result");

  return {
    ...basePoolRecord({
      source,
      pair,
      address: poolAddress,
      token0: decodeAddressResult(rawToken0, "token0 result"),
      token1: decodeAddressResult(rawToken1, "token1 result"),
    }),
    liquidity: stringifyBigint(liquidity),
    sqrtPriceX96: stringifyBigint(sqrtPriceX96),
    dynamicFeeTier: stringifyBigint(dynamicFeeTier),
    hasLiveLiquidity: liquidity > 0n && sqrtPriceX96 > 0n,
  };
}

export function buildOfficialTokenPairs(tokens = OFFICIAL_DOGEOS_TOKENS) {
  const pairs = [];

  for (let left = 0; left < tokens.length; left += 1) {
    for (let right = left + 1; right < tokens.length; right += 1) {
      pairs.push({
        tokenA: tokens[left],
        tokenB: tokens[right],
        symbolPair: `${tokens[left].symbol}/${tokens[right].symbol}`,
      });
    }
  }

  return pairs;
}

function defaultDiscoverySources(sources = listSources()) {
  const fromRegistry = sources
    .filter((source) => source.factory && ["v2", "v3", "algebra"].includes(source.protocolType))
    .map((source) => ({
      sourceId: source.sourceId,
      displayName: source.displayName,
      status: source.status,
      protocolType: source.protocolType,
      factory: source.factory,
      router: source.router,
      quoter: source.quoter,
      positionManager: source.positionManager,
      poolDeployer: source.poolDeployer,
    }));
  const hasOlderBarkswapFactory = sources.some((source) =>
    (source.verificationTargets ?? []).some(
      (target) => target.address?.toLowerCase() === "0x88f7307dd42e603c2b4ddd1bfcc5cbe55a5ed263",
    ),
  );

  if (hasOlderBarkswapFactory) {
    fromRegistry.push({
      sourceId: "barkswap-algebra-old",
      displayName: "Barkswap older factory",
      status: "watchlist",
      protocolType: "algebra",
      factory: "0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263",
      router: null,
      quoter: null,
    });
  }

  return fromRegistry;
}

function contractEntriesForSources(sources) {
  const roles = ["factory", "router", "quoter", "positionManager", "poolDeployer"];
  const seen = new Set();
  const entries = [];

  for (const source of sources) {
    for (const role of roles) {
      const address = source[role];
      if (!address) continue;

      const normalized = normalizeAddress(address, `${source.sourceId}.${role}`);
      const key = `${source.sourceId}:${role}:${normalized}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        sourceId: source.sourceId,
        displayName: source.displayName ?? source.sourceId,
        role,
        address: normalized,
      });
    }
  }

  return entries;
}

function blockscoutAbiUrl(baseUrl, address) {
  return `${baseUrl.replace(/\/+$/, "")}/api?module=contract&action=getabi&address=${address}`;
}

function parseAbiFunctionCount(result) {
  if (typeof result !== "string" || !result.trim().startsWith("[")) return 0;

  try {
    const abi = JSON.parse(result);
    return Array.isArray(abi) ? abi.filter((entry) => entry?.type === "function").length : 0;
  } catch {
    return 0;
  }
}

async function fetchBlockscoutAbiStatus({ fetchFn, blockscoutBaseUrl, contract }) {
  const url = blockscoutAbiUrl(blockscoutBaseUrl, contract.address);

  try {
    const response = await fetchFn(url);
    if (!response.ok) {
      return {
        ...contract,
        endpointUrl: url,
        hasAbi: false,
        status: "http-error",
        message: `HTTP ${response.status}`,
        functionCount: 0,
      };
    }

    const body = await response.json();
    const functionCount = parseAbiFunctionCount(body.result);
    return {
      ...contract,
      endpointUrl: url,
      hasAbi: body.status === "1" && functionCount > 0,
      status: body.status ?? null,
      message: body.message ?? null,
      functionCount,
    };
  } catch (error) {
    return {
      ...contract,
      endpointUrl: url,
      hasAbi: false,
      status: "error",
      message: error?.message ?? String(error),
      functionCount: 0,
    };
  }
}

function summarizePairCoverage(pairs, pools) {
  const byPair = {};

  for (const pair of pairs) {
    const pairPools = pools.filter((pool) => pool.symbolPair === pair.symbolPair);
    if (pairPools.length === 0) continue;

    byPair[pair.symbolPair] = {
      poolCount: pairPools.length,
      sourceIds: [...new Set(pairPools.map((pool) => pool.sourceId))].sort(),
      protocolTypes: [...new Set(pairPools.map((pool) => pool.protocolType))].sort(),
      liveLiquidityPoolCount: pairPools.filter((pool) => pool.hasLiveLiquidity).length,
    };
  }

  return byPair;
}

async function discoverPairSourcePool({ client, source, pair, feeTiers, blockTag }) {
  if (source.protocolType === "v2") {
    return [await readV2Pool({ client, source, pair, blockTag })].filter(Boolean);
  }

  if (source.protocolType === "v3") {
    const configuredFeeTiers = source.feeTiers ?? feeTiers;
    const pools = await Promise.all(
      configuredFeeTiers.map((feeTier) =>
        readV3Pool({ client, source, pair, feeTier, blockTag }).catch(() => null),
      ),
    );
    return pools.filter(Boolean);
  }

  if (source.protocolType === "algebra") {
    return [await readAlgebraPool({ client, source, pair, blockTag })].filter(Boolean);
  }

  return [];
}

export async function discoverOfficialTokenLiquidity({
  client,
  fetchFn = fetch,
  tokens = OFFICIAL_DOGEOS_TOKENS,
  sources = defaultDiscoverySources(),
  feeTiers = DEFAULT_FEE_TIERS,
  blockTag = "latest",
  includeBlockscout = true,
  blockscoutBaseUrl = DOGEOS_CHAIN.blockscoutBaseUrl,
} = {}) {
  if (!client?.call) throw new Error("discoverOfficialTokenLiquidity requires an RPC client with call().");

  const chainId = typeof client.getChainId === "function" ? await client.getChainId() : null;
  const pairs = buildOfficialTokenPairs(tokens);
  const pools = [];
  const errors = [];

  for (const pair of pairs) {
    for (const source of sources) {
      if (!source.factory) continue;
      try {
        pools.push(
          ...(await discoverPairSourcePool({
            client,
            source,
            pair,
            feeTiers,
            blockTag,
          })),
        );
      } catch (error) {
        errors.push({
          sourceId: source.sourceId,
          protocolType: source.protocolType,
          symbolPair: pair.symbolPair,
          message: error?.message ?? String(error),
        });
      }
    }
  }

  const pairCoverage = summarizePairCoverage(pairs, pools);
  const unsupportedOfficialPairs = pairs
    .filter((pair) => !pairCoverage[pair.symbolPair])
    .map((pair) => pair.symbolPair);
  const contractAbiStatus = includeBlockscout
    ? await Promise.all(
        contractEntriesForSources(sources).map((contract) =>
          fetchBlockscoutAbiStatus({
            fetchFn,
            blockscoutBaseUrl,
            contract,
          }),
        ),
      )
    : [];

  return {
    checkedAt: new Date().toISOString(),
    chainId,
    expectedChainId: DOGEOS_CHAIN.id,
    chainMatches: chainId === null ? null : chainId === DOGEOS_CHAIN.id,
    tokenCount: tokens.length,
    pairCount: pairs.length,
    sourceCount: sources.length,
    feeTiers,
    pools: pools.sort((left, right) =>
      `${left.symbolPair}:${left.sourceId}:${left.feeTier ?? ""}`.localeCompare(
        `${right.symbolPair}:${right.sourceId}:${right.feeTier ?? ""}`,
      ),
    ),
    pairCoverage,
    unsupportedOfficialPairs,
    contractAbiStatus,
    errors,
  };
}

function parseArgs(argv) {
  return {
    includeBlockscout: !argv.includes("--skip-blockscout"),
    rpcUrl:
      argv.find((arg) => arg.startsWith("--rpc-url="))?.slice("--rpc-url=".length) ??
      DOGEOS_CHAIN.rpcUrls[0],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const client = createJsonRpcClient({ rpcUrl: options.rpcUrl });
  const report = await discoverOfficialTokenLiquidity({
    client,
    includeBlockscout: options.includeBlockscout,
  });

  console.log(JSON.stringify(report, null, 2));

  if (report.chainMatches === false) {
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (entrypoint) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
