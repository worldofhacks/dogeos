const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DogeOSSwapRouter AMM integration", function () {
  const liquidityIn = ethers.parseEther("1000");
  const liquidityOut = ethers.parseEther("1000");
  const userBalance = ethers.parseEther("100");
  const swapAmount = ethers.parseEther("10");

  async function futureDeadline() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + 3600;
  }

  function encodePool(poolAddress) {
    return ethers.AbiCoder.defaultAbiCoder().encode(["address"], [poolAddress]);
  }

  async function fundAsset(asset, wDoge, account, amount) {
    if ((await asset.getAddress()) === (await wDoge.getAddress())) {
      await wDoge.connect(account).deposit({ value: amount });
      return;
    }

    await asset.mint(account.address, amount);
  }

  async function deployAmmFixture({ nativeIn = false, nativeOut = false, reversePool = false } = {}) {
    const [owner, user, recipient, liquidityProvider] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const tokenA = await Token.deploy("Token A", "TKNA");
    const tokenB = await Token.deploy("Token B", "TKNB");

    const WDOGE = await ethers.getContractFactory("MockWDOGE");
    const wDoge = await WDOGE.deploy();

    const Router = await ethers.getContractFactory("DogeOSSwapRouter");
    const router = await Router.deploy(owner.address, await wDoge.getAddress());

    const Adapter = await ethers.getContractFactory("MockV2SwapAdapter");
    const adapter = await Adapter.deploy();

    const adapterTokenInAsset = nativeIn ? wDoge : tokenA;
    const adapterTokenOutAsset = nativeOut ? wDoge : tokenB;
    const adapterTokenIn = await adapterTokenInAsset.getAddress();
    const adapterTokenOut = await adapterTokenOutAsset.getAddress();

    const poolToken0Asset = reversePool ? adapterTokenOutAsset : adapterTokenInAsset;
    const poolToken1Asset = reversePool ? adapterTokenInAsset : adapterTokenOutAsset;
    const poolToken0 = await poolToken0Asset.getAddress();
    const poolToken1 = await poolToken1Asset.getAddress();
    const poolAmount0 = reversePool ? liquidityOut : liquidityIn;
    const poolAmount1 = reversePool ? liquidityIn : liquidityOut;

    const Pool = await ethers.getContractFactory("MockConstantProductPool");
    const pool = await Pool.deploy(poolToken0, poolToken1);
    const poolAddress = await pool.getAddress();

    await fundAsset(poolToken0Asset, wDoge, liquidityProvider, poolAmount0);
    await fundAsset(poolToken1Asset, wDoge, liquidityProvider, poolAmount1);
    await poolToken0Asset.connect(liquidityProvider).approve(poolAddress, poolAmount0);
    await poolToken1Asset.connect(liquidityProvider).approve(poolAddress, poolAmount1);
    await pool.connect(liquidityProvider).addLiquidity(poolAmount0, poolAmount1);

    if (!nativeIn) {
      await fundAsset(adapterTokenInAsset, wDoge, user, userBalance);
      await adapterTokenInAsset.connect(user).approve(await router.getAddress(), swapAmount);
    }

    await router.connect(owner).setAdapterAllowed(await adapter.getAddress(), true);

    return {
      owner,
      user,
      recipient,
      tokenA,
      tokenB,
      wDoge,
      router,
      adapter,
      pool,
      routerTokenIn: nativeIn ? ethers.ZeroAddress : adapterTokenIn,
      routerTokenOut: nativeOut ? ethers.ZeroAddress : adapterTokenOut,
      adapterTokenIn,
      adapterTokenOut,
      routeData: encodePool(poolAddress)
    };
  }

  function routeParams({ tokenIn, tokenOut, recipient, minAmountOut, routeData }) {
    return {
      tokenIn,
      tokenOut,
      recipient,
      amountIn: swapAmount,
      minAmountOut,
      routeData
    };
  }

  it("executes ERC20 to ERC20 through a seeded constant-product pool", async function () {
    const { user, recipient, tokenA, tokenB, router, adapter, pool, routerTokenIn, routerTokenOut, adapterTokenIn, routeData } =
      await deployAmmFixture();
    const expectedOut = await pool.getAmountOut(adapterTokenIn, swapAmount);
    const params = routeParams({
      tokenIn: routerTokenIn,
      tokenOut: routerTokenOut,
      recipient: recipient.address,
      minAmountOut: expectedOut - 1n,
      routeData
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, await futureDeadline()))
      .to.emit(router, "SwapExecuted")
      .withArgs(await adapter.getAddress(), routerTokenIn, routerTokenOut, recipient.address, swapAmount, expectedOut);

    expect(await tokenA.balanceOf(user.address)).to.equal(userBalance - swapAmount);
    expect(await tokenB.balanceOf(recipient.address)).to.equal(expectedOut);
    expect(await tokenA.balanceOf(await router.getAddress())).to.equal(0);
    expect(await tokenB.balanceOf(await router.getAddress())).to.equal(0);
    expect(await tokenA.allowance(await router.getAddress(), await adapter.getAddress())).to.equal(0);
    expect(await pool.reserve0()).to.equal(liquidityIn + swapAmount);
    expect(await pool.reserve1()).to.equal(liquidityOut - expectedOut);
  });

  it("quotes and executes the reverse token1 to token0 AMM path", async function () {
    const { user, recipient, tokenA, tokenB, router, adapter, pool, routerTokenIn, routerTokenOut, adapterTokenIn, routeData } =
      await deployAmmFixture({ reversePool: true });
    const quotedOut = await adapter.quoteExactInput(pool, adapterTokenIn, swapAmount);
    const expectedOut = await pool.getAmountOut(adapterTokenIn, swapAmount);
    const params = routeParams({
      tokenIn: routerTokenIn,
      tokenOut: routerTokenOut,
      recipient: recipient.address,
      minAmountOut: quotedOut - 1n,
      routeData
    });

    expect(quotedOut).to.equal(expectedOut);
    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, await futureDeadline()))
      .to.emit(router, "SwapExecuted")
      .withArgs(await adapter.getAddress(), routerTokenIn, routerTokenOut, recipient.address, swapAmount, expectedOut);

    expect(await tokenA.balanceOf(user.address)).to.equal(userBalance - swapAmount);
    expect(await tokenB.balanceOf(recipient.address)).to.equal(expectedOut);
    expect(await pool.reserve0()).to.equal(liquidityOut - expectedOut);
    expect(await pool.reserve1()).to.equal(liquidityIn + swapAmount);
  });

  it("wraps native DOGE and executes through a WDOGE pool", async function () {
    const { user, recipient, tokenB, wDoge, router, adapter, pool, routerTokenIn, routerTokenOut, adapterTokenIn, routeData } =
      await deployAmmFixture({ nativeIn: true });
    const expectedOut = await pool.getAmountOut(adapterTokenIn, swapAmount);
    const params = routeParams({
      tokenIn: routerTokenIn,
      tokenOut: routerTokenOut,
      recipient: recipient.address,
      minAmountOut: expectedOut - 1n,
      routeData
    });

    await expect(
      router.connect(user).exactInput(await adapter.getAddress(), params, await futureDeadline(), { value: swapAmount })
    )
      .to.emit(router, "SwapExecuted")
      .withArgs(await adapter.getAddress(), ethers.ZeroAddress, routerTokenOut, recipient.address, swapAmount, expectedOut);

    expect(await tokenB.balanceOf(recipient.address)).to.equal(expectedOut);
    expect(await wDoge.balanceOf(await router.getAddress())).to.equal(0);
    expect(await tokenB.balanceOf(await router.getAddress())).to.equal(0);
    expect(await pool.reserve0()).to.equal(liquidityIn + swapAmount);
    expect(await pool.reserve1()).to.equal(liquidityOut - expectedOut);
  });

  it("unwraps WDOGE pool output into native DOGE", async function () {
    const { user, recipient, tokenA, wDoge, router, adapter, pool, routerTokenIn, routerTokenOut, adapterTokenIn, routeData } =
      await deployAmmFixture({ nativeOut: true });
    const expectedOut = await pool.getAmountOut(adapterTokenIn, swapAmount);
    const recipientBefore = await ethers.provider.getBalance(recipient.address);
    const params = routeParams({
      tokenIn: routerTokenIn,
      tokenOut: routerTokenOut,
      recipient: recipient.address,
      minAmountOut: expectedOut - 1n,
      routeData
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, await futureDeadline()))
      .to.emit(router, "SwapExecuted")
      .withArgs(await adapter.getAddress(), routerTokenIn, ethers.ZeroAddress, recipient.address, swapAmount, expectedOut);

    expect(await ethers.provider.getBalance(recipient.address)).to.equal(recipientBefore + expectedOut);
    expect(await tokenA.balanceOf(await router.getAddress())).to.equal(0);
    expect(await wDoge.balanceOf(await router.getAddress())).to.equal(0);
    expect(await pool.reserve0()).to.equal(liquidityIn + swapAmount);
    expect(await pool.reserve1()).to.equal(liquidityOut - expectedOut);
  });

  it("reverts and preserves pool state when AMM output is below the route minimum", async function () {
    const { user, recipient, tokenA, tokenB, router, adapter, pool, routerTokenIn, routerTokenOut, adapterTokenIn, routeData } =
      await deployAmmFixture();
    const expectedOut = await pool.getAmountOut(adapterTokenIn, swapAmount);
    const params = routeParams({
      tokenIn: routerTokenIn,
      tokenOut: routerTokenOut,
      recipient: recipient.address,
      minAmountOut: expectedOut + 1n,
      routeData
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, await futureDeadline()))
      .to.be.revertedWithCustomError(adapter, "OutputBelowMinimum")
      .withArgs(expectedOut, expectedOut + 1n);

    expect(await pool.reserve0()).to.equal(liquidityIn);
    expect(await pool.reserve1()).to.equal(liquidityOut);
    expect(await tokenA.balanceOf(user.address)).to.equal(userBalance);
    expect(await tokenB.balanceOf(recipient.address)).to.equal(0);
  });

  it("rejects route data whose pool does not match the requested token pair", async function () {
    const { user, tokenA, wDoge, router, adapter, pool, routerTokenIn, routeData } = await deployAmmFixture();
    const params = routeParams({
      tokenIn: routerTokenIn,
      tokenOut: await wDoge.getAddress(),
      recipient: user.address,
      minAmountOut: 1n,
      routeData
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, await futureDeadline()))
      .to.be.revertedWithCustomError(adapter, "PairMismatch")
      .withArgs(await tokenA.getAddress(), await wDoge.getAddress(), await pool.getAddress());
  });

  it("rejects malformed AMM route data before moving user funds", async function () {
    const { user, tokenA, tokenB, router, adapter, routerTokenIn, routerTokenOut } = await deployAmmFixture();
    const params = routeParams({
      tokenIn: routerTokenIn,
      tokenOut: routerTokenOut,
      recipient: user.address,
      minAmountOut: 1n,
      routeData: "0x1234"
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, await futureDeadline()))
      .to.be.revertedWithCustomError(adapter, "InvalidRouteData");

    expect(await tokenA.balanceOf(user.address)).to.equal(userBalance);
    expect(await tokenB.balanceOf(user.address)).to.equal(0);
  });

  it("rejects direct pool swaps when input was not transferred first", async function () {
    const { user, pool, adapterTokenIn } = await deployAmmFixture();

    await expect(pool.swapExactInput(adapterTokenIn, swapAmount, user.address))
      .to.be.revertedWithCustomError(pool, "InsufficientInputAmount")
      .withArgs(0, swapAmount);
  });

  it("rejects direct pool quotes for tokens outside the pair", async function () {
    const { wDoge, pool } = await deployAmmFixture();

    await expect(pool.getAmountOut(await wDoge.getAddress(), swapAmount))
      .to.be.revertedWithCustomError(pool, "InvalidToken")
      .withArgs(await wDoge.getAddress());
  });

  it("mints WDOGE when DOGE is sent to the wrapped token receive path", async function () {
    const { user, wDoge } = await deployAmmFixture();

    await user.sendTransaction({ to: await wDoge.getAddress(), value: 123n });

    expect(await wDoge.balanceOf(user.address)).to.equal(123n);
  });

  it("rejects accidental native value sent directly to the adapter", async function () {
    const { user, adapter, routeData, adapterTokenIn, adapterTokenOut } = await deployAmmFixture();
    const params = {
      tokenIn: adapterTokenIn,
      tokenOut: adapterTokenOut,
      recipient: user.address,
      amountIn: swapAmount,
      minAmountOut: 1n,
      routeData
    };

    await expect(adapter.connect(user).exactInput(params, { value: 1n }))
      .to.be.revertedWithCustomError(adapter, "UnexpectedNativeValue")
      .withArgs(1n);
  });
});
