// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {MockERC20} from "./MockERC20.sol";
import {IAlgebraSwapRouter} from "../../src/interfaces/IAlgebraSwapRouter.sol";
contract MockAlgebraRouter {
    uint256 public rateBps = 9_960;
    address public lastCaller; address public lastDeployer;
    function exactInputSingle(IAlgebraSwapRouter.ExactInputSingleParams calldata p) external payable returns (uint256 amountOut) {
        lastCaller = msg.sender; lastDeployer = p.deployer;
        MockERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        amountOut = (p.amountIn * rateBps) / 10_000;
        require(amountOut >= p.amountOutMinimum, "ALG: TOO_LITTLE");
        MockERC20(p.tokenOut).mint(p.recipient, amountOut);
    }
}
