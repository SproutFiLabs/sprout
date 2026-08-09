// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Chainlink-AggregatorV3-shaped local price feed.
contract MockPriceFeed {
    uint8 public decimals;
    int256 private _answer;
    uint256 private _updatedAt;
    bool public paused;
    uint80 private _roundId;

    constructor(uint8 decimals_, int256 answer_, uint256 updatedAt_) {
        decimals = decimals_;
        _answer = answer_;
        _updatedAt = updatedAt_;
        _roundId = 1;
    }

    function setAnswer(int256 answer_) external {
        _answer = answer_;
        _updatedAt = block.timestamp;
        _roundId += 1;
    }

    function setAnswerAt(int256 answer_, uint256 updatedAt_) external {
        _answer = answer_;
        _updatedAt = updatedAt_;
    }

    function setPaused(bool paused_) external {
        paused = paused_;
    }

    function latestAnswer() external view returns (int256) {
        return _answer;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!paused, "PAUSED");
        require(_updatedAt != 0, "NO_DATA");
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }
}
