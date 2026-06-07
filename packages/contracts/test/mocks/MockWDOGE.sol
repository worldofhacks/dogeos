// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract MockWDOGE {
    string public name = "Wrapped Doge";
    string public symbol = "WDOGE";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function deposit() public payable { balanceOf[msg.sender] += msg.value; }

    function withdraw(uint256 amt) external {
        require(balanceOf[msg.sender] >= amt, "bal");
        balanceOf[msg.sender] -= amt;
        (bool ok, ) = msg.sender.call{value: amt}("");
        require(ok, "send");
    }

    receive() external payable { deposit(); }

    // test-only; back with vm.deal
    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) { return _t(msg.sender, to, a); }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        uint256 al = allowance[f][msg.sender];
        if (al != type(uint256).max) { require(al >= a, "al"); allowance[f][msg.sender] = al - a; }
        return _t(f, to, a);
    }

    function _t(address f, address to, uint256 a) internal returns (bool) {
        require(balanceOf[f] >= a, "bal");
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}
