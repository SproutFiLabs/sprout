// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Narrow venue adapter used by a SproutVault for bounded execution.
/// @dev The vault never forwards arbitrary user calldata; it only calls these
///      two functions on an allowlisted venue.
interface ISproutVenue {
    /// @notice Expected output for an exact-input swap, before slippage limits.
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut);

    /// @notice Execute a bounded exact-input swap. `recipient` is always the vault.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        returns (uint256 amountOut);
}
