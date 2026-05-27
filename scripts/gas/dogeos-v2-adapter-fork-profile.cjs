const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { DEFAULT_DOGEOS_RPC_URL } = require("../deploy/lib/env.cjs");
const { estimateCostWei } = require("./lib/report.cjs");

const REPORT_DATE = process.env.REPORT_DATE || new Date().toISOString().slice(0, 10);
const RPC_URL = process.env.DOGEOS_RPC_URL || DEFAULT_DOGEOS_RPC_URL;
const REFERENCE_GAS_PRICE_WEI = process.env.DOGEOS_REFERENCE_GAS_PRICE_WEI || "15680108";

const ADDRESSES = {
  factory: "0x7864071B532894216e3C045a74814EafEB92ae20",
  pairUsdcWdoge: "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
  usdc: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
  wDoge: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE"
};

const AMOUNT_IN = hre.ethers.parseEther(process.env.DOGEOS_FORK_SWAP_DOGE || "0.001");

function encodePair(pairAddress) {
  return hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [pairAddress]);
}

async function txGas(transactionPromise) {
  const tx = await transactionPromise;
  const receipt = await tx.wait();
  return receipt.gasUsed;
}

function writeForkGasReport(json) {
  const dir = path.join(process.cwd(), "docs", "dexv3");
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, `dogeos-v2-adapter-fork-gas-profile-${REPORT_DATE}.json`);
  const mdPath = path.join(dir, `dogeos-v2-adapter-fork-gas-profile-${REPORT_DATE}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);

  const body = json.rows
    .map(
      (row) =>
        `| ${row.category} | \`${row.action}\` | \`${row.gasUsed}\` | \`${row.estimatedCostWei}\` | ${row.notes} |`
    )
    .join("\n");

  fs.writeFileSync(
    mdPath,
    `# DogeOS V2 Adapter Fork Gas Profile

Generated: \`${json.generatedAt}\`

This profile runs on a local Hardhat fork of DogeOS Chikyu. No transaction was broadcast to DogeOS. The swap row uses the real MuchFi V2 WDOGE/USDC pair bytecode and the production \`DogeOSV2PairAdapter\` deployed only inside the fork.

| Field | Value |
| --- | --- |
| Fork block | \`${json.forkBlockNumber}\` |
| RPC | \`${json.rpcUrl}\` |
| Factory | \`${json.addresses.factory}\` |
| Pair | \`${json.addresses.pairUsdcWdoge}\` |
| Token in | native DOGE via WDOGE \`${json.addresses.wDoge}\` |
| Token out | USDC \`${json.addresses.usdc}\` |
| Amount in | \`${json.amountInWei}\` wei |
| Quoted amount out | \`${json.quotedAmountOut}\` |
| Reference gas price | \`${json.referenceGasPriceWei}\` wei |

| Category | Action | Gas Used | Estimated Cost Wei | Notes |
| --- | --- | ---: | ---: | --- |
${body}
`
  );

  return { jsonPath, mdPath };
}

async function main() {
  await hre.network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl: RPC_URL
        }
      }
    ]
  });

  const [owner, user, recipient] = await hre.ethers.getSigners();
  const provider = hre.ethers.provider;
  const forkBlockNumber = await provider.getBlockNumber();

  const Adapter = await hre.ethers.getContractFactory("DogeOSV2PairAdapter");
  const adapter = await Adapter.deploy(ADDRESSES.factory);
  const adapterDeploymentReceipt = await adapter.deploymentTransaction().wait();

  const Router = await hre.ethers.getContractFactory("DogeOSSwapRouter");
  const router = await Router.deploy(owner.address, ADDRESSES.wDoge);
  const routerDeploymentReceipt = await router.deploymentTransaction().wait();

  const pair = await hre.ethers.getContractAt("IUniswapV2Pair", ADDRESSES.pairUsdcWdoge);
  const quotedAmountOut = await adapter.quoteExactInput(pair, ADDRESSES.wDoge, ADDRESSES.usdc, AMOUNT_IN);
  const minAmountOut = quotedAmountOut - quotedAmountOut / 100n;

  const allowGas = await txGas(router.connect(owner).setAdapterAllowed(await adapter.getAddress(), true));
  const deadline = (await provider.getBlock("latest")).timestamp + 3600;
  const params = {
    tokenIn: hre.ethers.ZeroAddress,
    tokenOut: ADDRESSES.usdc,
    recipient: recipient.address,
    amountIn: AMOUNT_IN,
    minAmountOut,
    routeData: encodePair(ADDRESSES.pairUsdcWdoge)
  };
  const swapGas = await txGas(
    router.connect(user).exactInput(await adapter.getAddress(), params, deadline, {
      value: AMOUNT_IN
    })
  );

  const rows = [
    {
      category: "deployment",
      action: "DogeOSV2PairAdapter.constructor",
      gasUsed: adapterDeploymentReceipt.gasUsed.toString(),
      estimatedCostWei: estimateCostWei(adapterDeploymentReceipt.gasUsed.toString(), REFERENCE_GAS_PRICE_WEI),
      notes: "fork-local deployment bound to MuchFi V2 factory"
    },
    {
      category: "deployment",
      action: "DogeOSSwapRouter.constructor",
      gasUsed: routerDeploymentReceipt.gasUsed.toString(),
      estimatedCostWei: estimateCostWei(routerDeploymentReceipt.gasUsed.toString(), REFERENCE_GAS_PRICE_WEI),
      notes: "fork-local router deployment with DogeOS WDOGE"
    },
    {
      category: "admin",
      action: "setAdapterAllowed(adapter,true)",
      gasUsed: allowGas.toString(),
      estimatedCostWei: estimateCostWei(allowGas.toString(), REFERENCE_GAS_PRICE_WEI),
      notes: "fork-local allowlist transaction"
    },
    {
      category: "fork-swap",
      action: "exactInput MuchFi V2 native DOGE -> USDC",
      gasUsed: swapGas.toString(),
      estimatedCostWei: estimateCostWei(swapGas.toString(), REFERENCE_GAS_PRICE_WEI),
      notes: "real DogeOS WDOGE and MuchFi V2 pair bytecode on local fork"
    }
  ];

  const json = {
    generatedAt: new Date().toISOString(),
    rpcUrl: RPC_URL,
    forkBlockNumber,
    referenceGasPriceWei: REFERENCE_GAS_PRICE_WEI,
    amountInWei: AMOUNT_IN.toString(),
    quotedAmountOut: quotedAmountOut.toString(),
    minAmountOut: minAmountOut.toString(),
    addresses: ADDRESSES,
    deployedInFork: {
      router: await router.getAddress(),
      adapter: await adapter.getAddress(),
      owner: owner.address,
      user: user.address,
      recipient: recipient.address
    },
    rows
  };
  const { jsonPath, mdPath } = writeForkGasReport(json);

  console.log("DogeOS V2 adapter fork gas profile completed");
  console.log(`forkBlockNumber: ${forkBlockNumber}`);
  console.log(`quotedAmountOut: ${quotedAmountOut.toString()}`);
  for (const row of rows) {
    console.log(`${row.category} ${row.action}: ${row.gasUsed} gas`);
  }
  console.log(`json: ${jsonPath}`);
  console.log(`markdown: ${mdPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
