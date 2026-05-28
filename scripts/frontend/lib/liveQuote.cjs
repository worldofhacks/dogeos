const { AbiCoder, Interface, ZeroAddress, getAddress, parseUnits } = require("ethers");

const BPS_DENOMINATOR = 10_000n;
const DEFAULT_SLIPPAGE_BPS = 50n;
const DEFAULT_DEADLINE_SECONDS = 600n;

const PAIR_IFACE = new Interface([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
]);

const ADAPTER_IFACE = new Interface([
  "function quoteExactInput(address pair,address tokenIn,address tokenOut,uint256 amountIn) view returns (uint256 amountOut)"
]);

const ROUTER_IFACE = new Interface([
  "function exactInput(address adapter,(address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,address recipient,bytes routeData) params,uint256 deadline) payable returns (uint256 amountOut)"
]);

const ERC20_IFACE = new Interface([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)"
]);

const DEFAULT_LIVE_QUOTE_CONFIG = {
  chain: {
    id: 6281971,
    rpcUrl: "https://rpc.testnet.dogeos.com",
    blockscoutUrl: "https://blockscout.testnet.dogeos.com"
  },
  deployments: {
    routerAddress: "0xBBf7ECC134350a9aF2BCA49A1420ac5E15fe54c3",
    adapterAddress: "0xe3D7979C510a3eBc7e3C60dB0F9f69c60E3D7A0E"
  },
  tokens: {
    DOGE: {
      symbol: "DOGE",
      name: "DogeOS DOGE",
      address: ZeroAddress,
      decimals: 18,
      native: true
    },
    WDOGE: {
      symbol: "WDOGE",
      name: "Wrapped Doge",
      address: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
      decimals: 18
    },
    USDC: {
      symbol: "USDC",
      name: "USD Coin",
      address: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
      decimals: 18
    },
    USDT: {
      symbol: "USDT",
      name: "Tether",
      address: "0xC81800b77D91391Ef03d7868cB81204E753093a9",
      decimals: 18
    },
    USD1: {
      symbol: "USD1",
      name: "World Liberty Financial USD",
      address: "0x25D5E5375e01Ed39Dc856bDCA5040417fD45eA3F",
      decimals: 18
    },
    WETH: {
      symbol: "WETH",
      name: "Wrapped Ethereum",
      address: "0x1a6094Ac3ca3Fc9F1B4777941a5f4AAc16A72000",
      decimals: 18
    },
    LBTC: {
      symbol: "LBTC",
      name: "Lombard Staked BTC",
      address: "0x29789F5A3e4c3113e7165c33A7E3bc592CF6fE0E",
      decimals: 18
    }
  },
  sources: {
    muchfiV2: {
      sourceId: "muchfi-v2",
      displayName: "MuchFi V2",
      protocol: "v2",
      executable: true,
      pairs: [
        "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
        "0x1498200A5D49081D8E55250aFeb13aAf3c1d9AE4"
      ]
    }
  }
};

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function normalizeAddress(address) {
  return getAddress(address);
}

function resolveToken(config, symbol) {
  const token = config.tokens[normalizeSymbol(symbol)];
  if (!token) {
    throw new Error(`UNSUPPORTED_TOKEN:${symbol}`);
  }
  return token;
}

function quoteTokenAddress(config, token) {
  if (token.native) {
    return normalizeAddress(config.tokens.WDOGE.address);
  }
  return normalizeAddress(token.address);
}

function routerTokenAddress(token) {
  return token.native ? ZeroAddress : normalizeAddress(token.address);
}

function encodePairRouteData(pair) {
  return AbiCoder.defaultAbiCoder().encode(["address"], [normalizeAddress(pair)]);
}

function calculateMinAmountOut(quotedAmountOut, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  const quote = BigInt(quotedAmountOut);
  const bps = BigInt(slippageBps);
  if (bps < 0n || bps > BPS_DENOMINATOR) {
    throw new Error("slippageBps must be between 0 and 10000");
  }
  if (quote <= 0n) return 0n;
  return (quote * (BPS_DENOMINATOR - bps)) / BPS_DENOMINATOR;
}

function parseAmountIn(amountIn, decimals) {
  const raw = String(amountIn || "").trim().replace(/,/gu, "");
  if (!/^\d+(\.\d+)?$/u.test(raw)) {
    throw new Error("amountIn must be a positive decimal amount");
  }
  const parsed = parseUnits(raw, decimals);
  if (parsed <= 0n) {
    throw new Error("amountIn must be greater than zero");
  }
  return parsed;
}

function formatUnitsTrimmed(value, decimals) {
  const amount = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function estimateV2ExactIn({
  amountIn,
  reserveIn,
  reserveOut,
  feeNumerator = 997n,
  feeDenominator = 1000n
}) {
  const input = BigInt(amountIn);
  const inReserve = BigInt(reserveIn);
  const outReserve = BigInt(reserveOut);
  if (input <= 0n || inReserve <= 0n || outReserve <= 0n) {
    return 0n;
  }

  const amountInWithFee = input * BigInt(feeNumerator);
  return (amountInWithFee * outReserve) / (inReserve * BigInt(feeDenominator) + amountInWithFee);
}

async function rpcRequest({ fetchImpl, rpcUrl, method, params = [] }) {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  if (!response.ok) {
    throw new Error(`RPC_HTTP_${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || `RPC_ERROR_${payload.error.code}`);
  }

  return payload.result;
}

async function rpcBatchRequest({ fetchImpl, rpcUrl, calls }) {
  const request = calls.map((call, index) => ({
    jsonrpc: "2.0",
    id: call.id || index + 1,
    method: call.method,
    params: call.params || []
  }));
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    throw new Error(`RPC_HTTP_${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("RPC_BATCH_RESPONSE_INVALID");
  }

  const byId = new Map(payload.map((item) => [item.id, item]));
  for (const call of request) {
    const item = byId.get(call.id);
    if (!item) throw new Error(`RPC_BATCH_MISSING_${call.id}`);
    if (item.error) throw new Error(item.error.message || `RPC_ERROR_${item.error.code}`);
  }

  return byId;
}

async function ethCall(ctx, to, data) {
  return rpcRequest({
    ...ctx,
    method: "eth_call",
    params: [{ to: normalizeAddress(to), data }, "latest"]
  });
}

async function readBlockNumber(ctx) {
  const hex = await rpcRequest({ ...ctx, method: "eth_blockNumber" });
  return Number(BigInt(hex));
}

async function readPairState(ctx, pair) {
  const address = normalizeAddress(pair);
  const [token0Raw, token1Raw, reservesRaw] = await Promise.all([
    ethCall(ctx, address, PAIR_IFACE.encodeFunctionData("token0")),
    ethCall(ctx, address, PAIR_IFACE.encodeFunctionData("token1")),
    ethCall(ctx, address, PAIR_IFACE.encodeFunctionData("getReserves"))
  ]);
  const [token0] = PAIR_IFACE.decodeFunctionResult("token0", token0Raw);
  const [token1] = PAIR_IFACE.decodeFunctionResult("token1", token1Raw);
  const [reserve0, reserve1, blockTimestampLast] = PAIR_IFACE.decodeFunctionResult("getReserves", reservesRaw);

  return {
    pair: address,
    token0: normalizeAddress(token0),
    token1: normalizeAddress(token1),
    reserve0: BigInt(reserve0),
    reserve1: BigInt(reserve1),
    blockTimestampLast: BigInt(blockTimestampLast)
  };
}

function reservesFor(pairState, tokenInAddress, tokenOutAddress) {
  const tokenIn = normalizeAddress(tokenInAddress);
  const tokenOut = normalizeAddress(tokenOutAddress);
  if (pairState.token0 === tokenIn && pairState.token1 === tokenOut) {
    return { reserveIn: pairState.reserve0, reserveOut: pairState.reserve1 };
  }
  if (pairState.token1 === tokenIn && pairState.token0 === tokenOut) {
    return { reserveIn: pairState.reserve1, reserveOut: pairState.reserve0 };
  }
  return undefined;
}

function findV2Leg(pairStates, tokenInAddress, tokenOutAddress) {
  for (const pairState of pairStates) {
    const reserves = reservesFor(pairState, tokenInAddress, tokenOutAddress);
    if (reserves) return { pairState, reserves };
  }
  return null;
}

async function quoteAdapterExactInput(ctx, { adapter, pair, tokenIn, tokenOut, amountIn }) {
  const data = ADAPTER_IFACE.encodeFunctionData("quoteExactInput", [
    normalizeAddress(pair),
    normalizeAddress(tokenIn),
    normalizeAddress(tokenOut),
    BigInt(amountIn)
  ]);
  const result = await ethCall(ctx, adapter, data);
  const [amountOut] = ADAPTER_IFACE.decodeFunctionResult("quoteExactInput", result);
  return BigInt(amountOut);
}

async function readAllowance(ctx, { token, owner, spender }) {
  const result = await ethCall(
    ctx,
    token,
    ERC20_IFACE.encodeFunctionData("allowance", [normalizeAddress(owner), normalizeAddress(spender)])
  );
  const [allowance] = ERC20_IFACE.decodeFunctionResult("allowance", result);
  return BigInt(allowance);
}

function buildSwapTransaction({
  config,
  tokenIn,
  tokenOut,
  amountIn,
  amountOut,
  recipient,
  pair,
  slippageBps,
  nowSeconds,
  deadlineSeconds,
  allowance = null
}) {
  const minAmountOut = calculateMinAmountOut(amountOut, slippageBps);
  const deadline = BigInt(nowSeconds) + BigInt(deadlineSeconds);
  const routeData = encodePairRouteData(pair);
  const params = [
    routerTokenAddress(tokenIn),
    routerTokenAddress(tokenOut),
    BigInt(amountIn),
    minAmountOut,
    normalizeAddress(recipient),
    routeData
  ];
  const data = ROUTER_IFACE.encodeFunctionData("exactInput", [
    normalizeAddress(config.deployments.adapterAddress),
    params,
    deadline
  ]);
  const value = tokenIn.native ? BigInt(amountIn) : 0n;
  const approvalRequired = !tokenIn.native && (allowance === null || BigInt(allowance) < BigInt(amountIn));
  const approvalTransaction = approvalRequired
    ? {
      to: normalizeAddress(tokenIn.address),
      data: ERC20_IFACE.encodeFunctionData("approve", [
        normalizeAddress(config.deployments.routerAddress),
        BigInt(amountIn)
      ]),
      value: "0"
    }
    : null;

  return {
    to: normalizeAddress(config.deployments.routerAddress),
    data,
    value: value.toString(),
    approvalRequired,
    approvalTransaction,
    approvalSpender: tokenIn.native ? null : normalizeAddress(config.deployments.routerAddress),
    allowance: allowance === null ? null : BigInt(allowance).toString(),
    deadline: deadline.toString(),
    minAmountOut: minAmountOut.toString()
  };
}

function readMuchFiV2MultiHopRoutes({ config, pairStates, tokenIn, tokenOut, amountIn, slippageBps }) {
  const tokenInAddress = quoteTokenAddress(config, tokenIn);
  const tokenOutAddress = quoteTokenAddress(config, tokenOut);
  const intermediateTokens = Object.values(config.tokens).filter((token) => {
    if (token.native) return false;
    const address = quoteTokenAddress(config, token);
    return address !== tokenInAddress && address !== tokenOutAddress;
  });
  const routes = [];

  for (const intermediateToken of intermediateTokens) {
    const intermediateAddress = quoteTokenAddress(config, intermediateToken);
    const firstLeg = findV2Leg(pairStates, tokenInAddress, intermediateAddress);
    const secondLeg = findV2Leg(pairStates, intermediateAddress, tokenOutAddress);
    if (!firstLeg || !secondLeg) continue;
    if (firstLeg.pairState.pair === secondLeg.pairState.pair) continue;

    const amountMid = estimateV2ExactIn({
      amountIn,
      reserveIn: firstLeg.reserves.reserveIn,
      reserveOut: firstLeg.reserves.reserveOut
    });
    const amountOut = estimateV2ExactIn({
      amountIn: amountMid,
      reserveIn: secondLeg.reserves.reserveIn,
      reserveOut: secondLeg.reserves.reserveOut
    });
    if (amountOut <= 0n) continue;

    routes.push({
      sourceId: config.sources.muchfiV2.sourceId,
      sourceName: config.sources.muchfiV2.displayName,
      protocol: config.sources.muchfiV2.protocol,
      status: "multi-hop-quote",
      executable: false,
      path: [tokenIn.symbol, intermediateToken.symbol, tokenOut.symbol],
      legs: [
        { pair: firstLeg.pairState.pair, tokenIn: tokenIn.symbol, tokenOut: intermediateToken.symbol },
        { pair: secondLeg.pairState.pair, tokenIn: intermediateToken.symbol, tokenOut: tokenOut.symbol }
      ],
      pair: null,
      routeData: null,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      amountOutFormatted: formatUnitsTrimmed(amountOut, tokenOut.decimals),
      minAmountOut: calculateMinAmountOut(amountOut, slippageBps).toString(),
      gasEstimate: "multi-hop-adapter-needed",
      transaction: null
    });
  }

  return routes;
}

async function readMuchFiV2Routes(ctx, { config, tokenIn, tokenOut, amountIn, recipient, slippageBps, nowSeconds, deadlineSeconds }) {
  const tokenInAddress = quoteTokenAddress(config, tokenIn);
  const tokenOutAddress = quoteTokenAddress(config, tokenOut);
  const routes = [];

  const pairResults = await Promise.allSettled(
    config.sources.muchfiV2.pairs.map((pair) => readPairState(ctx, pair))
  );
  const pairStates = pairResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  for (const pairState of pairStates) {
    const reserves = reservesFor(pairState, tokenInAddress, tokenOutAddress);
    if (!reserves) continue;

    let amountOut;
    let status = "live";
    try {
      amountOut = await quoteAdapterExactInput(ctx, {
        adapter: config.deployments.adapterAddress,
        pair: pairState.pair,
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        amountIn
      });
    } catch {
      amountOut = estimateV2ExactIn({ amountIn, reserveIn: reserves.reserveIn, reserveOut: reserves.reserveOut });
      status = "reserve-estimate";
    }

    if (amountOut <= 0n) continue;
    let allowance = null;
    if (recipient && !tokenIn.native) {
      allowance = await readAllowance(ctx, {
        token: tokenIn.address,
        owner: recipient,
        spender: config.deployments.routerAddress
      }).catch(() => null);
    }

    const transaction = recipient
      ? buildSwapTransaction({
        config,
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        recipient,
        pair: pairState.pair,
        slippageBps,
        nowSeconds,
        deadlineSeconds,
        allowance
      })
      : null;

    routes.push({
      sourceId: config.sources.muchfiV2.sourceId,
      sourceName: config.sources.muchfiV2.displayName,
      protocol: config.sources.muchfiV2.protocol,
      status,
      executable: true,
      path: [tokenIn.symbol, tokenOut.symbol],
      pair: pairState.pair,
      routeData: encodePairRouteData(pairState.pair),
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      amountOutFormatted: formatUnitsTrimmed(amountOut, tokenOut.decimals),
      minAmountOut: calculateMinAmountOut(amountOut, slippageBps).toString(),
      gasEstimate: "live-wallet-estimate",
      transaction
    });
  }

  routes.push(...readMuchFiV2MultiHopRoutes({
    config,
    pairStates,
    tokenIn,
    tokenOut,
    amountIn,
    slippageBps
  }));

  return routes.sort((a, b) => (BigInt(a.amountOut) > BigInt(b.amountOut) ? -1 : 1));
}

async function buildLiveQuote({
  fetchImpl = fetch,
  rpcUrl,
  config = DEFAULT_LIVE_QUOTE_CONFIG,
  tokenIn,
  tokenOut,
  amountIn,
  recipient,
  slippageBps = Number(DEFAULT_SLIPPAGE_BPS),
  nowSeconds = Math.floor(Date.now() / 1000),
  deadlineSeconds = Number(DEFAULT_DEADLINE_SECONDS)
}) {
  const resolvedRpcUrl = rpcUrl || config.chain.rpcUrl;
  const inputToken = resolveToken(config, tokenIn);
  const outputToken = resolveToken(config, tokenOut);
  if (inputToken.symbol === outputToken.symbol) {
    throw new Error("tokenIn and tokenOut must differ");
  }

  const parsedAmountIn = parseAmountIn(amountIn, inputToken.decimals);
  const ctx = { fetchImpl, rpcUrl: resolvedRpcUrl };
  const [blockNumber, routes] = await Promise.all([
    readBlockNumber(ctx),
    readMuchFiV2Routes(ctx, {
      config,
      tokenIn: inputToken,
      tokenOut: outputToken,
      amountIn: parsedAmountIn,
      recipient,
      slippageBps,
      nowSeconds,
      deadlineSeconds
    })
  ]);

  return {
    chainId: config.chain.id,
    blockNumber,
    tokenIn: inputToken,
    tokenOut: outputToken,
    amountIn: parsedAmountIn.toString(),
    amountInFormatted: formatUnitsTrimmed(parsedAmountIn, inputToken.decimals),
    routes,
    bestRoute: routes[0] || null
  };
}

async function readWalletSnapshot({
  fetchImpl = fetch,
  rpcUrl,
  config = DEFAULT_LIVE_QUOTE_CONFIG,
  address
}) {
  const resolvedRpcUrl = rpcUrl || config.chain.rpcUrl;
  const account = normalizeAddress(address);
  const tokens = Object.values(config.tokens);
  const erc20Tokens = tokens.filter((token) => !token.native);
  const calls = [
    { id: "block", method: "eth_blockNumber" },
    { id: "native", method: "eth_getBalance", params: [account, "latest"] },
    ...erc20Tokens.map((token) => ({
      id: `balance:${token.symbol}`,
      method: "eth_call",
      params: [{
        to: normalizeAddress(token.address),
        data: ERC20_IFACE.encodeFunctionData("balanceOf", [account])
      }, "latest"]
    }))
  ];

  const results = await rpcBatchRequest({ fetchImpl, rpcUrl: resolvedRpcUrl, calls });
  const nativeBalance = BigInt(results.get("native").result);
  const balancesBySymbol = new Map([["DOGE", nativeBalance]]);

  for (const token of erc20Tokens) {
    const [balance] = ERC20_IFACE.decodeFunctionResult("balanceOf", results.get(`balance:${token.symbol}`).result);
    balancesBySymbol.set(token.symbol, BigInt(balance));
  }

  return {
    chainId: config.chain.id,
    address: account,
    blockNumber: Number(BigInt(results.get("block").result)),
    nativeBalance: nativeBalance.toString(),
    nativeBalanceFormatted: formatUnitsTrimmed(nativeBalance, config.tokens.DOGE.decimals),
    tokens: tokens.map((token) => {
      const balance = balancesBySymbol.get(token.symbol) || 0n;
      return {
        symbol: token.symbol,
        name: token.name,
        address: token.address,
        decimals: token.decimals,
        native: Boolean(token.native),
        balance: balance.toString(),
        balanceFormatted: formatUnitsTrimmed(balance, token.decimals)
      };
    })
  };
}

module.exports = {
  DEFAULT_LIVE_QUOTE_CONFIG,
  calculateMinAmountOut,
  buildLiveQuote,
  encodePairRouteData,
  estimateV2ExactIn,
  formatUnitsTrimmed,
  readWalletSnapshot
};
