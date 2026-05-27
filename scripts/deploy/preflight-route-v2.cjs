const { buildRoutePreflightPlan } = require("./lib/adapterPlan.cjs");
const { writeJson } = require("./lib/routerPlan.cjs");

async function main() {
  const plan = await buildRoutePreflightPlan();
  const target = writeJson("route-v2-preflight-latest.json", plan);

  console.log("DogeOS V2 route preflight passed");
  console.log(`chainId: ${plan.chainId}`);
  console.log(`blockNumber: ${plan.blockNumber}`);
  console.log(`router: ${plan.routerAddress}`);
  console.log(`adapter: ${plan.adapterAddress}`);
  console.log(`tokenIn: ${plan.tokenIn}`);
  console.log(`tokenOut: ${plan.tokenOut}`);
  console.log(`amountInWei: ${plan.routePreflightAmountInWei}`);
  console.log(`quotedAmountOut: ${plan.quotedAmountOut}`);
  console.log(`minAmountOut: ${plan.minAmountOut}`);
  console.log(`estimatedSwapGas: ${plan.estimatedSwapGas}`);
  console.log(`planFile: ${target}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
