const hre = require("hardhat");
const { resolveDeploymentConfig } = require("./lib/env.cjs");
const { resolveRouterAddress } = require("./lib/deploymentState.cjs");

async function main() {
  const config = resolveDeploymentConfig({ cwd: process.cwd(), requirePrivateKey: false });
  const routerAddress = resolveRouterAddress(config);
  if (!routerAddress) {
    throw new Error("DOGEOS_SWAP_ROUTER_ADDRESS or deployments/dogeos-chikyu/router-latest.json is required");
  }

  const provider = new hre.ethers.JsonRpcProvider(config.rpcUrl, {
    chainId: config.chainId,
    name: "dogeos-chikyu-testnet"
  });
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) {
    throw new Error(`Expected chainId ${config.chainId}, got ${network.chainId.toString()}`);
  }

  const code = await provider.getCode(routerAddress);
  if (code === "0x") {
    throw new Error(`No router bytecode found at ${routerAddress}`);
  }

  const router = await hre.ethers.getContractAt("DogeOSSwapRouter", routerAddress, provider);
  const [owner, wDoge, paused] = await Promise.all([router.owner(), router.wDoge(), router.paused()]);

  if (wDoge !== config.wDogeAddress) {
    throw new Error(`Router WDOGE mismatch: expected ${config.wDogeAddress}, got ${wDoge}`);
  }

  console.log("DogeOS router verification passed");
  console.log(`router: ${routerAddress}`);
  console.log(`owner: ${owner}`);
  console.log(`wDoge: ${wDoge}`);
  console.log(`paused: ${paused}`);
  console.log(`codeBytes: ${Math.max((code.length - 2) / 2, 0)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
