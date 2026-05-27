const hre = require("hardhat");
const { resolveDeploymentConfig } = require("./lib/env.cjs");
const { resolveRouterAddress } = require("./lib/deploymentState.cjs");

async function main() {
  const config = resolveDeploymentConfig({ cwd: process.cwd(), requirePrivateKey: false });
  const routerAddress = resolveRouterAddress(config);
  if (!routerAddress) {
    throw new Error("DOGEOS_SWAP_ROUTER_ADDRESS or deployments/dogeos-chikyu/router-latest.json is required");
  }

  try {
    await hre.run("verify:verify", {
      address: routerAddress,
      constructorArguments: [config.routerOwnerAddress, config.wDogeAddress],
      contract: "contracts/src/router/DogeOSSwapRouter.sol:DogeOSSwapRouter"
    });
  } catch (error) {
    if (!/already verified/i.test(error.message || "")) {
      throw error;
    }
    console.log("DogeOS router source was already verified");
  }

  console.log("DogeOS router source verification submitted");
  console.log(`router: ${routerAddress}`);
  console.log(`constructor owner: ${config.routerOwnerAddress}`);
  console.log(`constructor WDOGE: ${config.wDogeAddress}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
