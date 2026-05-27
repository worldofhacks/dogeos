const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { buildMarkdownGasReport, estimateCostWei, writeGasReport } = require("./lib/report.cjs");

const REPORT_DATE = process.env.REPORT_DATE || new Date().toISOString().slice(0, 10);
const AMOUNT_IN = hre.ethers.parseEther("10");
const AMOUNT_OUT = hre.ethers.parseEther("9");
const MIN_AMOUNT_OUT = hre.ethers.parseEther("8");
const LIQUIDITY_IN = hre.ethers.parseEther("1000");
const LIQUIDITY_OUT = hre.ethers.parseEther("1000");
const FALLBACK_REFERENCE_GAS_PRICE_WEI = "15680108";

function readReferenceGasPriceWei() {
  const preflightPath = path.join(process.cwd(), "deployments", "dogeos-chikyu", "router-preflight-latest.json");
  if (!fs.existsSync(preflightPath)) {
    return FALLBACK_REFERENCE_GAS_PRICE_WEI;
  }

  const preflight = JSON.parse(fs.readFileSync(preflightPath, "utf8"));
  return preflight.gasPriceWei || FALLBACK_REFERENCE_GAS_PRICE_WEI;
}

function routeParams({ tokenIn, tokenOut, recipient, amount = AMOUNT_IN, min = MIN_AMOUNT_OUT, routeData = "0x" }) {
  return {
    tokenIn,
    tokenOut,
    recipient,
    amountIn: amount,
    minAmountOut: min,
    routeData
  };
}

function encodePool(poolAddress) {
  return hre.ethers.AbiCoder.defaultAbiCoder().encode(["address"], [poolAddress]);
}

async function txGas(transactionPromise) {
  const tx = await transactionPromise;
  const receipt = await tx.wait();
  return receipt.gasUsed;
}

async function fundAsset(asset, wDoge, account, amount) {
  if ((await asset.getAddress()).toLowerCase() === (await wDoge.getAddress()).toLowerCase()) {
    await wDoge.connect(account).deposit({ value: amount });
    return;
  }

  await asset.mint(account.address, amount);
}

async function deployFixture() {
  const [owner, user, recipient, pendingOwner] = await hre.ethers.getSigners();

  const Token = await hre.ethers.getContractFactory("MockERC20");
  const tokenIn = await Token.deploy("Token In", "TIN");
  const tokenOut = await Token.deploy("Token Out", "TOUT");

  const WDOGE = await hre.ethers.getContractFactory("MockWDOGE");
  const wDoge = await WDOGE.deploy();

  const Adapter = await hre.ethers.getContractFactory("MockSwapAdapter");
  const adapter = await Adapter.deploy();

  const Router = await hre.ethers.getContractFactory("DogeOSSwapRouter");
  const router = await Router.deploy(owner.address, await wDoge.getAddress());

  await tokenIn.mint(user.address, hre.ethers.parseEther("100"));
  await tokenOut.mint(await adapter.getAddress(), hre.ethers.parseEther("100"));
  await wDoge.connect(owner).deposit({ value: hre.ethers.parseEther("100") });
  await wDoge.connect(owner).transfer(await adapter.getAddress(), hre.ethers.parseEther("100"));
  await adapter.setAmountOut(AMOUNT_OUT);

  return { owner, user, recipient, pendingOwner, tokenIn, tokenOut, wDoge, adapter, router };
}

async function deploymentGas() {
  const [owner] = await hre.ethers.getSigners();
  const WDOGE = await hre.ethers.getContractFactory("MockWDOGE");
  const wDoge = await WDOGE.deploy();
  await wDoge.waitForDeployment();

  const Router = await hre.ethers.getContractFactory("DogeOSSwapRouter");
  const router = await Router.deploy(owner.address, await wDoge.getAddress());
  const receipt = await router.deploymentTransaction().wait();
  return receipt.gasUsed;
}

async function adapterDeploymentGas() {
  const Factory = await hre.ethers.getContractFactory("MockUniswapV2Factory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  const Adapter = await hre.ethers.getContractFactory("DogeOSV2PairAdapter");
  const adapter = await Adapter.deploy(await factory.getAddress());
  const receipt = await adapter.deploymentTransaction().wait();
  return receipt.gasUsed;
}

async function deployAmmFixture({ nativeIn = false, nativeOut = false } = {}) {
  const [owner, user, recipient, , liquidityProvider] = await hre.ethers.getSigners();

  const Token = await hre.ethers.getContractFactory("MockERC20");
  const tokenA = await Token.deploy("Token A", "TKNA");
  const tokenB = await Token.deploy("Token B", "TKNB");

  const WDOGE = await hre.ethers.getContractFactory("MockWDOGE");
  const wDoge = await WDOGE.deploy();

  const Router = await hre.ethers.getContractFactory("DogeOSSwapRouter");
  const router = await Router.deploy(owner.address, await wDoge.getAddress());

  const Factory = await hre.ethers.getContractFactory("MockUniswapV2Factory");
  const factory = await Factory.deploy();

  const Adapter = await hre.ethers.getContractFactory("DogeOSV2PairAdapter");
  const adapter = await Adapter.deploy(await factory.getAddress());

  const adapterTokenInAsset = nativeIn ? wDoge : tokenA;
  const adapterTokenOutAsset = nativeOut ? wDoge : tokenB;
  const adapterTokenIn = await adapterTokenInAsset.getAddress();
  const adapterTokenOut = await adapterTokenOutAsset.getAddress();

  const Pair = await hre.ethers.getContractFactory("MockUniswapV2Pair");
  const pair = await Pair.deploy(adapterTokenIn, adapterTokenOut);
  const pairAddress = await pair.getAddress();
  await factory.setPair(adapterTokenIn, adapterTokenOut, pairAddress);

  await fundAsset(adapterTokenInAsset, wDoge, liquidityProvider, LIQUIDITY_IN);
  await fundAsset(adapterTokenOutAsset, wDoge, liquidityProvider, LIQUIDITY_OUT);
  await adapterTokenInAsset.connect(liquidityProvider).approve(pairAddress, LIQUIDITY_IN);
  await adapterTokenOutAsset.connect(liquidityProvider).approve(pairAddress, LIQUIDITY_OUT);
  await pair.connect(liquidityProvider).addLiquidity(LIQUIDITY_IN, LIQUIDITY_OUT);

  if (!nativeIn) {
    await fundAsset(adapterTokenInAsset, wDoge, user, hre.ethers.parseEther("100"));
    await adapterTokenInAsset.connect(user).approve(await router.getAddress(), AMOUNT_IN);
  }

  await router.connect(owner).setAdapterAllowed(await adapter.getAddress(), true);

  return {
    user,
    recipient,
    router,
    adapter,
    pair,
    routerTokenIn: nativeIn ? hre.ethers.ZeroAddress : adapterTokenIn,
    routerTokenOut: nativeOut ? hre.ethers.ZeroAddress : adapterTokenOut,
    adapterTokenIn,
    adapterTokenOut,
    routeData: encodePool(pairAddress)
  };
}

async function collectGasRows(referenceGasPriceWei) {
  const rows = [];
  const push = ({ category, action, gasUsed, notes }) => {
    rows.push({
      category,
      action,
      gasUsed: gasUsed.toString(),
      estimatedCostWei: estimateCostWei(gasUsed.toString(), referenceGasPriceWei),
      notes
    });
  };

  push({
    category: "deployment",
    action: "DogeOSSwapRouter.constructor",
    gasUsed: await deploymentGas(),
    notes: "local deployment with mock WDOGE"
  });

  push({
    category: "deployment",
    action: "DogeOSV2PairAdapter.constructor",
    gasUsed: await adapterDeploymentGas(),
    notes: "factory-bound adapter deployment"
  });

  {
    const { adapter, router } = await deployFixture();
    push({
      category: "admin",
      action: "setAdapterAllowed(adapter,true)",
      gasUsed: await txGas(router.setAdapterAllowed(await adapter.getAddress(), true)),
      notes: "owner enables adapter"
    });
  }

  {
    const { adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);
    push({
      category: "admin",
      action: "setAdapterAllowed(adapter,false)",
      gasUsed: await txGas(router.setAdapterAllowed(await adapter.getAddress(), false)),
      notes: "owner disables adapter"
    });
  }

  {
    const { router } = await deployFixture();
    push({
      category: "admin",
      action: "pause()",
      gasUsed: await txGas(router.pause()),
      notes: "owner pause"
    });
  }

  {
    const { router } = await deployFixture();
    await router.pause();
    push({
      category: "admin",
      action: "unpause()",
      gasUsed: await txGas(router.unpause()),
      notes: "owner unpause"
    });
  }

  {
    const { pendingOwner, router } = await deployFixture();
    push({
      category: "admin",
      action: "transferOwnership(pendingOwner)",
      gasUsed: await txGas(router.transferOwnership(pendingOwner.address)),
      notes: "Ownable2Step owner transfer start"
    });
  }

  {
    const { pendingOwner, router } = await deployFixture();
    await router.transferOwnership(pendingOwner.address);
    push({
      category: "admin",
      action: "acceptOwnership()",
      gasUsed: await txGas(router.connect(pendingOwner).acceptOwnership()),
      notes: "Ownable2Step owner transfer accept"
    });
  }

  {
    const { user, recipient, tokenIn, tokenOut, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);
    await tokenIn.connect(user).approve(await router.getAddress(), AMOUNT_IN);
    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: await tokenOut.getAddress(),
      recipient: recipient.address
    });
    push({
      category: "swap",
      action: "exactInput ERC20 -> ERC20",
      gasUsed: await txGas(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600)),
      notes: "mock ERC20 tokens and mock adapter"
    });
  }

  {
    const { user, recipient, tokenOut, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);
    const params = routeParams({
      tokenIn: hre.ethers.ZeroAddress,
      tokenOut: await tokenOut.getAddress(),
      recipient: recipient.address
    });
    push({
      category: "swap",
      action: "exactInput native DOGE -> ERC20",
      gasUsed: await txGas(
        router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600, {
          value: AMOUNT_IN
        })
      ),
      notes: "includes WDOGE deposit"
    });
  }

  {
    const { user, recipient, tokenIn, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);
    await tokenIn.connect(user).approve(await router.getAddress(), AMOUNT_IN);
    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: hre.ethers.ZeroAddress,
      recipient: recipient.address
    });
    push({
      category: "swap",
      action: "exactInput ERC20 -> native DOGE",
      gasUsed: await txGas(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600)),
      notes: "includes WDOGE withdraw and native transfer"
    });
  }

  {
    const { user, recipient, router, adapter, pair, routerTokenIn, routerTokenOut, adapterTokenIn, adapterTokenOut, routeData } =
      await deployAmmFixture();
    const expectedOut = await adapter.quoteExactInput(pair, adapterTokenIn, adapterTokenOut, AMOUNT_IN);
    const params = routeParams({
      tokenIn: routerTokenIn,
      tokenOut: routerTokenOut,
      recipient: recipient.address,
      min: expectedOut - 1n,
      routeData
    });
    push({
      category: "integration",
      action: "exactInput DogeOS V2 ERC20 -> ERC20",
      gasUsed: await txGas(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600)),
      notes: "production adapter with local V2-shaped pair"
    });
  }

  {
    const { user, recipient, router, adapter, pair, routerTokenIn, routerTokenOut, adapterTokenIn, adapterTokenOut, routeData } =
      await deployAmmFixture({ nativeIn: true });
    const expectedOut = await adapter.quoteExactInput(pair, adapterTokenIn, adapterTokenOut, AMOUNT_IN);
    const params = routeParams({
      tokenIn: routerTokenIn,
      tokenOut: routerTokenOut,
      recipient: recipient.address,
      min: expectedOut - 1n,
      routeData
    });
    push({
      category: "integration",
      action: "exactInput DogeOS V2 native DOGE -> ERC20",
      gasUsed: await txGas(
        router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600, {
          value: AMOUNT_IN
        })
      ),
      notes: "production adapter with local V2-shaped WDOGE input pair"
    });
  }

  {
    const { user, recipient, router, adapter, pair, routerTokenIn, routerTokenOut, adapterTokenIn, adapterTokenOut, routeData } =
      await deployAmmFixture({ nativeOut: true });
    const expectedOut = await adapter.quoteExactInput(pair, adapterTokenIn, adapterTokenOut, AMOUNT_IN);
    const params = routeParams({
      tokenIn: routerTokenIn,
      tokenOut: routerTokenOut,
      recipient: recipient.address,
      min: expectedOut - 1n,
      routeData
    });
    push({
      category: "integration",
      action: "exactInput DogeOS V2 ERC20 -> native DOGE",
      gasUsed: await txGas(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600)),
      notes: "production adapter with local V2-shaped WDOGE output pair"
    });
  }

  return rows;
}

async function main() {
  const referenceGasPriceWei = readReferenceGasPriceWei();
  const rows = await collectGasRows(referenceGasPriceWei);
  const json = {
    generatedAt: new Date().toISOString(),
    compiler: "0.8.30",
    evmVersion: "prague",
    referenceGasPriceWei,
    note: "Local Hardhat gas profile. No transaction was broadcast. Swap gas uses fixed-output mocks plus the production DogeOS V2 pair adapter against local V2-shaped pair mocks. Production source gas can still differ when the external pair bytecode differs.",
    rows
  };
  const markdown = buildMarkdownGasReport(json);
  const { jsonPath, mdPath } = writeGasReport({ date: REPORT_DATE, json, markdown });

  console.log("DogeOS router gas profile completed");
  console.log(`referenceGasPriceWei: ${referenceGasPriceWei}`);
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
