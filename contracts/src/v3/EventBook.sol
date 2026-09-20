// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IEventSprout {
    function parent() external view returns (address);
}

/// Public commitments contain no names, guest messages or amounts.
contract EventBook {
    struct Event {
        address owner;
        address vault;
        bytes32 detailsHash;
        uint64 expires;
        bool closed;
    }
    mapping(bytes32 => Event) public events;
    event Created(bytes32 indexed id, address indexed vault, bytes32 detailsHash, uint64 expires);
    event Closed(bytes32 indexed id);
    error Invalid();

    function create(bytes32 id, address vault, bytes32 detailsHash, uint64 expires) external {
        if (
            id == bytes32(0) || detailsHash == bytes32(0) || events[id].owner != address(0)
                || IEventSprout(vault).parent() != msg.sender || expires <= block.timestamp
                || expires > block.timestamp + 366 days
        ) revert Invalid();
        events[id] = Event(msg.sender, vault, detailsHash, expires, false);
        emit Created(id, vault, detailsHash, expires);
    }

    function close(bytes32 id) external {
        if (events[id].owner != msg.sender || events[id].closed) revert Invalid();
        events[id].closed = true;
        emit Closed(id);
    }
}
