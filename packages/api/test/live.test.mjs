import assert from "node:assert/strict";
import test from "node:test";

import { DOGEOS_CHAIN } from "../../config/src/chains.mjs";
import { OFFICIAL_DOGEOS_TOKENS } from "../../config/src/tokens.mjs";
import { createLiveAggregatorApiHandler } from "../src/live.mjs";

const now = 1_780_000_000_000;
const [wdoge, , , , usdc, usdt] = OFFICIAL_DOGEOS_TOKENS;
const muchfiV2Pair = "0x2222222222222222222222222222222222222222";
const l1GasPriceOracle = "0x5300000000000000000000000000000000000002";
const getL1FeeSelector = "0x49948e0e";

function jsonRequest(path, body) {
  return new Request(`https://aggregator.local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rpcQueue(results) {
  const calls = [];

  return {
    calls,
    fetchFn: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: results.shift(),
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  };
}

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressResult(address) {
  return `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
}

function reservesResult(reserve0, reserve1, blockTimestampLast = 10n) {
  return `0x${word(reserve0)}${word(reserve1)}${word(blockTimestampLast)}`;
}

function oracleFeeResult(value = 10_000n) {
  return `0x${word(value)}`;
}

function discoveryRpc() {
  const calls = [];

  return {
    calls,
    fetchFn: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);

      let result;
      if (body.method === "eth_chainId") result = "0x5fdaf3";
      if (body.method === "eth_blockNumber") result = "0x4f5880";
      if (body.method === "eth_gasPrice") result = "0x2";
      if (body.method === "eth_call") {
        if (
          body.params[0].to.toLowerCase() === l1GasPriceOracle.toLowerCase() &&
          body.params[0].data.startsWith(getL1FeeSelector)
        ) {
          result = oracleFeeResult();
        }

        const selector = body.params[0].data.slice(0, 10);
        if (selector === "0xe6a43905") result = addressResult(muchfiV2Pair);
        if (selector === "0x0dfe1681") result = addressResult(usdc.address);
        if (selector === "0xd21220a7") result = addressResult(wdoge.address);
        if (selector === "0x0902f1ac") result = reservesResult(1_000_000_000n, 2_000_000_000n);
      }

      if (!result) {
        throw new Error(`unexpected RPC request ${body.method}`);
      }

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  };
}

function noPairDiscoveryRpc() {
  const calls = [];

  return {
    calls,
    fetchFn: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);

      let result;
      if (body.method === "eth_chainId") result = "0x5fdaf3";
      if (body.method === "eth_blockNumber") result = "0x4f5880";
      if (body.method === "eth_gasPrice") result = "0x2";
      if (body.method === "eth_call") {
        if (
          body.params[0].to.toLowerCase() === l1GasPriceOracle.toLowerCase() &&
          body.params[0].data.startsWith(getL1FeeSelector)
        ) {
          result = oracleFeeResult();
        }

        const selector = body.params[0].data.slice(0, 10);
        if (selector === "0xe6a43905") {
          result = addressResult("0x0000000000000000000000000000000000000000");
        }
      }

      if (!result) {
        throw new Error(`unexpected RPC request ${body.method}`);
      }

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  };
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

test("createLiveAggregatorApiHandler verifies DogeOS RPC chain and uses live gas price for quotes", async () => {
  const rpc = rpcQueue(["0x5fdaf3", "0x2"]);
  const handle = createLiveAggregatorApiHandler({
    nowMs: () => now,
    fetchFn: rpc.fetchFn,
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
  assert.equal(body.status, "ok");
  assert.equal(body.best.score.executionFeeWei, "240000");
  assert.equal(body.best.score.totalFeeWei, "245000");
  assert.equal(body.best.score.netOutput, "805000");
  assert.deepEqual(
    rpc.calls.map((call) => call.method),
    ["eth_chainId", "eth_gasPrice"],
  );
});

test("createLiveAggregatorApiHandler rejects RPC chain mismatches before quote provider work", async () => {
  const rpc = rpcQueue(["0x1"]);
  let providerCalled = false;
  const handle = createLiveAggregatorApiHandler({
    nowMs: () => now,
    fetchFn: rpc.fetchFn,
    quoteCandidateProvider: async () => {
      providerCalled = true;
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

  assert.equal(response.status, 400);
  assert.equal(providerCalled, false);
  assert.equal(body.error.code, "invalid-quote-request");
  assert.match(body.error.message, /RPC chain mismatch/);
});

test("createLiveAggregatorApiHandler uses default V2 pool discovery as executable quotes", async () => {
  const rpc = discoveryRpc();
  const handle = createLiveAggregatorApiHandler({
    nowMs: () => now,
    fetchFn: rpc.fetchFn,
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
  assert.equal(body.status, "ok");
  assert.equal(body.best.sourceId, "muchfi-v2");
  assert.equal(body.best.amountOut, "1992013");
  assert.equal(body.best.score.netOutput, "1712013");
  assert.equal(body.best.score.totalFeeWei, "280000");
  assert.equal(rpc.calls[0].method, "eth_chainId");
  assert.equal(
    rpc.calls.some(
      (call) => call.method === "eth_call" && call.params[0].data.startsWith("0xe6a43905"),
    ),
    false,
  );
  assert.equal(rpc.calls.some((call) => call.method === "eth_gasPrice"), true);
});

test("createLiveAggregatorApiHandler uses default V2 exact-output discovery", async () => {
  const rpc = discoveryRpc();
  const handle = createLiveAggregatorApiHandler({
    nowMs: () => now,
    fetchFn: rpc.fetchFn,
  });

  const response = await handle(
    jsonRequest("/quote", {
      quoteMode: "exactOutput",
      chainId: DOGEOS_CHAIN.id,
      sellToken: usdc.address,
      buyToken: wdoge.address,
      amountOut: "1992013",
      slippageBps: "50",
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.best.sourceId, "muchfi-v2");
  assert.equal(body.best.quoteMode, "exactOutput");
  assert.equal(body.best.amountIn, "1000000");
  assert.equal(body.best.amountOut, "1992013");
  assert.equal(body.best.maxAmountIn, "1005000");
  assert.equal(body.best.score.totalInput, "1280000");
  assert.equal(rpc.calls[0].method, "eth_chainId");
  assert.equal(rpc.calls.some((call) => call.method === "eth_gasPrice"), true);
});

test("createLiveAggregatorApiHandler composes verified concentrated-liquidity quotes with live providers", async () => {
  const rpc = noPairDiscoveryRpc();
  const seenQuoterBlockNumbers = [];
  const handle = createLiveAggregatorApiHandler({
    nowMs: () => now,
    fetchFn: rpc.fetchFn,
    concentratedLiquidityQuoterProvider: async ({ source, blockNumber }) => {
      seenQuoterBlockNumbers.push(blockNumber);
      if (source.sourceId !== "muchfi-v3") return null;

      return {
        poolAddress: "0x3333333333333333333333333333333333333333",
        token0: usdc.address,
        token1: wdoge.address,
        quotedAmountOut: 1_100_000n,
        feeBps: 25n,
        sqrtPriceX96: 79_228_162_514_264_337_593_543_950_336n,
        liquidity: 10_000_000n,
        quoterProvenance: "blockscout",
      };
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
  assert.equal(body.status, "ok");
  assert.equal(body.best.sourceId, "muchfi-v3");
  assert.equal(body.best.amountOut, "1100000");
  assert.ok(seenQuoterBlockNumbers.length > 0);
  assert.deepEqual([...new Set(seenQuoterBlockNumbers)], [5_200_000n]);
  assert.equal(rpc.calls.filter((call) => call.method === "eth_blockNumber").length, 1);
});

test("createLiveAggregatorApiHandler times out stalled live quote providers", async () => {
  const rpc = noPairDiscoveryRpc();
  const handle = createLiveAggregatorApiHandler({
    nowMs: () => now,
    fetchFn: rpc.fetchFn,
    quoteProviderTimeoutMs: 5,
    concentratedLiquidityQuoterProvider: async () => new Promise(() => {}),
  });

  const response = await Promise.race([
    handle(
      jsonRequest("/quote", {
        chainId: DOGEOS_CHAIN.id,
        sellToken: usdc.address,
        buyToken: wdoge.address,
        amountIn: "1000000",
        slippageBps: "50",
      }),
    ),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("live quote provider hung")), 100);
    }),
  ]);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "no-route");
  assert.deepEqual(body.warnings, ["no-executable-route"]);
  assert.equal(body.telemetry.sourceErrorCount, 2);
  assert.deepEqual(
    body.telemetry.sourceErrors.map((entry) => entry.type).sort(),
    ["provider-error", "source-error"],
  );
  const concentratedLiquidityError = body.telemetry.sourceErrors.find(
    (entry) => entry.providerId === "concentrated-liquidity",
  );
  assert.match(concentratedLiquidityError.message, /timed out/);
  assert.equal(
    rpc.calls.some((call) => call.method === "eth_gasPrice"),
    true,
  );
});

test("createLiveAggregatorApiHandler can opt into one-hop quote candidates without split routing", async () => {
  const rpc = noPairDiscoveryRpc();
  const handle = createLiveAggregatorApiHandler({
    nowMs: () => now,
    fetchFn: rpc.fetchFn,
    oneHopEnabled: true,
    concentratedLiquidityQuoterProvider: async ({ sellToken, buyToken, source }) => {
      if (source.sourceId !== "muchfi-v3") return null;

      if (sellToken === usdc.address && buyToken === wdoge.address) {
        return {
          poolAddress: "0x3333333333333333333333333333333333333333",
          token0: usdc.address,
          token1: wdoge.address,
          quotedAmountOut: 950_000n,
          feeBps: 25n,
          sqrtPriceX96: 79_228_162_514_264_337_593_543_950_336n,
          liquidity: 10_000_000n,
          quoterProvenance: "blockscout",
          gasUnits: 110_000n,
        };
      }

      if (sellToken === wdoge.address && buyToken === usdt.address) {
        return {
          poolAddress: "0x4444444444444444444444444444444444444444",
          token0: wdoge.address,
          token1: usdt.address,
          quotedAmountOut: 940_000n,
          feeBps: 25n,
          sqrtPriceX96: 79_228_162_514_264_337_593_543_950_336n,
          liquidity: 10_000_000n,
          quoterProvenance: "blockscout",
          gasUnits: 120_000n,
        };
      }

      return null;
    },
  });

  const response = await handle(
    jsonRequest("/quote", {
      chainId: DOGEOS_CHAIN.id,
      sellToken: usdc.address,
      buyToken: usdt.address,
      amountIn: "1000000",
      slippageBps: "50",
    }),
  );
  const body = await response.json();
  const oneHopRoute = [
    ...(body.best ? [body.best] : []),
    ...(body.alternatives ?? []),
    ...(body.rejected ?? []),
  ].find(
    (route) => route.routeType === "oneHop",
  );

  assert.equal(response.status, 200);
  assert.equal(body.status, "read-only");
  assert.equal(body.best, null);
  assert.equal(oneHopRoute.sourceId, "muchfi-v3+muchfi-v3");
  assert.equal(oneHopRoute.status, "readOnly");
  assert.equal(oneHopRoute.reason, "one-hop-execution-preview");
  assert.equal(oneHopRoute.chainId, DOGEOS_CHAIN.id);
  assert.equal(oneHopRoute.viaToken, wdoge.address);
  assert.equal(oneHopRoute.amountOut, "940000");
  assert.equal(oneHopRoute.gasUnits, "230000");
  assert.equal(oneHopRoute.legs.length, 2);
});

test("createLiveAggregatorApiHandler serves injected live verification snapshots", async () => {
  const rpc = rpcQueue([]);
  let providerCalled = false;
  const handle = createLiveAggregatorApiHandler({
    nowMs: () => now,
    fetchFn: rpc.fetchFn,
    verificationSnapshotProvider: async () => {
      providerCalled = true;
      return {
        expectedChainId: "0x5fdaf3",
        summary: {
          chainMatches: true,
          relationshipMismatches: [],
          tokenDecimalMismatches: [],
          hasBlockingMismatch: false,
        },
        sources: [
          {
            sourceId: "barkswap-algebra",
            role: "router",
            address: "0x77147f436cE9739D2A54Ffe428DBe02b90c0205e",
            verification: {
              status: "readOnly",
            },
          },
        ],
        tokens: [
          {
            symbol: "USDT",
            actualDecimals: 18,
            matches: true,
          },
        ],
      };
    },
  });

  const response = await handle(new Request("https://aggregator.local/verification"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(providerCalled, true);
  assert.deepEqual(rpc.calls, []);
  assert.equal(body.data.summary.hasBlockingMismatch, false);
  assert.equal(body.data.sources[0].sourceId, "barkswap-algebra");
  assert.equal(body.data.tokens[0].symbol, "USDT");
});

test("createLiveAggregatorApiHandler serves default cached live verification snapshots", async () => {
  const verificationRouter = "0x1111111111111111111111111111111111111111";
  const verificationFactory = "0x2222222222222222222222222222222222222222";
  const calls = [];
  let clock = now;
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });

    if (init.body) {
      const body = JSON.parse(init.body);
      let result;
      if (body.method === "eth_chainId") result = "0x5fdaf3";
      if (body.method === "eth_getCode") {
        result = body.params[0].toLowerCase() === verificationRouter.toLowerCase()
          ? "0x6080604052600438ed1739"
          : "0x6000";
      }
      if (body.method === "eth_call") {
        const selector = body.params[0].data.slice(0, 10);
        if (selector === "0xc45a0155") result = addressResult(verificationFactory);
        if (selector === "0x313ce567") result = `0x${word(18n)}`;
      }
      if (!result) throw new Error(`unexpected RPC request ${body.method}`);

      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ is_contract: true, is_verified: false, has_abi: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const handle = createLiveAggregatorApiHandler({
    nowMs: () => clock,
    fetchFn,
    verificationCacheTtlMs: 15_000,
    verificationTargets: [
      {
        sourceId: "muchfi-v2",
        protocolType: "v2",
        displayName: "MuchFi V2",
        role: "router",
        address: verificationRouter,
        abiProvenance: "onchain-bytecode",
        expectedSelectors: ["0x38ed1739"],
        expectedReadChecks: [
          {
            label: "factory()",
            selector: "0xc45a0155",
            expectedAddress: verificationFactory,
          },
        ],
      },
    ],
    verificationTokens: [usdc],
  });

  const firstResponse = await handle(new Request("https://aggregator.local/verification"));
  const firstBody = await firstResponse.json();
  const callCountAfterFirst = calls.length;
  clock += 1_000;
  const secondResponse = await handle(new Request("https://aggregator.local/verification"));

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(calls.length, callCountAfterFirst);
  assert.equal(firstBody.data.chainMatches, true);
  assert.equal(firstBody.data.summary.hasBlockingMismatch, false);
  assert.equal(firstBody.data.sources[0].readChecks[0].matches, true);
  assert.equal(firstBody.data.tokens[0].actualDecimals, 18);
  assert.equal(calls.some((call) => call.body?.method === "eth_gasPrice"), false);
});

test("createLiveAggregatorApiHandler loads venue calldata builders for active live sources", async () => {
  const rpc = rpcQueue(["0x5fdaf3"]);
  const handle = createLiveAggregatorApiHandler({
    nowMs: () => now,
    fetchFn: rpc.fetchFn,
    swapVerifier: false,
    refreshSwapQuoteBeforeBuild: false,
  });

  const response = await handle(
    jsonRequest("/swap", {
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
        feeBps: "25",
        recipient: "0x1111111111111111111111111111111111111111",
        deadline: 1_780_000_300,
        quoteTimestampMs: now,
        ttlMs: 10_000,
        routeData: "0xdeadbeef",
      },
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.transaction.to, "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB");
  assert.match(body.transaction.data, /^0x04e45aaf/);
});

test("createLiveAggregatorApiHandler verifies chain and simulates active swaps before returning gas", async () => {
  const rpc = rpcQueue([
    "0x5fdaf3",
    "0x",
    "0x186a0",
    oracleFeeResult(12_345n),
    `0x${word(2_000_000n)}`,
    "0xf4240",
    "0x1",
  ]);
  const handle = createLiveAggregatorApiHandler({
    nowMs: () => now,
    fetchFn: rpc.fetchFn,
    calldataBuilder: () => "0x38ed1739deadbeef",
    refreshSwapQuoteBeforeBuild: false,
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
  assert.equal(body.transaction.gas, "120000");
  assert.equal(body.verification.status, "simulated");
  assert.equal(body.verification.dataFinalityFeeWei, "12345");
  assert.deepEqual(body.verification.balance, {
    status: "sufficient",
    requiredSellAmount: "1000000",
    sellTokenBalance: "2000000",
    requiredNativeWei: "132345",
    nativeBalance: "1000000",
  });
  assert.deepEqual(
    rpc.calls.map((call) => call.method),
    [
      "eth_chainId",
      "eth_call",
      "eth_estimateGas",
      "eth_call",
      "eth_call",
      "eth_getBalance",
      "eth_gasPrice",
    ],
  );
  assert.deepEqual(rpc.calls[1].params[0], {
    to: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
    data: "0x38ed1739deadbeef",
    from: "0x2222222222222222222222222222222222222222",
    value: "0x0",
  });
  assert.equal(rpc.calls[3].params[0].to, l1GasPriceOracle);
  assert.equal(rpc.calls[3].params[0].data.startsWith(getL1FeeSelector), true);
  assert.equal(rpc.calls[3].params[0].data.includes("38ed1739deadbeef"), true);
  assert.equal(rpc.calls[4].params[0].to, usdc.address);
  assert.equal(rpc.calls[4].params[0].data.startsWith("0x70a08231"), true);
  assert.deepEqual(rpc.calls[5].params, [
    "0x2222222222222222222222222222222222222222",
    "latest",
  ]);
});
