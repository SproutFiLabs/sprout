// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Anvil/test fixture only. Yield comes from explicit donations of test tokens.
contract LocalTreasury is ERC4626 {
    constructor(IERC20 token) ERC20("Local practice treasury", "pCASH") ERC4626(token) {
        require(block.chainid == 31337, "local only");
    }
}
