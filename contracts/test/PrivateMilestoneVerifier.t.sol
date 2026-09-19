// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;
import { Test } from "forge-std/Test.sol";
import { PlonkVerifier } from "../src/privacy/PrivateMilestoneVerifier.sol";
import { PrivateMilestoneProof } from "./fixtures/PrivateMilestoneProof.sol";
contract PrivateMilestoneVerifierTest is Test {
    PlonkVerifier verifier;
    function setUp() public { verifier = new PlonkVerifier(); }
    function testRealPlonkProof() public view {
        (uint256[24] memory proof, uint256[3] memory signals) = PrivateMilestoneProof.sample();
        assertTrue(verifier.verifyProof(proof, signals));
    }
    function testCannotChangeCommitmentThresholdOrScope() public view {
        for (uint256 i; i < 3; i++) {
            (uint256[24] memory proof, uint256[3] memory signals) = PrivateMilestoneProof.sample();
            signals[i] += 1;
            assertFalse(verifier.verifyProof(proof, signals));
        }
    }
    function testCannotForgeProof() public view {
        (uint256[24] memory proof, uint256[3] memory signals) = PrivateMilestoneProof.sample();
        proof[18] = 0;
        assertFalse(verifier.verifyProof(proof, signals));
    }
}
