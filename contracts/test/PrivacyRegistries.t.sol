// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {Test} from "forge-std/Test.sol";
import {TagRegistry} from "../src/privacy/TagRegistry.sol";
import {SproutPolicyRegistry} from "../src/privacy/SproutPolicyRegistry.sol";

contract PrivacyRegistriesTest is Test {
    TagRegistry tags;
    SproutPolicyRegistry policies;
    uint256 constant KEY = 0xA11CE;
    address controller;
    bytes pub = hex"0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    bytes32 tag = keccak256("unlinked-alias");

    function setUp() public {
        vm.warp(1000);
        controller = vm.addr(KEY);
        tags = new TagRegistry();
        policies = new SproutPolicyRegistry();
    }

    function signature(TagRegistry registry, uint64 expiry, uint64 version, uint256 signer)
        internal
        view
        returns (bytes memory)
    {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("SproutTagRegistry"),
                keccak256("1"),
                block.chainid,
                address(registry)
            )
        );
        bytes32 message = keccak256(
            abi.encode(registry.UPDATE_TYPEHASH(), tag, controller, keccak256(pub), keccak256(pub), expiry, version)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signer, keccak256(abi.encodePacked("\x19\x01", domain, message)));
        return abi.encodePacked(r, s, v);
    }

    function testSignedTagRotationRejectsReplayAndWrongSigner() public {
        bytes memory sig = signature(tags, 2000, 1, KEY);
        tags.update(tag, controller, pub, pub, 2000, 1, sig);
        assertEq(tags.resolve(tag).version, 1);
        vm.expectRevert(TagRegistry.InvalidRecord.selector);
        tags.update(tag, controller, pub, pub, 2000, 1, sig);
        bytes memory wrong = signature(tags, 3000, 2, 123);
        vm.expectRevert(TagRegistry.Unauthorized.selector);
        tags.update(tag, controller, pub, pub, 3000, 2, wrong);
        tags.update(tag, controller, pub, pub, 3000, 2, signature(tags, 3000, 2, KEY));
        assertEq(tags.resolve(tag).version, 2);
    }

    function testTagSignatureCannotReplayAcrossRegistryOrChain() public {
        bytes memory sig = signature(tags, 2000, 1, KEY);
        TagRegistry other = new TagRegistry();
        vm.expectRevert(TagRegistry.Unauthorized.selector);
        other.update(tag, controller, pub, pub, 2000, 1, sig);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(TagRegistry.Unauthorized.selector);
        tags.update(tag, controller, pub, pub, 2000, 1, sig);
    }

    function testExpiryAndRevocationDoNotFreeTagForTakeover() public {
        tags.update(tag, controller, pub, pub, 2000, 1, signature(tags, 2000, 1, KEY));
        vm.warp(2000);
        vm.expectRevert(TagRegistry.Expired.selector);
        tags.resolve(tag);
        vm.expectRevert(TagRegistry.Unauthorized.selector);
        tags.update(tag, address(123), pub, pub, 3000, 2, "");
        vm.prank(controller);
        tags.revoke(tag);
        assertEq(tags.versionOf(tag), 2);
        vm.expectRevert(TagRegistry.Expired.selector);
        tags.resolve(tag);
    }

    function testPolicyOwnershipVersionAndExpiry() public {
        bytes32 salt = keccak256("private salt");
        bytes32 hash = keccak256("policy");
        vm.prank(controller);
        bytes32 account = policies.setPolicy(salt, hash, 0, 2000);
        assertTrue(policies.isCurrent(account, hash, 1));
        vm.prank(controller);
        vm.expectRevert(SproutPolicyRegistry.InvalidPolicy.selector);
        policies.setPolicy(salt, hash, 0, 2000);
        vm.expectRevert(SproutPolicyRegistry.Unauthorized.selector);
        policies.revoke(account);
        bytes32 other = policies.setPolicy(salt, hash, 0, 2000);
        assertTrue(other != account);
        vm.prank(controller);
        policies.revoke(account);
        assertFalse(policies.isCurrent(account, hash, 1));
        vm.prank(controller);
        policies.setPolicy(salt, hash, 2, 2000);
        assertTrue(policies.isCurrent(account, hash, 3));
        vm.warp(2000);
        assertFalse(policies.isCurrent(account, hash, 3));
    }
}
