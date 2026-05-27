const hre = require("hardhat");
const { Contract, Wallet, ZeroAddress, formatEther, formatUnits, parseEther } = require("ethers");
const {
  buildRoutePreflightPlan,
  dogeosProvider,
  encodePair,
  readMuchFiV2PairState,
  verifyDeployedAdapter
} = require("./lib/adapterPlan.cjs");
const {
  calculateMinAmountOut,
  parseBoundedBps,
  parseBoundedInteger,
  validatePositiveAmount,
  writeCanaryEvidence
} = require("./lib/canarySwap.cjs");
const { resolveDeploymentConfig } = require("./lib/env.cjs");
const { resolveAdapterAddress, resolveRouterAddress } = require("./lib/deploymentState.cjs");

const CONFIRM_VALUE = "swap-dogeos-v2-canary";
const ERC20_ABI = [
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

async function main() {
  if (process.env.CONFIRM_DOGEOS_TESTNET_CANARY_SWAP !== CONFIRM_VALUE) {
    throw new Error(
      `Refusing to run live canary swap. Set CONFIRM_DOGEOS_TESTNET_CANARY_SWAP=${CONFIRM_VALUE} after route preflight.`
    );
  }

  const startedAt = new Date().toISOString();
  const config = resolveDeploymentConfig({ cwd: process.cwd(), requirePrivateKey: true });
  const provider = dogeosProvider(config);
  const wallet = new Wallet(config.privateKey, provider);
  const routerAddress = resolveRouterAddress(config);
  const adapterAddress = resolveAdapterAddress(config);
  if (!routerAddress) {
    throw new Error("DOGEOS_SWAP_ROUTER_ADDRESS or deployments/dogeos-chikyu/router-latest.json is required");
  }
  if (!adapterAddress) {
    throw new Error("DOGEOS_V2_PAIR_ADAPTER_ADDRESS or deployments/dogeos-chikyu/adapter-latest.json is required");
  }

  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) {
    throw new Error(`Expected chainId ${config.chainId}, got ${network.chainId.toString()}`);
  }

  const amountIn = validatePositiveAmount(
    parseEther(process.env.DOGEOS_CANARY_SWAP_DOGE || "0.0001"),
    "DOGEOS_CANARY_SWAP_DOGE"
  );
  const slippageBps = parseBoundedBps(process.env.DOGEOS_CANARY_SLIPPAGE_BPS || "200", "DOGEOS_CANARY_SLIPPAGE_BPS", 1000);
  const deadlineSeconds = parseBoundedInteger(
    process.env.DOGEOS_CANARY_DEADLINE_SECONDS || "600",
    "DOGEOS_CANARY_DEADLINE_SECONDS",
    60,
    3600
  );

  const routePreflight = await buildRoutePreflightPlan();
  const router = await hre.ethers.getContractAt("DogeOSSwapRouter", routerAddress, wallet);
  const adapter = await hre.ethers.getContractAt("DogeOSV2PairAdapter", adapterAddress, provider);
  const pair = await hre.ethers.getContractAt("IUniswapV2Pair", config.muchFiV2UsdcWdogePairAddress, provider);
  const usdc = new Contract(config.usdcAddress, ERC20_ABI, provider);
  const wDoge = new Contract(config.wDogeAddress, ERC20_ABI, provider);

  const [adapterState, pairState, latestBlock, owner, pausedBefore, allowedBefore, usdcSymbol, usdcDecimals] =
    await Promise.all([
      verifyDeployedAdapter(provider, config, adapterAddress),
      readMuchFiV2PairState(provider, config),
      provider.getBlock("latest"),
      router.owner(),
      router.paused(),
      router.allowedAdapter(adapterAddress),
      usdc.symbol(),
      usdc.decimals()
    ]);

  if (pausedBefore) {
    throw new Error("Router is paused; refusing canary swap");
  }
  if (!allowedBefore) {
    throw new Error("Adapter is not allowlisted; run allowlist preflight and allowlist transaction first");
  }

  const quotedAmountOut = await adapter.quoteExactInput(
    pair,
    config.wDogeAddress,
    config.usdcAddress,
    amountIn
  );
  const minAmountOut = calculateMinAmountOut(quotedAmountOut, slippageBps);
  validatePositiveAmount(quotedAmountOut, "quotedAmountOut");
  validatePositiveAmount(minAmountOut, "minAmountOut");

  const deadline = latestBlock.timestamp + deadlineSeconds;
  const routeData = encodePair(config.muchFiV2UsdcWdogePairAddress);
  const params = {
    tokenIn: ZeroAddress,
    tokenOut: config.usdcAddress,
    recipient: wallet.address,
    amountIn,
    minAmountOut,
    routeData
  };

  const [
    nativeBalanceBefore,
    usdcBefore,
    routerWdogeBefore,
    routerUsdcBefore,
    gasPrice,
    estimatedGas
  ] = await Promise.all([
    provider.getBalance(wallet.address),
    usdc.balanceOf(wallet.address),
    wDoge.balanceOf(routerAddress),
    usdc.balanceOf(routerAddress),
    provider.getFeeData().then((feeData) => feeData.gasPrice || 0n),
    router.exactInput.estimateGas(adapterAddress, params, deadline, { value: amountIn })
  ]);

  const estimatedCost = estimatedGas * gasPrice;
  if (nativeBalanceBefore < amountIn + estimatedCost) {
    throw new Error(
      `Canary wallet balance ${formatEther(nativeBalanceBefore)} DOGE is below amount plus estimated gas ${formatEther(
        amountIn + estimatedCost
      )} DOGE`
    );
  }

  const tx = await router.exactInput(adapterAddress, params, deadline, {
    value: amountIn,
    gasLimit: (estimatedGas * 125n) / 100n
  });
  const receipt = await tx.wait();
  if (receipt.status !== 1) {
    throw new Error(`Canary swap failed: ${receipt.hash}`);
  }

  const [
    nativeBalanceAfter,
    usdcAfter,
    routerWdogeAfter,
    routerUsdcAfter,
    pausedAfter,
    allowedAfter,
    routerAdapterAllowanceAfter
  ] = await Promise.all([
    provider.getBalance(wallet.address),
    usdc.balanceOf(wallet.address),
    wDoge.balanceOf(routerAddress),
    usdc.balanceOf(routerAddress),
    router.paused(),
    router.allowedAdapter(adapterAddress),
    wDoge.allowance(routerAddress, adapterAddress)
  ]);

  const actualAmountOut = usdcAfter - usdcBefore;
  if (actualAmountOut < minAmountOut) {
    throw new Error(`Canary output ${actualAmountOut} is below minAmountOut ${minAmountOut}`);
  }
  if (routerWdogeAfter !== routerWdogeBefore) {
    throw new Error(`Router WDOGE balance changed: before=${routerWdogeBefore} after=${routerWdogeAfter}`);
  }
  if (routerUsdcAfter !== routerUsdcBefore) {
    throw new Error(`Router USDC balance changed: before=${routerUsdcBefore} after=${routerUsdcAfter}`);
  }
  if (routerAdapterAllowanceAfter !== 0n) {
    throw new Error(`Router WDOGE adapter allowance was not reset: ${routerAdapterAllowanceAfter}`);
  }

  const evidence = {
    startedAt,
    completedAt: new Date().toISOString(),
    chainId: config.chainId,
    deployerAddress: config.deployerAddress,
    recipient: wallet.address,
    routerAddress,
    adapterAddress,
    owner,
    adapter: adapterState,
    pairAddress: config.muchFiV2UsdcWdogePairAddress,
    pairState,
    routePreflight,
    wDogeAddress: config.wDogeAddress,
    usdcAddress: config.usdcAddress,
    usdcSymbol,
    usdcDecimals: Number(usdcDecimals),
    amountInWei: amountIn.toString(),
    amountInDoge: formatEther(amountIn),
    quotedAmountOut: quotedAmountOut.toString(),
    minAmountOut: minAmountOut.toString(),
    actualAmountOut: actualAmountOut.toString(),
    actualAmountOutFormatted: formatUnits(actualAmountOut, usdcDecimals),
    slippageBps,
    deadline,
    deadlineSeconds,
    routeData,
    estimatedGas: estimatedGas.toString(),
    gasPriceWei: gasPrice.toString(),
    estimatedCostWei: estimatedCost.toString(),
    balances: {
      nativeBeforeWei: nativeBalanceBefore.toString(),
      nativeAfterWei: nativeBalanceAfter.toString(),
      usdcBefore: usdcBefore.toString(),
      usdcAfter: usdcAfter.toString(),
      routerWdogeBefore: routerWdogeBefore.toString(),
      routerWdogeAfter: routerWdogeAfter.toString(),
      routerUsdcBefore: routerUsdcBefore.toString(),
      routerUsdcAfter: routerUsdcAfter.toString()
    },
    receipt: {
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.gasPrice?.toString() || null,
      explorerUrl: `${config.blockscoutUrl}/tx/${receipt.hash}`
    },
    postChecks: {
      adapterAllowed: allowedAfter,
      outputMetMinimum: actualAmountOut >= minAmountOut,
      routerAdapterAllowanceReset: routerAdapterAllowanceAfter === 0n,
      routerPaused: pausedAfter,
      routerUsdcDeltaZero: routerUsdcAfter === routerUsdcBefore,
      routerWdogeDeltaZero: routerWdogeAfter === routerWdogeBefore
    }
  };
  const paths = writeCanaryEvidence(evidence);

  console.log("DogeOS V2 canary swap succeeded");
  console.log(`router: ${routerAddress}`);
  console.log(`adapter: ${adapterAddress}`);
  console.log(`amountInDOGE: ${formatEther(amountIn)}`);
  console.log(`quotedOut${usdcSymbol}: ${formatUnits(quotedAmountOut, usdcDecimals)}`);
  console.log(`actualOut${usdcSymbol}: ${formatUnits(actualAmountOut, usdcDecimals)}`);
  console.log(`gasUsed: ${receipt.gasUsed.toString()}`);
  console.log(`tx: ${receipt.hash}`);
  console.log(`explorer: ${evidence.receipt.explorerUrl}`);
  console.log(`json: ${paths.deploymentJsonPath}`);
  console.log(`latestJson: ${paths.latestJsonPath}`);
  console.log(`markdown: ${paths.markdownPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
