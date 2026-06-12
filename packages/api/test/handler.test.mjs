import assert from "node:assert/strict";
import test from "node:test";

import { DOGEOS_CHAIN } from "../../config/src/chains.mjs";
import { OFFICIAL_DOGEOS_TOKENS } from "../../config/src/tokens.mjs";
import { createAggregatorApiHandler } from "../src/handler.mjs";

const now = 1_780_000_000_000;
const [wdoge, , , , usdc] = OFFICIAL_DOGEOS_TOKENS;

function jsonRequest(path, body) {
  return new Request(`https://aggregator.local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function candidate(overrides = {}) {
  return {
    routeType: "direct",
    sourceId: "muchfi-v3",
    status: "active",
    chainId: DOGEOS_CHAIN.id,
    sellToken: usdc.address,
    buyToken: wdoge.address,
    amountIn: 1_000_000n,
    amountOut: 1_050_000n,
    gasUnits: 120_000n,
    dataFinalityFeeWei: 5_000n,
    failurePenalty: 0n,
    blockNumber: 5_200_000n,
    quoteTimestampMs: now,
    ttlMs: 5_000,
    warnings: [],
    ...overrides,
  };
}

test("GET /sources and /tokens expose UI metadata without executable custom venue surfaces", async () => {
  const handle = createAggregatorApiHandler({ nowMs: () => now });

  const sourcesResponse = await handle(new Request("https://aggregator.local/sources"));
  const sourcesBody = await sourcesResponse.json();

  assert.equal(sourcesResponse.status, 200);
  assert.equal(sourcesBody.chainId, DOGEOS_CHAIN.id);
  assert.equal(sourcesBody.data.every((source) => source.ownership === "external"), true);
  assert.equal(sourcesBody.data.some((source) => source.sourceId === "muchfi-v3"), true);

  const tokensResponse = await handle(new Request("https://aggregator.local/tokens"));
  const tokensBody = await tokensResponse.json();

  assert.equal(tokensResponse.status, 200);
  assert.deepEqual(
    tokensBody.data.map((token) => [token.symbol, token.decimals]),
    [
      ["WDOGE", 18],
      ["LBTC", 18],
      ["WETH", 18],
      ["USD1", 18],
      ["USDC", 18],
      ["USDT", 18],
    ],
  );
});

test("GET /chain-status exposes DogeOS RPC, gas, block, and fee-oracle metadata", async () => {
  let providerCalled = false;
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    chainStatusProvider: async () => {
      providerCalled = true;
      return {
        checkedAt: "2026-06-06T18:00:00.000Z",
        live: true,
        status: "live",
        chainId: DOGEOS_CHAIN.id,
        expectedChainId: DOGEOS_CHAIN.id,
        chainMatches: true,
        blockNumber: 5_348_657n,
        gasPriceWei: 1_250_000_000n,
        dataFinalityFeeWei: 456_000_000_000n,
        dataFinalityFeeSample: "v2-swap-payload",
        nativeCurrency: DOGEOS_CHAIN.nativeCurrency,
        rpcUrl: DOGEOS_CHAIN.rpcUrls[0],
        blockscoutBaseUrl: DOGEOS_CHAIN.blockscoutBaseUrl,
        docsUrl: DOGEOS_CHAIN.docsUrl,
        faucetUrl: DOGEOS_CHAIN.faucetUrl,
        l1GasPriceOracle: DOGEOS_CHAIN.l1GasPriceOracle,
        documentedMaxReorgDepth: DOGEOS_CHAIN.documentedMaxReorgDepth,
      };
    },
  });

  const response = await handle(new Request("https://aggregator.local/chain-status"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(providerCalled, true);
  assert.equal(body.chainId, DOGEOS_CHAIN.id);
  assert.equal(body.data.chainMatches, true);
  assert.equal(body.data.blockNumber, "5348657");
  assert.equal(body.data.gasPriceWei, "1250000000");
  assert.equal(body.data.dataFinalityFeeWei, "456000000000");
  assert.equal(body.data.nativeCurrency.symbol, "DOGE");
  assert.equal(body.data.rpcUrl, "https://rpc.testnet.dogeos.com");
  assert.equal(body.data.blockscoutBaseUrl, "https://blockscout.testnet.dogeos.com");
  assert.equal(body.data.l1GasPriceOracle, DOGEOS_CHAIN.l1GasPriceOracle);
  assert.equal(body.data.documentedMaxReorgDepth, 17);
});

test("GET /verification exposes router and token provenance snapshots without quote work", async () => {
  let quoteProviderCalled = false;
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    quoteCandidateProvider: async () => {
      quoteProviderCalled = true;
      return [];
    },
    verificationSnapshotProvider: async () => ({
      checkedAt: "2026-05-31T00:00:00.000Z",
      expectedChainId: "0x5fdaf3",
      summary: {
        chainMatches: true,
        relationshipMismatches: [],
        tokenDecimalMismatches: [],
        hasBlockingMismatch: false,
      },
      tokens: [
        {
          symbol: "USDC",
          address: usdc.address,
          expectedDecimals: 18,
          actualDecimals: 18,
          matches: true,
        },
      ],
      sources: [
        {
          sourceId: "muchfi-v3",
          role: "router",
          address: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
          blockscoutUrl:
            "https://blockscout.testnet.dogeos.com/api/v2/addresses/0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
          blockscoutContract: {
            hasAbi: false,
          },
          readChecks: [
            {
              label: "factory()",
              matches: true,
            },
          ],
          verification: {
            status: "readOnly",
            isBlockscoutAbiAvailable: false,
          },
        },
      ],
    }),
  });

  const response = await handle(new Request("https://aggregator.local/verification"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(quoteProviderCalled, false);
  assert.equal(body.chainId, DOGEOS_CHAIN.id);
  assert.equal(body.data.expectedChainId, "0x5fdaf3");
  assert.equal(body.data.summary.hasBlockingMismatch, false);
  assert.equal(body.data.tokens[0].symbol, "USDC");
  assert.equal(body.data.sources[0].sourceId, "muchfi-v3");
  assert.equal(body.data.sources[0].verification.status, "readOnly");
});

test("GET /venues exposes contract addresses with Blockscout and adapter ABI provenance without quote work", async () => {
  let quoteProviderCalled = false;
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    quoteCandidateProvider: async () => {
      quoteProviderCalled = true;
      return [];
    },
    verificationSnapshotProvider: async () => ({
      checkedAt: "2026-05-31T00:00:00.000Z",
      sources: [
        {
          sourceId: "muchfi-v3",
          role: "router",
          address: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
          blockscoutSmartContractUrl:
            "https://blockscout.testnet.dogeos.com/api/v2/smart-contracts/0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
          blockscoutAbiEndpointUrl:
            "https://blockscout.testnet.dogeos.com/api?module=contract&action=getabi&address=0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
          blockscoutAbi: {
            status: "0",
            message: "Contract source code not verified",
            hasAbi: false,
            abiFunctionSignatures: [],
          },
          readChecks: [{ label: "factory()", matches: true }],
          verification: {
            status: "active",
            hasBytecode: true,
            hasAdapterAbiArtifact: true,
            isBlockscoutAbiAvailable: false,
            selectorMatches: ["0x04e45aaf", "0x5023b4df"],
            reason: "Router passed bytecode, adapter ABI fragment, selector, and relationship checks.",
          },
          executionEvidence: {
            status: "active",
            executable: true,
            abiProof: {
              provenance: "adapter-fragment",
              adapterAbiArtifactVerified: true,
              blockscoutAbiAvailable: false,
              artifactHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
            onchainProof: {
              bytecodePresent: true,
              selectorMatches: ["0x04e45aaf", "0x5023b4df"],
              readChecksPassed: 1,
              readChecksTotal: 1,
            },
            blockscout: {
              abiAvailable: false,
            },
          },
          abiArtifact: {
            kind: "adapter-fragment",
            status: "verified",
            issuer: "dogeos-aggregator-adapter",
            sourceUri: "packages/aggregator/src/abi/adapterAbiArtifacts.mjs",
            artifactHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            matchesTarget: true,
            selectorMatches: ["0x04e45aaf", "0x5023b4df"],
            verified: true,
          },
        },
      ],
    }),
  });

  const response = await handle(new Request("https://aggregator.local/venues"));
  const body = await response.json();
  const muchFiV3 = body.data.find((venue) => venue.sourceId === "muchfi-v3");
  const router = muchFiV3.contracts.find((contract) => contract.role === "router");

  assert.equal(response.status, 200);
  assert.equal(quoteProviderCalled, false);
  assert.equal(body.chainId, DOGEOS_CHAIN.id);
  assert.equal(body.checkedAt, "2026-05-31T00:00:00.000Z");
  assert.equal(muchFiV3.protocolType, "v3");
  assert.equal(muchFiV3.execution.enabled, true);
  assert.equal(router.address, "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB");
  assert.equal(router.abiProvenance, "adapter-fragment");
  assert.equal(router.blockscoutSmartContractUrl.endsWith(router.address), true);
  assert.match(router.blockscoutAbiEndpointUrl, /module=contract&action=getabi/);
  assert.equal(router.blockscoutAbi.status, "0");
  assert.match(router.blockscoutAbi.message, /not verified/i);
  assert.equal(router.verification.isBlockscoutAbiAvailable, false);
  assert.equal(router.verification.hasAdapterAbiArtifact, true);
  assert.deepEqual(router.verification.selectorMatches, ["0x04e45aaf", "0x5023b4df"]);
  assert.equal(router.abiArtifact.issuer, "dogeos-aggregator-adapter");
  assert.equal(router.abiArtifact.verified, true);
  assert.deepEqual(router.readChecks, [{ label: "factory()", matches: true }]);
  assert.equal(router.executionEvidence.executable, true);
  assert.equal(router.executionEvidence.abiProof.provenance, "adapter-fragment");
  assert.equal(router.executionEvidence.abiProof.adapterAbiArtifactVerified, true);
  assert.equal(router.executionEvidence.blockscout.abiAvailable, false);
});

test("GET /intelligence exposes venue classes and rejected non-spot surfaces without quote work", async () => {
  let quoteProviderCalled = false;
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    quoteCandidateProvider: async () => {
      quoteProviderCalled = true;
      return [];
    },
    verificationSnapshotProvider: async () => ({
      checkedAt: "2026-06-02T03:28:16.161Z",
      sources: [
        {
          sourceId: "muchfi-v2",
          role: "router",
          address: "0xC653e745FC613a03D156DACB924AE8e9148B18dc",
          executionEvidence: {
            executable: true,
            abiProof: {
              provenance: "adapter-fragment",
              adapterAbiArtifactVerified: true,
            },
          },
        },
        {
          sourceId: "muchfi-v2",
          role: "pool",
          address: "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
          executionEvidence: {
            onchainProof: {
              poolPair: "WDOGE/USDC",
              poolHasLiveLiquidity: true,
            },
          },
        },
      ],
    }),
  });

  const response = await handle(new Request("https://aggregator.local/intelligence"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(quoteProviderCalled, false);
  assert.equal(body.chainId, DOGEOS_CHAIN.id);
  assert.equal(body.checkedAt, "2026-06-02T03:28:16.161Z");
  assert.equal(body.data.summary.activeExecutable, 3);
  assert.equal(body.data.summary.watchlist, 2);
  assert.equal(body.data.activeExecutable.some((source) => source.sourceId === "muchfi-v2"), true);
  assert.equal(
    body.data.activeExecutable.find((source) => source.sourceId === "muchfi-v2")
      .contracts.executableRouters,
    1,
  );
  assert.equal(
    body.data.activeExecutable.find((source) => source.sourceId === "muchfi-v2")
      .liquidity.livePoolCount,
    1,
  );
  assert.equal(body.data.rejectedSurfaces.some((surface) => surface.surfaceId === "derps-perps"), true);
});

test("GET /activity exposes connected wallet DogeOS Blockscout transaction history", async () => {
  let activityInput;
  const walletAddress = "0x1111111111111111111111111111111111111111";
  const txHash = "0x206aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2907";
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    activityProvider: async (input) => {
      activityInput = input;
      return {
        items: [
          {
            hash: txHash,
            status: "ok",
            method: "swapExactTokensForTokens",
            block_number: 5_348_657,
            timestamp: "2026-06-03T19:15:00.000000Z",
            from: { hash: walletAddress },
            to: { hash: "0xC653e745FC613a03D156DACB924AE8e9148B18dc" },
          },
        ],
        nextPageParams: null,
        sourceUrl: `https://blockscout.testnet.dogeos.com/api/v2/addresses/${walletAddress}/transactions`,
      };
    },
  });

  const response = await handle(new Request(`https://aggregator.local/activity?address=${walletAddress}`));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(activityInput.address, walletAddress);
  assert.equal(activityInput.limit, 20);
  assert.equal(body.chainId, DOGEOS_CHAIN.id);
  assert.equal(body.address, walletAddress);
  assert.equal(body.source, "blockscout");
  assert.equal(body.blockscoutUrl.endsWith(`/addresses/${walletAddress}/transactions`), true);
  assert.equal(body.data[0].hash, txHash);
  assert.equal(body.data[0].method, "swapExactTokensForTokens");
});

test("GET /activity rejects malformed wallet addresses before Blockscout work", async () => {
  let providerCalled = false;
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    activityProvider: async () => {
      providerCalled = true;
      return { items: [] };
    },
  });

  const response = await handle(new Request("https://aggregator.local/activity?address=not-a-wallet"));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "invalid-activity-request");
  assert.equal(providerCalled, false);
});

test("POST /quote returns gas-aware quote responses with bigint values serialized as strings", async () => {
  let providerInput;
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    gasPriceWei: () => 1n,
    outputWeiPerFeeWei: () => 1n,
    quoteCandidateProvider: async (input) => {
      providerInput = input;
      return [
        candidate({ sourceId: "muchfi-v2", amountOut: 1_000_000n, gasUnits: 100_000n }),
        candidate(),
      ];
    },
  });

  const response = await handle(
    jsonRequest("/quote", {
      chainId: DOGEOS_CHAIN.id,
      sellToken: usdc.address,
      buyToken: wdoge.address,
      amountIn: "1000000",
      slippageBps: "50",
      includeSources: ["muchfi-v2", "muchfi-v3"],
      excludeSources: [],
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(providerInput.amountIn, 1_000_000n);
  assert.deepEqual(providerInput.includeSources, ["muchfi-v2", "muchfi-v3"]);
  assert.equal(body.status, "ok");
  assert.equal(body.best.sourceId, "muchfi-v3");
  assert.equal(body.best.amountOut, "1050000");
  assert.equal(body.best.minimumOutput, "1044750");
  assert.equal(body.best.minAmountOut, "1044750");
  assert.deepEqual(body.best.feeEstimate, {
    executionFeeWei: "120000",
    dataFinalityFeeWei: "5000",
    totalFeeWei: "125000",
  });
  assert.equal(body.best.score.netOutput, "925000");
  assert.deepEqual(body.alternatives[0].feeEstimate, {
    executionFeeWei: "100000",
    dataFinalityFeeWei: "5000",
    totalFeeWei: "105000",
  });
  assert.equal(body.expiresAtMs, now + 5_000);
});

test("POST /quote returns timing telemetry for speed monitoring", async () => {
  const timingMarks = [10, 12, 20, 25, 30];
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    timingNowMs: () => timingMarks.shift(),
    preQuoteVerifier: async () => {},
    gasPriceWei: () => 1n,
    outputWeiPerFeeWei: () => 1n,
    quoteCandidateProvider: async () => [candidate()],
  });

  const response = await handle(
    jsonRequest("/quote", {
      chainId: DOGEOS_CHAIN.id,
      sellToken: usdc.address,
      buyToken: wdoge.address,
      amountIn: "1000000",
      slippageBps: "50",
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.telemetry, {
    quoteLatencyMs: 20,
    preQuoteVerificationMs: 2,
    candidateProviderMs: 8,
    feeResolutionMs: 5,
    routeScoringMs: 5,
    candidateCount: 1,
    executableCandidateCount: 1,
    rejectedCandidateCount: 0,
    sourceErrorCount: 0,
    sourceErrors: [],
  });
});

test("POST /quote resolves independent scoring providers while quote candidates are in flight", async () => {
  let releaseCandidates;
  let candidateProviderStarted;
  const candidateProviderStartedPromise = new Promise((resolve) => {
    candidateProviderStarted = resolve;
  });
  let gasPriceStarted = false;
  let outputFeeStarted = false;
  let inputFeeStarted = false;
  let nowStarted = false;
  const handle = createAggregatorApiHandler({
    nowMs: async () => {
      nowStarted = true;
      return now;
    },
    gasPriceWei: async () => {
      gasPriceStarted = true;
      return 1n;
    },
    outputWeiPerFeeWei: async () => {
      outputFeeStarted = true;
      return 1n;
    },
    inputWeiPerFeeWei: async () => {
      inputFeeStarted = true;
      return 1n;
    },
    quoteCandidateProvider: async () => {
      candidateProviderStarted();
      await new Promise((resolve) => {
        releaseCandidates = resolve;
      });
      return [candidate()];
    },
  });

  const responsePromise = handle(
    jsonRequest("/quote", {
      chainId: DOGEOS_CHAIN.id,
      sellToken: usdc.address,
      buyToken: wdoge.address,
      amountIn: "1000000",
      slippageBps: "50",
    }),
  );

  await candidateProviderStartedPromise;
  await Promise.resolve();

  assert.equal(nowStarted, true);
  assert.equal(gasPriceStarted, true);
  assert.equal(outputFeeStarted, true);
  assert.equal(inputFeeStarted, true);

  releaseCandidates();
  const response = await responsePromise;
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
});

test("POST /quote coalesces identical in-flight quote work", async () => {
  let releaseCandidates;
  let providerCalls = 0;
  let markProviderStarted;
  const providerStarted = new Promise((resolve) => {
    markProviderStarted = resolve;
  });
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    gasPriceWei: () => 1n,
    outputWeiPerFeeWei: () => 1n,
    quoteCandidateProvider: async (input) => {
      providerCalls += 1;
      if (providerCalls === 1) markProviderStarted();
      input.quoteDiagnostics.push({
        type: "source-error",
        sourceId: "barkswap-algebra",
        protocolType: "algebra",
        message: "coalesced diagnostic",
      });
      if (providerCalls === 1) {
        await new Promise((release) => {
          releaseCandidates = release;
        });
      }
      return [candidate()];
    },
  });
  const requestBody = {
    chainId: DOGEOS_CHAIN.id,
    sellToken: usdc.address,
    buyToken: wdoge.address,
    amountIn: "1000000",
    slippageBps: "50",
    includeSources: ["muchfi-v3"],
    excludeSources: [],
  };
  const firstResponsePromise = handle(jsonRequest("/quote", requestBody));
  const secondResponsePromise = handle(jsonRequest("/quote", requestBody));

  await providerStarted;
  await Promise.resolve();
  assert.equal(providerCalls, 1);

  releaseCandidates();
  const [firstResponse, secondResponse] = await Promise.all([
    firstResponsePromise,
    secondResponsePromise,
  ]);
  const [firstBody, secondBody] = await Promise.all([
    firstResponse.json(),
    secondResponse.json(),
  ]);

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(providerCalls, 1);
  assert.equal(firstBody.status, "ok");
  assert.deepEqual(secondBody.best, firstBody.best);
  assert.deepEqual(secondBody.telemetry.sourceErrors, [
    {
      type: "source-error",
      sourceId: "barkswap-algebra",
      protocolType: "algebra",
      message: "coalesced diagnostic",
    },
  ]);
});

test("POST /quote reuses in-flight candidate work across slippage-only changes", async () => {
  let releaseCandidates;
  let providerCalls = 0;
  let markProviderStarted;
  const providerStarted = new Promise((resolve) => {
    markProviderStarted = resolve;
  });
  let markSecondVerifierCompleted;
  const secondVerifierCompleted = new Promise((resolve) => {
    markSecondVerifierCompleted = resolve;
  });
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    preQuoteVerifier: async (input) => {
      if (input.slippageBps === 100n) markSecondVerifierCompleted();
    },
    gasPriceWei: () => 1n,
    outputWeiPerFeeWei: () => 0n,
    quoteCandidateProvider: async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        markProviderStarted();
        await new Promise((release) => {
          releaseCandidates = release;
        });
      }
      return [candidate()];
    },
  });
  const baseRequestBody = {
    chainId: DOGEOS_CHAIN.id,
    sellToken: usdc.address,
    buyToken: wdoge.address,
    amountIn: "1000000",
    includeSources: ["muchfi-v3"],
    excludeSources: [],
  };

  const firstResponsePromise = handle(
    jsonRequest("/quote", {
      ...baseRequestBody,
      slippageBps: "50",
    }),
  );
  await providerStarted;
  const secondResponsePromise = handle(
    jsonRequest("/quote", {
      ...baseRequestBody,
      slippageBps: "100",
    }),
  );
  await secondVerifierCompleted;
  await Promise.resolve();

  assert.equal(providerCalls, 1);

  releaseCandidates();
  const [firstResponse, secondResponse] = await Promise.all([
    firstResponsePromise,
    secondResponsePromise,
  ]);
  const [firstBody, secondBody] = await Promise.all([
    firstResponse.json(),
    secondResponse.json(),
  ]);

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(providerCalls, 1);
  assert.equal(firstBody.best.minAmountOut, "1044750");
  assert.equal(secondBody.best.minAmountOut, "1039500");
});

test("POST /quote reuses in-flight candidate work across source-list ordering changes", async () => {
  let releaseCandidates;
  let providerCalls = 0;
  let markProviderStarted;
  const providerStarted = new Promise((resolve) => {
    markProviderStarted = resolve;
  });
  let markSecondVerifierCompleted;
  const secondVerifierCompleted = new Promise((resolve) => {
    markSecondVerifierCompleted = resolve;
  });
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    preQuoteVerifier: async (input) => {
      if (input.includeSources[0] === "muchfi-v2") markSecondVerifierCompleted();
    },
    gasPriceWei: () => 1n,
    outputWeiPerFeeWei: () => 0n,
    quoteCandidateProvider: async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        markProviderStarted();
        await new Promise((release) => {
          releaseCandidates = release;
        });
      }
      return [
        candidate({
          sourceId: "muchfi-v2",
          amountOut: 1_040_000n,
        }),
        candidate(),
      ];
    },
  });
  const baseRequestBody = {
    chainId: DOGEOS_CHAIN.id,
    sellToken: usdc.address,
    buyToken: wdoge.address,
    amountIn: "1000000",
    slippageBps: "50",
    excludeSources: [],
  };

  const firstResponsePromise = handle(
    jsonRequest("/quote", {
      ...baseRequestBody,
      includeSources: ["muchfi-v3", "muchfi-v2"],
    }),
  );
  await providerStarted;
  const secondResponsePromise = handle(
    jsonRequest("/quote", {
      ...baseRequestBody,
      includeSources: ["muchfi-v2", "muchfi-v3"],
    }),
  );
  await secondVerifierCompleted;
  await Promise.resolve();

  assert.equal(providerCalls, 1);

  releaseCandidates();
  const [firstResponse, secondResponse] = await Promise.all([
    firstResponsePromise,
    secondResponsePromise,
  ]);
  const [firstBody, secondBody] = await Promise.all([
    firstResponse.json(),
    secondResponse.json(),
  ]);

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(providerCalls, 1);
  assert.equal(firstBody.best.sourceId, "muchfi-v3");
  assert.deepEqual(secondBody.alternatives.map((route) => route.sourceId), ["muchfi-v2"]);
});

test("POST /quote exposes per-request source diagnostics from live providers", async () => {
  let providerInput;
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    gasPriceWei: () => 1n,
    outputWeiPerFeeWei: () => 1n,
    quoteCandidateProvider: async (input) => {
      providerInput = input;
      input.quoteDiagnostics.push({
        type: "source-error",
        sourceId: "barkswap-algebra",
        protocolType: "algebra",
        message: "Source barkswap-algebra timed out after 1000ms.",
      });
      return [candidate()];
    },
  });

  const response = await handle(
    jsonRequest("/quote", {
      chainId: DOGEOS_CHAIN.id,
      sellToken: usdc.address,
      buyToken: wdoge.address,
      amountIn: "1000000",
      slippageBps: "50",
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(Array.isArray(providerInput.quoteDiagnostics), true);
  assert.equal(body.status, "ok");
  assert.equal(body.telemetry.sourceErrorCount, 1);
  assert.deepEqual(body.telemetry.sourceErrors, [
    {
      type: "source-error",
      sourceId: "barkswap-algebra",
      protocolType: "algebra",
      message: "Source barkswap-algebra timed out after 1000ms.",
    },
  ]);
});

test("POST /quote accepts exact-output requests", async () => {
  let providerInput;
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    gasPriceWei: () => 1n,
    outputWeiPerFeeWei: () => 1n,
    quoteCandidateProvider: async (input) => {
      providerInput = input;
      return [
        candidate({
          quoteMode: "exactOutput",
          sourceId: "muchfi-v2",
          amountIn: 1_050_000n,
          amountOut: input.amountOut,
          gasUnits: 100_000n,
          dataFinalityFeeWei: 1_000n,
        }),
        candidate({
          quoteMode: "exactOutput",
          sourceId: "muchfi-v3",
          amountIn: 1_000_000n,
          amountOut: input.amountOut,
          gasUnits: 120_000n,
          dataFinalityFeeWei: 5_000n,
        }),
      ];
    },
  });

  const response = await handle(
    jsonRequest("/quote", {
      quoteMode: "exactOutput",
      chainId: DOGEOS_CHAIN.id,
      sellToken: usdc.address,
      buyToken: wdoge.address,
      amountOut: "1000000",
      slippageBps: "50",
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(providerInput.quoteMode, "exactOutput");
  assert.equal(providerInput.amountOut, 1_000_000n);
  assert.equal(body.status, "ok");
  assert.equal(body.best.sourceId, "muchfi-v3");
  assert.equal(body.best.amountIn, "1000000");
  assert.equal(body.best.maxAmountIn, "1005000");
  assert.equal(body.best.score.totalInput, "1125000");
});

test("POST /quote rejects wrong-chain requests before provider work", async () => {
  let providerCalled = false;
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    quoteCandidateProvider: async () => {
      providerCalled = true;
      return [];
    },
  });

  const response = await handle(
    jsonRequest("/quote", {
      chainId: 1,
      sellToken: usdc.address,
      buyToken: wdoge.address,
      amountIn: "1000000",
      slippageBps: "50",
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(providerCalled, false);
  assert.equal(body.error.code, "wrong-chain");
});

test("POST /approval derives exact-output approval bounds from the quote before swap building", async () => {
  let plannerInput;
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    approvalPlanner: async (input) => {
      plannerInput = input;
      return {
        approvalRequired: true,
        allowance: 5n,
        transaction: {
          to: input.token,
          data: "0x095ea7b3",
          value: 0n,
        },
      };
    },
  });

  const response = await handle(
    jsonRequest("/approval", {
      owner: "0x2222222222222222222222222222222222222222",
      quote: {
        quoteMode: "exactOutput",
        sourceId: "muchfi-v3",
        protocolType: "v3",
        status: "active",
        chainId: DOGEOS_CHAIN.id,
        router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
        sellToken: usdc.address,
        buyToken: wdoge.address,
        amountIn: "1000000",
        amountOut: "900000",
        maxAmountIn: "1050000",
        recipient: "0x1111111111111111111111111111111111111111",
        deadline: 1_780_000_300,
        quoteTimestampMs: now,
        ttlMs: 10_000,
      },
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(plannerInput.token, usdc.address);
  assert.equal(plannerInput.owner, "0x2222222222222222222222222222222222222222");
  assert.equal(plannerInput.spender, "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB");
  assert.equal(plannerInput.amount, 1_050_000n);
  // The planner also receives the refreshed quote so it can branch on source
  // (Permit2 for the split router vs direct ERC-20 for single venues).
  assert.equal(plannerInput.quote.sourceId, "muchfi-v3");
  assert.equal(body.approvalRequired, true);
  assert.equal(body.allowance, "5");
  assert.deepEqual(body.transaction, {
    to: usdc.address,
    data: "0x095ea7b3",
    value: "0",
  });
});

function exactOutputRefreshHandle({ refreshedAmountIn, onPlan, onQuoteInput }) {
  return createAggregatorApiHandler({
    nowMs: () => now,
    refreshSwapQuoteBeforeBuild: true,
    gasPriceWei: () => 1n,
    inputWeiPerFeeWei: () => 0n,
    outputWeiPerFeeWei: () => 0n,
    quoteCandidateProvider: async (input) => {
      onQuoteInput?.(input);
      return [
        candidate({
          quoteMode: "exactOutput",
          sourceId: "muchfi-v3",
          protocolType: "v3",
          router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
          amountIn: refreshedAmountIn,
          amountOut: input.amountOut,
          quoteTimestampMs: now,
          ttlMs: 5_000,
        }),
      ];
    },
    approvalPlanner: async (input) => {
      onPlan?.(input);
      return { approvalRequired: true, allowance: 0n };
    },
  });
}

function exactOutputApprovalRequest() {
  return jsonRequest("/approval", {
    owner: "0x2222222222222222222222222222222222222222",
    quote: {
      quoteMode: "exactOutput",
      sourceId: "muchfi-v3",
      protocolType: "v3",
      status: "active",
      chainId: DOGEOS_CHAIN.id,
      router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
      sellToken: usdc.address,
      buyToken: wdoge.address,
      amountIn: "1000000",
      amountOut: "900000",
      maxAmountIn: "1010000",
      slippageBps: "100",
      recipient: "0x1111111111111111111111111111111111111111",
      deadline: 1_780_000_300,
      quoteTimestampMs: now,
      ttlMs: 10_000,
    },
  });
}

test("POST /approval refresh clamps the rebuilt maxAmountIn to the accepted maximum", async () => {
  let plannerInput;
  let quoteProviderInput;
  // Refreshed route still fits inside the user's accepted maxAmountIn
  // (1,010,000), but its own slippage buffer would rebase the bound above it
  // (1,005,000 * 1.01 = 1,015,050). The user-accepted bound must win.
  const handle = exactOutputRefreshHandle({
    refreshedAmountIn: 1_005_000n,
    onPlan: (input) => {
      plannerInput = input;
    },
    onQuoteInput: (input) => {
      quoteProviderInput = input;
    },
  });

  const response = await handle(exactOutputApprovalRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(quoteProviderInput.quoteMode, "exactOutput");
  assert.equal(quoteProviderInput.amountOut, 900_000n);
  assert.deepEqual(quoteProviderInput.includeSources, ["muchfi-v3"]);
  assert.equal(plannerInput.amount, 1_010_000n);
  assert.equal(body.quote.maxAmountIn, "1010000");
  assert.equal(body.quote.amountIn, "1005000");
});

test("POST /approval fails closed when the refreshed route exceeds the accepted maximum input", async () => {
  // The fresh route needs 1,200,000 in — beyond the user's accepted
  // 1,010,000. Rebasing the bound would silently charge ~19% more than the
  // user confirmed, so the API must demand a re-quote instead.
  const handle = exactOutputRefreshHandle({ refreshedAmountIn: 1_200_000n });

  const response = await handle(exactOutputApprovalRequest());
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, "approval-not-buildable");
  assert.match(body.error.message, /Price moved/);
  assert.match(body.error.message, /1010000/);
});

test("POST /approval and /swap coalesce identical in-flight refreshed quote work", async () => {
  let releaseCandidates;
  let providerCalls = 0;
  let markProviderStarted;
  const providerStarted = new Promise((resolve) => {
    markProviderStarted = resolve;
  });
  const activeQuote = {
    sourceId: "muchfi-v3",
    protocolType: "v3",
    status: "active",
    chainId: DOGEOS_CHAIN.id,
    router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
    sellToken: usdc.address,
    buyToken: wdoge.address,
    amountIn: "1000000",
    amountOut: "1050000",
    minAmountOut: "1000000",
    slippageBps: "100",
    recipient: "0x1111111111111111111111111111111111111111",
    deadline: 1_780_000_300,
    quoteTimestampMs: now,
    ttlMs: 10_000,
  };
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    refreshSwapQuoteBeforeBuild: true,
    gasPriceWei: () => 1n,
    outputWeiPerFeeWei: () => 0n,
    quoteCandidateProvider: async (input) => {
      providerCalls += 1;
      if (providerCalls === 1) markProviderStarted();
      await new Promise((release) => {
        releaseCandidates = release;
      });
      return [
        candidate({
          sourceId: "muchfi-v3",
          protocolType: "v3",
          router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
          amountIn: input.amountIn,
          amountOut: 1_200_000n,
          quoteTimestampMs: now,
          ttlMs: 5_000,
        }),
      ];
    },
    approvalPlanner: async () => ({ approvalRequired: false, allowance: 2_000_000n }),
    calldataBuilder: () => "0x38ed1739",
  });

  const approvalResponsePromise = handle(
    jsonRequest("/approval", {
      owner: "0x2222222222222222222222222222222222222222",
      quote: activeQuote,
    }),
  );
  const swapResponsePromise = handle(
    jsonRequest("/swap", {
      sender: "0x2222222222222222222222222222222222222222",
      quote: activeQuote,
    }),
  );

  await providerStarted;
  await Promise.resolve();
  assert.equal(providerCalls, 1);

  releaseCandidates();
  const [approvalResponse, swapResponse] = await Promise.all([
    approvalResponsePromise,
    swapResponsePromise,
  ]);
  const [approvalBody, swapBody] = await Promise.all([
    approvalResponse.json(),
    swapResponse.json(),
  ]);

  assert.equal(approvalResponse.status, 200);
  assert.equal(swapResponse.status, 200);
  assert.equal(providerCalls, 1);
  assert.equal(approvalBody.quote.amountOut, "1200000");
  assert.equal(swapBody.quote.amountOut, "1200000");
  assert.equal(swapBody.transaction.routeBinding.minAmountOut, "1188000");
});

test("POST /approval refuses inactive quotes before reading allowance", async () => {
  let plannerCalled = false;
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    approvalPlanner: async () => {
      plannerCalled = true;
      return { approvalRequired: false, allowance: 0n };
    },
  });

  const response = await handle(
    jsonRequest("/approval", {
      owner: "0x2222222222222222222222222222222222222222",
      quote: {
        sourceId: "muchfi-v3",
        protocolType: "v3",
        status: "readOnly",
        chainId: DOGEOS_CHAIN.id,
        router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
        sellToken: usdc.address,
        buyToken: wdoge.address,
        amountIn: "1000000",
        minAmountOut: "900000",
        recipient: "0x1111111111111111111111111111111111111111",
        deadline: 1_780_000_300,
        quoteTimestampMs: now,
        ttlMs: 10_000,
      },
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(plannerCalled, false);
  assert.equal(body.error.code, "approval-not-buildable");
  assert.match(body.error.message, /not active/i);
});

test("POST /swap refuses inactive quotes before calldata is built", async () => {
  let calldataCalled = false;
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    calldataBuilder: () => {
      calldataCalled = true;
      return "0x1234";
    },
  });

  const response = await handle(
    jsonRequest("/swap", {
      quote: {
        sourceId: "muchfi-v3",
        status: "readOnly",
        chainId: DOGEOS_CHAIN.id,
        router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
        sellToken: usdc.address,
        buyToken: wdoge.address,
        amountIn: "1000000",
        minAmountOut: "900000",
        recipient: "0x1111111111111111111111111111111111111111",
        deadline: 1_780_000_300,
        quoteTimestampMs: now,
        ttlMs: 10_000,
      },
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(calldataCalled, false);
  assert.equal(body.error.code, "swap-not-buildable");
  assert.match(body.error.message, /not active/i);
});

test("POST /swap attaches on-chain simulation and gas estimates for active quotes", async () => {
  let verifierInput;
  let balanceInput;
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    calldataBuilder: () => "0x38ed1739",
    swapVerifier: async (input) => {
      verifierInput = input;
      return {
        status: "simulated",
        estimatedGas: 100_000n,
        gasLimit: 120_000n,
        gasBufferBps: 12_000n,
        blockTag: "latest",
      };
    },
    balanceVerifier: async (input) => {
      balanceInput = input;
      return {
        status: "sufficient",
        requiredSellAmount: 1_000_000n,
        sellTokenBalance: 2_000_000n,
        requiredNativeWei: 120_000n,
        nativeBalance: 1_000_000n,
      };
    },
  });

  const response = await handle(
    jsonRequest("/swap", {
      sender: "0x2222222222222222222222222222222222222222",
      quote: {
        sourceId: "muchfi-v3",
        protocolType: "v3",
        status: "active",
        chainId: DOGEOS_CHAIN.id,
        router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
        sellToken: usdc.address,
        buyToken: wdoge.address,
        amountIn: "1000000",
        minAmountOut: "900000",
        recipient: "0x1111111111111111111111111111111111111111",
        deadline: 1_780_000_300,
        quoteTimestampMs: now,
        ttlMs: 10_000,
      },
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(verifierInput.sender, "0x2222222222222222222222222222222222222222");
  assert.equal(verifierInput.transaction.to, "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB");
  assert.equal(verifierInput.quote.sourceId, "muchfi-v3");
  assert.equal(balanceInput.sender, "0x2222222222222222222222222222222222222222");
  assert.equal(balanceInput.verification.gasLimit, 120_000n);
  assert.equal(body.transaction.from, "0x2222222222222222222222222222222222222222");
  assert.equal(body.transaction.chainId, DOGEOS_CHAIN.id);
  assert.equal(body.transaction.to, "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB");
  assert.equal(body.transaction.data, "0x38ed1739");
  assert.equal(body.transaction.value, "0");
  assert.equal(body.transaction.gas, "120000");
  assert.deepEqual(body.verification, {
    status: "simulated",
    estimatedGas: "100000",
    gasLimit: "120000",
    gasBufferBps: "12000",
    blockTag: "latest",
    balance: {
      status: "sufficient",
      requiredSellAmount: "1000000",
      sellTokenBalance: "2000000",
      requiredNativeWei: "120000",
      nativeBalance: "1000000",
    },
  });
});

test("POST /swap can refresh the selected source quote before calldata building", async () => {
  let quoteProviderInput;
  let builderInput;
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    refreshSwapQuoteBeforeBuild: true,
    gasPriceWei: () => 1n,
    outputWeiPerFeeWei: () => 0n,
    quoteCandidateProvider: async (input) => {
      quoteProviderInput = input;
      return [
        candidate({
          sourceId: "muchfi-v3",
          protocolType: "v3",
          router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
          amountIn: input.amountIn,
          amountOut: 1_200_000n,
          quoteTimestampMs: now,
          ttlMs: 5_000,
        }),
      ];
    },
    calldataBuilder: (quote) => {
      builderInput = quote;
      return "0x38ed1739";
    },
    swapVerifier: async () => ({
      status: "simulated",
      estimatedGas: 100_000n,
      gasLimit: 120_000n,
      gasBufferBps: 12_000n,
      blockTag: "latest",
    }),
  });

  const response = await handle(
    jsonRequest("/swap", {
      sender: "0x2222222222222222222222222222222222222222",
      quote: {
        sourceId: "muchfi-v3",
        protocolType: "v3",
        status: "active",
        chainId: DOGEOS_CHAIN.id,
        router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
        sellToken: usdc.address,
        buyToken: wdoge.address,
        amountIn: "1000000",
        amountOut: "1050000",
        minAmountOut: "1000000",
        slippageBps: "100",
        recipient: "0x1111111111111111111111111111111111111111",
        deadline: 1_780_000_300,
        quoteTimestampMs: now,
        ttlMs: 10_000,
      },
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(quoteProviderInput.amountIn, 1_000_000n);
  assert.deepEqual(quoteProviderInput.includeSources, ["muchfi-v3"]);
  assert.deepEqual(quoteProviderInput.excludeSources, []);
  assert.equal(builderInput.amountOut, 1_200_000n);
  assert.equal(builderInput.minAmountOut, 1_188_000n);
  assert.equal(builderInput.recipient, "0x1111111111111111111111111111111111111111");
  assert.equal(builderInput.deadline, 1_780_000_300);
  assert.equal(body.quote.amountOut, "1200000");
  assert.equal(body.quote.minAmountOut, "1188000");
  assert.equal(body.transaction.routeBinding.minAmountOut, "1188000");
});

function exactInputRefreshHandle({ refreshedAmountOut, onBuild }) {
  return createAggregatorApiHandler({
    nowMs: () => now,
    refreshSwapQuoteBeforeBuild: true,
    gasPriceWei: () => 1n,
    outputWeiPerFeeWei: () => 0n,
    quoteCandidateProvider: async (input) => [
      candidate({
        sourceId: "muchfi-v3",
        protocolType: "v3",
        router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
        amountIn: input.amountIn,
        amountOut: refreshedAmountOut,
        quoteTimestampMs: now,
        ttlMs: 5_000,
      }),
    ],
    calldataBuilder: (quote) => {
      onBuild?.(quote);
      return "0x38ed1739";
    },
    swapVerifier: async () => ({
      status: "simulated",
      estimatedGas: 100_000n,
      gasLimit: 120_000n,
      gasBufferBps: 12_000n,
      blockTag: "latest",
    }),
  });
}

function exactInputSwapRequest() {
  return jsonRequest("/swap", {
    sender: "0x2222222222222222222222222222222222222222",
    quote: {
      sourceId: "muchfi-v3",
      protocolType: "v3",
      status: "active",
      chainId: DOGEOS_CHAIN.id,
      router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
      sellToken: usdc.address,
      buyToken: wdoge.address,
      amountIn: "1000000",
      amountOut: "1050000",
      minAmountOut: "1000000",
      slippageBps: "100",
      recipient: "0x1111111111111111111111111111111111111111",
      deadline: 1_780_000_300,
      quoteTimestampMs: now,
      ttlMs: 10_000,
    },
  });
}

test("POST /swap refresh clamps the on-chain floor to the accepted minAmountOut", async () => {
  let builderInput;
  // Price dipped within the user's tolerance: the refreshed route still beats
  // the accepted minimum (1,005,000 >= 1,000,000) but its recomputed floor
  // (1,005,000 * 0.99 = 994,950) would drop below what the UI displayed as
  // "min received". The user-accepted floor must stay on-chain.
  const handle = exactInputRefreshHandle({
    refreshedAmountOut: 1_005_000n,
    onBuild: (quote) => {
      builderInput = quote;
    },
  });

  const response = await handle(exactInputSwapRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(builderInput.amountOut, 1_005_000n);
  assert.equal(builderInput.minAmountOut, 1_000_000n);
  assert.equal(body.quote.amountOut, "1005000");
  assert.equal(body.quote.minAmountOut, "1000000");
  assert.equal(body.transaction.routeBinding.minAmountOut, "1000000");
});

test("POST /swap fails closed when the refreshed route drops below the accepted minAmountOut", async () => {
  // The fresh route returns less than the minimum the user accepted — the
  // classic stale-quote loss. The API must demand a re-quote, never silently
  // rebase the floor downward.
  const handle = exactInputRefreshHandle({ refreshedAmountOut: 990_000n });

  const response = await handle(exactInputSwapRequest());
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, "swap-not-buildable");
  assert.match(body.error.message, /Price moved/);
  assert.match(body.error.message, /1000000/);
});

test("POST /swap refuses insufficient balances after simulation", async () => {
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    calldataBuilder: () => "0x38ed1739",
    swapVerifier: async () => ({
      status: "simulated",
      estimatedGas: 100_000n,
      gasLimit: 120_000n,
      gasBufferBps: 12_000n,
      blockTag: "latest",
    }),
    balanceVerifier: async () => {
      throw new Error("Insufficient sell-token balance: required 1000000, available 999999.");
    },
  });

  const response = await handle(
    jsonRequest("/swap", {
      sender: "0x2222222222222222222222222222222222222222",
      quote: {
        sourceId: "muchfi-v3",
        protocolType: "v3",
        status: "active",
        chainId: DOGEOS_CHAIN.id,
        router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
        sellToken: usdc.address,
        buyToken: wdoge.address,
        amountIn: "1000000",
        minAmountOut: "900000",
        recipient: "0x1111111111111111111111111111111111111111",
        deadline: 1_780_000_300,
        quoteTimestampMs: now,
        ttlMs: 10_000,
      },
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, "swap-not-buildable");
  assert.match(body.error.message, /insufficient sell-token balance/i);
});

test("POST /swap normalizes exact-output quote bounds before calldata building", async () => {
  let builderInput;
  const handle = createAggregatorApiHandler({
    nowMs: () => now,
    calldataBuilder: (quote) => {
      builderInput = quote;
      return "0x5023b4df";
    },
    swapVerifier: async () => ({
      status: "simulated",
      estimatedGas: 100_000n,
      gasLimit: 120_000n,
      gasBufferBps: 12_000n,
      blockTag: "latest",
    }),
  });

  const response = await handle(
    jsonRequest("/swap", {
      sender: "0x2222222222222222222222222222222222222222",
      quote: {
        quoteMode: "exactOutput",
        sourceId: "muchfi-v3",
        protocolType: "v3",
        status: "active",
        chainId: DOGEOS_CHAIN.id,
        router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
        sellToken: usdc.address,
        buyToken: wdoge.address,
        amountIn: "1000000",
        amountOut: "900000",
        maxAmountIn: "1050000",
        minAmountOut: "900000",
        recipient: "0x1111111111111111111111111111111111111111",
        deadline: 1_780_000_300,
        quoteTimestampMs: now,
        ttlMs: 10_000,
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(builderInput.quoteMode, "exactOutput");
  assert.equal(builderInput.amountOut, 900_000n);
  assert.equal(builderInput.maxAmountIn, 1_050_000n);
});
