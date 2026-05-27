const { AbiCoder, Wallet, ZeroAddress, formatEther, getCreateAddress, keccak256, parseEther } = require("ethers");
const hre = require("hardhat");
const { resolveDeploymentConfig } = require("./env.cjs");
const { resolveAdapterAddress, resolveRouterAddress } = require("./deploymentState.cjs");

const ROUTE_PREFLIGHT_AMOUNT_IN = parseEther(process.env.DOGEOS_ROUTE_PREFLIGHT_DOGE || "0.001");

function toDecimalString(value) {
  return value.toString();
}

function codeBytes(code) {
  return Math.max((code.length - 2) / 2, 0);
}

function encodePair(pairAddress) {
  return AbiCoder.defaultAbiCoder().encode(["address"], [pairAddress]);
}

function tokenSetMatches(token0, token1, tokenA, tokenB) {
  return (
    (token0 === tokenA && token1 === tokenB) ||
    (token0 === tokenB && token1 === tokenA)
  );
}

function dogeosProvider(config) {
  return new hre.ethers.JsonRpcProvider(config.rpcUrl, {
    chainId: config.chainId,
    name: "dogeos-chikyu-testnet"
  });
}

async function assertDogeOSNetwork(provider, config) {
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) {
    throw new Error(`Expected chainId ${config.chainId}, got ${network.chainId.toString()}`);
  }
}

async function readMuchFiV2PairState(provider, config) {
  const [factoryCode, pairCode] = await Promise.all([
    provider.getCode(config.muchFiV2FactoryAddress),
    provider.getCode(config.muchFiV2UsdcWdogePairAddress)
  ]);

  if (factoryCode === "0x") {
    throw new Error(`MuchFi V2 factory has no bytecode at ${config.muchFiV2FactoryAddress}`);
  }
  if (pairCode === "0x") {
    throw new Error(`MuchFi V2 WDOGE/USDC pair has no bytecode at ${config.muchFiV2UsdcWdogePairAddress}`);
  }

  const factory = await hre.ethers.getContractAt("IUniswapV2Factory", config.muchFiV2FactoryAddress, provider);
  const pair = await hre.ethers.getContractAt("IUniswapV2Pair", config.muchFiV2UsdcWdogePairAddress, provider);

  const [canonicalPair, token0, token1, reserves] = await Promise.all([
    factory.getPair(config.wDogeAddress, config.usdcAddress),
    pair.token0(),
    pair.token1(),
    pair.getReserves()
  ]);

  if (canonicalPair !== config.muchFiV2UsdcWdogePairAddress) {
    throw new Error(
      `MuchFi V2 factory pair mismatch: expected ${config.muchFiV2UsdcWdogePairAddress}, got ${canonicalPair}`
    );
  }
  if (!tokenSetMatches(token0, token1, config.wDogeAddress, config.usdcAddress)) {
    throw new Error(`MuchFi V2 pair token mismatch: token0=${token0} token1=${token1}`);
  }
  if (reserves[0] === 0n || reserves[1] === 0n) {
    throw new Error(`MuchFi V2 pair has zero liquidity: reserve0=${reserves[0]} reserve1=${reserves[1]}`);
  }

  return {
    factoryCodeBytes: codeBytes(factoryCode),
    factoryCodeHash: keccak256(factoryCode),
    pairCodeBytes: codeBytes(pairCode),
    pairCodeHash: keccak256(pairCode),
    token0,
    token1,
    reserve0: toDecimalString(reserves[0]),
    reserve1: toDecimalString(reserves[1]),
    blockTimestampLast: Number(reserves[2])
  };
}

async function buildAdapterPlan() {
  const config = resolveDeploymentConfig({ cwd: process.cwd(), requirePrivateKey: true });
  const provider = dogeosProvider(config);
  const wallet = new Wallet(config.privateKey, provider);
  await assertDogeOSNetwork(provider, config);

  const [blockNumber, balance, gasPrice, nonce, pairState] = await Promise.all([
    provider.getBlockNumber(),
    provider.getBalance(config.deployerAddress),
    provider.getFeeData().then((feeData) => feeData.gasPrice),
    provider.getTransactionCount(config.deployerAddress, "pending"),
    readMuchFiV2PairState(provider, config)
  ]);

  const Adapter = await hre.ethers.getContractFactory("DogeOSV2PairAdapter", wallet);
  const unsignedTx = await Adapter.getDeployTransaction(config.muchFiV2FactoryAddress);
  const estimatedGas = await wallet.estimateGas(unsignedTx);
  const resolvedGasPrice = gasPrice || 0n;
  const estimatedCost = estimatedGas * resolvedGasPrice;
  const predictedAdapterAddress = getCreateAddress({
    from: config.deployerAddress,
    nonce
  });

  if (balance < estimatedCost) {
    throw new Error(
      `Deployer balance ${formatEther(balance)} DOGE is below estimated adapter deployment cost ${formatEther(
        estimatedCost
      )} DOGE`
    );
  }

  return {
    blockNumber,
    blockscoutUrl: config.blockscoutUrl,
    chainId: config.chainId,
    deployerAddress: config.deployerAddress,
    estimatedCostWei: toDecimalString(estimatedCost),
    estimatedGas: toDecimalString(estimatedGas),
    gasPriceWei: toDecimalString(resolvedGasPrice),
    muchFiV2FactoryAddress: config.muchFiV2FactoryAddress,
    muchFiV2UsdcWdogePairAddress: config.muchFiV2UsdcWdogePairAddress,
    nonce,
    predictedAdapterAddress,
    rpcUrl: config.rpcUrl,
    timestamp: new Date().toISOString(),
    usdcAddress: config.usdcAddress,
    wDogeAddress: config.wDogeAddress,
    pairState
  };
}

async function verifyDeployedAdapter(provider, config, adapterAddress) {
  const adapterCode = await provider.getCode(adapterAddress);
  if (adapterCode === "0x") {
    throw new Error(`No adapter bytecode found at ${adapterAddress}`);
  }

  const adapter = await hre.ethers.getContractAt("DogeOSV2PairAdapter", adapterAddress, provider);
  const factory = await adapter.factory();
  if (factory !== config.muchFiV2FactoryAddress) {
    throw new Error(`Adapter factory mismatch: expected ${config.muchFiV2FactoryAddress}, got ${factory}`);
  }

  return {
    adapterAddress,
    adapterCodeBytes: codeBytes(adapterCode),
    adapterCodeHash: keccak256(adapterCode),
    factory
  };
}

async function buildAllowlistPlan() {
  const config = resolveDeploymentConfig({ cwd: process.cwd(), requirePrivateKey: true });
  const provider = dogeosProvider(config);
  const wallet = new Wallet(config.privateKey, provider);
  await assertDogeOSNetwork(provider, config);

  const routerAddress = resolveRouterAddress(config);
  const adapterAddress = resolveAdapterAddress(config);
  if (!routerAddress) {
    throw new Error("DOGEOS_SWAP_ROUTER_ADDRESS or deployments/dogeos-chikyu/router-latest.json is required");
  }
  if (!adapterAddress) {
    throw new Error("DOGEOS_V2_PAIR_ADAPTER_ADDRESS or deployments/dogeos-chikyu/adapter-latest.json is required");
  }

  const [blockNumber, gasPrice, routerCode, pairState, adapterState] = await Promise.all([
    provider.getBlockNumber(),
    provider.getFeeData().then((feeData) => feeData.gasPrice),
    provider.getCode(routerAddress),
    readMuchFiV2PairState(provider, config),
    verifyDeployedAdapter(provider, config, adapterAddress)
  ]);

  if (routerCode === "0x") {
    throw new Error(`No router bytecode found at ${routerAddress}`);
  }

  const router = await hre.ethers.getContractAt("DogeOSSwapRouter", routerAddress, wallet);
  const adapter = await hre.ethers.getContractAt("DogeOSV2PairAdapter", adapterAddress, provider);
  const pair = await hre.ethers.getContractAt("IUniswapV2Pair", config.muchFiV2UsdcWdogePairAddress, provider);

  const [owner, wDoge, paused, alreadyAllowed, quotedAmountOut] = await Promise.all([
    router.owner(),
    router.wDoge(),
    router.paused(),
    router.allowedAdapter(adapterAddress),
    adapter.quoteExactInput(pair, config.wDogeAddress, config.usdcAddress, ROUTE_PREFLIGHT_AMOUNT_IN)
  ]);

  if (owner !== config.deployerAddress) {
    throw new Error(`Configured deployer ${config.deployerAddress} is not router owner ${owner}`);
  }
  if (wDoge !== config.wDogeAddress) {
    throw new Error(`Router WDOGE mismatch: expected ${config.wDogeAddress}, got ${wDoge}`);
  }
  if (paused) {
    throw new Error("Router is paused; allowlist can proceed, but route preflight cannot execute while paused");
  }

  const estimatedGas = alreadyAllowed ? 0n : await router.setAdapterAllowed.estimateGas(adapterAddress, true);
  const resolvedGasPrice = gasPrice || 0n;

  return {
    adapter: adapterState,
    alreadyAllowed,
    blockNumber,
    blockscoutUrl: config.blockscoutUrl,
    chainId: config.chainId,
    estimatedCostWei: toDecimalString(estimatedGas * resolvedGasPrice),
    estimatedGas: toDecimalString(estimatedGas),
    gasPriceWei: toDecimalString(resolvedGasPrice),
    pairState,
    quotedAmountOut: toDecimalString(quotedAmountOut),
    routeData: encodePair(config.muchFiV2UsdcWdogePairAddress),
    routePreflightAmountInWei: toDecimalString(ROUTE_PREFLIGHT_AMOUNT_IN),
    router: {
      routerAddress,
      routerCodeBytes: codeBytes(routerCode),
      routerCodeHash: keccak256(routerCode),
      owner,
      paused,
      wDoge
    },
    timestamp: new Date().toISOString(),
    usdcAddress: config.usdcAddress,
    wDogeAddress: config.wDogeAddress
  };
}

async function buildRoutePreflightPlan() {
  const config = resolveDeploymentConfig({ cwd: process.cwd(), requirePrivateKey: true });
  const provider = dogeosProvider(config);
  const wallet = new Wallet(config.privateKey, provider);
  await assertDogeOSNetwork(provider, config);

  const routerAddress = resolveRouterAddress(config);
  const adapterAddress = resolveAdapterAddress(config);
  if (!routerAddress) {
    throw new Error("DOGEOS_SWAP_ROUTER_ADDRESS or deployments/dogeos-chikyu/router-latest.json is required");
  }
  if (!adapterAddress) {
    throw new Error("DOGEOS_V2_PAIR_ADAPTER_ADDRESS or deployments/dogeos-chikyu/adapter-latest.json is required");
  }

  const [block, pairState] = await Promise.all([
    provider.getBlock("latest"),
    readMuchFiV2PairState(provider, config)
  ]);
  const router = await hre.ethers.getContractAt("DogeOSSwapRouter", routerAddress, wallet);
  const adapter = await hre.ethers.getContractAt("DogeOSV2PairAdapter", adapterAddress, provider);
  await verifyDeployedAdapter(provider, config, adapterAddress);

  const pair = await hre.ethers.getContractAt("IUniswapV2Pair", config.muchFiV2UsdcWdogePairAddress, provider);
  const [owner, paused, allowed, quotedAmountOut] = await Promise.all([
    router.owner(),
    router.paused(),
    router.allowedAdapter(adapterAddress),
    adapter.quoteExactInput(pair, config.wDogeAddress, config.usdcAddress, ROUTE_PREFLIGHT_AMOUNT_IN)
  ]);

  if (!allowed) {
    throw new Error("Adapter is not allowlisted; route preflight requires explicit allowlist approval first");
  }
  if (paused) {
    throw new Error("Router is paused; route preflight requires an unpaused router");
  }

  const minAmountOut = quotedAmountOut - quotedAmountOut / 100n;
  const deadline = block.timestamp + 3600;
  const params = {
    tokenIn: ZeroAddress,
    tokenOut: config.usdcAddress,
    recipient: config.deployerAddress,
    amountIn: ROUTE_PREFLIGHT_AMOUNT_IN,
    minAmountOut,
    routeData: encodePair(config.muchFiV2UsdcWdogePairAddress)
  };
  const estimatedSwapGas = await router.exactInput.estimateGas(adapterAddress, params, deadline, {
    value: ROUTE_PREFLIGHT_AMOUNT_IN
  });

  return {
    adapterAddress,
    blockNumber: block.number,
    chainId: config.chainId,
    deadline,
    estimatedSwapGas: toDecimalString(estimatedSwapGas),
    minAmountOut: toDecimalString(minAmountOut),
    owner,
    pairState,
    quotedAmountOut: toDecimalString(quotedAmountOut),
    routeData: params.routeData,
    routePreflightAmountInWei: toDecimalString(ROUTE_PREFLIGHT_AMOUNT_IN),
    routerAddress,
    timestamp: new Date().toISOString(),
    tokenIn: ZeroAddress,
    tokenOut: config.usdcAddress,
    wDogeAddress: config.wDogeAddress
  };
}

module.exports = {
  buildAdapterPlan,
  buildAllowlistPlan,
  buildRoutePreflightPlan,
  dogeosProvider,
  encodePair,
  readMuchFiV2PairState,
  verifyDeployedAdapter
};
