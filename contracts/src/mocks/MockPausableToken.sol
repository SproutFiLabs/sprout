// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MockERC20} from "./MockERC20.sol";

/// @notice Test stock token that additionally exposes the optional
///         `oraclePaused()` signal some stock tokens publish.
contract MockPausableToken is MockERC20 {
    bool private _oraclePaused;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) MockERC20(name_, symbol_, decimals_) {}

    function setOraclePaused(bool paused_) external {
        _oraclePaused = paused_;
    }

    function oraclePaused() external view returns (bool) {
        return _oraclePaused;
    }
}
