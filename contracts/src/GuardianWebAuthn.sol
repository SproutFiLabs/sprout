// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @notice WebAuthn assertion verification for Guardian's transaction challenge.
/// @dev Follows WebAuthn Level 2 steps 11–20 and OpenZeppelin WebAuthn v5.7.0's
/// validation pattern, using this repository's OZ 5.1 P256 implementation.
/// Adds RP-ID and origin binding. Counters/attestation are not enforced (synced
/// passkeys may have zero counters); replay is prevented by the wallet nonce.
library GuardianWebAuthn {
    struct Assertion {
        bytes authenticatorData;
        string clientDataJSON;
        uint256 challengeIndex;
        uint256 typeIndex;
        uint256 originIndex;
        bytes32 r;
        bytes32 s;
    }

    function verify(
        bytes32 challenge,
        Assertion calldata a,
        bytes32 x,
        bytes32 y,
        bytes32 rpIdHash,
        string memory origin
    ) internal view returns (bool) {
        if (
            a.authenticatorData.length < 37 || a.authenticatorData.length > 1024
                || bytes(a.clientDataJSON).length > 2048
        ) return false;
        if (bytes32(a.authenticatorData[:32]) != rpIdHash) return false;
        uint8 flags = uint8(a.authenticatorData[32]);
        if (flags & 5 != 5 || (flags & 16 != 0 && flags & 8 == 0)) return false;
        bytes memory json = bytes(a.clientDataJSON);
        if (
            !_at(json, a.typeIndex, bytes('"type":"webauthn.get"'))
                || !_at(
                    json,
                    a.challengeIndex,
                    bytes(string.concat('"challenge":"', Base64.encodeURL(abi.encodePacked(challenge)), '"'))
                ) || !_at(json, a.originIndex, bytes(string.concat('"origin":"', origin, '"')))
        ) return false;
        return P256.verify(sha256(abi.encodePacked(a.authenticatorData, sha256(json))), a.r, a.s, x, y);
    }

    function _at(bytes memory source, uint256 offset, bytes memory expected) private pure returns (bool) {
        if (offset > source.length || expected.length > source.length - offset) return false;
        for (uint256 i; i < expected.length; ++i) {
            if (source[offset + i] != expected[i]) return false;
        }
        return true;
    }
}
