// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @notice Signed, expiring stealth-key records. Holds no funds.
/// @dev The controller and tag hash are public. Use a dedicated controller; a hash does not conceal guessable tags.
contract TagRegistry is EIP712 {
    struct Record {
        address controller;
        uint64 expiresAt;
        uint64 version;
        bytes spendingKey;
        bytes viewingKey;
    }
    bytes32 public constant UPDATE_TYPEHASH = keccak256(
        "TagUpdate(bytes32 tag,address controller,bytes32 spendingKeyHash,bytes32 viewingKeyHash,uint64 expiresAt,uint64 version)"
    );
    mapping(bytes32 => Record) private records;
    error InvalidRecord();
    error Unauthorized();
    error Expired();
    event TagUpdated(bytes32 indexed tag, uint64 version, uint64 expiresAt);
    constructor() EIP712("SproutTagRegistry", "1") {}

    function update(
        bytes32 tag,
        address controller,
        bytes calldata spendingKey,
        bytes calldata viewingKey,
        uint64 expiresAt,
        uint64 version,
        bytes calldata signature
    ) external {
        Record storage previous = records[tag];
        if (
            tag == bytes32(0) || controller == address(0) || expiresAt <= block.timestamp
                || expiresAt > block.timestamp + 365 days || version != previous.version + 1 || spendingKey.length != 33
                || viewingKey.length != 33 || (spendingKey[0] != 0x02 && spendingKey[0] != 0x03)
                || (viewingKey[0] != 0x02 && viewingKey[0] != 0x03)
        ) revert InvalidRecord();
        // Expiry never permits another controller to take over a known tag.
        if (previous.controller != address(0) && previous.controller != controller) revert Unauthorized();
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    UPDATE_TYPEHASH, tag, controller, keccak256(spendingKey), keccak256(viewingKey), expiresAt, version
                )
            )
        );
        if (!SignatureChecker.isValidSignatureNow(controller, digest, signature)) revert Unauthorized();
        records[tag] = Record(controller, expiresAt, version, spendingKey, viewingKey);
        emit TagUpdated(tag, version, expiresAt);
    }

    function revoke(bytes32 tag) external {
        Record storage r = records[tag];
        if (r.controller != msg.sender) revert Unauthorized();
        r.expiresAt = 0;
        r.version++;
        emit TagUpdated(tag, r.version, 0);
    }

    function resolve(bytes32 tag) external view returns (Record memory) {
        Record memory r = records[tag];
        if (r.expiresAt <= block.timestamp) revert Expired();
        return r;
    }

    function versionOf(bytes32 tag) external view returns (uint64) {
        return records[tag].version;
    }
}
