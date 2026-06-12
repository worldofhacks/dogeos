// poolScan.mjs — on-chain pool discovery across the configured venues for an
// arbitrary token pair. For each venue with a factory, queries the canonical
// pool-lookup method (UniswapV2 getPair, UniswapV3 getPool per fee tier,
// Algebra poolByPair) and reports the live pools. Used both by the /token scan
// endpoint and (via discoverConcentratedPools) by the live quote path so that
// pasted tokens become routable without a registry edit.

import { listSources } from "../sources/registry.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const SELECTORS = Object.freeze({
  getPair: "0xe6a43905", // UniswapV2Factory.getPair(address,address)
  getPool: "0x1698ee82", // UniswapV3Factory.getPool(address,address,uint24)
  poolByPair: "0xd9a641e1", // AlgebraFactory.poolByPair(address,address)
  getReserves: "0x0902f1ac",
  liquidity: "0x1a686502",
});

// Fee tiers probed for V3-style factories. Superset of the tiers the official
// pools use (500, 2500) plus common UniswapV3 tiers; non-existent tiers just
// return the zero address.
export const V3_FEE_TIERS = Object.freeze([100, 500, 2500, 3000, 10000]);

function normalizeAddress(value, fieldName) {
  const normalized = String(value ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
  return normalized;
}

function encodeAddress(address) {
  return normalizeAddress(address, "address").slice(2).padStart(64, "0");
}

function encodeUint(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function decodeAddress(result) {
  const hex = String(result ?? "0x").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hex)) return null;
  const addr = `0x${hex.slice(26)}`;
  return addr === ZERO_ADDRESS ? null : addr;
}

function decodeWord(result, wordIndex) {
  const hex = String(result ?? "0x").toLowerCase();
  const start = 2 + wordIndex * 64;
  const word = hex.slice(start, start + 64);
  if (word.length !== 64) return 0n;
  return BigInt(`0x${word}`);
}

async function safeCall(client, to, data, blockTag) {
  try {
    return await client.call({ to, data }, blockTag);
  } catch {
    return null;
  }
}

function getPairCalldata(tokenA, tokenB) {
  return `${SELECTORS.getPair}${encodeAddress(tokenA)}${encodeAddress(tokenB)}`;
}

function getPoolCalldata(tokenA, tokenB, feeTier) {
  return `${SELECTORS.getPool}${encodeAddress(tokenA)}${encodeAddress(tokenB)}${encodeUint(feeTier)}`;
}

function poolByPairCalldata(tokenA, tokenB) {
  return `${SELECTORS.poolByPair}${encodeAddress(tokenA)}${encodeAddress(tokenB)}`;
}

// Discover V3/Algebra pools for a pair via the venue's factory. Returns pool
// descriptors in the shape concentratedLiquidityPools.matchingPools yields
// (address + feeTier for v3; address for algebra), already liquidity-checked.
export async function discoverConcentratedPools({
  client,
  source,
  tokenA,
  tokenB,
  blockTag = "latest",
  feeTiers = V3_FEE_TIERS,
}) {
  if (!source?.factory) return [];
  const factory = source.factory;

  if (source.protocolType === "v3") {
    const lookups = await Promise.all(
      feeTiers.map((feeTier) =>
        safeCall(client, factory, getPoolCalldata(tokenA, tokenB, feeTier), blockTag).then((result) => ({
          feeTier,
          address: result ? decodeAddress(result) : null,
        })),
      ),
    );
    const pools = lookups.filter((entry) => entry.address);
    const liveFlags = await Promise.all(
      pools.map((pool) =>
        safeCall(client, pool.address, SELECTORS.liquidity, blockTag).then(
          (result) => decodeWord(result, 0) > 0n,
        ),
      ),
    );
    return pools.filter((_, i) => liveFlags[i]).map((pool) => ({
      address: pool.address,
      feeTier: pool.feeTier,
    }));
  }

  if (source.protocolType === "algebra") {
    const result = await safeCall(client, factory, poolByPairCalldata(tokenA, tokenB), blockTag);
    const address = result ? decodeAddress(result) : null;
    if (!address) return [];
    const liq = await safeCall(client, address, SELECTORS.liquidity, blockTag);
    if (decodeWord(liq, 0) <= 0n) return [];
    return [{ address }];
  }

  return [];
}

async function discoverV2Pool({ client, source, tokenA, tokenB, blockTag }) {
  if (!source?.factory) return null;
  const result = await safeCall(client, source.factory, getPairCalldata(tokenA, tokenB), blockTag);
  const address = result ? decodeAddress(result) : null;
  if (!address) return null;
  const reserves = await safeCall(client, address, SELECTORS.getReserves, blockTag);
  if (!reserves) return null;
  const reserve0 = decodeWord(reserves, 0);
  const reserve1 = decodeWord(reserves, 1);
  if (reserve0 <= 0n || reserve1 <= 0n) return null;
  return { address, reserve0, reserve1 };
}

// Scan every configured venue for live pools of `tokenA`/`tokenB`. Returns a
// flat list of { sourceId, protocolType, poolAddress, feeTier? } for the
// venues that have a live pool. Powers the /token discovery endpoint.
export async function scanVenuePools({
  client,
  tokenA,
  tokenB,
  sources = listSources(),
  blockTag = "latest",
  feeTiers = V3_FEE_TIERS,
}) {
  const factorySources = sources.filter(
    (source) => source.factory && source.status !== "disabled",
  );

  const results = await Promise.all(
    factorySources.map(async (source) => {
      try {
        if (source.protocolType === "v2") {
          const pool = await discoverV2Pool({ client, source, tokenA, tokenB, blockTag });
          return pool
            ? [{ sourceId: source.sourceId, protocolType: "v2", poolAddress: pool.address }]
            : [];
        }
        const pools = await discoverConcentratedPools({
          client,
          source,
          tokenA,
          tokenB,
          blockTag,
          feeTiers,
        });
        return pools.map((pool) => ({
          sourceId: source.sourceId,
          protocolType: source.protocolType,
          poolAddress: pool.address,
          ...(pool.feeTier !== undefined ? { feeTier: pool.feeTier } : {}),
        }));
      } catch {
        return [];
      }
    }),
  );

  return results.flat();
}
