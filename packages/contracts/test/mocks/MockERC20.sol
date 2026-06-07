// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract MockERC20 {
    string public name; string public symbol; uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public feeBps;          // fee-on-transfer
    bool public approveReturnsVoid; // USDT-style no-return approve

    constructor(string memory n, string memory s) { name = n; symbol = s; }
    function setFeeBps(uint256 b) external { feeBps = b; }
    function setApproveReturnsVoid(bool v) external { approveReturnsVoid = v; }
    function mint(address to, uint256 amt) external { balanceOf[to] += amt; totalSupply += amt; }
    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        if (approveReturnsVoid) { assembly { return(0, 0) } }
        return true;
    }
    function transfer(address to, uint256 amt) public returns (bool) { return _transfer(msg.sender, to, amt); }
    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) { require(a >= amt, "allowance"); allowance[from][msg.sender] = a - amt; }
        return _transfer(from, to, amt);
    }
    function _transfer(address from, address to, uint256 amt) internal returns (bool) {
        require(balanceOf[from] >= amt, "balance");
        balanceOf[from] -= amt;
        uint256 fee = (amt * feeBps) / 10_000;
        balanceOf[to] += (amt - fee);
        if (fee > 0) balanceOf[address(0xdead)] += fee;
        return true;
    }
}
