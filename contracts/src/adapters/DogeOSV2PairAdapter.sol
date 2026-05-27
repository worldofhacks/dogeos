// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDogeOSSwapAdapter} from "../interfaces/IDogeOSSwapAdapter.sol";
import {IUniswapV2Factory} from "../interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "../interfaces/IUniswapV2Pair.sol";

/// @notice DogeOS V2-style direct pair adapter for exact-input swaps.
/// @dev The adapter is factory-bound and accepts only canonical factory pairs.
contract DogeOSV2PairAdapter is IDogeOSSwapAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_NUMERATOR = 997;
    uint256 public constant FEE_DENOMINATOR = 1000;

    error CanonicalPairMismatch(address tokenIn, address tokenOut, address pair, address expectedPair);
    error IdenticalTokens(address token);
    error InsufficientLiquidity(uint256 reserveIn, uint256 reserveOut);
    error InvalidRouteData();
    error OutputBelowMinimum(uint256 amountOut, uint256 minAmountOut);
    error PairTokenMismatch(address tokenIn, address tokenOut, address pair);
    error UnexpectedNativeValue(uint256 value);
    error ZeroAddress();
    error ZeroAmount();

    /// @notice DogeOS V2-style factory used for canonical pair validation.
    IUniswapV2Factory public immutable factory; // immutable because this adapter is deployed per verified source.

    /// @notice Create a factory-bound DogeOS V2 pair adapter.
    /// @param factory_ Canonical V2-style factory address.
    constructor(IUniswapV2Factory factory_) {
        if (address(factory_) == address(0)) revert ZeroAddress();
        factory = factory_;
    }

    /// @notice Quote a direct exact-input swap against a canonical pair.
    /// @param pair V2-style pair address.
    /// @param tokenIn Input token.
    /// @param tokenOut Output token.
    /// @param amountIn Exact input amount.
    /// @return amountOut Expected output after the V2 fee.
    function quoteExactInput(
        IUniswapV2Pair pair,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        _validatePair(pair, tokenIn, tokenOut);
        (uint256 reserveIn, uint256 reserveOut, ) = _reservesFor(pair, tokenIn);
        amountOut = _amountOut(amountIn, reserveIn, reserveOut);
    }

    /// @notice Execute an exact-input swap through a canonical V2-style DogeOS pair.
    /// @param params Typed exact-input route parameters from the DogeOS router.
    /// @return amountOut Amount produced by the pair.
    function exactInput(ExactInputParams calldata params) external payable nonReentrant returns (uint256 amountOut) {
        if (msg.value != 0) revert UnexpectedNativeValue(msg.value);
        if (params.recipient == address(0)) revert ZeroAddress();
        if (params.tokenIn == address(0) || params.tokenOut == address(0)) revert ZeroAddress();
        if (params.tokenIn == params.tokenOut) revert IdenticalTokens(params.tokenIn);
        if (params.amountIn == 0) revert ZeroAmount();

        IUniswapV2Pair pair = _decodePair(params.routeData);
        _validatePair(pair, params.tokenIn, params.tokenOut);

        (uint256 reserveIn, uint256 reserveOut, bool tokenInIsToken0) = _reservesFor(pair, params.tokenIn);
        amountOut = _amountOut(params.amountIn, reserveIn, reserveOut);
        if (amountOut < params.minAmountOut) revert OutputBelowMinimum(amountOut, params.minAmountOut);

        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(pair), params.amountIn);
        (uint256 amount0Out, uint256 amount1Out) = tokenInIsToken0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
        pair.swap(amount0Out, amount1Out, params.recipient, "");
    }

    function _decodePair(bytes calldata routeData) private pure returns (IUniswapV2Pair pair) {
        if (routeData.length != 32) revert InvalidRouteData();
        pair = IUniswapV2Pair(abi.decode(routeData, (address)));
        if (address(pair) == address(0)) revert ZeroAddress();
    }

    function _validatePair(IUniswapV2Pair pair, address tokenIn, address tokenOut) private view {
        if (tokenIn == address(0) || tokenOut == address(0)) revert ZeroAddress();
        if (tokenIn == tokenOut) revert IdenticalTokens(tokenIn);

        address pairToken0 = pair.token0();
        address pairToken1 = pair.token1();
        bool forward = tokenIn == pairToken0 && tokenOut == pairToken1;
        bool reverse = tokenIn == pairToken1 && tokenOut == pairToken0;
        if (!forward && !reverse) revert PairTokenMismatch(tokenIn, tokenOut, address(pair));

        address expectedPair = factory.getPair(tokenIn, tokenOut);
        if (expectedPair != address(pair)) {
            revert CanonicalPairMismatch(tokenIn, tokenOut, address(pair), expectedPair);
        }
    }

    function _reservesFor(
        IUniswapV2Pair pair,
        address tokenIn
    ) private view returns (uint256 reserveIn, uint256 reserveOut, bool tokenInIsToken0) {
        (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
        tokenInIsToken0 = tokenIn == pair.token0();
        (reserveIn, reserveOut) = tokenInIsToken0 ? (uint256(reserve0), uint256(reserve1)) : (uint256(reserve1), uint256(reserve0));
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity(reserveIn, reserveOut);
    }

    function _amountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) private pure returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();
        uint256 amountInWithFee = amountIn * FEE_NUMERATOR;
        amountOut = (amountInWithFee * reserveOut) / ((reserveIn * FEE_DENOMINATOR) + amountInWithFee);
        if (amountOut == 0 || amountOut >= reserveOut) revert InsufficientLiquidity(reserveIn, reserveOut);
    }
}
