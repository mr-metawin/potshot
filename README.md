# PotShot

> **One throw. One pot.**

PotShot is a trustless, decentralized 1v1 Rock-Paper-Scissors wagering game built on the BOT Mainnet. Players create or join games by staking native BOT tokens, secretly committing to a move using cryptographic commit-reveal, and revealing once both players are locked in. The winner claims the entire pot (2× stake), while draws refund both players. Built with Solidity `^0.8.24` and OpenZeppelin contracts, paired with a retro-arcade React + TypeScript + Vite + viem frontend.

---

## 🎯 Deployed Contract

- **Network:** BOT Mainnet
- **Chain ID:** `677`
- **RPC Endpoint:** `https://rpc.botchain.ai`
- **Native Currency:** BOT (18 decimals)
- **Block Explorer:** [https://scan.botchain.ai](https://scan.botchain.ai)
- **Contract Address:** [`0x5A682a3450a31fad39F25bB3bCEcF2bDBFdf834e`](https://scan.botchain.ai/address/0x5A682a3450a31fad39F25bB3bCEcF2bDBFdf834e)
- **Deployment Transaction:** [`0x67fb8c2d70bb7f6cbb2542824368aba7f8c90d7129679778d39342ddc392a8f4`](https://scan.botchain.ai/tx/0x67fb8c2d70bb7f6cbb2542824368aba7f8c90d7129679778d39342ddc392a8f4)
- **Deployed Reveal Window:** `3600` seconds (1 hour)
- **Contract Verification:** Verified on [BOTScan](https://scan.botchain.ai/address/0x5A682a3450a31fad39F25bB3bCEcF2bDBFdf834e#code)

---

## 🕹️ Project Structure

```text
potshot/
├── contracts/             # Foundry smart contract project
│   ├── src/
│   │   └── PotShot.sol    # Core smart contract
│   ├── test/
│   │   ├── PotShot.t.sol           # 31 unit & fuzz tests
│   │   └── PotShotInvariant.t.sol  # Stateful invariant test
│   ├── script/
│   │   └── Deploy.s.sol   # Foundry deployment script
│   ├── foundry.toml       # Foundry configuration
│   └── remappings.txt     # Library remappings
├── frontend/              # Vite + React + TypeScript + viem
│   ├── src/
│   │   ├── contracts/     # address.json, abi.ts, chain.ts
│   │   ├── secret.ts      # Commit-reveal crypto & localStorage
│   │   ├── types.ts       # TypeScript definitions
│   │   ├── utils.ts       # Formatting & error handling
│   │   ├── App.tsx        # Main application component
│   │   └── App.css        # Retro-arcade neon theme
│   ├── index.html         # HTML root with tagline
│   └── package.json       # Frontend dependencies
└── README.md
```

---

## ⚙️ Setup & Development Instructions

### Prerequisites
- [Foundry](https://getfoundry.sh/) (`forge`, `cast`)
- [Node.js](https://nodejs.org/) (v18+ or v20+) and `npm`

### 1. Compile Contracts
```bash
cd contracts
forge build
```

### 2. Run Tests
The test suite includes unit tests for all game transitions, edge cases, copy-attack prevention, 256-run fuzz tests, and 4,096-call stateful invariant tests:
```bash
cd contracts
forge test -vvv
```

### 3. Deploy Contracts
Deploy using an existing `cast` wallet keystore:
```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.bohr.life \
  --account potshot \
  --password-file <path_to_password_file> \
  --broadcast
```
*Note: To customize the reveal deadline for demos, set the `REVEAL_WINDOW` environment variable in seconds (e.g. `REVEAL_WINDOW=180` for 3 minutes).*

### 4. Run Frontend
```bash
cd frontend
npm run dev
```
The application will launch locally at `http://localhost:5173/`.

---

## 🎲 Game States & Lifecycle

```
[Create Game] ──> Status: Open ──[Player A Cancels]──> Status: Cancelled
                      │
              [Player B Joins]
                      │
                      ▼
               Status: Committed (Reveal Window Active)
                      │
        ┌─────────────┴─────────────┐
        │ Both Reveal               │ Deadline Passes
        ▼                           ▼
[Draw: Stakes Refunded]     [claimTimeout]
        │                           │
[Decisive: Winner Takes Pot] ├─ 1 Revealed: Revealer Wins Entire Pot (Forfeit)
        │                    └─ 0 Revealed: Both Refunded
        ▼                                   │
Status: Won / Draw                  Status: TimedOut
```

1. **`Open`**: Created by Player A with a native BOT stake and a secret commitment hash. Can be cancelled by Player A at any time before an opponent joins to receive a full refund.
2. **`Committed`**: Player B has matched the stake and locked in their secret commitment. The countdown timer (`revealDeadline = block.timestamp + revealWindow`) begins immediately.
3. **`Won`**: Both players revealed distinct non-tying moves. The winning player receives the full pot (`2 * stake`) credited to their `pendingBalance`.
4. **`Draw`**: Both players revealed the same move (Rock vs Rock, Paper vs Paper, or Scissors vs Scissors). Both players are refunded their initial stakes.
5. **`Cancelled`**: Player A cancelled the game before anyone joined.
6. **`TimedOut`**: The reveal window expired without both players revealing:
   - **One player revealed, one hidden:** The player who revealed is awarded the entire pot (`2 * stake`) by forfeit.
   - **Neither player revealed:** Both players are refunded their exact stakes.

---

## 🔐 Trust and Security Notes

1. **Commit-Reveal Privacy**: Moves remain completely secret until revealed because commitments are computed as:
   $$\text{commitment} = \text{keccak256}(\text{abi.encode}(\text{player}, \text{move}, \text{salt}))$$
   Binding the player address directly prevents copy-attacks where an adversary attempts to mirror your commitment hash.
2. **Secret Responsibility**: Your random 32-byte salt is stored locally in your browser's `localStorage`. If you clear your browser history, cache, or switch devices before revealing your move, you will not be able to generate the matching proof and will forfeit the game. A "Back Up My Secret" export feature and a manual reveal fallback are provided for safety.
3. **Forfeit on Non-Reveal**: If a player inspects their opponent's revealed move and notices they would have lost, refusing to reveal does not save their stake. Once the deadline passes, anyone can call `claimTimeout`, and the player who revealed takes the full pot.
4. **Pull-Payment Pattern (`pendingBalance`)**: All winnings, refunds, and cancellations are credited to `pendingBalance`. Funds only exit the contract when a user explicitly calls `withdraw()`. This isolates users from external call failures and ensures a contract or player rejecting BOT cannot block anyone else.
5. **No Admin Privileges**: The contract has no owner, no fee takers, no pausing, no upgrade proxies, and no external oracle dependencies. 100% of the pot is distributed to the winner or refunded.
6. **Testnet Demonstration**: PotShot is deployed on the BOT Testnet for demonstration and peer-to-peer gameplay. It has not been formally audited by a third-party security firm; play responsibly.
