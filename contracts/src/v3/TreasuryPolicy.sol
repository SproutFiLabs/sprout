// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// Eligibility and NAV heartbeat supplied by the approved treasury operator.
/// This does not manufacture a price or remove an issuer's redemption restrictions.
contract TreasuryPolicy is Ownable2Step {
    mapping(address => bool) public permitted;
    uint64 public updatedAt;
    uint64 public immutable maxAge;
    event Eligibility(address indexed vault, bool permitted);
    event NavHeartbeat(uint64 at);

    constructor(address operator, uint64 age) Ownable(operator) {
        require(age >= 1 hours && age <= 7 days, "age");
        maxAge = age;
    }

    function setPermitted(address vault, bool value) external onlyOwner {
        require(vault.code.length > 0, "vault");
        permitted[vault] = value;
        emit Eligibility(vault, value);
    }

    function publishHeartbeat() external onlyOwner {
        updatedAt = uint64(block.timestamp);
        emit NavHeartbeat(updatedAt);
    }
}
