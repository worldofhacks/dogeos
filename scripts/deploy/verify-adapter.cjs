const { parseEther } = require("ethers");
const hre = require("hardhat");
const { dogeosProvider, readMuchFiV2PairState, verifyDeployedAdapter } = require("./lib/adapterPlan.cjs");
const { resolveDeploymentConfig } = require("./lib/env.cjs");
const { resolveAdapterAddress } = require("./lib/deploymentState.cjs");

const ROUTE_PREFLIGHT_AMOUNT_IN = parseEther(process.env.DOGEOS_ROUTE_PREFLIGHT_DOGE || "0.001");

async function main() {
  const config = resolveDeploymentConfig({ cwd: process.cwd(), requirePrivateKey: false });
  const adapterAddress = resolveAdapterAddress(config);
  if (!adapterAddress) {
    throw new Error("DOGEOS_V2_PAIR_ADAPTER_ADDRESS or deployments/dogeos-chikyu/adapter-latest.json is required");
  }

  const provider = dogeosProvider(config);
  const adapterState = await verifyDeployedAdapter(provider, config, adapterAddress);
  const pairState = await readMuchFiV2PairState(provider, config);
  const adapter = await hre.ethers.getContractAt("DogeOSV2PairAdapter", adapterAddress, provider);
  const pair = await hre.ethers.getContractAt("IUniswapV2Pair", config.muchFiV2UsdcWdogePairAddress, provider);
  const quotedAmountOut = await adapter.quoteExactInput(
    pair,
    config.wDogeAddress,
    config.usdcAddress,
    ROUTE_PREFLIGHT_AMOUNT_IN
  );

  console.log("DogeOS V2 adapter verification passed");
  console.log(`adapter: ${adapterState.adapterAddress}`);
  console.log(`factory: ${adapterState.factory}`);
  console.log(`codeBytes: ${adapterState.adapterCodeBytes}`);
  console.log(`canonicalPair: ${pairState.token0}/${pairState.token1}`);
  console.log(`routeQuoteAmountOut: ${quotedAmountOut.toString()}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
