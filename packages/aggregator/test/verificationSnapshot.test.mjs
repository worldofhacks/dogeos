import assert from "node:assert/strict";
import test from "node:test";

import { createAdapterAbiArtifact } from "../src/abi/adapterAbiArtifacts.mjs";
import {
  TOKEN_DECIMALS_SELECTOR,
  buildExecutionEvidence,
  classifyVerification,
  createVerificationSnapshotProvider,
  summarizeAbiArtifact,
  summarizeBlockscoutContract,
} from "../src/verification/verificationSnapshot.mjs";

const router = "0x1111111111111111111111111111111111111111";
const factory = "0x2222222222222222222222222222222222222222";
const pool = "0x3333333333333333333333333333333333333333";
const token = {
  symbol: "USDC",
  name: "USD Coin",
  address: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
  decimals: 18,
};
const usdtToken = {
  symbol: "USDT",
  name: "Tether USD",
  address: "0xC81800b77D91391Ef03d7868cB81204E753093a9",
  decimals: 18,
};
const wdoge = "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE";

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressResult(address) {
  return `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
}

function words(...values) {
  return `0x${values.map((value) => word(value)).join("")}`;
}

const v3RouterAbi = [
  {
    type: "function",
    name: "exactInputSingle",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
  },
];

function verificationFetch({
  routerBytecode = "0x6080604052600438ed1739",
  poolBytecode = "0x608060405260040dfe1681d21220a70902f1ac",
  addressPayload = { is_contract: true, is_verified: false },
  smartContractPayload = { status: "success", has_abi: false },
  abiPayload = { message: "Contract source code not verified", result: null, status: "0" },
  poolToken0 = token.address,
  poolToken1 = wdoge,
} = {}) {
  const calls = [];

  return {
    calls,
    fetchFn: async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : null });

      if (init.body) {
        const body = JSON.parse(init.body);
        const rpcResult = (request) => {
          let result;
          if (request.method === "eth_chainId") result = "0x5fdaf3";
          if (request.method === "eth_getCode") {
            if (request.params[0].toLowerCase() === router.toLowerCase()) result = routerBytecode;
            else if (request.params[0].toLowerCase() === pool.toLowerCase()) result = poolBytecode;
            else result = "0x6000";
          }
          if (request.method === "eth_call") {
            const selector = request.params[0].data.slice(0, 10);
            if (selector === "0xc45a0155") result = addressResult(factory);
            if (selector === "0xad5c4648") result = addressResult(wdoge);
            if (selector === TOKEN_DECIMALS_SELECTOR) result = `0x${word(18n)}`;
            if (selector === "0x0dfe1681") result = addressResult(poolToken0);
            if (selector === "0xd21220a7") result = addressResult(poolToken1);
            if (selector === "0x0902f1ac") result = words(1_000_000n, 2_000_000n, 123n);
            if (selector === "0x3850c7bd") result = words(79_228_162_514_264_337_593_543_950_336n, 0n);
            if (selector === "0xe76c01e4") {
              result = words(79_228_162_514_264_337_593_543_950_336n, 0n, 300n);
            }
            if (selector === "0x1a686502") result = words(5_000_000n);
          }
          if (!result) throw new Error(`unexpected RPC call ${request.method}`);
          return result;
        };

        if (Array.isArray(body)) {
          return new Response(
            JSON.stringify(
              body.map((request) => ({
                jsonrpc: "2.0",
                id: request.id,
                result: rpcResult(request),
              })),
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: rpcResult(body) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.includes("/api/v2/addresses/")) {
        return new Response(JSON.stringify(addressPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.includes("/api/v2/smart-contracts/")) {
        return new Response(JSON.stringify(smartContractPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.includes("/api?module=contract&action=getabi&address=")) {
        return new Response(JSON.stringify(abiPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`unexpected URL ${url}`);
    },
  };
}

test("createVerificationSnapshotProvider verifies sources, token decimals, and caches by ttl", async () => {
  const fetcher = verificationFetch();
  let now = 1_000;
  const provider = createVerificationSnapshotProvider({
    fetchFn: fetcher.fetchFn,
    nowMs: () => now,
    cacheTtlMs: 15_000,
    verificationTargets: [
      {
        sourceId: "muchfi-v2",
        protocolType: "v2",
        displayName: "MuchFi V2",
        role: "router",
        address: router,
        abiProvenance: "onchain-bytecode",
        expectedSelectors: ["0x38ed1739"],
        expectedReadChecks: [
          {
            label: "factory()",
            selector: "0xc45a0155",
            expectedAddress: factory,
          },
        ],
      },
    ],
    tokens: [token],
  });

  const first = await provider();
  const callCountAfterFirst = fetcher.calls.length;
  now += 1_000;
  const second = await provider();

  assert.equal(second, first);
  assert.equal(fetcher.calls.length, callCountAfterFirst);
  assert.equal(first.chainId, "0x5fdaf3");
  assert.equal(first.chainMatches, true);
  assert.equal(first.sources[0].sourceId, "muchfi-v2");
  assert.equal(first.sources[0].readChecks[0].matches, true);
  assert.deepEqual(first.sources[0].verification.selectorMatches, ["0x38ed1739"]);
  assert.equal(first.sources[0].blockscoutAbi.status, "0");
  assert.match(first.sources[0].blockscoutAbi.message, /not verified/i);
  assert.match(first.sources[0].blockscoutAbiEndpointUrl, /module=contract&action=getabi/);
  assert.equal(first.sources[0].executionEvidence.abiProof.blockscoutAbiStatus, "0");
  assert.equal(first.tokens[0].symbol, "USDC");
  assert.equal(first.tokens[0].actualDecimals, 18);
  assert.deepEqual(first.summary, {
    chainMatches: true,
    relationshipMismatches: [],
    tokenDecimalMismatches: [],
    poolMismatches: [],
    hasBlockingMismatch: false,
  });
});

test("createVerificationSnapshotProvider batches source and token on-chain verification reads", async () => {
  const fetcher = verificationFetch();
  const provider = createVerificationSnapshotProvider({
    fetchFn: fetcher.fetchFn,
    verificationTargets: [
      {
        sourceId: "muchfi-v2",
        protocolType: "v2",
        displayName: "MuchFi V2",
        role: "router",
        address: router,
        abiProvenance: "onchain-bytecode",
        expectedSelectors: ["0x38ed1739"],
        expectedReadChecks: [
          {
            label: "factory()",
            selector: "0xc45a0155",
            expectedAddress: factory,
          },
          {
            label: "WETH()",
            selector: "0xad5c4648",
            expectedAddress: wdoge,
          },
        ],
      },
      {
        sourceId: "muchfi-v2",
        protocolType: "v2",
        displayName: "MuchFi V2",
        role: "pool",
        address: pool,
        abiProvenance: "onchain-bytecode",
        expectedSelectors: ["0x0902f1ac"],
        expectedPool: {
          pair: "WDOGE/USDC",
          token0: token.address,
          token1: wdoge,
        },
      },
    ],
    tokens: [token, usdtToken],
  });

  const report = await provider();
  const rpcBodies = fetcher.calls.filter((call) => call.body).map((call) => call.body);
  const batches = rpcBodies.filter(Array.isArray);
  const hasBatch = (matcher) => batches.some(matcher);
  const selectors = (batch) => batch.map((request) => request.params?.[0]?.data?.slice(0, 10));

  assert.equal(report.summary.hasBlockingMismatch, false);
  assert.equal(
    hasBatch(
      (batch) =>
        batch.length === 2 &&
        batch.every((request) => request.method === "eth_getCode") &&
        batch.some((request) => request.params[0].toLowerCase() === router.toLowerCase()) &&
        batch.some((request) => request.params[0].toLowerCase() === pool.toLowerCase()),
    ),
    true,
    "source bytecode reads should be batched",
  );
  assert.equal(
    hasBatch(
      (batch) =>
        batch.length === 2 &&
        batch.every((request) => request.method === "eth_getCode") &&
        batch.some((request) => request.params[0].toLowerCase() === token.address.toLowerCase()) &&
        batch.some((request) => request.params[0].toLowerCase() === usdtToken.address.toLowerCase()),
    ),
    true,
    "token bytecode reads should be batched",
  );
  assert.equal(
    hasBatch(
      (batch) =>
        batch.length === 2 &&
        batch.every((request) => request.method === "eth_call") &&
        selectors(batch).every((selector) => selector === TOKEN_DECIMALS_SELECTOR),
    ),
    true,
    "token decimal reads should be batched",
  );
  assert.equal(
    hasBatch(
      (batch) =>
        batch.length === 2 &&
        batch.every((request) => request.method === "eth_call") &&
        selectors(batch).includes("0xc45a0155") &&
        selectors(batch).includes("0xad5c4648"),
    ),
    true,
    "relationship reads should be batched",
  );
  assert.equal(
    hasBatch(
      (batch) =>
        batch.length === 3 &&
        batch.every((request) => request.method === "eth_call") &&
        selectors(batch).includes("0x0dfe1681") &&
        selectors(batch).includes("0xd21220a7") &&
        selectors(batch).includes("0x0902f1ac"),
    ),
    true,
    "pool state reads should be batched",
  );
});

test("createVerificationSnapshotProvider verifies pinned V2 pool token sides and live state", async () => {
  const fetcher = verificationFetch();
  const provider = createVerificationSnapshotProvider({
    fetchFn: fetcher.fetchFn,
    verificationTargets: [
      {
        sourceId: "muchfi-v2",
        protocolType: "v2",
        displayName: "MuchFi V2",
        role: "pool",
        address: pool,
        abiProvenance: "onchain-bytecode",
        expectedSelectors: ["0x0902f1ac"],
        expectedPool: {
          pair: "WDOGE/USDC",
          token0: token.address,
          token1: wdoge,
        },
      },
    ],
    tokens: [],
  });

  const report = await provider();

  assert.equal(report.sources[0].poolStateCheck.matches, true);
  assert.deepEqual(report.sources[0].poolStateCheck, {
    pair: "WDOGE/USDC",
    expectedToken0: token.address.toLowerCase(),
    expectedToken1: wdoge.toLowerCase(),
    actualToken0: token.address.toLowerCase(),
    actualToken1: wdoge.toLowerCase(),
    tokenMatches: true,
    stateSelector: "0x0902f1ac",
    stateKind: "v2-reserves",
    rawState: words(1_000_000n, 2_000_000n, 123n),
    reserve0: "1000000",
    reserve1: "2000000",
    hasLiveLiquidity: true,
    matches: true,
  });
  assert.equal(report.sources[0].executionEvidence.onchainProof.poolStateVerified, true);
  assert.equal(report.sources[0].executionEvidence.onchainProof.poolHasLiveLiquidity, true);
  assert.deepEqual(report.summary.poolMismatches, []);
  assert.equal(report.summary.hasBlockingMismatch, false);
});

test("createVerificationSnapshotProvider verifies pinned V3 pool token sides and live state", async () => {
  const fetcher = verificationFetch({
    poolBytecode: "0x608060405260040dfe1681d21220a73850c7bd1a686502",
  });
  const provider = createVerificationSnapshotProvider({
    fetchFn: fetcher.fetchFn,
    verificationTargets: [
      {
        sourceId: "muchfi-v3",
        protocolType: "v3",
        displayName: "MuchFi V3",
        role: "pool",
        address: pool,
        abiProvenance: "onchain-bytecode",
        expectedSelectors: ["0x3850c7bd", "0x1a686502"],
        expectedPool: {
          pair: "WDOGE/USDC",
          token0: token.address,
          token1: wdoge,
          feeTier: 2500,
        },
      },
    ],
    tokens: [],
  });

  const report = await provider();

  assert.equal(report.sources[0].poolStateCheck.matches, true);
  assert.equal(report.sources[0].poolStateCheck.feeTier, 2500);
  assert.equal(report.sources[0].poolStateCheck.stateKind, "v3-slot0");
  assert.equal(report.sources[0].poolStateCheck.sqrtPriceX96, "79228162514264337593543950336");
  assert.equal(report.sources[0].poolStateCheck.liquidity, "5000000");
  assert.equal(report.sources[0].executionEvidence.onchainProof.poolStateVerified, true);
  assert.equal(report.sources[0].executionEvidence.onchainProof.poolHasLiveLiquidity, true);
});

test("createVerificationSnapshotProvider refreshes after cache expiry", async () => {
  const fetcher = verificationFetch();
  let now = 1_000;
  const provider = createVerificationSnapshotProvider({
    fetchFn: fetcher.fetchFn,
    nowMs: () => now,
    cacheTtlMs: 500,
    verificationTargets: [],
    tokens: [],
  });

  const first = await provider();
  const callCountAfterFirst = fetcher.calls.length;
  now += 501;
  const second = await provider();

  // SWR: the expired call serves the stale report and refreshes in the background.
  assert.equal(second, first);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetcher.calls.length > callCountAfterFirst, true);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("createVerificationSnapshotProvider shares one build across concurrent cold callers (single-flight)", async () => {
  let builds = 0;
  const gate = deferred();
  const provider = createVerificationSnapshotProvider({
    cacheTtlMs: 15_000,
    buildSnapshot: async () => {
      builds += 1;
      return gate.promise;
    },
  });

  const requests = [provider(), provider(), provider()];
  gate.resolve({ checkedAt: "first" });
  const reports = await Promise.all(requests);

  assert.equal(builds, 1, "N concurrent cold requests share exactly one build");
  assert.deepEqual(
    reports.map((report) => report.checkedAt),
    ["first", "first", "first"],
  );
});

test("createVerificationSnapshotProvider serves stale data instantly on expiry while refreshing in background (SWR)", async () => {
  let now = 1_000;
  let builds = 0;
  const gates = [deferred(), deferred()];
  const provider = createVerificationSnapshotProvider({
    cacheTtlMs: 500,
    nowMs: () => now,
    buildSnapshot: async () => {
      const gate = gates[builds];
      builds += 1;
      return gate.promise;
    },
  });

  const coldRequest = provider();
  gates[0].resolve({ checkedAt: "first" });
  const first = await coldRequest;
  assert.equal(first.checkedAt, "first");

  now += 501; // expire the cache; the second build stays UNRESOLVED
  const stale = await provider();
  assert.equal(stale, first, "served the stale report without blocking on the refresh");
  assert.equal(builds, 2, "a background refresh was kicked off");

  const staleAgain = await provider();
  assert.equal(staleAgain, first, "repeat callers keep getting stale data, no extra build");
  assert.equal(builds, 2, "the in-flight refresh is shared, not duplicated");

  gates[1].resolve({ checkedAt: "second" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await provider()).checkedAt, "second", "the finished refresh replaced the cache");
  assert.equal(builds, 2);
});

test("createVerificationSnapshotProvider keeps serving stale data when the background refresh fails, then retries", async () => {
  let now = 1_000;
  let builds = 0;
  const outcomes = [
    () => Promise.resolve({ checkedAt: "first" }),
    () => Promise.reject(new Error("rpc down")),
    () => Promise.resolve({ checkedAt: "third" }),
  ];
  const provider = createVerificationSnapshotProvider({
    cacheTtlMs: 500,
    nowMs: () => now,
    buildSnapshot: () => outcomes[builds++](),
  });

  const first = await provider();
  assert.equal(first.checkedAt, "first");

  now += 501; // expire -> background refresh fails
  const stale = await provider();
  assert.equal(stale, first, "refresh failure does not poison the cache");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(builds, 2, "the failing refresh ran");

  // The latch is not stuck: a later call still serves stale AND retries the build.
  const staleRetry = await provider();
  assert.equal(staleRetry, first);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(builds, 3, "a later call retried the build after the failure");
  assert.equal((await provider()).checkedAt, "third", "the successful retry replaced the cache");
});

test("createVerificationSnapshotProvider uses Blockscout getabi payloads for Blockscout ABI provenance", async () => {
  const fetcher = verificationFetch({
    routerBytecode: "0x6080604052600404e45aaf",
    addressPayload: { is_contract: true, is_verified: true },
    smartContractPayload: { status: "success" },
    abiPayload: {
      message: "OK",
      result: JSON.stringify(v3RouterAbi),
      status: "1",
    },
  });
  const provider = createVerificationSnapshotProvider({
    fetchFn: fetcher.fetchFn,
    verificationTargets: [
      {
        sourceId: "muchfi-v3",
        protocolType: "v3",
        displayName: "MuchFi V3",
        role: "router",
        address: router,
        abiProvenance: "blockscout",
        expectedSelectors: ["0x04e45aaf"],
        expectedAbiFunctions: [
          "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
        ],
      },
    ],
    tokens: [],
  });

  const report = await provider();

  assert.equal(report.sources[0].verification.status, "active");
  assert.equal(report.sources[0].blockscoutContract.hasAbi, true);
  assert.equal(report.sources[0].blockscoutAbi.status, "1");
  assert.deepEqual(report.sources[0].blockscoutAbi.abiFunctionSignatures, [
    "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
  ]);
  assert.equal(report.sources[0].executionEvidence.abiProof.blockscoutAbiStatus, "1");
});

test("summarizeBlockscoutContract extracts canonical function signatures from ABI payloads", () => {
  const summary = summarizeBlockscoutContract({
    status: "success",
    has_abi: true,
    abi: JSON.stringify([
      {
        type: "function",
        name: "exactInputSingle",
        inputs: [
          {
            name: "params",
            type: "tuple",
            components: [
              { name: "tokenIn", type: "address" },
              { name: "tokenOut", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "recipient", type: "address" },
              { name: "amountIn", type: "uint256" },
              { name: "amountOutMinimum", type: "uint256" },
              { name: "sqrtPriceLimitX96", type: "uint160" },
            ],
          },
        ],
      },
      {
        type: "function",
        name: "swapExactTokensForTokens",
        inputs: [
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMin", type: "uint256" },
          { name: "path", type: "address[]" },
          { name: "to", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ]),
  });

  assert.deepEqual(summary.abiFunctionSignatures, [
    "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
    "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
  ]);
});

test("summarizeAbiArtifact validates adapter ABI fragment target, selectors, functions, and hash metadata", () => {
  const artifact = createAdapterAbiArtifact({
    sourceId: "muchfi-v3",
    role: "router",
    address: router,
    selectors: ["0x04e45aaf"],
    abiFunctionSignatures: [
      "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
    ],
    abi: v3RouterAbi,
  });
  const summary = summarizeAbiArtifact({
    sourceId: "muchfi-v3",
    role: "router",
    address: router,
    expectedSelectors: ["0x04e45aaf"],
    expectedAbiFunctions: [
      "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
    ],
    abiArtifact: artifact,
  });

  assert.equal(summary.kind, "adapter-fragment");
  assert.equal(summary.matchesTarget, true);
  assert.equal(summary.verified, true);
  assert.equal(summary.artifactHashMatches, true);
  assert.equal(summary.computedArtifactHash, artifact.artifactHash);
  assert.deepEqual(summary.selectorMatches, ["0x04e45aaf"]);
  assert.deepEqual(summary.abiFunctionMatches, [
    "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
  ]);
});

test("summarizeAbiArtifact rejects ABI artifacts whose hash does not match the payload", () => {
  const artifact = createAdapterAbiArtifact({
    sourceId: "muchfi-v3",
    role: "router",
    address: router,
    selectors: ["0x04e45aaf"],
    abiFunctionSignatures: [
      "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
    ],
    abi: v3RouterAbi,
  });
  const summary = summarizeAbiArtifact({
    sourceId: "muchfi-v3",
    role: "router",
    address: router,
    expectedSelectors: ["0x04e45aaf"],
    expectedAbiFunctions: [
      "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
    ],
    abiArtifact: {
      ...artifact,
      artifactHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  });

  assert.equal(summary.matchesTarget, true);
  assert.equal(summary.artifactHashMatches, false);
  assert.equal(summary.computedArtifactHash, artifact.artifactHash);
  assert.equal(summary.verified, false);
});

test("buildExecutionEvidence makes ABI, Blockscout, selector, and relationship proof explicit", () => {
  const evidence = buildExecutionEvidence({
    source: {
      abiProvenance: "adapter-fragment",
    },
    blockscoutUrl: "https://blockscout.testnet.dogeos.com/api/v2/addresses/0x1111111111111111111111111111111111111111",
    blockscoutSmartContractUrl:
      "https://blockscout.testnet.dogeos.com/api/v2/smart-contracts/0x1111111111111111111111111111111111111111",
    blockscoutContract: {
      name: "SwapRouter",
      hasAbi: false,
    },
    abiArtifact: {
      kind: "adapter-fragment",
      verified: true,
      artifactHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceUri: "packages/aggregator/src/abi/adapterAbiArtifacts.mjs",
      selectorMatches: ["0x04e45aaf"],
      missingSelectors: [],
      abiFunctionMatches: [
        "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
      ],
      missingAbiFunctions: [],
    },
    readChecks: [
      {
        label: "factory()",
        matches: true,
      },
      {
        label: "WETH9()",
        matches: true,
      },
    ],
    bytecodeSizeBytes: 24_316,
    verification: {
      status: "active",
      reason: "Router passed bytecode, adapter ABI fragment, selector, and relationship checks.",
      hasBytecode: true,
      hasAdapterAbiArtifact: true,
      hasVenueAbiArtifact: false,
      isBlockscoutContract: true,
      isBlockscoutVerified: false,
      isBlockscoutAbiAvailable: false,
      selectorMatches: ["0x04e45aaf"],
    },
  });

  assert.deepEqual(evidence, {
    status: "active",
    executable: true,
    reason: "Router passed bytecode, adapter ABI fragment, selector, and relationship checks.",
    abiProof: {
      provenance: "adapter-fragment",
      blockscoutAbiAvailable: false,
      adapterAbiArtifactVerified: true,
      venueAbiArtifactVerified: false,
      artifactKind: "adapter-fragment",
      artifactHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      artifactHashMatches: null,
      artifactSourceUri: "packages/aggregator/src/abi/adapterAbiArtifacts.mjs",
      missingSelectors: [],
      missingAbiFunctions: [],
    },
    onchainProof: {
      bytecodePresent: true,
      bytecodeSizeBytes: 24_316,
      selectorMatches: ["0x04e45aaf"],
      readChecksPassed: 2,
      readChecksTotal: 2,
      readCheckLabels: ["factory()", "WETH9()"],
    },
    blockscout: {
      addressUrl: "https://blockscout.testnet.dogeos.com/api/v2/addresses/0x1111111111111111111111111111111111111111",
      smartContractUrl:
        "https://blockscout.testnet.dogeos.com/api/v2/smart-contracts/0x1111111111111111111111111111111111111111",
      contractListed: true,
      sourceVerified: false,
      abiAvailable: false,
      contractName: "SwapRouter",
    },
  });
});

test("classifyVerification keeps Blockscout routers below active when ABI functions are missing", () => {
  const status = classifyVerification({
    role: "router",
    bytecode: "0x608060405260043610806304e45aaf1461029157",
    blockscout: { is_contract: true, is_verified: true },
    blockscoutContract: summarizeBlockscoutContract({
      status: "success",
      has_abi: true,
      abi: JSON.stringify([{ type: "function", name: "wrongRouterMethod", inputs: [] }]),
    }),
    abiProvenance: "blockscout",
    expectedSelectors: ["0x04e45aaf"],
    expectedAbiFunctions: [
      "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
    ],
  });

  assert.equal(status.status, "simulationOnly");
  assert.deepEqual(status.blockscoutAbiFunctionMatches, []);
  assert.match(status.reason, /ABI payload/i);
});
