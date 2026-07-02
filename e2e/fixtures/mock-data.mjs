export const DOGEOS_CHAIN_ID = 6_281_971;
export const DOGEOS_CHAIN_ID_HEX = "0x5fdaf3";

export const WALLET_ADDRESS = "0x1111111111111111111111111111111111111111";
export const APPROVAL_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const SWAP_HASH =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export const TOKENS = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0xd19d2ffb1c284668b7afe72cddae1baf3bc03925",
    decimals: 18,
    verified: true,
    provenance: "dogeos-faucet-rpc-validated",
  },
  {
    symbol: "WDOGE",
    name: "Wrapped DOGE",
    address: "0xf6bdb158a5ddf77f1b83bc9074f6a472c58d78ae",
    decimals: 18,
    verified: true,
    provenance: "dogeos-faucet-rpc-validated",
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    address: "0xc81800b77d91391ef03d7868cb81204e753093a9",
    decimals: 18,
    verified: true,
    provenance: "dogeos-faucet-rpc-validated",
  },
];

export const SOURCES = [
  {
    sourceId: "muchfi-v3",
    displayName: "MuchFi V3",
    protocolType: "v3",
    status: "active",
  },
  {
    sourceId: "muchfi-v2",
    displayName: "MuchFi V2",
    protocolType: "v2",
    status: "active",
  },
  {
    sourceId: "barkswap-algebra",
    displayName: "Barkswap",
    protocolType: "algebra",
    status: "active",
  },
  {
    sourceId: "dogeswap-split",
    displayName: "DogeSwap Split",
    protocolType: "router",
    status: "active",
    routerMode: "all",
  },
];

export function quoteBody(overrides = {}) {
  const amountIn = BigInt(overrides.amountIn ?? "1000000000000000000");
  const amountOut = (amountIn * 1_200n) / 1n;
  const minAmountOut = (amountOut * 9950n) / 10_000n;
  const now = Date.now();

  return {
    status: "success",
    best: {
      sourceId: "muchfi-v3",
      displayName: "MuchFi V3",
      protocolType: "v3",
      routeType: "direct",
      status: "active",
      quoteMode: "exactInput",
      chainId: DOGEOS_CHAIN_ID,
      sellToken: TOKENS[0].address,
      buyToken: TOKENS[1].address,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      minAmountOut: minAmountOut.toString(),
      minimumOutput: minAmountOut.toString(),
      gasUnits: "170000",
      priceImpactBps: "12",
      router: "0x54f7d7f6fedf4e930efd6b4742ba0b9e8a6dc1cb",
      feeTier: "2500",
      quoteTimestampMs: now,
      ttlMs: 60_000,
      feeEstimate: {
        executionFeeWei: "2500000000000",
        dataFinalityFeeWei: "1500000000000",
        totalFeeWei: "4000000000000",
      },
    },
    alternatives: [
      {
        sourceId: "muchfi-v2",
        displayName: "MuchFi V2",
        protocolType: "v2",
        routeType: "direct",
        status: "active",
        quoteMode: "exactInput",
        chainId: DOGEOS_CHAIN_ID,
        sellToken: TOKENS[0].address,
        buyToken: TOKENS[1].address,
        amountIn: amountIn.toString(),
        amountOut: ((amountOut * 997n) / 1000n).toString(),
        minAmountOut: ((minAmountOut * 997n) / 1000n).toString(),
        gasUnits: "145000",
        priceImpactBps: "18",
        router: "0xc653e745fc613a03d156dacb924ae8e9148b18dc",
        feeEstimate: {
          executionFeeWei: "2200000000000",
          dataFinalityFeeWei: "1400000000000",
          totalFeeWei: "3600000000000",
        },
      },
    ],
    rejected: [],
    warnings: [],
    expiresAtMs: now + 60_000,
    telemetry: {
      quoteLatencyMs: 42,
      candidateCount: 2,
      executableCandidateCount: 2,
      rejectedCandidateCount: 0,
      sourceErrorCount: 0,
      sourceErrors: [],
    },
  };
}

export function approvalBody(requestBody = {}) {
  return {
    approvalRequired: true,
    transaction: {
      chainId: DOGEOS_CHAIN_ID,
      to: TOKENS[0].address,
      data: "0x095ea7b3",
      value: "0",
      gas: "60000",
    },
    quote: requestBody.quote,
  };
}

export function swapBody(requestBody = {}) {
  return {
    quote: requestBody.quote,
    transaction: {
      chainId: DOGEOS_CHAIN_ID,
      to: "0xa3158549f38400f355adf20c92da1769620aa35a",
      data: "0xe56964c6",
      value: "0",
      gas: "260000",
    },
    verification: {
      gasLimit: "260000",
      simulation: { success: true },
      balance: { ok: true },
    },
  };
}
