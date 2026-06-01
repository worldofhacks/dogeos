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
const token = {
  symbol: "USDC",
  name: "USD Coin",
  address: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
  decimals: 18,
};

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressResult(address) {
  return `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
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
  addressPayload = { is_contract: true, is_verified: false },
  smartContractPayload = { status: "success", has_abi: false },
  abiPayload = { message: "Contract source code not verified", result: null, status: "0" },
} = {}) {
  const calls = [];

  return {
    calls,
    fetchFn: async (url, init = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : null });

      if (init.body) {
        const body = JSON.parse(init.body);
        let result;
        if (body.method === "eth_chainId") result = "0x5fdaf3";
        if (body.method === "eth_getCode") {
          result = body.params[0].toLowerCase() === router.toLowerCase() ? routerBytecode : "0x6000";
        }
        if (body.method === "eth_call") {
          const selector = body.params[0].data.slice(0, 10);
          if (selector === "0xc45a0155") result = addressResult(factory);
          if (selector === TOKEN_DECIMALS_SELECTOR) result = `0x${word(18n)}`;
        }
        if (!result) throw new Error(`unexpected RPC call ${body.method}`);

        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
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
    hasBlockingMismatch: false,
  });
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

  await provider();
  const callCountAfterFirst = fetcher.calls.length;
  now += 501;
  await provider();

  assert.equal(fetcher.calls.length > callCountAfterFirst, true);
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
