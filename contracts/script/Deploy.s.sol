// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PotShot} from "../src/PotShot.sol";

contract DeployScript is Script {
    function run() external returns (PotShot potshot) {
        // Default revealWindow is 1 hour, overrideable via REVEAL_WINDOW env var
        uint64 revealWindow = uint64(vm.envOr("REVEAL_WINDOW", uint256(1 hours)));

        vm.startBroadcast();
        potshot = new PotShot(revealWindow);
        vm.stopBroadcast();

        console.log("PotShot deployed to:", address(potshot));
        console.log("revealWindow:", uint256(revealWindow));
    }
}
