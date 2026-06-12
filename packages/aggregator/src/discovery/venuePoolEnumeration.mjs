// venuePoolEnumeration.mjs — enumerate EVERY pool on each venue from its
// pool-creation event log, then keep the ones that are (a) live (non-zero
// liquidity/reserves) and (b) routable against a base token (WDOGE/USDC/…).
//
// This is the ground truth of what is tradeable on DogeOS — far more complete
// than ranking explorer tokens by holders (which misses tokens with real
// pools but few holders, and surfaces airdrop spam with no liquidity). MuchFi
// V3 alone has dozens of pools that holder-ranking never reaches.

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Pool-creation event topic0 (keccak of the signature).
const TOPICS = Object.freeze({
  // UniswapV3 PoolCreated(token0 indexed, token1 indexed, fee indexed, tickSpacing, pool)
  v3PoolCreated: "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118",
  // Algebra Pool(token0 indexed, token1 indexed, pool)
  algebraPool: "0x91ccaa7a278130b65168c3a0c8d3bcae84cf5e43704342bd3ec0b59e59c036db",
  // UniswapV2 PairCreated(token0 indexed, token1 indexed, pair, uint)
  v2PairCreated: "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9",
});

const SELECTORS = Object.freeze({
  liquidity: "0x1a686502",
  getReserves: "0x0902f1ac",
  allPairsLength: "0x574f2ba3",
  allPairs: "0x1e3dd18b",
});

function topicAddress(topic) {
  const hex = String(topic ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hex)) return null;
  const addr = `0x${hex.slice(26)}`;
  return addr === ZERO_ADDRESS ? null : addr;
}

function dataWordAddress(data, wordIndex) {
  const hex = String(data ?? "0x").toLowerCase().slice(2);
  const start = wordIndex * 64;
  const word = hex.slice(start, start + 64);
  if (word.length !== 64) return null;
  const addr = `0x${word.slice(24)}`;
  return addr === ZERO_ADDRESS ? null : addr;
}

function dataWordUint(data, wordIndex) {
  const hex = String(data ?? "0x").toLowerCase().slice(2);
  const start = wordIndex * 64;
  const word = hex.slice(start, start + 64);
  if (word.length !== 64) return 0n;
  return BigInt(`0x${word}`);
}

async function safeCall(client, to, data, blockTag = "latest") {
  try {
    return await client.call({ to, data }, blockTag);
  } catch {
    return null;
  }
}

// Enumerate raw pools (no liquidity check) for one venue from its factory log.
async function enumeratePoolsFromLogs({ client, source, fromBlock = "0x0", toBlock = "latest" }) {
  if (!source?.factory) return [];

  if (source.protocolType === "v2") {
    // V2 factories expose allPairs(i); cheaper + more reliable than logs.
    const lengthResult = await safeCall(client, source.factory, SELECTORS.allPairsLength);
    const length = lengthResult ? Number(BigInt(lengthResult)) : 0;
    const pairs = await Promise.all(
      Array.from({ length: Math.min(length, 500) }, (_, i) =>
        safeCall(
          client,
          source.factory,
          `${SELECTORS.allPairs}${BigInt(i).toString(16).padStart(64, "0")}`,
        ).then((result) => (result ? dataWordAddress(result, 0) : null)),
      ),
    );
    return pairs.filter(Boolean).map((address) => ({ poolAddress: address, protocolType: "v2" }));
  }

  const topic =
    source.protocolType === "v3"
      ? TOPICS.v3PoolCreated
      : source.protocolType === "algebra"
        ? TOPICS.algebraPool
        : null;
  if (!topic) return [];

  const logs = await client
    .getLogs({ address: source.factory, topics: [topic], fromBlock, toBlock })
    .catch(() => []);

  return logs
    .map((log) => {
      const token0 = topicAddress(log.topics?.[1]);
      const token1 = topicAddress(log.topics?.[2]);
      if (!token0 || !token1) return null;
      if (source.protocolType === "v3") {
        // fee is indexed topic[3]; pool is the last data word (after tickSpacing).
        const feeTier = log.topics?.[3] ? Number(BigInt(log.topics[3])) : undefined;
        const poolAddress = dataWordAddress(log.data, 1);
        if (!poolAddress) return null;
        return { poolAddress, token0, token1, feeTier, protocolType: "v3" };
      }
      // Algebra: pool is the single data word.
      const poolAddress = dataWordAddress(log.data, 0);
      if (!poolAddress) return null;
      return { poolAddress, token0, token1, protocolType: "algebra" };
    })
    .filter(Boolean);
}

async function isPoolLive({ client, pool }) {
  if (pool.protocolType === "v2") {
    const reserves = await safeCall(client, pool.poolAddress, SELECTORS.getReserves);
    if (!reserves) return false;
    return dataWordUint(reserves, 0) > 0n && dataWordUint(reserves, 1) > 0n;
  }
  const liq = await safeCall(client, pool.poolAddress, SELECTORS.liquidity);
  return dataWordUint(liq, 0) > 0n;
}

// For V2, the log/allPairs path gives only the pool address; resolve token0/1.
async function resolvePairTokens({ client, pool }) {
  if (pool.token0 && pool.token1) return pool;
  const [t0, t1] = await Promise.all([
    safeCall(client, pool.poolAddress, "0x0dfe1681"), // token0()
    safeCall(client, pool.poolAddress, "0xd21220a7"), // token1()
  ]);
  return {
    ...pool,
    token0: t0 ? dataWordAddress(t0, 0) : null,
    token1: t1 ? dataWordAddress(t1, 0) : null,
  };
}

// Enumerate the full tradeable-token universe across all venues. Returns a map
// of nonOfficialToken -> { address, venues: Set, bases: Set, pools: [...] },
// limited to tokens that have a LIVE pool paired with a base token.
export async function enumerateTradeableTokens({
  client,
  sources = [],
  baseAddresses = [],
  officialAddresses = [],
  fromBlock = "0x0",
} = {}) {
  const baseSet = new Set(baseAddresses.map((a) => a.toLowerCase()));
  const officialSet = new Set(officialAddresses.map((a) => a.toLowerCase()));

  const perVenue = await Promise.all(
    sources
      .filter((source) => source.factory && source.status !== "disabled")
      .map(async (source) => {
        const raw = await enumeratePoolsFromLogs({ client, source, fromBlock });
        const withTokens = await Promise.all(raw.map((pool) => resolvePairTokens({ client, pool })));
        return withTokens
          .filter((pool) => pool.token0 && pool.token1)
          .map((pool) => ({ ...pool, sourceId: source.sourceId }));
      }),
  );

  const allPools = perVenue.flat();

  // Keep only pools that pair a NON-official token with a base token.
  const relevant = allPools.filter((pool) => {
    const t0 = pool.token0.toLowerCase();
    const t1 = pool.token1.toLowerCase();
    const baseSide = baseSet.has(t0) ? t0 : baseSet.has(t1) ? t1 : null;
    if (!baseSide) return false;
    const other = baseSide === t0 ? t1 : t0;
    return !officialSet.has(other) && !baseSet.has(other);
  });

  // Liquidity-check the relevant pools (bounded concurrency via Promise.all on
  // the already-narrowed set).
  const liveFlags = await Promise.all(relevant.map((pool) => isPoolLive({ client, pool })));

  const tokens = new Map();
  relevant.forEach((pool, i) => {
    if (!liveFlags[i]) return;
    const t0 = pool.token0.toLowerCase();
    const t1 = pool.token1.toLowerCase();
    const baseSide = baseSet.has(t0) ? t0 : t1;
    const other = baseSide === t0 ? t1 : t0;
    const entry = tokens.get(other) ?? { address: other, venues: new Set(), bases: new Set(), pools: [] };
    entry.venues.add(pool.sourceId);
    entry.bases.add(baseSide);
    entry.pools.push({ sourceId: pool.sourceId, poolAddress: pool.poolAddress, base: baseSide });
    tokens.set(other, entry);
  });

  return [...tokens.values()].map((entry) => ({
    address: entry.address,
    venues: [...entry.venues],
    bases: [...entry.bases],
    pools: entry.pools,
  }));
}
