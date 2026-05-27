const hre = require("hardhat");
const { Wallet } = require("ethers");
const { buildRouterPlan, writeJson } = require("./lib/routerPlan.cjs");
const { resolveDeploymentConfig } = require("./lib/env.cjs");

const CONFIRM_VALUE = "deploy-dogeos-router";

async function main() {
  if (process.env.CONFIRM_DOGEOS_TESTNET_DEPLOY !== CONFIRM_VALUE) {
    throw new Error(`Refusing to deploy. Set CONFIRM_DOGEOS_TESTNET_DEPLOY=${CONFIRM_VALUE} after reviewing preflight.`);
  }

  const plan = await buildRouterPlan();
  const config = resolveDeploymentConfig({ cwd: process.cwd(), requirePrivateKey: true });
  const provider = new hre.ethers.JsonRpcProvider(config.rpcUrl, {
    chainId: config.chainId,
    name: "dogeos-chikyu-testnet"
  });
  const wallet = new Wallet(config.privateKey, provider);
  const Router = await hre.ethers.getContractFactory("DogeOSSwapRouter", wallet);

  const router = await Router.deploy(config.routerOwnerAddress, config.wDogeAddress, {
    gasLimit: (BigInt(plan.estimatedGas) * 125n) / 100n
  });
  const deploymentTx = router.deploymentTransaction();
  const receipt = await router.waitForDeployment().then(() => deploymentTx.wait());
  const routerAddress = await router.getAddress();

  const owner = await router.owner();
  const wDoge = await router.wDoge();
  const paused = await router.paused();
  const code = await provider.getCode(routerAddress);

  if (owner !== config.routerOwnerAddress) {
    throw new Error(`Router owner mismatch: expected ${config.routerOwnerAddress}, got ${owner}`);
  }
  if (wDoge !== config.wDogeAddress) {
    throw new Error(`Router WDOGE mismatch: expected ${config.wDogeAddress}, got ${wDoge}`);
  }
  if (paused) {
    throw new Error("Router unexpectedly deployed paused");
  }
  if (code === "0x") {
    throw new Error("Router deployment has no bytecode");
  }

  const deployment = {
    ...plan,
    routerAddress,
    status: receipt.status,
    transactionHash: receipt.hash,
    deployedBlockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.gasPrice?.toString() || null,
    explorerUrl: `${config.blockscoutUrl}/tx/${receipt.hash}`
  };
  const target = writeJson("router-latest.json", deployment);

  console.log("DogeOS router deployment succeeded");
  console.log(`router: ${routerAddress}`);
  console.log(`owner: ${owner}`);
  console.log(`wDoge: ${wDoge}`);
  console.log(`tx: ${receipt.hash}`);
  console.log(`explorer: ${deployment.explorerUrl}`);
  console.log(`deploymentFile: ${target}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
