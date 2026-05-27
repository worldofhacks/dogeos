const { formatEther } = require("ethers");
const { buildAllowlistPlan } = require("./lib/adapterPlan.cjs");
const { writeJson } = require("./lib/routerPlan.cjs");

async function main() {
  const plan = await buildAllowlistPlan();
  const target = writeJson("adapter-allowlist-preflight-latest.json", plan);

  console.log("DogeOS V2 adapter allowlist preflight passed");
  console.log(`chainId: ${plan.chainId}`);
  console.log(`blockNumber: ${plan.blockNumber}`);
  console.log(`router: ${plan.router.routerAddress}`);
  console.log(`adapter: ${plan.adapter.adapterAddress}`);
  console.log(`owner: ${plan.router.owner}`);
  console.log(`paused: ${plan.router.paused}`);
  console.log(`alreadyAllowed: ${plan.alreadyAllowed}`);
  console.log(`routeQuoteAmountOut: ${plan.quotedAmountOut}`);
  console.log(`estimatedGas: ${plan.estimatedGas}`);
  console.log(`gasPriceWei: ${plan.gasPriceWei}`);
  console.log(`estimatedCostDOGE: ${formatEther(BigInt(plan.estimatedCostWei))}`);
  console.log(`planFile: ${target}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
