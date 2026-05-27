const { Wallet } = require("ethers");
const hre = require("hardhat");
const { buildAllowlistPlan, dogeosProvider } = require("./lib/adapterPlan.cjs");
const { resolveDeploymentConfig } = require("./lib/env.cjs");
const { writeJson } = require("./lib/routerPlan.cjs");

const CONFIRM_VALUE = "allowlist-dogeos-v2-adapter";

async function main() {
  if (process.env.CONFIRM_DOGEOS_TESTNET_ALLOWLIST !== CONFIRM_VALUE) {
    throw new Error(
      `Refusing to allowlist adapter. Set CONFIRM_DOGEOS_TESTNET_ALLOWLIST=${CONFIRM_VALUE} after explicit approval.`
    );
  }

  const plan = await buildAllowlistPlan();
  if (plan.alreadyAllowed) {
    const target = writeJson("adapter-allowlist-latest.json", {
      ...plan,
      status: "already-allowed"
    });
    console.log("DogeOS V2 adapter is already allowlisted");
    console.log(`router: ${plan.router.routerAddress}`);
    console.log(`adapter: ${plan.adapter.adapterAddress}`);
    console.log(`deploymentFile: ${target}`);
    return;
  }

  const config = resolveDeploymentConfig({ cwd: process.cwd(), requirePrivateKey: true });
  const provider = dogeosProvider(config);
  const wallet = new Wallet(config.privateKey, provider);
  const router = await hre.ethers.getContractAt("DogeOSSwapRouter", plan.router.routerAddress, wallet);

  const tx = await router.setAdapterAllowed(plan.adapter.adapterAddress, true, {
    gasLimit: (BigInt(plan.estimatedGas) * 125n) / 100n
  });
  const receipt = await tx.wait();
  const allowed = await router.allowedAdapter(plan.adapter.adapterAddress);
  if (!allowed) {
    throw new Error("Adapter allowlist transaction succeeded but router.allowedAdapter is false");
  }

  const deployment = {
    ...plan,
    deployedBlockNumber: receipt.blockNumber,
    effectiveGasPrice: receipt.gasPrice?.toString() || null,
    explorerUrl: `${config.blockscoutUrl}/tx/${receipt.hash}`,
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status,
    transactionHash: receipt.hash
  };
  const target = writeJson("adapter-allowlist-latest.json", deployment);

  console.log("DogeOS V2 adapter allowlist succeeded");
  console.log(`router: ${plan.router.routerAddress}`);
  console.log(`adapter: ${plan.adapter.adapterAddress}`);
  console.log(`tx: ${receipt.hash}`);
  console.log(`explorer: ${deployment.explorerUrl}`);
  console.log(`deploymentFile: ${target}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
