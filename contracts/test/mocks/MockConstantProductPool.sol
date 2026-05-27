// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Test-only constant-product pool used for router integration coverage.
contract MockConstantProductPool {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_NUMERATOR = 997;
    uint256 public constant FEE_DENOMINATOR = 1000;

    error IdenticalTokens(address token);
    error InsufficientInputAmount(uint256 actual, uint256 expected);
    error InsufficientLiquidity(uint256 reserveIn, uint256 reserveOut);
    error InvalidToken(address token);
    error ZeroAddress();
    error ZeroAmount();

    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1);
    event Swap(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        address recipient,
        uint256 amountIn,
        uint256 amountOut
    );

    address public immutable token0; // immutable because the test pair never changes after deployment.
    address public immutable token1; // immutable because the test pair never changes after deployment.
    uint256 public reserve0;
    uint256 public reserve1;

    /// @notice Create a two-token pool.
    /// @param token0_ First ERC20 token.
    /// @param token1_ Second ERC20 token.
    constructor(address token0_, address token1_) {
        if (token0_ == address(0) || token1_ == address(0)) revert ZeroAddress();
        if (token0_ == token1_) revert IdenticalTokens(token0_);
        token0 = token0_;
        token1 = token1_;
    }

    /// @notice Add balanced or unbalanced liquidity to the test pool.
    /// @param amount0 Amount of token0 to deposit.
    /// @param amount1 Amount of token1 to deposit.
    function addLiquidity(uint256 amount0, uint256 amount1) external {
        if (amount0 == 0 || amount1 == 0) revert ZeroAmount();

        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1);
        _sync();

        emit LiquidityAdded(msg.sender, amount0, amount1);
    }

    /// @notice Return the output amount for an exact-input swap.
    /// @param tokenIn Input token address.
    /// @param amountIn Exact input amount.
    /// @return amountOut Expected output after the 0.3 percent test fee.
    function getAmountOut(address tokenIn, uint256 amountIn) public view returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();

        (, uint256 reserveIn, uint256 reserveOut) = _poolSide(tokenIn);
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity(reserveIn, reserveOut);

        uint256 amountInWithFee = amountIn * FEE_NUMERATOR;
        amountOut = (amountInWithFee * reserveOut) / ((reserveIn * FEE_DENOMINATOR) + amountInWithFee);
        if (amountOut == 0 || amountOut >= reserveOut) revert InsufficientLiquidity(reserveIn, reserveOut);
    }

    /// @notice Swap after the caller has transferred `amountIn` into the pool.
    /// @param tokenIn Input token address.
    /// @param amountIn Exact input amount.
    /// @param recipient Output token recipient.
    /// @return amountOut Output amount sent to the recipient.
    function swapExactInput(address tokenIn, uint256 amountIn, address recipient) external returns (uint256 amountOut) {
        if (recipient == address(0)) revert ZeroAddress();

        (address tokenOut, uint256 reserveIn, ) = _poolSide(tokenIn);
        uint256 actualInput = IERC20(tokenIn).balanceOf(address(this)) - reserveIn;
        if (actualInput < amountIn) revert InsufficientInputAmount(actualInput, amountIn);

        amountOut = getAmountOut(tokenIn, amountIn);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
        _sync();

        emit Swap(msg.sender, tokenIn, tokenOut, recipient, amountIn, amountOut);
    }

    function _poolSide(address tokenIn) private view returns (address tokenOut, uint256 reserveIn, uint256 reserveOut) {
        if (tokenIn == token0) {
            return (token1, reserve0, reserve1);
        }
        if (tokenIn == token1) {
            return (token0, reserve1, reserve0);
        }
        revert InvalidToken(tokenIn);
    }

    function _sync() private {
        reserve0 = IERC20(token0).balanceOf(address(this));
        reserve1 = IERC20(token1).balanceOf(address(this));
    }
}
