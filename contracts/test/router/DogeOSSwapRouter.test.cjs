const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DogeOSSwapRouter", function () {
  const amountIn = ethers.parseEther("10");
  const amountOut = ethers.parseEther("9");
  const minAmountOut = ethers.parseEther("8");

  async function deployFixture() {
    const [owner, user, recipient, attacker] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const tokenIn = await Token.deploy("Token In", "TIN");
    const tokenOut = await Token.deploy("Token Out", "TOUT");

    const WDOGE = await ethers.getContractFactory("MockWDOGE");
    const wDoge = await WDOGE.deploy();

    const Adapter = await ethers.getContractFactory("MockSwapAdapter");
    const adapter = await Adapter.deploy();

    const Router = await ethers.getContractFactory("DogeOSSwapRouter");
    const router = await Router.deploy(owner.address, await wDoge.getAddress());

    await tokenIn.mint(user.address, ethers.parseEther("100"));
    await tokenOut.mint(await adapter.getAddress(), ethers.parseEther("100"));
    await wDoge.connect(owner).deposit({ value: ethers.parseEther("100") });
    await wDoge.connect(owner).transfer(await adapter.getAddress(), ethers.parseEther("100"));
    await adapter.setAmountOut(amountOut);

    return { owner, user, recipient, attacker, tokenIn, tokenOut, wDoge, adapter, router };
  }

  function routeParams({ tokenIn, tokenOut, recipient, amount = amountIn, min = minAmountOut, routeData = "0x" }) {
    return {
      tokenIn,
      tokenOut,
      recipient,
      amountIn: amount,
      minAmountOut: min,
      routeData
    };
  }

  it("reverts when deadline has expired", async function () {
    const { user, recipient, tokenIn, tokenOut, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);

    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: await tokenOut.getAddress(),
      recipient: recipient.address
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, 1))
      .to.be.revertedWithCustomError(router, "DeadlineExpired");
  });

  it("reverts when adapter is not allowlisted", async function () {
    const { user, recipient, tokenIn, tokenOut, adapter, router } = await deployFixture();
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);

    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: await tokenOut.getAddress(),
      recipient: recipient.address
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600))
      .to.be.revertedWithCustomError(router, "AdapterNotAllowed")
      .withArgs(await adapter.getAddress());
  });

  it("allows the owner to enable and disable an adapter", async function () {
    const { owner, adapter, router } = await deployFixture();
    const adapterAddress = await adapter.getAddress();

    await expect(router.connect(owner).setAdapterAllowed(adapterAddress, true))
      .to.emit(router, "AdapterAllowed")
      .withArgs(adapterAddress, true);
    expect(await router.allowedAdapter(adapterAddress)).to.equal(true);

    await expect(router.connect(owner).setAdapterAllowed(adapterAddress, false))
      .to.emit(router, "AdapterAllowed")
      .withArgs(adapterAddress, false);
    expect(await router.allowedAdapter(adapterAddress)).to.equal(false);
  });

  it("reverts when a non-owner tries to change adapter allowlist", async function () {
    const { user, adapter, router } = await deployFixture();

    await expect(router.connect(user).setAdapterAllowed(await adapter.getAddress(), true))
      .to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount")
      .withArgs(user.address);
  });

  it("reverts when allowing the zero adapter address", async function () {
    const { router } = await deployFixture();

    await expect(router.setAdapterAllowed(ethers.ZeroAddress, true))
      .to.be.revertedWithCustomError(router, "ZeroAddress");
  });

  it("reverts when adapter output is below minAmountOut", async function () {
    const { user, recipient, tokenIn, tokenOut, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);
    await adapter.setAmountOut(ethers.parseEther("7"));
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);

    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: await tokenOut.getAddress(),
      recipient: recipient.address
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600))
      .to.be.revertedWithCustomError(router, "OutputBelowMinimum")
      .withArgs(ethers.parseEther("7"), minAmountOut);
  });

  it("emits SwapExecuted and transfers token output for an allowlisted adapter", async function () {
    const { user, recipient, tokenIn, tokenOut, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);

    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: await tokenOut.getAddress(),
      recipient: recipient.address
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600))
      .to.emit(router, "SwapExecuted")
      .withArgs(await adapter.getAddress(), await tokenIn.getAddress(), await tokenOut.getAddress(), recipient.address, amountIn, amountOut);

    expect(await tokenOut.balanceOf(recipient.address)).to.equal(amountOut);
  });

  it("wraps native DOGE into WDOGE before adapter execution", async function () {
    const { user, recipient, tokenOut, wDoge, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);

    const params = routeParams({
      tokenIn: ethers.ZeroAddress,
      tokenOut: await tokenOut.getAddress(),
      recipient: recipient.address
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600, { value: amountIn }))
      .to.emit(router, "SwapExecuted")
      .withArgs(await adapter.getAddress(), ethers.ZeroAddress, await tokenOut.getAddress(), recipient.address, amountIn, amountOut);

    expect(await wDoge.balanceOf(await adapter.getAddress())).to.equal(ethers.parseEther("100") + amountIn);
  });

  it("unwraps WDOGE and transfers native DOGE for native output", async function () {
    const { user, recipient, tokenIn, wDoge, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);

    const before = await ethers.provider.getBalance(recipient.address);
    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: ethers.ZeroAddress,
      recipient: recipient.address
    });

    await router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600);

    expect(await ethers.provider.getBalance(recipient.address)).to.equal(before + amountOut);
    expect(await wDoge.balanceOf(await router.getAddress())).to.equal(0);
  });

  it("reverts when paused", async function () {
    const { owner, user, recipient, tokenIn, tokenOut, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);
    await router.connect(owner).pause();

    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: await tokenOut.getAddress(),
      recipient: recipient.address
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600))
      .to.be.revertedWithCustomError(router, "EnforcedPause");
  });

  it("reverts when a non-owner tries to pause or unpause", async function () {
    const { user, router } = await deployFixture();

    await expect(router.connect(user).pause())
      .to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount")
      .withArgs(user.address);
    await expect(router.connect(user).unpause())
      .to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount")
      .withArgs(user.address);
  });

  it("lets the owner unpause after pause", async function () {
    const { owner, user, recipient, tokenIn, tokenOut, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);

    await router.connect(owner).pause();
    await router.connect(owner).unpause();

    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: await tokenOut.getAddress(),
      recipient: recipient.address
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600))
      .to.emit(router, "SwapExecuted");
  });

  it("reverts when amountIn is zero", async function () {
    const { user, recipient, tokenIn, tokenOut, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);

    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: await tokenOut.getAddress(),
      recipient: recipient.address,
      amount: 0n
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600))
      .to.be.revertedWithCustomError(router, "ZeroAmount");
  });

  it("reverts when recipient is zero address", async function () {
    const { user, tokenIn, tokenOut, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);

    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: await tokenOut.getAddress(),
      recipient: ethers.ZeroAddress
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600))
      .to.be.revertedWithCustomError(router, "ZeroAddress");
  });

  it("reverts when native input value does not match amountIn", async function () {
    const { user, recipient, tokenOut, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);

    const params = routeParams({
      tokenIn: ethers.ZeroAddress,
      tokenOut: await tokenOut.getAddress(),
      recipient: recipient.address
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600, { value: amountIn - 1n }))
      .to.be.revertedWithCustomError(router, "NativeValueMismatch")
      .withArgs(amountIn, amountIn - 1n);
  });

  it("reverts when ERC20 input includes native DOGE value", async function () {
    const { user, recipient, tokenIn, tokenOut, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);

    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: await tokenOut.getAddress(),
      recipient: recipient.address
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600, { value: 1n }))
      .to.be.revertedWithCustomError(router, "NativeValueMismatch")
      .withArgs(0, 1n);
  });

  it("rejects direct native DOGE transfers from non-WDOGE senders", async function () {
    const { user, router } = await deployFixture();

    await expect(user.sendTransaction({ to: await router.getAddress(), value: 1n }))
      .to.be.revertedWithCustomError(router, "UnexpectedNativeDogeSender")
      .withArgs(user.address);
  });

  it("reverts when native DOGE output recipient rejects the transfer", async function () {
    const { user, tokenIn, adapter, router } = await deployFixture();
    const RejectNativeRecipient = await ethers.getContractFactory("MockRejectNativeRecipient");
    const rejectingRecipient = await RejectNativeRecipient.deploy();
    await router.setAdapterAllowed(await adapter.getAddress(), true);
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);

    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: ethers.ZeroAddress,
      recipient: await rejectingRecipient.getAddress()
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600))
      .to.be.revertedWithCustomError(router, "NativeTransferFailed");
  });

  it("reverts when resolved input and output tokens are identical", async function () {
    const { user, recipient, tokenIn, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);

    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: await tokenIn.getAddress(),
      recipient: recipient.address
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600))
      .to.be.revertedWithCustomError(router, "IdenticalTokens")
      .withArgs(await tokenIn.getAddress());
  });

  it("uses SafeERC20-compatible flows for token inputs without bool returns", async function () {
    const { user, recipient, tokenOut, adapter, router } = await deployFixture();
    const NoReturnToken = await ethers.getContractFactory("MockNoReturnERC20");
    const tokenIn = await NoReturnToken.deploy("No Return Token", "NRT");
    await tokenIn.mint(user.address, ethers.parseEther("100"));
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);
    await router.setAdapterAllowed(await adapter.getAddress(), true);

    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: await tokenOut.getAddress(),
      recipient: recipient.address
    });

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600))
      .to.emit(router, "SwapExecuted")
      .withArgs(await adapter.getAddress(), await tokenIn.getAddress(), await tokenOut.getAddress(), recipient.address, amountIn, amountOut);
  });

  it("resets the adapter token allowance after a successful swap", async function () {
    const { user, recipient, tokenIn, tokenOut, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);

    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: await tokenOut.getAddress(),
      recipient: recipient.address
    });

    await router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600);

    expect(await tokenIn.allowance(await router.getAddress(), await adapter.getAddress())).to.equal(0);
  });

  it("reverts when constructor receives the zero WDOGE address", async function () {
    const { owner } = await deployFixture();
    const Router = await ethers.getContractFactory("DogeOSSwapRouter");

    await expect(Router.deploy(owner.address, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(Router, "ZeroAddress");
  });

  it("reverts when constructor receives the zero owner address", async function () {
    const { router, wDoge } = await deployFixture();
    const Router = await ethers.getContractFactory("DogeOSSwapRouter");

    await expect(Router.deploy(ethers.ZeroAddress, await wDoge.getAddress()))
      .to.be.revertedWithCustomError(router, "OwnableInvalidOwner")
      .withArgs(ethers.ZeroAddress);
  });

  it("blocks adapter reentrancy into exactInput", async function () {
    const { user, recipient, tokenIn, tokenOut, adapter, router } = await deployFixture();
    await router.setAdapterAllowed(await adapter.getAddress(), true);
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);

    const params = routeParams({
      tokenIn: await tokenIn.getAddress(),
      tokenOut: await tokenOut.getAddress(),
      recipient: recipient.address
    });

    await adapter.setReentry(await router.getAddress(), await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600);

    await expect(router.connect(user).exactInput(await adapter.getAddress(), params, Math.floor(Date.now() / 1000) + 3600))
      .to.emit(router, "SwapExecuted");
  });
});
