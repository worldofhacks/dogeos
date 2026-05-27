const { formatEther } = require("ethers");
const { buildAdapterPlan } = require("./lib/adapterPlan.cjs");
const { writeJson } = require("./lib/routerPlan.cjs");

async function main() {
  const plan = await buildAdapterPlan();
  const target = writeJson("adapter-preflight-latest.json", plan);

  console.log("DogeOS V2 adapter deployment preflight passed");
  console.log(`chainId: ${plan.chainId}`);
  console.log(`blockNumber: ${plan.blockNumber}`);
  console.log(`deployer: ${plan.deployerAddress}`);
  console.log(`factory: ${plan.muchFiV2FactoryAddress}`);
  console.log(`pair: ${plan.muchFiV2UsdcWdogePairAddress}`);
  console.log(`WDOGE: ${plan.wDogeAddress}`);
  console.log(`USDC: ${plan.usdcAddress}`);
  console.log(`nonce: ${plan.nonce}`);
  console.log(`predictedAdapter: ${plan.predictedAdapterAddress}`);
  console.log(`estimatedGas: ${plan.estimatedGas}`);
  console.log(`gasPriceWei: ${plan.gasPriceWei}`);
  console.log(`estimatedCostDOGE: ${formatEther(BigInt(plan.estimatedCostWei))}`);
  console.log(`planFile: ${target}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
