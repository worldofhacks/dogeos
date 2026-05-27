const hre = require("hardhat");
const { resolveDeploymentConfig } = require("./lib/env.cjs");
const { resolveAdapterAddress } = require("./lib/deploymentState.cjs");

async function main() {
  const config = resolveDeploymentConfig({ cwd: process.cwd(), requirePrivateKey: false });
  const adapterAddress = resolveAdapterAddress(config);
  if (!adapterAddress) {
    throw new Error("DOGEOS_V2_PAIR_ADAPTER_ADDRESS or deployments/dogeos-chikyu/adapter-latest.json is required");
  }

  try {
    await hre.run("verify:verify", {
      address: adapterAddress,
      constructorArguments: [config.muchFiV2FactoryAddress],
      contract: "contracts/src/adapters/DogeOSV2PairAdapter.sol:DogeOSV2PairAdapter"
    });
  } catch (error) {
    if (!/already verified/i.test(error.message || "")) {
      throw error;
    }
    console.log("DogeOS V2 adapter source was already verified");
  }

  console.log("DogeOS V2 adapter source verification submitted");
  console.log(`adapter: ${adapterAddress}`);
  console.log(`constructor factory: ${config.muchFiV2FactoryAddress}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
