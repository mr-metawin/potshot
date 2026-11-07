// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {PotShot} from "../src/PotShot.sol";

contract MaliciousReentrantPlayer {
    PotShot public potshot;
    bool public hasReentered;

    constructor(PotShot potshot_) {
        potshot = potshot_;
    }

    function createGame(bytes32 commitment) external payable returns (uint256) {
        return potshot.createGame{value: msg.value}(commitment);
    }

    function cancelGame(uint256 id) external {
        potshot.cancelGame(id);
    }

    function withdraw() external {
        potshot.withdraw();
    }

    receive() external payable {
        if (!hasReentered) {
            hasReentered = true;
            // Attempt to re-enter withdraw
            potshot.withdraw();
        }
    }
}

contract RejectingPlayer {
    PotShot public potshot;

    constructor(PotShot potshot_) {
        potshot = potshot_;
    }

    function createGame(bytes32 commitment) external payable returns (uint256) {
        return potshot.createGame{value: msg.value}(commitment);
    }

    function cancelGame(uint256 id) external {
        potshot.cancelGame(id);
    }

    function withdraw() external {
        potshot.withdraw();
    }

    // Rejects all plain ETH transfers
    receive() external payable {
        revert("I reject ETH");
    }
}

contract PotShotTest is Test {
    PotShot public potshot;
    uint64 public constant DEFAULT_REVEAL_WINDOW = 1 hours;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public charlie = makeAddr("charlie");

    bytes32 public saltA = keccak256("salt_alice");
    bytes32 public saltB = keccak256("salt_bob");

    function setUp() public {
        potshot = new PotShot(DEFAULT_REVEAL_WINDOW);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);
    }

    // --- Constructor Limits ---

    function test_ConstructorReverts_UnderOneMinute() public {
        vm.expectRevert(abi.encodeWithSelector(PotShot.InvalidRevealWindow.selector, uint64(59)));
        new PotShot(59);
    }

    function test_ConstructorReverts_OverSevenDays() public {
        vm.expectRevert(abi.encodeWithSelector(PotShot.InvalidRevealWindow.selector, uint64(7 days + 1)));
        new PotShot(uint64(7 days + 1));
    }

    function test_ConstructorAccepts_ValidWindow() public {
        PotShot p1 = new PotShot(1 minutes);
        assertEq(p1.revealWindow(), 1 minutes);

        PotShot p2 = new PotShot(7 days);
        assertEq(p2.revealWindow(), 7 days);
    }

    // --- createGame ---

    function test_CreateGame_Success() public {
        bytes32 commit = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        vm.prank(alice);
        uint256 id = potshot.createGame{value: 1 ether}(commit);

        assertEq(id, 1);
        assertEq(potshot.gameCount(), 1);

        PotShot.Game memory g = potshot.getGame(1);
        assertEq(g.id, 1);
        assertEq(g.playerA, alice);
        assertEq(g.playerB, address(0));
        assertEq(g.stake, 1 ether);
        assertEq(g.commitA, commit);
        assertEq(g.commitB, bytes32(0));
        assertEq(uint8(g.moveA), uint8(PotShot.Move.None));
        assertEq(uint8(g.moveB), uint8(PotShot.Move.None));
        assertEq(g.createdAt, block.timestamp);
        assertEq(g.joinedAt, 0);
        assertEq(g.revealDeadline, 0);
        assertEq(g.winner, address(0));
        assertEq(uint8(g.status), uint8(PotShot.Status.Open));

        assertEq(address(potshot).balance, 1 ether);
    }

    function test_CreateGame_RevertZeroStake() public {
        bytes32 commit = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        vm.prank(alice);
        vm.expectRevert(PotShot.ZeroStake.selector);
        potshot.createGame{value: 0}(commit);
    }

    function test_CreateGame_RevertZeroCommitment() public {
        vm.prank(alice);
        vm.expectRevert(PotShot.ZeroCommitment.selector);
        potshot.createGame{value: 1 ether}(bytes32(0));
    }

    // --- joinGame ---

    function test_JoinGame_Success() public {
        bytes32 commitA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        vm.prank(alice);
        uint256 id = potshot.createGame{value: 2 ether}(commitA);

        bytes32 commitB = potshot.computeCommitment(bob, PotShot.Move.Paper, saltB);
        vm.warp(1000);
        vm.prank(bob);
        potshot.joinGame{value: 2 ether}(id, commitB);

        PotShot.Game memory g = potshot.getGame(id);
        assertEq(g.playerB, bob);
        assertEq(g.commitB, commitB);
        assertEq(g.joinedAt, 1000);
        assertEq(g.revealDeadline, 1000 + DEFAULT_REVEAL_WINDOW);
        assertEq(uint8(g.status), uint8(PotShot.Status.Committed));
        assertEq(address(potshot).balance, 4 ether);
    }

    function test_JoinGame_Reverts_IncorrectStake() public {
        bytes32 commitA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        vm.prank(alice);
        uint256 id = potshot.createGame{value: 2 ether}(commitA);

        bytes32 commitB = potshot.computeCommitment(bob, PotShot.Move.Paper, saltB);

        // Underpay
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PotShot.IncorrectStake.selector, 2 ether, 1 ether));
        potshot.joinGame{value: 1 ether}(id, commitB);

        // Overpay
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PotShot.IncorrectStake.selector, 2 ether, 3 ether));
        potshot.joinGame{value: 3 ether}(id, commitB);
    }

    function test_JoinGame_Reverts_CreatorCannotJoin() public {
        bytes32 commitA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        vm.prank(alice);
        uint256 id = potshot.createGame{value: 1 ether}(commitA);

        vm.prank(alice);
        vm.expectRevert(PotShot.CannotJoinOwnGame.selector);
        potshot.joinGame{value: 1 ether}(id, commitA);
    }

    function test_JoinGame_Reverts_ZeroCommitment() public {
        bytes32 commitA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        vm.prank(alice);
        uint256 id = potshot.createGame{value: 1 ether}(commitA);

        vm.prank(bob);
        vm.expectRevert(PotShot.ZeroCommitment.selector);
        potshot.joinGame{value: 1 ether}(id, bytes32(0));
    }

    function test_JoinGame_Reverts_NonOpenGame() public {
        bytes32 commitA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        vm.prank(alice);
        uint256 id = potshot.createGame{value: 1 ether}(commitA);

        bytes32 commitB = potshot.computeCommitment(bob, PotShot.Move.Paper, saltB);
        vm.prank(bob);
        potshot.joinGame{value: 1 ether}(id, commitB);

        // Second joiner reverts
        vm.prank(charlie);
        vm.expectRevert(
            abi.encodeWithSelector(
                PotShot.InvalidStatus.selector,
                PotShot.Status.Open,
                PotShot.Status.Committed
            )
        );
        potshot.joinGame{value: 1 ether}(id, commitB);
    }

    // --- cancelGame ---

    function test_CancelGame_Success() public {
        bytes32 commitA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        vm.prank(alice);
        uint256 id = potshot.createGame{value: 3 ether}(commitA);

        vm.prank(alice);
        potshot.cancelGame(id);

        PotShot.Game memory g = potshot.getGame(id);
        assertEq(uint8(g.status), uint8(PotShot.Status.Cancelled));
        assertEq(potshot.pendingBalance(alice), 3 ether);

        // Player A withdraws refunded stake
        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        potshot.withdraw();
        assertEq(alice.balance, balanceBefore + 3 ether);
        assertEq(potshot.pendingBalance(alice), 0);
    }

    function test_CancelGame_Reverts_Stranger() public {
        bytes32 commitA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        vm.prank(alice);
        uint256 id = potshot.createGame{value: 1 ether}(commitA);

        vm.prank(bob);
        vm.expectRevert(PotShot.OnlyPlayerA.selector);
        potshot.cancelGame(id);
    }

    function test_CancelGame_Reverts_AlreadyJoined() public {
        bytes32 commitA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        vm.prank(alice);
        uint256 id = potshot.createGame{value: 1 ether}(commitA);

        bytes32 commitB = potshot.computeCommitment(bob, PotShot.Move.Paper, saltB);
        vm.prank(bob);
        potshot.joinGame{value: 1 ether}(id, commitB);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                PotShot.InvalidStatus.selector,
                PotShot.Status.Open,
                PotShot.Status.Committed
            )
        );
        potshot.cancelGame(id);
    }

    // --- reveal ---

    function test_Reveal_SuccessAndRevertCases() public {
        bytes32 commitA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        vm.prank(alice);
        uint256 id = potshot.createGame{value: 1 ether}(commitA);

        bytes32 commitB = potshot.computeCommitment(bob, PotShot.Move.Scissors, saltB);
        vm.prank(bob);
        potshot.joinGame{value: 1 ether}(id, commitB);

        // Stranger cannot reveal
        vm.prank(charlie);
        vm.expectRevert(PotShot.NotAPlayer.selector);
        potshot.reveal(id, PotShot.Move.Rock, saltA);

        // Move.None reverts
        vm.prank(alice);
        vm.expectRevert(PotShot.InvalidMove.selector);
        potshot.reveal(id, PotShot.Move.None, saltA);

        // Wrong move reverts InvalidReveal
        vm.prank(alice);
        vm.expectRevert(PotShot.InvalidReveal.selector);
        potshot.reveal(id, PotShot.Move.Paper, saltA);

        // Wrong salt reverts InvalidReveal
        vm.prank(alice);
        vm.expectRevert(PotShot.InvalidReveal.selector);
        potshot.reveal(id, PotShot.Move.Rock, keccak256("wrong_salt"));

        // Valid reveal by alice succeeds
        vm.prank(alice);
        potshot.reveal(id, PotShot.Move.Rock, saltA);

        PotShot.Game memory g = potshot.getGame(id);
        assertEq(uint8(g.moveA), uint8(PotShot.Move.Rock));
        assertEq(uint8(g.status), uint8(PotShot.Status.Committed)); // Still committed awaiting Bob

        // Double reveal by alice reverts
        vm.prank(alice);
        vm.expectRevert(PotShot.AlreadyRevealed.selector);
        potshot.reveal(id, PotShot.Move.Rock, saltA);

        // Reveal after deadline reverts
        vm.warp(g.revealDeadline + 1);
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                PotShot.RevealDeadlinePassed.selector,
                g.revealDeadline,
                uint64(g.revealDeadline + 1)
            )
        );
        potshot.reveal(id, PotShot.Move.Scissors, saltB);
    }

    // --- Copy Attack Prevention ---

    function test_CopyAttack_Prevented() public {
        bytes32 commitA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        vm.prank(alice);
        uint256 id = potshot.createGame{value: 1 ether}(commitA);

        // Bob maliciously copies Alice's commitment verbatim
        vm.prank(bob);
        potshot.joinGame{value: 1 ether}(id, commitA);

        // Alice reveals Rock
        vm.prank(alice);
        potshot.reveal(id, PotShot.Move.Rock, saltA);

        // Bob tries to reveal Rock with Alice's salt
        vm.prank(bob);
        vm.expectRevert(PotShot.InvalidReveal.selector);
        potshot.reveal(id, PotShot.Move.Rock, saltA);
    }

    // --- All 9 Move Combinations ---

    function _testOutcome(
        PotShot.Move moveA,
        PotShot.Move moveB,
        bool aliceRevealsFirst,
        PotShot.Status expectedStatus,
        address expectedWinner,
        uint256 expectedPayoutA,
        uint256 expectedPayoutB
    ) internal {
        bytes32 cA = potshot.computeCommitment(alice, moveA, saltA);
        bytes32 cB = potshot.computeCommitment(bob, moveB, saltB);

        vm.prank(alice);
        uint256 id = potshot.createGame{value: 1 ether}(cA);

        vm.prank(bob);
        potshot.joinGame{value: 1 ether}(id, cB);

        uint256 balABefore = potshot.pendingBalance(alice);
        uint256 balBBefore = potshot.pendingBalance(bob);

        if (aliceRevealsFirst) {
            vm.prank(alice);
            potshot.reveal(id, moveA, saltA);
            vm.prank(bob);
            potshot.reveal(id, moveB, saltB);
        } else {
            vm.prank(bob);
            potshot.reveal(id, moveB, saltB);
            vm.prank(alice);
            potshot.reveal(id, moveA, saltA);
        }

        PotShot.Game memory g = potshot.getGame(id);
        assertEq(uint8(g.status), uint8(expectedStatus));
        assertEq(g.winner, expectedWinner);
        assertEq(potshot.pendingBalance(alice) - balABefore, expectedPayoutA);
        assertEq(potshot.pendingBalance(bob) - balBBefore, expectedPayoutB);
    }

    function test_All9MoveCombinations_BothRevealOrders() public {
        // 1. Rock vs Rock -> Draw
        _testOutcome(PotShot.Move.Rock, PotShot.Move.Rock, true, PotShot.Status.Draw, address(0), 1 ether, 1 ether);
        _testOutcome(PotShot.Move.Rock, PotShot.Move.Rock, false, PotShot.Status.Draw, address(0), 1 ether, 1 ether);

        // 2. Paper vs Paper -> Draw
        _testOutcome(PotShot.Move.Paper, PotShot.Move.Paper, true, PotShot.Status.Draw, address(0), 1 ether, 1 ether);
        _testOutcome(PotShot.Move.Paper, PotShot.Move.Paper, false, PotShot.Status.Draw, address(0), 1 ether, 1 ether);

        // 3. Scissors vs Scissors -> Draw
        _testOutcome(PotShot.Move.Scissors, PotShot.Move.Scissors, true, PotShot.Status.Draw, address(0), 1 ether, 1 ether);
        _testOutcome(PotShot.Move.Scissors, PotShot.Move.Scissors, false, PotShot.Status.Draw, address(0), 1 ether, 1 ether);

        // 4. Rock vs Scissors -> Alice wins
        _testOutcome(PotShot.Move.Rock, PotShot.Move.Scissors, true, PotShot.Status.Won, alice, 2 ether, 0);
        _testOutcome(PotShot.Move.Rock, PotShot.Move.Scissors, false, PotShot.Status.Won, alice, 2 ether, 0);

        // 5. Paper vs Rock -> Alice wins
        _testOutcome(PotShot.Move.Paper, PotShot.Move.Rock, true, PotShot.Status.Won, alice, 2 ether, 0);
        _testOutcome(PotShot.Move.Paper, PotShot.Move.Rock, false, PotShot.Status.Won, alice, 2 ether, 0);

        // 6. Scissors vs Paper -> Alice wins
        _testOutcome(PotShot.Move.Scissors, PotShot.Move.Paper, true, PotShot.Status.Won, alice, 2 ether, 0);
        _testOutcome(PotShot.Move.Scissors, PotShot.Move.Paper, false, PotShot.Status.Won, alice, 2 ether, 0);

        // 7. Scissors vs Rock -> Bob wins
        _testOutcome(PotShot.Move.Scissors, PotShot.Move.Rock, true, PotShot.Status.Won, bob, 0, 2 ether);
        _testOutcome(PotShot.Move.Scissors, PotShot.Move.Rock, false, PotShot.Status.Won, bob, 0, 2 ether);

        // 8. Rock vs Paper -> Bob wins
        _testOutcome(PotShot.Move.Rock, PotShot.Move.Paper, true, PotShot.Status.Won, bob, 0, 2 ether);
        _testOutcome(PotShot.Move.Rock, PotShot.Move.Paper, false, PotShot.Status.Won, bob, 0, 2 ether);

        // 9. Paper vs Scissors -> Bob wins
        _testOutcome(PotShot.Move.Paper, PotShot.Move.Scissors, true, PotShot.Status.Won, bob, 0, 2 ether);
        _testOutcome(PotShot.Move.Paper, PotShot.Move.Scissors, false, PotShot.Status.Won, bob, 0, 2 ether);

        // Check records
        PotShot.Record memory recA = potshot.getRecord(alice);
        PotShot.Record memory recB = potshot.getRecord(bob);
        assertEq(recA.wins, 6);
        assertEq(recA.losses, 6);
        assertEq(recA.draws, 6);
        assertEq(recB.wins, 6);
        assertEq(recB.losses, 6);
        assertEq(recB.draws, 6);
    }

    // --- claimTimeout ---

    function test_ClaimTimeout_RevertsBeforeDeadline() public {
        bytes32 cA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        bytes32 cB = potshot.computeCommitment(bob, PotShot.Move.Scissors, saltB);

        vm.prank(alice);
        uint256 id = potshot.createGame{value: 1 ether}(cA);

        vm.prank(bob);
        potshot.joinGame{value: 1 ether}(id, cB);

        PotShot.Game memory g = potshot.getGame(id);

        vm.expectRevert(
            abi.encodeWithSelector(
                PotShot.RevealDeadlineNotPassed.selector,
                g.revealDeadline,
                uint64(block.timestamp)
            )
        );
        potshot.claimTimeout(id);
    }

    function test_ClaimTimeout_OnePlayerRevealed_AliceWins() public {
        bytes32 cA = potshot.computeCommitment(alice, PotShot.Move.Scissors, saltA);
        bytes32 cB = potshot.computeCommitment(bob, PotShot.Move.Rock, saltB);

        vm.prank(alice);
        uint256 id = potshot.createGame{value: 1 ether}(cA);
        vm.prank(bob);
        potshot.joinGame{value: 1 ether}(id, cB);

        // Alice reveals, Bob hides
        vm.prank(alice);
        potshot.reveal(id, PotShot.Move.Scissors, saltA);

        PotShot.Game memory g = potshot.getGame(id);
        vm.warp(g.revealDeadline + 1);

        // Stranger charlie triggers timeout
        vm.prank(charlie);
        potshot.claimTimeout(id);

        g = potshot.getGame(id);
        assertEq(uint8(g.status), uint8(PotShot.Status.TimedOut));
        assertEq(g.winner, alice);
        assertEq(potshot.pendingBalance(alice), 2 ether);
        assertEq(potshot.pendingBalance(bob), 0);

        PotShot.Record memory recA = potshot.getRecord(alice);
        PotShot.Record memory recB = potshot.getRecord(bob);
        assertEq(recA.wins, 1);
        assertEq(recB.losses, 1);
        assertEq(recB.wins, 0);
    }

    function test_ClaimTimeout_OnePlayerRevealed_BobWins() public {
        bytes32 cA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        bytes32 cB = potshot.computeCommitment(bob, PotShot.Move.Paper, saltB);

        vm.prank(alice);
        uint256 id = potshot.createGame{value: 1.5 ether}(cA);
        vm.prank(bob);
        potshot.joinGame{value: 1.5 ether}(id, cB);

        // Bob reveals, Alice hides
        vm.prank(bob);
        potshot.reveal(id, PotShot.Move.Paper, saltB);

        PotShot.Game memory g = potshot.getGame(id);
        vm.warp(g.revealDeadline + 1);

        potshot.claimTimeout(id);

        g = potshot.getGame(id);
        assertEq(uint8(g.status), uint8(PotShot.Status.TimedOut));
        assertEq(g.winner, bob);
        assertEq(potshot.pendingBalance(bob), 3 ether);
        assertEq(potshot.pendingBalance(alice), 0);

        PotShot.Record memory recA = potshot.getRecord(alice);
        PotShot.Record memory recB = potshot.getRecord(bob);
        assertEq(recB.wins, 1);
        assertEq(recA.losses, 1);
    }

    function test_ClaimTimeout_NeitherPlayerRevealed_BothRefunded() public {
        bytes32 cA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        bytes32 cB = potshot.computeCommitment(bob, PotShot.Move.Scissors, saltB);

        vm.prank(alice);
        uint256 id = potshot.createGame{value: 2 ether}(cA);
        vm.prank(bob);
        potshot.joinGame{value: 2 ether}(id, cB);

        PotShot.Game memory g = potshot.getGame(id);
        vm.warp(g.revealDeadline + 1);

        potshot.claimTimeout(id);

        g = potshot.getGame(id);
        assertEq(uint8(g.status), uint8(PotShot.Status.TimedOut));
        assertEq(g.winner, address(0));
        assertEq(potshot.pendingBalance(alice), 2 ether);
        assertEq(potshot.pendingBalance(bob), 2 ether);

        // No record changes
        PotShot.Record memory recA = potshot.getRecord(alice);
        PotShot.Record memory recB = potshot.getRecord(bob);
        assertEq(recA.wins, 0);
        assertEq(recA.losses, 0);
        assertEq(recA.draws, 0);
        assertEq(recB.wins, 0);
        assertEq(recB.losses, 0);
        assertEq(recB.draws, 0);
    }

    // --- Hiding a Losing Move Does Not Help ---

    function test_HidingLosingMove_Fails() public {
        // Alice has Rock, Bob has Scissors. Alice would win.
        bytes32 cA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        bytes32 cB = potshot.computeCommitment(bob, PotShot.Move.Scissors, saltB);

        vm.prank(alice);
        uint256 id = potshot.createGame{value: 1 ether}(cA);
        vm.prank(bob);
        potshot.joinGame{value: 1 ether}(id, cB);

        // Alice reveals Rock
        vm.prank(alice);
        potshot.reveal(id, PotShot.Move.Rock, saltA);

        // Bob sees Alice has Rock. Knowing Scissors loses to Rock, Bob tries to hide his move.
        // After deadline:
        PotShot.Game memory g = potshot.getGame(id);
        vm.warp(g.revealDeadline + 1);

        potshot.claimTimeout(id);
        // Alice wins anyway!
        assertEq(potshot.pendingBalance(alice), 2 ether);
        assertEq(potshot.pendingBalance(bob), 0);
    }

    function test_PlayerWhoWouldHaveWon_RevealsAndWins() public {
        // Alice has Rock, Bob has Paper (Paper beats Rock).
        bytes32 cA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        bytes32 cB = potshot.computeCommitment(bob, PotShot.Move.Paper, saltB);

        vm.prank(alice);
        uint256 id = potshot.createGame{value: 1 ether}(cA);
        vm.prank(bob);
        potshot.joinGame{value: 1 ether}(id, cB);

        // Alice reveals Rock first
        vm.prank(alice);
        potshot.reveal(id, PotShot.Move.Rock, saltA);

        // Bob reveals Paper and wins immediately
        vm.prank(bob);
        potshot.reveal(id, PotShot.Move.Paper, saltB);

        PotShot.Game memory g = potshot.getGame(id);
        assertEq(g.winner, bob);
        assertEq(uint8(g.status), uint8(PotShot.Status.Won));
        assertEq(potshot.pendingBalance(bob), 2 ether);
    }

    // --- No Double Settlement ---

    function test_TerminalStatus_BlocksFurtherActions() public {
        bytes32 cA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        bytes32 cB = potshot.computeCommitment(bob, PotShot.Move.Rock, saltB);

        vm.prank(alice);
        uint256 id = potshot.createGame{value: 1 ether}(cA);
        vm.prank(bob);
        potshot.joinGame{value: 1 ether}(id, cB);

        vm.prank(alice);
        potshot.reveal(id, PotShot.Move.Rock, saltA);
        vm.prank(bob);
        potshot.reveal(id, PotShot.Move.Rock, saltB);

        // Game is settled (Draw)
        // 1. Reveal again reverts
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                PotShot.InvalidStatus.selector,
                PotShot.Status.Committed,
                PotShot.Status.Draw
            )
        );
        potshot.reveal(id, PotShot.Move.Rock, saltA);

        // 2. ClaimTimeout reverts
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(
            abi.encodeWithSelector(
                PotShot.InvalidStatus.selector,
                PotShot.Status.Committed,
                PotShot.Status.Draw
            )
        );
        potshot.claimTimeout(id);

        // 3. CancelGame reverts
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                PotShot.InvalidStatus.selector,
                PotShot.Status.Open,
                PotShot.Status.Draw
            )
        );
        potshot.cancelGame(id);

        // 4. JoinGame reverts
        vm.prank(charlie);
        vm.expectRevert(
            abi.encodeWithSelector(
                PotShot.InvalidStatus.selector,
                PotShot.Status.Open,
                PotShot.Status.Draw
            )
        );
        potshot.joinGame{value: 1 ether}(id, cB);
    }

    // --- withdraw ---

    function test_Withdraw_PaysExactBalanceAndRevertsOnEmpty() public {
        bytes32 cA = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        vm.prank(alice);
        uint256 id = potshot.createGame{value: 5 ether}(cA);

        vm.prank(alice);
        potshot.cancelGame(id);

        assertEq(potshot.pendingBalance(alice), 5 ether);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        potshot.withdraw();

        assertEq(alice.balance, balBefore + 5 ether);
        assertEq(potshot.pendingBalance(alice), 0);

        // Second withdraw reverts
        vm.prank(alice);
        vm.expectRevert(PotShot.NoPendingBalance.selector);
        potshot.withdraw();
    }

    function test_Withdraw_AccumulatesFromMultipleGames() public {
        bytes32 cA1 = potshot.computeCommitment(alice, PotShot.Move.Rock, saltA);
        bytes32 cA2 = potshot.computeCommitment(alice, PotShot.Move.Paper, saltA);

        vm.prank(alice);
        uint256 id1 = potshot.createGame{value: 2 ether}(cA1);
        vm.prank(alice);
        uint256 id2 = potshot.createGame{value: 3 ether}(cA2);

        vm.prank(alice);
        potshot.cancelGame(id1);
        vm.prank(alice);
        potshot.cancelGame(id2);

        assertEq(potshot.pendingBalance(alice), 5 ether);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        potshot.withdraw();

        assertEq(alice.balance, balBefore + 5 ether);
        assertEq(potshot.pendingBalance(alice), 0);
    }

    // --- Reentrancy Protection ---

    function test_Reentrancy_AttackBlocked() public {
        MaliciousReentrantPlayer attacker = new MaliciousReentrantPlayer(potshot);
        vm.deal(address(attacker), 10 ether);

        bytes32 commit = potshot.computeCommitment(address(attacker), PotShot.Move.Rock, saltA);
        uint256 id = attacker.createGame{value: 2 ether}(commit);
        attacker.cancelGame(id);

        assertEq(potshot.pendingBalance(address(attacker)), 2 ether);

        // Reentrant call during withdraw will revert because nonReentrant guard is active
        vm.expectRevert();
        attacker.withdraw();
    }

    // --- Rejecting Player Isolation ---

    function test_RejectingPlayer_OnlyHurtsItself() public {
        RejectingPlayer rejecter = new RejectingPlayer(potshot);
        vm.deal(address(rejecter), 10 ether);

        // Rejecter creates game and cancels it
        bytes32 commitR = potshot.computeCommitment(address(rejecter), PotShot.Move.Rock, saltA);
        uint256 idR = rejecter.createGame{value: 2 ether}(commitR);
        rejecter.cancelGame(idR);

        // Alice creates and cancels another game
        bytes32 commitA = potshot.computeCommitment(alice, PotShot.Move.Paper, saltA);
        vm.prank(alice);
        uint256 idA = potshot.createGame{value: 1 ether}(commitA);
        vm.prank(alice);
        potshot.cancelGame(idA);

        // Rejecter withdraw reverts because its receive() reverts
        vm.expectRevert(PotShot.TransferFailed.selector);
        rejecter.withdraw();

        // Alice can withdraw normally without issue!
        uint256 balBefore = alice.balance;
        vm.prank(alice);
        potshot.withdraw();
        assertEq(alice.balance, balBefore + 1 ether);
    }

    // --- Plain ETH Transfer Rejection ---

    function test_PlainTransfer_Reverts() public {
        vm.prank(alice);
        (bool success, ) = address(potshot).call{value: 1 ether}("");
        assertFalse(success);
    }

    // --- Pagination ---

    function test_Pagination_GetGamesAndGetUserGameIds() public {
        // Create 5 games
        for (uint256 i = 1; i <= 5; i++) {
            address creator = (i % 2 == 1) ? alice : bob;
            bytes32 commit = potshot.computeCommitment(creator, PotShot.Move.Rock, bytes32(i));
            vm.prank(creator);
            potshot.createGame{value: 0.1 ether * i}(commit);
        }

        // Alice created games 1, 3, 5; Bob created games 2, 4
        // getGames (newest first: 5, 4, 3, 2, 1)
        PotShot.Game[] memory gAll = potshot.getGames(0, 10);
        assertEq(gAll.length, 5);
        assertEq(gAll[0].id, 5);
        assertEq(gAll[1].id, 4);
        assertEq(gAll[2].id, 3);
        assertEq(gAll[3].id, 2);
        assertEq(gAll[4].id, 1);

        // Pagination with offset and limit
        PotShot.Game[] memory gPage = potshot.getGames(1, 2);
        assertEq(gPage.length, 2);
        assertEq(gPage[0].id, 4);
        assertEq(gPage[1].id, 3);

        // Offset beyond total returns empty
        PotShot.Game[] memory gEmpty = potshot.getGames(5, 10);
        assertEq(gEmpty.length, 0);

        // Limit = 0 returns empty
        PotShot.Game[] memory gZeroLimit = potshot.getGames(0, 0);
        assertEq(gZeroLimit.length, 0);

        // getUserGameIds for Alice (games 5, 3, 1 newest first)
        uint256[] memory aliceIds = potshot.getUserGameIds(alice, 0, 10);
        assertEq(aliceIds.length, 3);
        assertEq(aliceIds[0], 5);
        assertEq(aliceIds[1], 3);
        assertEq(aliceIds[2], 1);

        uint256[] memory alicePage = potshot.getUserGameIds(alice, 1, 1);
        assertEq(alicePage.length, 1);
        assertEq(alicePage[0], 3);

        uint256[] memory aliceEmpty = potshot.getUserGameIds(alice, 3, 10);
        assertEq(aliceEmpty.length, 0);
    }

    // --- Fuzz Test ---

    function testFuzz_GamePlayConservesBOTAndAwardsCorrectWinner(
        uint96 stakeRaw,
        uint8 rawMoveA,
        uint8 rawMoveB,
        bytes32 fSaltA,
        bytes32 fSaltB,
        bool revealOrder
    ) public {
        uint256 stake = bound(uint256(stakeRaw), 1 wei, 10 ether);
        PotShot.Move moveA = PotShot.Move((rawMoveA % 3) + 1);
        PotShot.Move moveB = PotShot.Move((rawMoveB % 3) + 1);

        vm.assume(fSaltA != bytes32(0));
        vm.assume(fSaltB != bytes32(0));

        vm.deal(alice, stake + 1 ether);
        vm.deal(bob, stake + 1 ether);

        bytes32 cA = potshot.computeCommitment(alice, moveA, fSaltA);
        bytes32 cB = potshot.computeCommitment(bob, moveB, fSaltB);

        uint256 contractBalBefore = address(potshot).balance;

        vm.prank(alice);
        uint256 id = potshot.createGame{value: stake}(cA);

        vm.prank(bob);
        potshot.joinGame{value: stake}(id, cB);

        assertEq(address(potshot).balance, contractBalBefore + 2 * stake);

        if (revealOrder) {
            vm.prank(alice);
            potshot.reveal(id, moveA, fSaltA);
            vm.prank(bob);
            potshot.reveal(id, moveB, fSaltB);
        } else {
            vm.prank(bob);
            potshot.reveal(id, moveB, fSaltB);
            vm.prank(alice);
            potshot.reveal(id, moveA, fSaltA);
        }

        PotShot.Game memory g = potshot.getGame(id);

        if (moveA == moveB) {
            assertEq(uint8(g.status), uint8(PotShot.Status.Draw));
            assertEq(g.winner, address(0));
        } else if (
            (moveA == PotShot.Move.Rock && moveB == PotShot.Move.Scissors) ||
            (moveA == PotShot.Move.Paper && moveB == PotShot.Move.Rock) ||
            (moveA == PotShot.Move.Scissors && moveB == PotShot.Move.Paper)
        ) {
            assertEq(uint8(g.status), uint8(PotShot.Status.Won));
            assertEq(g.winner, alice);
        } else {
            assertEq(uint8(g.status), uint8(PotShot.Status.Won));
            assertEq(g.winner, bob);
        }

        // Both players withdraw everything
        uint256 pA = potshot.pendingBalance(alice);
        uint256 pB = potshot.pendingBalance(bob);
        assertEq(pA + pB, 2 * stake);

        if (pA > 0) {
            vm.prank(alice);
            potshot.withdraw();
        }
        if (pB > 0) {
            vm.prank(bob);
            potshot.withdraw();
        }

        assertEq(address(potshot).balance, contractBalBefore);
    }
}
