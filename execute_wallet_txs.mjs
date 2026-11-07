import { createWalletClient, createPublicClient, http, parseEther, defineChain, encodeAbiParameters, keccak256, decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';

// Contract configuration
const addressData = JSON.parse(fs.readFileSync('./frontend/src/contracts/address.json', 'utf8'));
const potshotAddress = addressData.address;
const potshotAbi = JSON.parse(fs.readFileSync('./frontend/src/contracts/PotShot.json', 'utf8'));

const botTestnet = defineChain({
  id: 968,
  name: 'BOT Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'BOT',
    symbol: 'BOT',
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.bohr.life'],
    },
  },
  blockExplorers: {
    default: {
      name: 'BohrScan',
      url: 'https://scan.bohr.life',
    },
  },
});

// Parse .env
const envContent = fs.readFileSync('.env', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const [k, ...v] = trimmed.split('=');
    env[k.trim()] = v.join('=').trim();
  }
}

const pk1 = env.WALLET_ADDRESS_1_PK || env.WALLET_1_PK || env.WALLET_1_PRIVATE_KEY;
const pk2 = env.WALLET_ADDRESS_2_PK || env.WALLET_2_PK || env.WALLET_2_PRIVATE_KEY;
const pk3 = env.WALLET_ADDRESS_3_PK || env.WALLET_3_PK || env.WALLET_3_PRIVATE_KEY;

const w1Account = privateKeyToAccount(pk1);
const w2Account = privateKeyToAccount(pk2);
const w3Account = privateKeyToAccount(pk3);

const publicClient = createPublicClient({
  chain: botTestnet,
  transport: http('https://rpc.bohr.life'),
});

function getWalletClient(account) {
  return createWalletClient({
    account,
    chain: botTestnet,
    transport: http('https://rpc.bohr.life'),
  });
}

const w1Client = getWalletClient(w1Account);
const w2Client = getWalletClient(w2Account);
const w3Client = getWalletClient(w3Account);

console.log('=== Executing 24 Transactions on BOT Testnet for PotShot ===');
console.log(`PotShot Address: ${potshotAddress}`);
console.log(`Wallet 1: ${w1Account.address}`);
console.log(`Wallet 2: ${w2Account.address}`);
console.log(`Wallet 3: ${w3Account.address}\n`);

// Enum Moves: None=0, Rock=1, Paper=2, Scissors=3
const Move = { None: 0, Rock: 1, Paper: 2, Scissors: 3 };

function computeCommitment(player, move, salt) {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint8' }, { type: 'bytes32' }],
      [player, move, salt]
    )
  );
}

const summary = {
  contract: potshotAddress,
  chainId: 968,
  network: 'BOT Testnet',
  wallets: {
    wallet1: { address: w1Account.address, txs: [] },
    wallet2: { address: w2Account.address, txs: [] },
    wallet3: { address: w3Account.address, txs: [] },
  },
  allTransactions: [],
};

async function runTx(walletNum, client, account, description, writeCall) {
  console.log(`[W${walletNum}] Action: ${description}...`);
  let attempts = 0;
  while (attempts < 6) {
    try {
      const hash = await writeCall();
      console.log(`  Tx sent: ${hash}. Waiting for receipt...`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        throw new Error(`Tx reverted onchain: ${hash}`);
      }
      console.log(`  Confirmed in block ${receipt.blockNumber} (gasUsed: ${receipt.gasUsed})`);

      const txRecord = {
        wallet: `Wallet ${walletNum}`,
        address: account.address,
        action: description,
        hash,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: Number(receipt.gasUsed),
        explorerUrl: `https://scan.bohr.life/tx/${hash}`,
      };

      summary.wallets[`wallet${walletNum}`].txs.push(txRecord);
      summary.allTransactions.push(txRecord);
      return receipt;
    } catch (err) {
      attempts++;
      console.error(`  Attempt ${attempts} failed: ${err.message}`);
      if (attempts >= 6) throw err;
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

function parseGameCreatedId(receipt) {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: potshotAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'GameCreated') {
        return decoded.args.id;
      }
    } catch {}
  }
  return null;
}

async function main() {
  const salt1 = '0x1111111111111111111111111111111111111111111111111111111111111101';
  const salt2 = '0x2222222222222222222222222222222222222222222222222222222222222202';
  const salt3 = '0x3333333333333333333333333333333333333333333333333333333333333303';
  const salt4 = '0x4444444444444444444444444444444444444444444444444444444444444404';
  const salt5 = '0x5555555555555555555555555555555555555555555555555555555555555505';
  const salt6 = '0x6666666666666666666666666666666666666666666666666666666666666606';

  // ----------------------------------------------------
  // MATCH 1: W1 creates, W2 joins. W1 Rock, W2 Scissors (W1 wins)
  // ----------------------------------------------------
  console.log('\n--- MATCH 1: W1 (Rock) vs W2 (Scissors) ---');
  const commitW1_M1 = computeCommitment(w1Account.address, Move.Rock, salt1);
  const rCreateM1 = await runTx(1, w1Client, w1Account, '1. createGame: Match 1 with Rock (0.003 BOT stake)', async () => {
    return w1Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'createGame',
      args: [commitW1_M1],
      value: parseEther('0.003'),
    });
  });
  const game1Id = parseGameCreatedId(rCreateM1);
  console.log(`  Game 1 ID created: ${game1Id}`);

  const commitW2_M1 = computeCommitment(w2Account.address, Move.Scissors, salt2);
  await runTx(2, w2Client, w2Account, `1. joinGame: Match 1 with Scissors (${game1Id})`, async () => {
    return w2Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'joinGame',
      args: [game1Id, commitW2_M1],
      value: parseEther('0.003'),
    });
  });

  await runTx(1, w1Client, w1Account, `2. reveal: Game #${game1Id} Rock`, async () => {
    return w1Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'reveal',
      args: [game1Id, Move.Rock, salt1],
    });
  });

  await runTx(2, w2Client, w2Account, `2. reveal: Game #${game1Id} Scissors (W1 wins showdown)`, async () => {
    return w2Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'reveal',
      args: [game1Id, Move.Scissors, salt2],
    });
  });

  // ----------------------------------------------------
  // MATCH 2: W2 creates, W3 joins. W2 Paper, W3 Rock (W2 wins)
  // ----------------------------------------------------
  console.log('\n--- MATCH 2: W2 (Paper) vs W3 (Rock) ---');
  const commitW2_M2 = computeCommitment(w2Account.address, Move.Paper, salt3);
  const rCreateM2 = await runTx(2, w2Client, w2Account, '3. createGame: Match 2 with Paper (0.003 BOT stake)', async () => {
    return w2Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'createGame',
      args: [commitW2_M2],
      value: parseEther('0.003'),
    });
  });
  const game2Id = parseGameCreatedId(rCreateM2);
  console.log(`  Game 2 ID created: ${game2Id}`);

  const commitW3_M2 = computeCommitment(w3Account.address, Move.Rock, salt4);
  await runTx(3, w3Client, w3Account, `1. joinGame: Match 2 with Rock (${game2Id})`, async () => {
    return w3Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'joinGame',
      args: [game2Id, commitW3_M2],
      value: parseEther('0.003'),
    });
  });

  await runTx(2, w2Client, w2Account, `4. reveal: Game #${game2Id} Paper`, async () => {
    return w2Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'reveal',
      args: [game2Id, Move.Paper, salt3],
    });
  });

  await runTx(3, w3Client, w3Account, `2. reveal: Game #${game2Id} Rock (W2 wins showdown)`, async () => {
    return w3Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'reveal',
      args: [game2Id, Move.Rock, salt4],
    });
  });

  // ----------------------------------------------------
  // MATCH 3: W3 creates, W1 joins. W3 Scissors, W1 Paper (W3 wins)
  // ----------------------------------------------------
  console.log('\n--- MATCH 3: W3 (Scissors) vs W1 (Paper) ---');
  const commitW3_M3 = computeCommitment(w3Account.address, Move.Scissors, salt5);
  const rCreateM3 = await runTx(3, w3Client, w3Account, '3. createGame: Match 3 with Scissors (0.003 BOT stake)', async () => {
    return w3Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'createGame',
      args: [commitW3_M3],
      value: parseEther('0.003'),
    });
  });
  const game3Id = parseGameCreatedId(rCreateM3);
  console.log(`  Game 3 ID created: ${game3Id}`);

  const commitW1_M3 = computeCommitment(w1Account.address, Move.Paper, salt6);
  await runTx(1, w1Client, w1Account, `3. joinGame: Match 3 with Paper (${game3Id})`, async () => {
    return w1Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'joinGame',
      args: [game3Id, commitW1_M3],
      value: parseEther('0.003'),
    });
  });

  await runTx(3, w3Client, w3Account, `4. reveal: Game #${game3Id} Scissors`, async () => {
    return w3Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'reveal',
      args: [game3Id, Move.Scissors, salt5],
    });
  });

  await runTx(1, w1Client, w1Account, `4. reveal: Game #${game3Id} Paper (W3 wins showdown)`, async () => {
    return w1Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'reveal',
      args: [game3Id, Move.Paper, salt6],
    });
  });

  // ----------------------------------------------------
  // CANCELLATIONS & REFUND TESTS (W1, W2, W3)
  // ----------------------------------------------------
  console.log('\n--- CANCELLATION & REFUNDS ---');
  // W1 creates & cancels Game 4
  const rCreate4 = await runTx(1, w1Client, w1Account, '5. createGame: Game 4 to test cancellation (0.002 BOT)', async () => {
    return w1Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'createGame',
      args: [commitW1_M1],
      value: parseEther('0.002'),
    });
  });
  const game4Id = parseGameCreatedId(rCreate4);

  await runTx(1, w1Client, w1Account, `6. cancelGame: Cancel Game #${game4Id} and refund stake`, async () => {
    return w1Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'cancelGame',
      args: [game4Id],
    });
  });

  // W2 creates & cancels Game 5
  const rCreate5 = await runTx(2, w2Client, w2Account, '5. createGame: Game 5 to test cancellation (0.002 BOT)', async () => {
    return w2Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'createGame',
      args: [commitW2_M2],
      value: parseEther('0.002'),
    });
  });
  const game5Id = parseGameCreatedId(rCreate5);

  await runTx(2, w2Client, w2Account, `6. cancelGame: Cancel Game #${game5Id} and refund stake`, async () => {
    return w2Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'cancelGame',
      args: [game5Id],
    });
  });

  // W3 creates & cancels Game 6
  const rCreate6 = await runTx(3, w3Client, w3Account, '5. createGame: Game 6 to test cancellation (0.002 BOT)', async () => {
    return w3Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'createGame',
      args: [commitW3_M3],
      value: parseEther('0.002'),
    });
  });
  const game6Id = parseGameCreatedId(rCreate6);

  await runTx(3, w3Client, w3Account, `6. cancelGame: Cancel Game #${game6Id} and refund stake`, async () => {
    return w3Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'cancelGame',
      args: [game6Id],
    });
  });

  // ----------------------------------------------------
  // WITHDRAWALS (W1, W2, W3)
  // ----------------------------------------------------
  console.log('\n--- WITHDRAWALS ---');
  await runTx(1, w1Client, w1Account, '7. withdraw: Withdraw accumulated winnings & refund', async () => {
    return w1Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'withdraw',
    });
  });

  await runTx(2, w2Client, w2Account, '7. withdraw: Withdraw accumulated winnings & refund', async () => {
    return w2Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'withdraw',
    });
  });

  await runTx(3, w3Client, w3Account, '7. withdraw: Withdraw accumulated winnings & refund', async () => {
    return w3Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'withdraw',
    });
  });

  // ----------------------------------------------------
  // 8th TRANSACTION FOR EACH WALLET (Lobby games & challenge)
  // ----------------------------------------------------
  console.log('\n--- FINAL 8TH TRANSACTION PER WALLET ---');
  // W1 creates Game 7 (Tx 8 for W1)
  const rCreate7 = await runTx(1, w1Client, w1Account, '8. createGame: Open lobby game #7 for challengers (0.002 BOT)', async () => {
    return w1Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'createGame',
      args: [commitW1_M1],
      value: parseEther('0.002'),
    });
  });
  const game7Id = parseGameCreatedId(rCreate7);

  // W2 joins Game 7 (Tx 8 for W2)
  await runTx(2, w2Client, w2Account, `8. joinGame: Accept W1 challenge on Game #${game7Id} (0.002 BOT)`, async () => {
    return w2Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'joinGame',
      args: [game7Id, commitW2_M1],
      value: parseEther('0.002'),
    });
  });

  // W3 creates Game 8 for public lobby (Tx 8 for W3)
  await runTx(3, w3Client, w3Account, '8. createGame: Open lobby game #8 with Scissors (0.002 BOT)', async () => {
    return w3Client.writeContract({
      address: potshotAddress,
      abi: potshotAbi,
      functionName: 'createGame',
      args: [commitW3_M3],
      value: parseEther('0.002'),
    });
  });

  console.log('\n======================================================');
  console.log('ALL 24 TRANSACTIONS EXECUTED SUCCESSFULLY!');
  console.log(`Wallet 1 txs: ${summary.wallets.wallet1.txs.length}`);
  console.log(`Wallet 2 txs: ${summary.wallets.wallet2.txs.length}`);
  console.log(`Wallet 3 txs: ${summary.wallets.wallet3.txs.length}`);
  console.log(`Total txs: ${summary.allTransactions.length}`);
  console.log('======================================================\n');

  // Write summaries
  fs.writeFileSync('transactions_summary.json', JSON.stringify(summary, null, 2));
  fs.writeFileSync('./frontend/transactions_summary.json', JSON.stringify(summary, null, 2));
  console.log('Saved to transactions_summary.json and frontend/transactions_summary.json');
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
