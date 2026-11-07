// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PotShot
/// @notice Trustless 1v1 Rock-Paper-Scissors with native BOT stakes and commit-reveal mechanics.
/// @dev Tagline: "One throw. One pot."
contract PotShot is ReentrancyGuard {
    // --- Enums & Structs ---

    enum Move {
        None,
        Rock,
        Paper,
        Scissors
    }

    enum Status {
        Open,
        Committed,
        Won,
        Draw,
        Cancelled,
        TimedOut
    }

    struct Game {
        uint256 id;
        address playerA;
        address playerB;
        uint256 stake;
        bytes32 commitA;
        bytes32 commitB;
        Move moveA;
        Move moveB;
        uint64 createdAt;
        uint64 joinedAt;
        uint64 revealDeadline;
        address winner;
        Status status;
    }

    struct Record {
        uint32 wins;
        uint32 losses;
        uint32 draws;
    }

    // --- State Variables ---

    /// @notice Duration allowed for moves reveal after opponent joins
    uint64 public immutable revealWindow;

    /// @notice Total games created (IDs start at 1)
    uint256 public gameCount;

    /// @notice Game storage mapping by game ID
    mapping(uint256 => Game) private _games;

    /// @notice Pull-based payout balances (in wei)
    mapping(address => uint256) public pendingBalance;

    /// @notice List of game IDs each user participated in
    mapping(address => uint256[]) private _userGames;

    /// @notice Win/loss/draw records for each user
    mapping(address => Record) private _records;

    // --- Custom Errors ---

    error InvalidRevealWindow(uint64 window);
    error ZeroStake();
    error ZeroCommitment();
    error GameNotFound(uint256 id);
    error InvalidStatus(Status expected, Status actual);
    error CannotJoinOwnGame();
    error IncorrectStake(uint256 expected, uint256 actual);
    error OnlyPlayerA();
    error NotAPlayer();
    error RevealDeadlinePassed(uint64 deadline, uint64 currentTimestamp);
    error RevealDeadlineNotPassed(uint64 deadline, uint64 currentTimestamp);
    error InvalidMove();
    error AlreadyRevealed();
    error InvalidReveal();
    error NoPendingBalance();
    error TransferFailed();

    // --- Events ---

    event GameCreated(
        uint256 indexed id,
        address indexed playerA,
        uint256 stake,
        bytes32 commitA,
        uint64 createdAt
    );

    event GameJoined(
        uint256 indexed id,
        address indexed playerB,
        bytes32 commitB,
        uint64 joinedAt,
        uint64 revealDeadline
    );

    event GameCancelled(
        uint256 indexed id,
        address indexed playerA,
        uint256 refundAmount
    );

    event Revealed(
        uint256 indexed id,
        address indexed player,
        Move move
    );

    event Settled(
        uint256 indexed id,
        Status status,
        address indexed winner,
        uint256 payoutA,
        uint256 payoutB
    );

    event TimedOutSettled(
        uint256 indexed id,
        address indexed winner,
        uint256 payoutA,
        uint256 payoutB
    );

    event Withdrawn(
        address indexed user,
        uint256 amount
    );

    // --- Constructor ---

    /// @param revealWindow_ Time window in seconds for players to reveal moves (between 1 min and 7 days)
    constructor(uint64 revealWindow_) {
        if (revealWindow_ < 1 minutes || revealWindow_ > 7 days) {
            revert InvalidRevealWindow(revealWindow_);
        }
        revealWindow = revealWindow_;
    }

    // --- External / Public Game Actions ---

    /// @notice Create a new game with a secret commitment and BOT stake
    /// @param commitment Hash of player address, move, and secret salt
    /// @return id The newly assigned game ID
    function createGame(bytes32 commitment) external payable nonReentrant returns (uint256) {
        if (msg.value == 0) revert ZeroStake();
        if (commitment == bytes32(0)) revert ZeroCommitment();

        uint256 id = ++gameCount;
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 nowTs = uint64(block.timestamp);

        _games[id] = Game({
            id: id,
            playerA: msg.sender,
            playerB: address(0),
            stake: msg.value,
            commitA: commitment,
            commitB: bytes32(0),
            moveA: Move.None,
            moveB: Move.None,
            createdAt: nowTs,
            joinedAt: 0,
            revealDeadline: 0,
            winner: address(0),
            status: Status.Open
        });

        _userGames[msg.sender].push(id);

        emit GameCreated(id, msg.sender, msg.value, commitment, nowTs);
        return id;
    }

    /// @notice Join an open game by matching the exact stake and committing a secret move
    /// @param id Game ID to join
    /// @param commitment Hash of opponent address, move, and secret salt
    function joinGame(uint256 id, bytes32 commitment) external payable nonReentrant {
        if (id == 0 || id > gameCount) revert GameNotFound(id);

        Game storage g = _games[id];
        if (g.status != Status.Open) revert InvalidStatus(Status.Open, g.status);
        if (msg.sender == g.playerA) revert CannotJoinOwnGame();
        if (msg.value != g.stake) revert IncorrectStake(g.stake, msg.value);
        if (commitment == bytes32(0)) revert ZeroCommitment();

        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 nowTs = uint64(block.timestamp);
        uint64 deadline = nowTs + revealWindow;

        g.playerB = msg.sender;
        g.commitB = commitment;
        g.joinedAt = nowTs;
        g.revealDeadline = deadline;
        g.status = Status.Committed;

        _userGames[msg.sender].push(id);

        emit GameJoined(id, msg.sender, commitment, nowTs, deadline);
    }

    /// @notice Cancel an open game before anyone joins and claim a refund to pendingBalance
    /// @param id Game ID to cancel
    function cancelGame(uint256 id) external nonReentrant {
        if (id == 0 || id > gameCount) revert GameNotFound(id);

        Game storage g = _games[id];
        if (msg.sender != g.playerA) revert OnlyPlayerA();
        if (g.status != Status.Open) revert InvalidStatus(Status.Open, g.status);

        g.status = Status.Cancelled;
        pendingBalance[g.playerA] += g.stake;

        emit GameCancelled(id, g.playerA, g.stake);
    }

    /// @notice Reveal a committed move using the secret salt
    /// @param id Game ID
    /// @param move The chosen move (Rock, Paper, or Scissors)
    /// @param salt The secret 32-byte salt chosen when committing
    function reveal(uint256 id, Move move, bytes32 salt) external nonReentrant {
        if (id == 0 || id > gameCount) revert GameNotFound(id);

        Game storage g = _games[id];
        if (g.status != Status.Committed) revert InvalidStatus(Status.Committed, g.status);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > g.revealDeadline) {
            // forge-lint: disable-next-line(unsafe-typecast)
            revert RevealDeadlinePassed(g.revealDeadline, uint64(block.timestamp));
        }
        if (move == Move.None || move > Move.Scissors) revert InvalidMove();

        bytes32 expectedHash = computeCommitment(msg.sender, move, salt);

        if (msg.sender == g.playerA) {
            if (g.moveA != Move.None) revert AlreadyRevealed();
            if (expectedHash != g.commitA) revert InvalidReveal();
            g.moveA = move;
        } else if (msg.sender == g.playerB) {
            if (g.moveB != Move.None) revert AlreadyRevealed();
            if (expectedHash != g.commitB) revert InvalidReveal();
            g.moveB = move;
        } else {
            revert NotAPlayer();
        }

        emit Revealed(id, msg.sender, move);

        // If both players have revealed, settle immediately
        if (g.moveA != Move.None && g.moveB != Move.None) {
            _settleGame(id, g);
        }
    }

    /// @notice Claim timeout after reveal deadline passes without both players revealing
    /// @dev Can be called by anyone
    /// @param id Game ID
    function claimTimeout(uint256 id) external nonReentrant {
        if (id == 0 || id > gameCount) revert GameNotFound(id);

        Game storage g = _games[id];
        if (g.status != Status.Committed) revert InvalidStatus(Status.Committed, g.status);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp <= g.revealDeadline) {
            // forge-lint: disable-next-line(unsafe-typecast)
            revert RevealDeadlineNotPassed(g.revealDeadline, uint64(block.timestamp));
        }

        g.status = Status.TimedOut;
        uint256 stake = g.stake;

        if (g.moveA != Move.None && g.moveB == Move.None) {
            // Player A revealed, Player B forfeited
            g.winner = g.playerA;
            _records[g.playerA].wins += 1;
            _records[g.playerB].losses += 1;
            uint256 totalPot = stake * 2;
            pendingBalance[g.playerA] += totalPot;

            emit TimedOutSettled(id, g.playerA, totalPot, 0);
        } else if (g.moveA == Move.None && g.moveB != Move.None) {
            // Player B revealed, Player A forfeited
            g.winner = g.playerB;
            _records[g.playerB].wins += 1;
            _records[g.playerA].losses += 1;
            uint256 totalPot = stake * 2;
            pendingBalance[g.playerB] += totalPot;

            emit TimedOutSettled(id, g.playerB, 0, totalPot);
        } else {
            // Neither player revealed: refund both, no record changes
            pendingBalance[g.playerA] += stake;
            pendingBalance[g.playerB] += stake;

            emit TimedOutSettled(id, address(0), stake, stake);
        }
    }

    /// @notice Withdraw caller's accumulated balance from pendingBalance
    function withdraw() external nonReentrant {
        uint256 amount = pendingBalance[msg.sender];
        if (amount == 0) revert NoPendingBalance();

        pendingBalance[msg.sender] = 0;

        emit Withdrawn(msg.sender, amount);

        // forge-lint: disable-next-line(reentrancy-eth,arbitrary-send-eth)
        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    // --- Views ---

    /// @notice Compute commitment hash for a given player, move, and salt
    function computeCommitment(
        address player,
        Move move,
        bytes32 salt
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(player, move, salt));
    }

    /// @notice Get full game struct by ID
    function getGame(uint256 id) external view returns (Game memory) {
        if (id == 0 || id > gameCount) revert GameNotFound(id);
        return _games[id];
    }

    /// @notice Get player's win/loss/draw record
    function getRecord(address user) external view returns (Record memory) {
        return _records[user];
    }

    /// @notice Query games with pagination, returned newest first
    /// @param offset Number of newest games to skip
    /// @param limit Maximum number of games to return
    function getGames(uint256 offset, uint256 limit) external view returns (Game[] memory) {
        uint256 total = gameCount;
        if (offset >= total || limit == 0) {
            return new Game[](0);
        }

        uint256 available = total - offset;
        uint256 count = limit < available ? limit : available;
        Game[] memory result = new Game[](count);

        for (uint256 i = 0; i < count; i++) {
            result[i] = _games[total - offset - i];
        }

        return result;
    }

    /// @notice Query game IDs participated in by user, returned newest first
    /// @param user Address of the player
    /// @param offset Number of newest user games to skip
    /// @param limit Maximum number of game IDs to return
    function getUserGameIds(
        address user,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory) {
        uint256 total = _userGames[user].length;
        if (offset >= total || limit == 0) {
            return new uint256[](0);
        }

        uint256 available = total - offset;
        uint256 count = limit < available ? limit : available;
        uint256[] memory result = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            result[i] = _userGames[user][total - 1 - offset - i];
        }

        return result;
    }

    // --- Internal Helpers ---

    function _settleGame(uint256 id, Game storage g) private {
        Move mA = g.moveA;
        Move mB = g.moveB;
        uint256 stake = g.stake;

        if (mA == mB) {
            // Draw
            g.status = Status.Draw;
            pendingBalance[g.playerA] += stake;
            pendingBalance[g.playerB] += stake;
            _records[g.playerA].draws += 1;
            _records[g.playerB].draws += 1;

            emit Settled(id, Status.Draw, address(0), stake, stake);
        } else if (
            (mA == Move.Rock && mB == Move.Scissors) ||
            (mA == Move.Paper && mB == Move.Rock) ||
            (mA == Move.Scissors && mB == Move.Paper)
        ) {
            // Player A wins
            g.status = Status.Won;
            g.winner = g.playerA;
            _records[g.playerA].wins += 1;
            _records[g.playerB].losses += 1;
            uint256 totalPot = stake * 2;
            pendingBalance[g.playerA] += totalPot;

            emit Settled(id, Status.Won, g.playerA, totalPot, 0);
        } else {
            // Player B wins
            g.status = Status.Won;
            g.winner = g.playerB;
            _records[g.playerB].wins += 1;
            _records[g.playerA].losses += 1;
            uint256 totalPot = stake * 2;
            pendingBalance[g.playerB] += totalPot;

            emit Settled(id, Status.Won, g.playerB, 0, totalPot);
        }
    }
}
