// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Versioned family-policy commitments. This registry alone does NOT enforce private trades.
/// @dev A future settlement verifier must bind account, epoch and policyHash to every accepted proof.
contract SproutPolicyRegistry {
    struct Policy {
        address controller;
        bytes32 policyHash;
        uint64 epoch;
        uint64 expiresAt;
    }
    mapping(bytes32 => Policy) public policies;
    error Unauthorized();
    error InvalidPolicy();
    event PolicyUpdated(bytes32 indexed account, bytes32 policyHash, uint64 epoch, uint64 expiresAt);

    /// @dev Account ID is bound to its controller to prevent first-write front-running.
    function accountId(address controller, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode("sprout-private-account-v2", block.chainid, address(this), controller, salt));
    }

    function setPolicy(bytes32 salt, bytes32 policyHash, uint64 expectedEpoch, uint64 expiresAt)
        external
        returns (bytes32 account)
    {
        account = accountId(msg.sender, salt);
        Policy storage p = policies[account];
        if (p.controller != address(0) && p.controller != msg.sender) revert Unauthorized();
        if (p.epoch != expectedEpoch || policyHash == bytes32(0) || expiresAt <= block.timestamp) {
            revert InvalidPolicy();
        }
        p.controller = msg.sender;
        p.policyHash = policyHash;
        p.epoch++;
        p.expiresAt = expiresAt;
        emit PolicyUpdated(account, policyHash, p.epoch, expiresAt);
    }

    function revoke(bytes32 account) external {
        Policy storage p = policies[account];
        if (p.controller != msg.sender) revert Unauthorized();
        p.epoch++;
        p.expiresAt = 0;
        emit PolicyUpdated(account, p.policyHash, p.epoch, 0);
    }

    function isCurrent(bytes32 account, bytes32 policyHash, uint64 epoch) external view returns (bool) {
        Policy memory p = policies[account];
        return
            p.controller != address(0) && p.expiresAt > block.timestamp && p.policyHash == policyHash
                && p.epoch == epoch;
    }
}
