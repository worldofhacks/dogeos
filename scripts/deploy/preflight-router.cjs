const { formatEther } = require("ethers");
const { buildRouterPlan, writeJson } = require("./lib/routerPlan.cjs");

async function main() {
  const plan = await buildRouterPlan();
  const target = writeJson("router-preflight-latest.json", plan);

  console.log("DogeOS router deployment preflight passed");
  console.log(`chainId: ${plan.chainId}`);
  console.log(`blockNumber: ${plan.blockNumber}`);
  console.log(`deployer: ${plan.deployerAddress}`);
  console.log(`routerOwner: ${plan.routerOwnerAddress}`);
  console.log(`WDOGE: ${plan.wDogeAddress}`);
  console.log(`nonce: ${plan.nonce}`);
  console.log(`predictedRouter: ${plan.predictedRouterAddress}`);
  console.log(`estimatedGas: ${plan.estimatedGas}`);
  console.log(`gasPriceWei: ${plan.gasPriceWei}`);
  console.log(`estimatedCostDOGE: ${formatEther(BigInt(plan.estimatedCostWei))}`);
  console.log(`planFile: ${target}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
