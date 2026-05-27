const fs = require("node:fs");
const path = require("node:path");
const { Wallet, formatEther, getCreateAddress } = require("ethers");
const hre = require("hardhat");
const { resolveDeploymentConfig } = require("./env.cjs");

function toDecimalString(value) {
  return value.toString();
}

async function buildRouterPlan() {
  const config = resolveDeploymentConfig({ cwd: process.cwd(), requirePrivateKey: true });
  const provider = new hre.ethers.JsonRpcProvider(config.rpcUrl, {
    chainId: config.chainId,
    name: "dogeos-chikyu-testnet"
  });
  const wallet = new Wallet(config.privateKey, provider);
  const network = await provider.getNetwork();

  if (Number(network.chainId) !== config.chainId) {
    throw new Error(`Expected chainId ${config.chainId}, got ${network.chainId.toString()}`);
  }

  const [blockNumber, balance, gasPrice, wDogeCode, nonce] = await Promise.all([
    provider.getBlockNumber(),
    provider.getBalance(config.deployerAddress),
    provider.getFeeData().then((feeData) => feeData.gasPrice),
    provider.getCode(config.wDogeAddress),
    provider.getTransactionCount(config.deployerAddress, "pending")
  ]);

  if (wDogeCode === "0x") {
    throw new Error(`WDOGE has no bytecode at ${config.wDogeAddress}`);
  }

  const Router = await hre.ethers.getContractFactory("DogeOSSwapRouter", wallet);
  const unsignedTx = await Router.getDeployTransaction(config.routerOwnerAddress, config.wDogeAddress);
  const estimatedGas = await wallet.estimateGas(unsignedTx);
  const resolvedGasPrice = gasPrice || 0n;
  const estimatedCost = estimatedGas * resolvedGasPrice;
  const predictedRouterAddress = getCreateAddress({
    from: config.deployerAddress,
    nonce
  });

  if (balance < estimatedCost) {
    throw new Error(
      `Deployer balance ${formatEther(balance)} DOGE is below estimated deployment cost ${formatEther(
        estimatedCost
      )} DOGE`
    );
  }

  return {
    blockNumber,
    blockscoutUrl: config.blockscoutUrl,
    chainId: config.chainId,
    deployerAddress: config.deployerAddress,
    estimatedCostWei: toDecimalString(estimatedCost),
    estimatedGas: toDecimalString(estimatedGas),
    gasPriceWei: toDecimalString(resolvedGasPrice),
    nonce,
    predictedRouterAddress,
    routerOwnerAddress: config.routerOwnerAddress,
    rpcUrl: config.rpcUrl,
    timestamp: new Date().toISOString(),
    wDogeAddress: config.wDogeAddress,
    wDogeCodeBytes: Math.max((wDogeCode.length - 2) / 2, 0)
  };
}

function deploymentDir() {
  return path.join(process.cwd(), "deployments", "dogeos-chikyu");
}

function writeJson(filename, value) {
  const dir = deploymentDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, filename);
  fs.writeFileSync(`${target}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${target}.tmp`, target);
  return target;
}

module.exports = {
  buildRouterPlan,
  deploymentDir,
  writeJson
};
