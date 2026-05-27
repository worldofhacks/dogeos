// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IUniswapV2Factory} from "../../src/interfaces/IUniswapV2Factory.sol";

contract MockUniswapV2Factory is IUniswapV2Factory {
    mapping(address tokenA => mapping(address tokenB => address pair)) public getPair;

    function setPair(address tokenA, address tokenB, address pair) external {
        getPair[tokenA][tokenB] = pair;
        getPair[tokenB][tokenA] = pair;
    }
}
