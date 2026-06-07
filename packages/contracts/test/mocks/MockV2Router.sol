// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {MockERC20} from "./MockERC20.sol";
contract MockV2Router {
    uint256 public rateBps = 9_900;
    address public lastCaller;
    function setRateBps(uint256 r) external { rateBps = r; }
    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256)
        external returns (uint256[] memory amounts)
    {
        lastCaller = msg.sender;
        MockERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        uint256 out = (amountIn * rateBps) / 10_000;
        require(out >= amountOutMin, "V2: INSUFFICIENT_OUTPUT");
        MockERC20(path[path.length - 1]).mint(to, out);
        amounts = new uint256[](2); amounts[0] = amountIn; amounts[1] = out;
    }
}
