// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {MockERC20} from "./MockERC20.sol";
import {IUniswapV3SwapRouter} from "../../src/interfaces/IUniswapV3SwapRouter.sol";
contract MockV3Router {
    uint256 public rateBps = 9_950;
    address public lastCaller;
    function setRateBps(uint256 r) external { rateBps = r; }
    function exactInputSingle(IUniswapV3SwapRouter.ExactInputSingleParams calldata p) external payable returns (uint256 amountOut) {
        lastCaller = msg.sender;
        MockERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        amountOut = (p.amountIn * rateBps) / 10_000;
        require(amountOut >= p.amountOutMinimum, "V3: TOO_LITTLE_RECEIVED");
        MockERC20(p.tokenOut).mint(p.recipient, amountOut);
    }
}
