// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IEIP712} from "permit2/src/interfaces/IEIP712.sol";
import {IERC20} from "openzeppelin/token/ERC20/IERC20.sol";
import {DogeSwapRouter} from "../../src/DogeSwapRouter.sol";
import {IUniswapV3SwapRouter} from "../../src/interfaces/IUniswapV3SwapRouter.sol";
import {PermitSignature} from "../utils/PermitSignature.sol";

interface IV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface IV3Router {
    function factory() external view returns (address);
}

/// @notice Live-fork differential test against DogeOS testnet (chain 6281971). Compares a direct
///         MuchFi V3 `exactInputSingle` swap (reference) against the same swap routed through the
///         aggregation router, asserting the outputs match within 2%. The WDOGE->USDC fee tier is
///         discovered from the V3 factory at runtime. Skips cleanly if the fork is unavailable, no
///         pool exists, or the pool has no usable liquidity.
contract RouterForkTest is Test, DeployPermit2, PermitSignature {
    // verified PRESENT on DogeOS testnet (see audit/CHAIN_FACTS.md)
    address internal constant WDOGE = 0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE;
    address internal constant MUCHFI_V2_ROUTER = 0xC653e745FC613a03D156DACB924AE8e9148B18dc;
    address internal constant MUCHFI_V3_ROUTER = 0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB;
    address internal constant BARKSWAP_ALGEBRA_ROUTER = 0x77147f436cE9739D2A54Ffe428DBe02b90c0205e;
    address internal constant USDC = 0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925;

    bool internal forked;
    DogeSwapRouter internal router;
    IAllowanceTransfer internal permit2;

    address internal owner = makeAddr("owner");
    address internal user;
    uint256 internal userPk;

    function setUp() public {
        try vm.createSelectFork(vm.rpcUrl("dogeos")) {
            forked = true;
        } catch {
            vm.skip(true);
            return;
        }

        // the fork lacks Permit2 -> etch it at the canonical address
        permit2 = IAllowanceTransfer(deployPermit2());

        router = new DogeSwapRouter(
            owner, makeAddr("g"), WDOGE, MUCHFI_V2_ROUTER, MUCHFI_V3_ROUTER, BARKSWAP_ALGEBRA_ROUTER
        );
        // no cap so the differential isn't bounded by governance config (fork sim only)
        vm.prank(owner);
        router.setMaxInputPerTx(WDOGE, type(uint256).max);

        (user, userPk) = makeAddrAndKey("forkUser");
    }

    /// @dev Discover a WDOGE/USDC V3 pool fee tier from the factory; returns (fee, found).
    function _findV3Fee() internal view returns (uint24 fee, bool found) {
        address factory = IV3Router(MUCHFI_V3_ROUTER).factory();
        uint24[4] memory tiers = [uint24(100), 500, 3000, 10000];
        for (uint256 i; i < tiers.length; ++i) {
            address pool = IV3Factory(factory).getPool(WDOGE, USDC, tiers[i]);
            if (pool != address(0) && IERC20(USDC).balanceOf(pool) > 0) {
                return (tiers[i], true);
            }
        }
        return (0, false);
    }

    function test_fork_v3_differential() public {
        if (block.chainid != 6281971) {
            vm.skip(true);
            return;
        }

        (uint24 fee, bool found) = _findV3Fee();
        if (!found) {
            console2.log("SKIP: no WDOGE/USDC V3 pool with liquidity on any fee tier");
            vm.skip(true);
            return;
        }
        console2.log("using V3 fee tier:", fee);

        // small input relative to pool depth so both legs see comparable price impact
        uint256 amountIn = 0.05 ether;

        // ---- reference leg: a direct V3 exactInputSingle WDOGE->USDC ----
        deal(WDOGE, address(this), amountIn);
        IERC20(WDOGE).approve(MUCHFI_V3_ROUTER, amountIn);

        uint256 directOut;
        try IUniswapV3SwapRouter(MUCHFI_V3_ROUTER).exactInputSingle(
            IUniswapV3SwapRouter.ExactInputSingleParams({
                tokenIn: WDOGE,
                tokenOut: USDC,
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256 out) {
            directOut = out;
        } catch {
            console2.log("SKIP: direct V3 WDOGE->USDC swap reverted");
            vm.skip(true);
            return;
        }

        if (directOut == 0) {
            console2.log("SKIP: direct V3 swap returned 0 (no usable liquidity)");
            vm.skip(true);
            return;
        }
        console2.log("direct V3 out (USDC units):", directOut);

        // ---- router leg: same input, pulled via Permit2 from a funded user, V3_SWAP, settled ----
        deal(WDOGE, user, amountIn);
        vm.prank(user);
        IERC20(WDOGE).approve(address(permit2), type(uint256).max);

        IAllowanceTransfer.PermitSingle memory p = IAllowanceTransfer.PermitSingle({
            details: IAllowanceTransfer.PermitDetails({
                token: WDOGE,
                amount: uint160(amountIn),
                expiration: uint48(block.timestamp + 1 days),
                nonce: 0
            }),
            spender: address(router),
            sigDeadline: block.timestamp + 1 hours
        });
        bytes memory sig = getPermitSignature(p, userPk, IEIP712(address(permit2)).DOMAIN_SEPARATOR(), vm);

        address recipient = makeAddr("recipient");

        // commands: PERMIT2_PERMIT(0x00), PERMIT2_TRANSFER_FROM(0x01), V3_SWAP(0x03)
        bytes memory commands = hex"000103";
        bytes[] memory inputs = new bytes[](3);
        inputs[0] = abi.encode(p, sig);
        inputs[1] = abi.encode(WDOGE, uint160(amountIn));
        inputs[2] = abi.encode(WDOGE, USDC, fee, amountIn, uint256(0)); // tin,tout,fee,amountIn,minOut

        DogeSwapRouter.Settlement memory s =
            DogeSwapRouter.Settlement({buyToken: USDC, minOut: 0, recipient: recipient});

        vm.prank(user);
        router.execute(commands, inputs, s, block.timestamp + 1 hours);

        uint256 routerOut = IERC20(USDC).balanceOf(recipient);
        console2.log("router V3 out (USDC units):", routerOut);

        assertGt(routerOut, 0, "router produced output");
        assertApproxEqRel(routerOut, directOut, 0.02e18, "router output within 2% of direct V3 swap");
    }
}
