const hre = require("hardhat");
const { Wallet } = require("ethers");
const { buildAdapterPlan, dogeosProvider, verifyDeployedAdapter } = require("./lib/adapterPlan.cjs");
const { resolveDeploymentConfig } = require("./lib/env.cjs");
const { writeJson } = require("./lib/routerPlan.cjs");

const CONFIRM_VALUE = "deploy-dogeos-v2-adapter";

async function main() {
  if (process.env.CONFIRM_DOGEOS_TESTNET_ADAPTER_DEPLOY !== CONFIRM_VALUE) {
    throw new Error(
      `Refusing to deploy adapter. Set CONFIRM_DOGEOS_TESTNET_ADAPTER_DEPLOY=${CONFIRM_VALUE} after reviewing preflight.`
    );
  }

  const plan = await buildAdapterPlan();
  const config = resolveDeploymentConfig({ cwd: process.cwd(), requirePrivateKey: true });
  const provider = dogeosProvider(config);
  const wallet = new Wallet(config.privateKey, provider);
  const Adapter = await hre.ethers.getContractFactory("DogeOSV2PairAdapter", wallet);

  const adapter = await Adapter.deploy(config.muchFiV2FactoryAddress, {
    gasLimit: (BigInt(plan.estimatedGas) * 125n) / 100n
  });
  const deploymentTx = adapter.deploymentTransaction();
  const receipt = await adapter.waitForDeployment().then(() => deploymentTx.wait());
  const adapterAddress = await adapter.getAddress();
  const adapterState = await verifyDeployedAdapter(provider, config, adapterAddress);

  const deployment = {
    ...plan,
    adapter: adapterState,
    adapterAddress,
    deployedBlockNumber: receipt.blockNumber,
    effectiveGasPrice: receipt.gasPrice?.toString() || null,
    explorerUrl: `${config.blockscoutUrl}/tx/${receipt.hash}`,
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status,
    transactionHash: receipt.hash
  };
  const target = writeJson("adapter-latest.json", deployment);

  console.log("DogeOS V2 adapter deployment succeeded");
  console.log(`adapter: ${adapterAddress}`);
  console.log(`factory: ${adapterState.factory}`);
  console.log(`tx: ${receipt.hash}`);
  console.log(`explorer: ${deployment.explorerUrl}`);
  console.log(`deploymentFile: ${target}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
