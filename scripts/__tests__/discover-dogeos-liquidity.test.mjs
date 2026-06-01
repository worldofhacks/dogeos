import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_SELECTORS,
  buildOfficialTokenPairs,
  discoverOfficialTokenLiquidity,
} from "../discover-dogeos-liquidity.mjs";

const zeroAddress = "0x0000000000000000000000000000000000000000";
const tokenA = "0x1111111111111111111111111111111111111111";
const tokenB = "0x2222222222222222222222222222222222222222";
const tokenC = "0x3333333333333333333333333333333333333333";
const v2Factory = "0x4444444444444444444444444444444444444444";
const v3Factory = "0x5555555555555555555555555555555555555555";
const algebraFactory = "0x6666666666666666666666666666666666666666";
const router = "0x7777777777777777777777777777777777777777";
const quoter = "0x8888888888888888888888888888888888888888";
const v2Pool = "0x9999999999999999999999999999999999999999";
const v3Pool = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const algebraPool = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const tokens = [
  { symbol: "AAA", address: tokenA, decimals: 18 },
  { symbol: "BBB", address: tokenB, decimals: 18 },
  { symbol: "CCC", address: tokenC, decimals: 18 },
];

function addressWord(address) {
  return address.toLowerCase().slice(2).padStart(64, "0");
}

function encodedAddress(address) {
  return `0x${addressWord(address)}`;
}

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function encodedWords(values) {
  return `0x${values.map(word).join("")}`;
}

function makeDiscoveryClient() {
  return {
    async getChainId() {
      return 6_281_971;
    },
    async call({ to, data }) {
      const target = to.toLowerCase();
      const callData = data.toLowerCase();
      const pairSuffix = `${addressWord(tokenA)}${addressWord(tokenB)}`;

      if (target === v2Factory.toLowerCase() && callData === `${DISCOVERY_SELECTORS.getPair}${pairSuffix}`) {
        return encodedAddress(v2Pool);
      }
      if (target === v3Factory.toLowerCase() && callData === `${DISCOVERY_SELECTORS.getPool}${pairSuffix}${word(500)}`) {
        return encodedAddress(v3Pool);
      }
      if (target === algebraFactory.toLowerCase() && callData === `${DISCOVERY_SELECTORS.poolByPair}${pairSuffix}`) {
        return encodedAddress(algebraPool);
      }
      if (target === v2Pool.toLowerCase() && callData === DISCOVERY_SELECTORS.token0) return encodedAddress(tokenA);
      if (target === v2Pool.toLowerCase() && callData === DISCOVERY_SELECTORS.token1) return encodedAddress(tokenB);
      if (target === v2Pool.toLowerCase() && callData === DISCOVERY_SELECTORS.getReserves) {
        return encodedWords([1000n, 2000n, 1n]);
      }
      if (target === v3Pool.toLowerCase() && callData === DISCOVERY_SELECTORS.token0) return encodedAddress(tokenA);
      if (target === v3Pool.toLowerCase() && callData === DISCOVERY_SELECTORS.token1) return encodedAddress(tokenB);
      if (target === v3Pool.toLowerCase() && callData === DISCOVERY_SELECTORS.liquidity) return encodedWords([3000n]);
      if (target === v3Pool.toLowerCase() && callData === DISCOVERY_SELECTORS.slot0) return encodedWords([4000n]);
      if (target === algebraPool.toLowerCase() && callData === DISCOVERY_SELECTORS.token0) return encodedAddress(tokenA);
      if (target === algebraPool.toLowerCase() && callData === DISCOVERY_SELECTORS.token1) return encodedAddress(tokenB);
      if (target === algebraPool.toLowerCase() && callData === DISCOVERY_SELECTORS.liquidity) return encodedWords([5000n]);
      if (target === algebraPool.toLowerCase() && callData === DISCOVERY_SELECTORS.globalState) {
        return encodedWords([6000n, 0n, 500n]);
      }

      return encodedAddress(zeroAddress);
    },
  };
}

test("buildOfficialTokenPairs enumerates unordered official token pairs", () => {
  assert.deepEqual(
    buildOfficialTokenPairs(tokens).map((pair) => pair.symbolPair),
    ["AAA/BBB", "AAA/CCC", "BBB/CCC"],
  );
});

test("discoverOfficialTokenLiquidity scans v2, v3, and algebra official-token pools", async () => {
  const report = await discoverOfficialTokenLiquidity({
    client: makeDiscoveryClient(),
    includeBlockscout: false,
    feeTiers: [500, 3000],
    tokens,
    sources: [
      { sourceId: "mock-v2", displayName: "Mock V2", protocolType: "v2", factory: v2Factory, router },
      { sourceId: "mock-v3", displayName: "Mock V3", protocolType: "v3", factory: v3Factory, router, quoter },
      {
        sourceId: "mock-algebra",
        displayName: "Mock Algebra",
        protocolType: "algebra",
        factory: algebraFactory,
        router,
        quoter,
      },
    ],
  });

  assert.equal(report.chainId, 6_281_971);
  assert.equal(report.pools.length, 3);
  assert.deepEqual(
    report.pools.map((pool) => `${pool.sourceId}:${pool.protocolType}:${pool.symbolPair}:${pool.address}`).sort(),
    [
      `mock-algebra:algebra:AAA/BBB:${algebraPool.toLowerCase()}`,
      `mock-v2:v2:AAA/BBB:${v2Pool.toLowerCase()}`,
      `mock-v3:v3:AAA/BBB:${v3Pool.toLowerCase()}`,
    ],
  );
  assert.deepEqual(report.unsupportedOfficialPairs, ["AAA/CCC", "BBB/CCC"]);
  assert.deepEqual(report.pairCoverage["AAA/BBB"].sourceIds.sort(), [
    "mock-algebra",
    "mock-v2",
    "mock-v3",
  ]);
  assert.equal(report.pools.find((pool) => pool.sourceId === "mock-v2").reserve0, "1000");
  assert.equal(report.pools.find((pool) => pool.sourceId === "mock-v3").feeTier, 500);
  assert.equal(report.pools.find((pool) => pool.sourceId === "mock-algebra").dynamicFeeTier, "500");
});

test("discoverOfficialTokenLiquidity records Blockscout ABI availability for source contracts", async () => {
  const seenUrls = [];
  const report = await discoverOfficialTokenLiquidity({
    client: makeDiscoveryClient(),
    blockscoutBaseUrl: "https://blockscout.example",
    fetchFn: async (url) => {
      seenUrls.push(String(url));
      return {
        ok: true,
        async json() {
          return {
            status: "0",
            message: "Contract source code not verified",
            result: "Contract source code not verified",
          };
        },
      };
    },
    feeTiers: [500],
    tokens: tokens.slice(0, 2),
    sources: [
      { sourceId: "mock-v3", displayName: "Mock V3", protocolType: "v3", factory: v3Factory, router, quoter },
    ],
  });

  assert.equal(seenUrls.some((url) => url.includes("/api?module=contract&action=getabi")), true);
  assert.deepEqual(
    report.contractAbiStatus.map((contract) => `${contract.sourceId}:${contract.role}:${contract.hasAbi}`),
    [
      "mock-v3:factory:false",
      "mock-v3:router:false",
      "mock-v3:quoter:false",
    ],
  );
  assert.equal(report.contractAbiStatus[0].message, "Contract source code not verified");
});
