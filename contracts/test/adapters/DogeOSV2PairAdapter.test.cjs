const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DogeOSV2PairAdapter", function () {
  const liquidityIn = ethers.parseEther("1000");
  const liquidityOut = ethers.parseEther("1000");
  const userBalance = ethers.parseEther("100");
  const amountIn = ethers.parseEther("10");

  async function futureDeadline() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + 3600;
  }

  function encodePair(pairAddress) {
    return ethers.AbiCoder.defaultAbiCoder().encode(["address"], [pairAddress]);
  }

  async function fundAsset(asset, wDoge, account, amount) {
    if ((await asset.getAddress()) === (await wDoge.getAddress())) {
      await wDoge.connect(account).deposit({ value: amount });
      return;
    }

    await asset.mint(account.address, amount);
  }

  async function deployFixture({ nativeIn = false, nativeOut = false, reversePair = false, registerPair = true } = {}) {
    const [owner, user, recipient, liquidityProvider] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const tokenA = await Token.deploy("Token A", "TKNA");
    const tokenB = await Token.deploy("Token B", "TKNB");

    const WDOGE = await ethers.getContractFactory("MockWDOGE");
    const wDoge = await WDOGE.deploy();

    const Factory = await ethers.getContractFactory("MockUniswapV2Factory");
    const factory = await Factory.deploy();

    const Adapter = await ethers.getContractFactory("DogeOSV2PairAdapter");
    const adapter = await Adapter.deploy(await factory.getAddress());

    const Router = await ethers.getContractFactory("DogeOSSwapRouter");
    const router = await Router.deploy(owner.address, await wDoge.getAddress());

    const tokenInAsset = nativeIn ? wDoge : tokenA;
    const tokenOutAsset = nativeOut ? wDoge : tokenB;
    const adapterTokenIn = await tokenInAsset.getAddress();
    const adapterTokenOut = await tokenOutAsset.getAddress();

    const pairToken0Asset = reversePair ? tokenOutAsset : tokenInAsset;
    const pairToken1Asset = reversePair ? tokenInAsset : tokenOutAsset;
    const pairToken0 = await pairToken0Asset.getAddress();
    const pairToken1 = await pairToken1Asset.getAddress();
    const amount0 = reversePair ? liquidityOut : liquidityIn;
    const amount1 = reversePair ? liquidityIn : liquidityOut;

    const Pair = await ethers.getContractFactory("MockUniswapV2Pair");
    const pair = await Pair.deploy(pairToken0, pairToken1);
    const pairAddress = await pair.getAddress();

    if (registerPair) {
      await factory.setPair(adapterTokenIn, adapterTokenOut, pairAddress);
    }

    await fundAsset(pairToken0Asset, wDoge, liquidityProvider, amount0);
    await fundAsset(pairToken1Asset, wDoge, liquidityProvider, amount1);
    await pairToken0Asset.connect(liquidityProvider).approve(pairAddress, amount0);
    await pairToken1Asset.connect(liquidityProvider).approve(pairAddress, amount1);
    await pair.connect(liquidityProvider).addLiquidity(amount0, amount1);

    if (!nativeIn) {
      await fundAsset(tokenInAsset, wDoge, user, userBalance);
      await tokenInAsset.connect(user).approve(await router.getAddress(), amountIn);
    }

    await router.connect(owner).setAdapterAllowed(await adapter.getAddress(), true);

    return {
      owner,
      user,
      recipient,
      tokenA,
      tokenB,
      wDoge,
      factory,
      adapter,
      router,
      pair,
      adapterTokenIn,
      adapterTokenOut,
      routerTokenIn: nativeIn ? ethers.ZeroAddress : adapterTokenIn,
      routerTokenOut: nativeOut ? ethers.ZeroAddress : adapterTokenOut,
      routeData: encodePair(pairAddress)
    };
  }

  function routeParams({ tokenIn, tokenOut, recipient, minAmountOut, routeData }) {
    return {
      tokenIn,
      tokenOut,
      recipient,
      amountIn,
      minAmountOut,
      routeData
    };
  }

  it("quotes and executes ERC20 to ERC20 through a canonical DogeOS V2 pair", async function () {
    const { user, recipient, tokenA, tokenB, adapter, router, pair, adapterTokenIn, adapterTokenOut, routerTokenIn, routerTokenOut, routeData } =
      await deployFixture();
    const expectedOut = await adapter.quoteExactInput(pair, adapterTokenIn, adapterTokenOut, amountIn);
    const params = routeParams({
      tokenIn: routerTokenIn,
      tokenOut: routerTokenOut,
      recipient: recipient.address,
      minAmountOut: expectedOut - 1n,
      routeData
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, await futureDeadline()))
      .to.emit(router, "SwapExecuted")
      .withArgs(await adapter.getAddress(), routerTokenIn, routerTokenOut, recipient.address, amountIn, expectedOut);

    expect(await tokenA.balanceOf(user.address)).to.equal(userBalance - amountIn);
    expect(await tokenB.balanceOf(recipient.address)).to.equal(expectedOut);
    expect(await tokenA.balanceOf(await router.getAddress())).to.equal(0);
    expect(await tokenB.balanceOf(await router.getAddress())).to.equal(0);
    expect(await tokenA.allowance(await router.getAddress(), await adapter.getAddress())).to.equal(0);

    const reserves = await pair.getReserves();
    expect(reserves[0]).to.equal(liquidityIn + amountIn);
    expect(reserves[1]).to.equal(liquidityOut - expectedOut);
  });

  it("executes the reverse token1 to token0 pair direction", async function () {
    const { user, recipient, tokenA, tokenB, adapter, router, pair, adapterTokenIn, adapterTokenOut, routerTokenIn, routerTokenOut, routeData } =
      await deployFixture({ reversePair: true });
    const expectedOut = await adapter.quoteExactInput(pair, adapterTokenIn, adapterTokenOut, amountIn);
    const params = routeParams({
      tokenIn: routerTokenIn,
      tokenOut: routerTokenOut,
      recipient: recipient.address,
      minAmountOut: expectedOut - 1n,
      routeData
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, await futureDeadline()))
      .to.emit(router, "SwapExecuted")
      .withArgs(await adapter.getAddress(), routerTokenIn, routerTokenOut, recipient.address, amountIn, expectedOut);

    expect(await tokenA.balanceOf(user.address)).to.equal(userBalance - amountIn);
    expect(await tokenB.balanceOf(recipient.address)).to.equal(expectedOut);

    const reserves = await pair.getReserves();
    expect(reserves[0]).to.equal(liquidityOut - expectedOut);
    expect(reserves[1]).to.equal(liquidityIn + amountIn);
  });

  it("wraps native DOGE and swaps WDOGE through a canonical pair", async function () {
    const { user, recipient, tokenB, wDoge, adapter, router, pair, adapterTokenIn, adapterTokenOut, routerTokenIn, routerTokenOut, routeData } =
      await deployFixture({ nativeIn: true });
    const expectedOut = await adapter.quoteExactInput(pair, adapterTokenIn, adapterTokenOut, amountIn);
    const params = routeParams({
      tokenIn: routerTokenIn,
      tokenOut: routerTokenOut,
      recipient: recipient.address,
      minAmountOut: expectedOut - 1n,
      routeData
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, await futureDeadline(), { value: amountIn }))
      .to.emit(router, "SwapExecuted")
      .withArgs(await adapter.getAddress(), ethers.ZeroAddress, routerTokenOut, recipient.address, amountIn, expectedOut);

    expect(await tokenB.balanceOf(recipient.address)).to.equal(expectedOut);
    expect(await wDoge.balanceOf(await router.getAddress())).to.equal(0);
    expect(await tokenB.balanceOf(await router.getAddress())).to.equal(0);
  });

  it("swaps into WDOGE and lets the router unwrap native DOGE output", async function () {
    const { user, recipient, tokenA, wDoge, adapter, router, pair, adapterTokenIn, adapterTokenOut, routerTokenIn, routerTokenOut, routeData } =
      await deployFixture({ nativeOut: true });
    const expectedOut = await adapter.quoteExactInput(pair, adapterTokenIn, adapterTokenOut, amountIn);
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
      .withArgs(await adapter.getAddress(), routerTokenIn, ethers.ZeroAddress, recipient.address, amountIn, expectedOut);

    expect(await ethers.provider.getBalance(recipient.address)).to.equal(recipientBefore + expectedOut);
    expect(await tokenA.balanceOf(await router.getAddress())).to.equal(0);
    expect(await wDoge.balanceOf(await router.getAddress())).to.equal(0);
  });

  it("reverts and preserves state when pair output is below the route minimum", async function () {
    const { user, recipient, tokenA, tokenB, adapter, router, pair, adapterTokenIn, adapterTokenOut, routerTokenIn, routerTokenOut, routeData } =
      await deployFixture();
    const expectedOut = await adapter.quoteExactInput(pair, adapterTokenIn, adapterTokenOut, amountIn);
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

    expect(await tokenA.balanceOf(user.address)).to.equal(userBalance);
    expect(await tokenB.balanceOf(recipient.address)).to.equal(0);
    const reserves = await pair.getReserves();
    expect(reserves[0]).to.equal(liquidityIn);
    expect(reserves[1]).to.equal(liquidityOut);
  });

  it("rejects non-canonical pairs that are not registered in the factory", async function () {
    const { user, recipient, adapter, router, pair, adapterTokenIn, adapterTokenOut, routerTokenIn, routerTokenOut, routeData } =
      await deployFixture({ registerPair: false });
    const params = routeParams({
      tokenIn: routerTokenIn,
      tokenOut: routerTokenOut,
      recipient: recipient.address,
      minAmountOut: 1n,
      routeData
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, await futureDeadline()))
      .to.be.revertedWithCustomError(adapter, "CanonicalPairMismatch")
      .withArgs(adapterTokenIn, adapterTokenOut, await pair.getAddress(), ethers.ZeroAddress);
  });

  it("rejects route data whose pair tokens do not match the requested route", async function () {
    const { user, adapter, router, pair, tokenA, wDoge, routerTokenIn, routeData } = await deployFixture();
    const params = routeParams({
      tokenIn: routerTokenIn,
      tokenOut: await wDoge.getAddress(),
      recipient: user.address,
      minAmountOut: 1n,
      routeData
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, await futureDeadline()))
      .to.be.revertedWithCustomError(adapter, "PairTokenMismatch")
      .withArgs(await tokenA.getAddress(), await wDoge.getAddress(), await pair.getAddress());
  });

  it("rejects malformed route data before moving user funds", async function () {
    const { user, adapter, router, tokenA, tokenB, routerTokenIn, routerTokenOut } = await deployFixture();
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

  it("rejects direct native value sent to the adapter", async function () {
    const { user, adapter, routeData, adapterTokenIn, adapterTokenOut } = await deployFixture();
    const params = {
      tokenIn: adapterTokenIn,
      tokenOut: adapterTokenOut,
      recipient: user.address,
      amountIn,
      minAmountOut: 1n,
      routeData
    };

    await expect(adapter.connect(user).exactInput(params, { value: 1n }))
      .to.be.revertedWithCustomError(adapter, "UnexpectedNativeValue")
      .withArgs(1n);
  });

  it("rejects a zero factory at deployment", async function () {
    const Adapter = await ethers.getContractFactory("DogeOSV2PairAdapter");

    await expect(Adapter.deploy(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(Adapter, "ZeroAddress");
  });
});
