// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Immutable admission policy published by {SproutFactory}. Vaults read
///         this so parents can only ever choose assets and venues that were
///         vetted at factory deployment time.
interface ISproutAdmission {
    function settlementToken() external view returns (address);

    function isAdmittedAsset(address asset) external view returns (bool);

    function isAdmittedVenue(address venue) external view returns (bool);
}
