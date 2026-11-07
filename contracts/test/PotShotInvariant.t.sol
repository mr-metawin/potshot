// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {PotShot} from "../src/PotShot.sol";

contract PotShotHandler is Test {
    PotShot public potshot;

    address[] public actors;
    mapping(address => bytes32) public userSalts;
    mapping(uint256 => mapping(address => PotShot.Move)) public chosenMoves;

    uint256[] public activeGameIds;
    uint256 public totalGhostCreated;

    constructor(PotShot potshot_) {
        potshot = potshot_;
        actors.push(address(0x101));
        actors.push(address(0x102));
        actors.push(address(0x103));

        for (uint256 i = 0; i < actors.length; i++) {
            vm.deal(actors[i], 1000 ether);
            userSalts[actors[i]] = keccak256(abi.encode(actors[i], "salt"));
        }
    }

    function create(uint8 actorIdx, uint8 rawMove, uint96 rawStake) external {
        address actor = actors[actorIdx % actors.length];
        uint256 stake = bound(uint256(rawStake), 0.01 ether, 5 ether);
        PotShot.Move move = PotShot.Move((rawMove % 3) + 1);

        bytes32 commit = potshot.computeCommitment(actor, move, userSalts[actor]);

        vm.prank(actor);
        uint256 id = potshot.createGame{value: stake}(commit);

        chosenMoves[id][actor] = move;
        activeGameIds.push(id);
        totalGhostCreated++;
    }

    function join(uint8 actorIdx, uint256 gameIdx, uint8 rawMove) external {
        if (activeGameIds.length == 0) return;
        uint256 id = activeGameIds[gameIdx % activeGameIds.length];

        PotShot.Game memory g = potshot.getGame(id);
        if (g.status != PotShot.Status.Open) return;

        address actor = actors[actorIdx % actors.length];
        if (actor == g.playerA) {
            // Pick a different actor
            actor = actors[(actorIdx + 1) % actors.length];
        }

        PotShot.Move move = PotShot.Move((rawMove % 3) + 1);
        bytes32 commit = potshot.computeCommitment(actor, move, userSalts[actor]);

        vm.prank(actor);
        potshot.joinGame{value: g.stake}(id, commit);

        chosenMoves[id][actor] = move;
    }

    function cancel(uint256 gameIdx) external {
        if (activeGameIds.length == 0) return;
        uint256 id = activeGameIds[gameIdx % activeGameIds.length];

        PotShot.Game memory g = potshot.getGame(id);
        if (g.status != PotShot.Status.Open) return;

        vm.prank(g.playerA);
        potshot.cancelGame(id);
    }

    function reveal(uint256 gameIdx, bool revealA) external {
        if (activeGameIds.length == 0) return;
        uint256 id = activeGameIds[gameIdx % activeGameIds.length];

        PotShot.Game memory g = potshot.getGame(id);
        if (g.status != PotShot.Status.Committed) return;
        if (block.timestamp > g.revealDeadline) return;

        address actor = revealA ? g.playerA : g.playerB;
        PotShot.Move currentMove = revealA ? g.moveA : g.moveB;
        if (currentMove != PotShot.Move.None) return;

        PotShot.Move move = chosenMoves[id][actor];
        if (move == PotShot.Move.None) move = PotShot.Move.Rock;

        vm.prank(actor);
        potshot.reveal(id, move, userSalts[actor]);
    }

    function timeout(uint256 gameIdx) external {
        if (activeGameIds.length == 0) return;
        uint256 id = activeGameIds[gameIdx % activeGameIds.length];

        PotShot.Game memory g = potshot.getGame(id);
        if (g.status != PotShot.Status.Committed) return;

        vm.warp(g.revealDeadline + 1);
        potshot.claimTimeout(id);
    }

    function withdraw(uint8 actorIdx) external {
        address actor = actors[actorIdx % actors.length];
        if (potshot.pendingBalance(actor) == 0) return;

        vm.prank(actor);
        potshot.withdraw();
    }

    function getActors() external view returns (address[] memory) {
        return actors;
    }
}

contract PotShotInvariantTest is StdInvariant, Test {
    PotShot public potshot;
    PotShotHandler public handler;

    function setUp() public {
        potshot = new PotShot(1 hours);
        handler = new PotShotHandler(potshot);

        targetContract(address(handler));
    }

    function invariant_BalanceMatchesLockedStakesPlusPendingBalances() public view {
        uint256 expectedLocked = 0;
        uint256 totalGames = potshot.gameCount();

        for (uint256 i = 1; i <= totalGames; i++) {
            PotShot.Game memory g = potshot.getGame(i);
            if (g.status == PotShot.Status.Open) {
                expectedLocked += g.stake;
            } else if (g.status == PotShot.Status.Committed) {
                expectedLocked += 2 * g.stake;
            }
        }

        uint256 totalPending = 0;
        address[] memory actors = handler.getActors();
        for (uint256 i = 0; i < actors.length; i++) {
            totalPending += potshot.pendingBalance(actors[i]);
        }

        assertEq(
            address(potshot).balance,
            expectedLocked + totalPending,
            "Invariant violated: contract balance != locked stakes + pending balance"
        );
    }
}
