// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUniswapV2Pair} from "../../src/interfaces/IUniswapV2Pair.sol";

contract MockUniswapV2Pair is IUniswapV2Pair {
    using SafeERC20 for IERC20;

    uint256 private constant FEE_MULTIPLIER = 1000;
    uint256 private constant FEE_UNITS = 3;

    error InsufficientInputAmount();
    error InsufficientLiquidity();
    error InvalidOutputAmount();
    error KInvariant();
    error UnsupportedCallback();
    error ZeroAddress();
    error ZeroAmount();

    address public immutable token0; // immutable because the test pair tokens never change.
    address public immutable token1; // immutable because the test pair tokens never change.
    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;

    constructor(address token0_, address token1_) {
        if (token0_ == address(0) || token1_ == address(0)) revert ZeroAddress();
        token0 = token0_;
        token1 = token1_;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function addLiquidity(uint256 amount0, uint256 amount1) external {
        if (amount0 == 0 || amount1 == 0) revert ZeroAmount();

        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1);
        _update();
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external {
        if (data.length != 0) revert UnsupportedCallback();
        if (to == address(0)) revert ZeroAddress();
        if (amount0Out == 0 && amount1Out == 0) revert InvalidOutputAmount();
        if (amount0Out >= reserve0 || amount1Out >= reserve1) revert InsufficientLiquidity();

        uint112 reserve0Before = reserve0;
        uint112 reserve1Before = reserve1;
        if (amount0Out > 0) IERC20(token0).safeTransfer(to, amount0Out);
        if (amount1Out > 0) IERC20(token1).safeTransfer(to, amount1Out);

        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0In = balance0 > uint256(reserve0Before) - amount0Out ? balance0 - (uint256(reserve0Before) - amount0Out) : 0;
        uint256 amount1In = balance1 > uint256(reserve1Before) - amount1Out ? balance1 - (uint256(reserve1Before) - amount1Out) : 0;
        if (amount0In == 0 && amount1In == 0) revert InsufficientInputAmount();

        uint256 balance0Adjusted = (balance0 * FEE_MULTIPLIER) - (amount0In * FEE_UNITS);
        uint256 balance1Adjusted = (balance1 * FEE_MULTIPLIER) - (amount1In * FEE_UNITS);
        if (
            balance0Adjusted * balance1Adjusted <
            uint256(reserve0Before) * uint256(reserve1Before) * FEE_MULTIPLIER * FEE_MULTIPLIER
        ) {
            revert KInvariant();
        }

        _update();
    }

    function _update() private {
        reserve0 = uint112(IERC20(token0).balanceOf(address(this)));
        reserve1 = uint112(IERC20(token1).balanceOf(address(this)));
        blockTimestampLast = uint32(block.timestamp);
    }
}
