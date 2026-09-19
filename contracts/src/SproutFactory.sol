// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {SproutVault} from "./SproutVault.sol";

/// @title SproutFactory
/// @notice Deploys one minimal-proxy {SproutVault} per sprout and publishes the
///         immutable admission policy that bounds what any vault may hold or
///         trade. The parent is always `msg.sender`.
///
/// @dev There is no owner and no post-deployment mutation: settlement token,
///      admitted assets and admitted venues are fixed at deployment. A vault can
///      only ever select a subset of these, so a parent cannot admit a hostile
///      token or venue after the fact.
///
///      Two different limits apply. The factory may admit up to
///      {MAX_ADMITTED_ASSETS} assets: that is the menu families choose from.
///      Each sprout still holds at most {MAX_ASSETS} of them at a time, which
///      {SproutVault} enforces on initialization and on every allocation
///      change, so a single purchase never fans out across the whole menu.
contract SproutFactory {
    /// @notice Most assets one sprout may hold at a time. Mirrors
    ///         `SproutVault.MAX_ASSETS`, which is what actually enforces it.
    uint256 public constant MAX_ASSETS = 5;
    /// @notice Most assets this factory may admit in total.
    uint256 public constant MAX_ADMITTED_ASSETS = 32;

    address public immutable vaultImplementation;
    address public immutable settlementToken;

    mapping(address => bool) private _admittedAsset;
    mapping(address => bool) private _admittedVenue;
    address[] private _admittedAssets;
    address[] private _admittedVenues;

    address[] private _allSprouts;
    mapping(address => address[]) private _sproutsOf;

    event SproutCreated(
        address indexed vault,
        address indexed parent,
        address indexed beneficiary,
        address settlementToken,
        uint64 graduationTimestamp
    );

    error BadArguments();
    error UnsupportedToken();
    error UnsupportedVenue();

    constructor(address implementation_, address settlementToken_, address[] memory assets_, address[] memory venues_) {
        if (implementation_ == address(0) || settlementToken_ == address(0)) revert BadArguments();
        if (assets_.length == 0 || assets_.length > MAX_ADMITTED_ASSETS) revert BadArguments();
        vaultImplementation = implementation_;
        settlementToken = settlementToken_;

        for (uint256 i = 0; i < assets_.length; i++) {
            address asset = assets_[i];
            if (asset == address(0) || asset == settlementToken_ || _admittedAsset[asset]) revert BadArguments();
            _admittedAsset[asset] = true;
            _admittedAssets.push(asset);
        }
        for (uint256 i = 0; i < venues_.length; i++) {
            address venue = venues_[i];
            if (venue == address(0) || _admittedVenue[venue]) revert BadArguments();
            _admittedVenue[venue] = true;
            _admittedVenues.push(venue);
        }
    }

    function isAdmittedAsset(address asset) external view returns (bool) {
        return _admittedAsset[asset];
    }

    function isAdmittedVenue(address venue) external view returns (bool) {
        return _admittedVenue[venue];
    }

    function admittedAssets() external view returns (address[] memory) {
        return _admittedAssets;
    }

    function admittedVenues() external view returns (address[] memory) {
        return _admittedVenues;
    }

    function createSprout(
        address beneficiary,
        address settlementToken_,
        address[] calldata assets,
        uint16[] calldata weights,
        uint64 graduationTimestamp,
        address[] calldata venues
    ) external returns (address vault) {
        if (settlementToken_ != settlementToken) revert UnsupportedToken();
        for (uint256 i = 0; i < assets.length; i++) {
            if (!_admittedAsset[assets[i]]) revert UnsupportedToken();
        }
        for (uint256 i = 0; i < venues.length; i++) {
            if (!_admittedVenue[venues[i]]) revert UnsupportedVenue();
        }

        vault = Clones.clone(vaultImplementation);
        SproutVault(vault).initialize(
            address(this), msg.sender, beneficiary, settlementToken, assets, weights, graduationTimestamp, venues
        );
        _allSprouts.push(vault);
        _sproutsOf[msg.sender].push(vault);
        emit SproutCreated(vault, msg.sender, beneficiary, settlementToken, graduationTimestamp);
    }

    function totalSprouts() external view returns (uint256) {
        return _allSprouts.length;
    }

    function allSprouts() external view returns (address[] memory) {
        return _allSprouts;
    }

    function sproutsOf(address parent) external view returns (address[] memory) {
        return _sproutsOf[parent];
    }

    function sproutsOfLength(address parent) external view returns (uint256) {
        return _sproutsOf[parent].length;
    }
}
