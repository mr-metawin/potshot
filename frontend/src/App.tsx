import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEther,
  decodeEventLog,
} from 'viem';
import {
  contractAddress,
  potShotAbi,
  botMainnet,
  botTestnet,
} from './contracts';
import { Move, Status, Game, UserRecord, TxStatus, SavedSecret } from './types';
import {
  shortenAddress,
  formatRelativeTime,
  formatBOT,
  formatCountdown,
  getMoveEmoji,
  getMoveName,
  getStatusLabel,
  parseContractError,
} from './utils';
import {
  generateSalt,
  computeCommitment,
  saveSecretByCommitment,
  saveSecretByGameId,
  promoteCommitmentToGameId,
  getSecretForGame,
} from './secret';
import botLogo from './assets/botchainlogo_transparent.png';
import './App.css';

const publicClient = createPublicClient({
  chain: botMainnet,
  transport: http('https://rpc.botchain.ai'),
});

export const App: React.FC = () => {
  // Wallet State
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [userBalance, setUserBalance] = useState<bigint>(0n);

  // Contract Read State
  const [contractRevealWindow, setContractRevealWindow] = useState<bigint>(3600n);
  const [pendingBalance, setPendingBalance] = useState<bigint>(0n);
  const [userRecord, setUserRecord] = useState<UserRecord>({ wins: 0, losses: 0, draws: 0 });
  const [openGames, setOpenGames] = useState<Game[]>([]);
  const [userGames, setUserGames] = useState<Game[]>([]);
  const [activeGameId, setActiveGameId] = useState<bigint | null>(null);
  const [activeGame, setActiveGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [nowSec, setNowSec] = useState<number>(Math.floor(Date.now() / 1000));

  // Form States
  const [createMove, setCreateMove] = useState<Move>(Move.Rock);
  const [createStake, setCreateStake] = useState<string>('0.1');
  const [joinMoves, setJoinMoves] = useState<Record<string, Move>>({});
  const [lookupIdInput, setLookupIdInput] = useState<string>('');

  // Manual Secret Fallback State
  const [manualMove, setManualMove] = useState<Move>(Move.Rock);
  const [manualSalt, setManualSalt] = useState<string>('');
  const [showManualSecret, setShowManualSecret] = useState<boolean>(false);
  const [copiedBackup, setCopiedBackup] = useState<boolean>(false);

  // How it works toggle
  const [showHowItWorks, setShowHowItWorks] = useState<boolean>(false);

  // Transaction Status
  const [txStatus, setTxStatus] = useState<TxStatus>({ state: 'idle' });

  const isCorrectChain = chainId === botMainnet.id;
  const explorerBaseUrl = 'https://scan.botchain.ai';

  // --- Hash Routing Sync ---
  const syncRouteFromHash = useCallback(() => {
    const hash = window.location.hash;
    const match = hash.match(/#\/game\/(\d+)/);
    if (match && match[1]) {
      setActiveGameId(BigInt(match[1]));
    } else {
      setActiveGameId(null);
    }
  }, []);

  useEffect(() => {
    syncRouteFromHash();
    window.addEventListener('hashchange', syncRouteFromHash);
    return () => window.removeEventListener('hashchange', syncRouteFromHash);
  }, [syncRouteFromHash]);

  const navigateToGame = (id: bigint) => {
    window.location.hash = `#/game/${id.toString()}`;
  };

  const navigateToLobby = () => {
    window.location.hash = '#/';
  };

  // --- Clock timer for live countdowns ---
  useEffect(() => {
    const timer = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // --- Wallet Helpers ---
  const checkConnectedWallet = async () => {
    if (typeof window === 'undefined' || !window.ethereum) return;
    try {
      const accounts = (await window.ethereum.request({ method: 'eth_accounts' })) as string[];
      if (accounts && accounts.length > 0) {
        setAccount(accounts[0] as `0x${string}`);
      }
      const rawChainId = (await window.ethereum.request({ method: 'eth_chainId' })) as string;
      setChainId(parseInt(rawChainId, 16));
    } catch (err) {
      console.error('Wallet check failed:', err);
    }
  };

  const connectWallet = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      alert('Please install MetaMask or another Web3 wallet to play PotShot.');
      return;
    }
    try {
      const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
      if (accounts && accounts.length > 0) {
        setAccount(accounts[0] as `0x${string}`);
      }
      const rawChainId = (await window.ethereum.request({ method: 'eth_chainId' })) as string;
      setChainId(parseInt(rawChainId, 16));
    } catch (err: any) {
      console.error('Wallet connect error:', err);
      setTxStatus({ state: 'error', message: parseContractError(err) });
    }
  };

  const switchToBotMainnet = async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x2a5' }], // 677 in hex
      });
      setChainId(677);
    } catch (switchError: any) {
      if (switchError.code === 4902 || switchError?.data?.originalError?.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: '0x2a5',
                chainName: 'BOT Mainnet',
                nativeCurrency: {
                  name: 'BOT',
                  symbol: 'BOT',
                  decimals: 18,
                },
                rpcUrls: ['https://rpc.botchain.ai'],
                blockExplorerUrls: ['https://scan.botchain.ai'],
              },
            ],
          });
          setChainId(677);
        } catch (addError) {
          console.error('Failed to add BOT Mainnet:', addError);
        }
      } else {
        console.error('Failed to switch network:', switchError);
      }
    }
  };

  // Wallet event listeners
  useEffect(() => {
    checkConnectedWallet();

    if (window.ethereum) {
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length > 0) {
          setAccount(accounts[0] as `0x${string}`);
        } else {
          setAccount(null);
        }
      };

      const handleChainChanged = (newChainId: string) => {
        setChainId(parseInt(newChainId, 16));
      };

      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);

      return () => {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      };
    }
  }, []);

  // --- Fetch Onchain Data ---
  const fetchData = useCallback(async () => {
    try {
      // 1. Reveal window constant from contract
      const rw = (await publicClient.readContract({
        address: contractAddress,
        abi: potShotAbi,
        functionName: 'revealWindow',
      })) as bigint;
      setContractRevealWindow(rw);

      // 2. Wallet balance & pending withdrawal balance
      if (account) {
        const bal = await publicClient.getBalance({ address: account });
        setUserBalance(bal);

        const pb = (await publicClient.readContract({
          address: contractAddress,
          abi: potShotAbi,
          functionName: 'pendingBalance',
          args: [account],
        })) as bigint;
        setPendingBalance(pb);

        const rec = (await publicClient.readContract({
          address: contractAddress,
          abi: potShotAbi,
          functionName: 'getRecord',
          args: [account],
        })) as { wins: number; losses: number; draws: number };
        setUserRecord({
          wins: Number(rec.wins),
          losses: Number(rec.losses),
          draws: Number(rec.draws),
        });
      }

      // 3. Lobby Open Games
      const gamesList = (await publicClient.readContract({
        address: contractAddress,
        abi: potShotAbi,
        functionName: 'getGames',
        args: [0n, 40n],
      })) as any[];

      const parsedGames: Game[] = gamesList.map((g: any) => ({
        id: BigInt(g.id),
        playerA: g.playerA as `0x${string}`,
        playerB: g.playerB as `0x${string}`,
        stake: BigInt(g.stake),
        commitA: g.commitA as `0x${string}`,
        commitB: g.commitB as `0x${string}`,
        moveA: Number(g.moveA) as Move,
        moveB: Number(g.moveB) as Move,
        createdAt: BigInt(g.createdAt),
        joinedAt: BigInt(g.joinedAt),
        revealDeadline: BigInt(g.revealDeadline),
        winner: g.winner as `0x${string}`,
        status: Number(g.status) as Status,
      }));

      // Open games for lobby
      setOpenGames(parsedGames.filter((g) => g.status === Status.Open));

      // 4. User's participated games
      if (account) {
        const userGameIds = (await publicClient.readContract({
          address: contractAddress,
          abi: potShotAbi,
          functionName: 'getUserGameIds',
          args: [account, 0n, 30n],
        })) as bigint[];

        const myGames: Game[] = [];
        for (const gid of userGameIds) {
          const matched = parsedGames.find((g) => g.id === gid);
          if (matched) {
            myGames.push(matched);
          } else {
            try {
              const single = (await publicClient.readContract({
                address: contractAddress,
                abi: potShotAbi,
                functionName: 'getGame',
                args: [gid],
              })) as any;
              myGames.push({
                id: BigInt(single.id),
                playerA: single.playerA as `0x${string}`,
                playerB: single.playerB as `0x${string}`,
                stake: BigInt(single.stake),
                commitA: single.commitA as `0x${string}`,
                commitB: single.commitB as `0x${string}`,
                moveA: Number(single.moveA) as Move,
                moveB: Number(single.moveB) as Move,
                createdAt: BigInt(single.createdAt),
                joinedAt: BigInt(single.joinedAt),
                revealDeadline: BigInt(single.revealDeadline),
                winner: single.winner as `0x${string}`,
                status: Number(single.status) as Status,
              });
            } catch (e) {
              console.warn('Could not fetch single game', gid);
            }
          }
        }
        setUserGames(myGames);
      }

      // 5. Active game detail if hash routing matches
      if (activeGameId !== null) {
        const found = parsedGames.find((g) => g.id === activeGameId);
        if (found) {
          setActiveGame(found);
        } else {
          try {
            const single = (await publicClient.readContract({
              address: contractAddress,
              abi: potShotAbi,
              functionName: 'getGame',
              args: [activeGameId],
            })) as any;
            setActiveGame({
              id: BigInt(single.id),
              playerA: single.playerA as `0x${string}`,
              playerB: single.playerB as `0x${string}`,
              stake: BigInt(single.stake),
              commitA: single.commitA as `0x${string}`,
              commitB: single.commitB as `0x${string}`,
              moveA: Number(single.moveA) as Move,
              moveB: Number(single.moveB) as Move,
              createdAt: BigInt(single.createdAt),
              joinedAt: BigInt(single.joinedAt),
              revealDeadline: BigInt(single.revealDeadline),
              winner: single.winner as `0x${string}`,
              status: Number(single.status) as Status,
            });
          } catch (err) {
            console.error('Active game not found:', err);
            setActiveGame(null);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching onchain state:', err);
    } finally {
      setLoading(false);
    }
  }, [account, activeGameId]);

  // Initial & periodic polling
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // --- Wallet Client Helper ---
  const getWalletClient = async () => {
    if (!window.ethereum) throw new Error('No web3 provider found');
    const [active] = (await window.ethereum.request({ method: 'eth_accounts' })) as string[];
    if (!active) throw new Error('Please connect your wallet first');
    return createWalletClient({
      account: active as `0x${string}`,
      chain: botMainnet,
      transport: custom(window.ethereum),
    });
  };

  // --- Action: Create Game ---
  const handleCreateGame = async () => {
    if (!account) return connectWallet();
    if (!isCorrectChain) return switchToBotMainnet();

    try {
      const parsedStake = parseEther(createStake);
      if (parsedStake <= 0n) {
        alert('Stake must be greater than 0 BOT');
        return;
      }

      setTxStatus({
        state: 'pending',
        message: 'Generating secret commitment and creating game...',
      });

      // 1. Generate salt & compute commitment
      const salt = generateSalt();
      const commitment = computeCommitment(account, createMove, salt);

      // 2. Save secret immediately under commitment
      const secretRecord: SavedSecret = {
        move: createMove,
        salt,
        commitment,
        createdAt: Date.now(),
      };
      saveSecretByCommitment(botTestnet.id, contractAddress, account, secretRecord);

      // 3. Call createGame
      const walletClient = await getWalletClient();
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: potShotAbi,
        functionName: 'createGame',
        args: [commitment],
        value: parsedStake,
      });

      setTxStatus({
        state: 'pending',
        hash,
        message: 'Transaction broadcast! Waiting for confirmation...',
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // 4. Parse GameCreated event for assigned ID
      let createdGameId: bigint | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: potShotAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'GameCreated') {
            createdGameId = (decoded.args as any).id;
            break;
          }
        } catch {
          // not this event
        }
      }

      if (createdGameId !== null) {
        promoteCommitmentToGameId(botTestnet.id, contractAddress, account, commitment, createdGameId);
        navigateToGame(createdGameId);
      }

      setTxStatus({
        state: 'success',
        hash,
        message: `Game #${createdGameId ?? ''} created successfully!`,
        description: 'Your secret move has been safely secured in your browser.',
      });

      fetchData();
    } catch (err: any) {
      console.error('Create game error:', err);
      setTxStatus({
        state: 'error',
        message: parseContractError(err),
      });
    }
  };

  // --- Action: Join Game ---
  const handleJoinGame = async (game: Game) => {
    if (!account) return connectWallet();
    if (!isCorrectChain) return switchToBotMainnet();

    try {
      const chosenMove = joinMoves[game.id.toString()] || Move.Rock;

      setTxStatus({
        state: 'pending',
        message: `Locking in move for Game #${game.id}...`,
      });

      // 1. Generate salt & compute commitment
      const salt = generateSalt();
      const commitment = computeCommitment(account, chosenMove, salt);

      // 2. Save secret under game ID and commitment
      const secretRecord: SavedSecret = {
        move: chosenMove,
        salt,
        commitment,
        createdAt: Date.now(),
        gameId: game.id.toString(),
      };
      saveSecretByGameId(botTestnet.id, contractAddress, account, game.id, secretRecord);

      // 3. Call joinGame
      const walletClient = await getWalletClient();
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: potShotAbi,
        functionName: 'joinGame',
        args: [game.id, commitment],
        value: game.stake,
      });

      setTxStatus({
        state: 'pending',
        hash,
        message: 'Join transaction broadcast! Confirming onchain...',
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setTxStatus({
        state: 'success',
        hash,
        message: `Joined Game #${game.id}! Reveal phase is now open.`,
        description: 'Both players are locked in. Reveal your move before the deadline!',
      });

      navigateToGame(game.id);
      fetchData();
    } catch (err: any) {
      console.error('Join game error:', err);
      setTxStatus({
        state: 'error',
        message: parseContractError(err),
      });
    }
  };

  // --- Action: Cancel Game ---
  const handleCancelGame = async (gameId: bigint) => {
    if (!account) return;
    try {
      setTxStatus({ state: 'pending', message: 'Cancelling game and refunding stake...' });
      const walletClient = await getWalletClient();
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: potShotAbi,
        functionName: 'cancelGame',
        args: [gameId],
      });

      setTxStatus({ state: 'pending', hash, message: 'Confirming cancellation...' });
      await publicClient.waitForTransactionReceipt({ hash });

      setTxStatus({
        state: 'success',
        hash,
        message: `Game #${gameId} cancelled! Stake credited to your pending balance.`,
      });
      fetchData();
    } catch (err: any) {
      console.error('Cancel error:', err);
      setTxStatus({ state: 'error', message: parseContractError(err) });
    }
  };

  // --- Action: Reveal Move ---
  const handleRevealMove = async (game: Game, overrideMove?: Move, overrideSalt?: string) => {
    if (!account) return;

    try {
      let move = overrideMove;
      let salt = overrideSalt as `0x${string}` | undefined;

      // Look up saved secret if override not supplied
      if (!move || !salt) {
        const saved = getSecretForGame(
          botTestnet.id,
          contractAddress,
          account,
          game.id,
          account === game.playerA ? game.commitA : game.commitB
        );
        if (!saved) {
          setShowManualSecret(true);
          alert('Saved secret not found automatically. Please enter your secret manually below.');
          return;
        }
        move = saved.move;
        salt = saved.salt;
      }

      if (!move || !salt) {
        return;
      }

      setTxStatus({
        state: 'pending',
        message: `Revealing your ${getMoveName(move)}...`,
      });

      const walletClient = await getWalletClient();
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: potShotAbi,
        functionName: 'reveal',
        args: [game.id, move, salt],
      });

      setTxStatus({
        state: 'pending',
        hash,
        message: 'Reveal transaction submitted! Settle showdown...',
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setTxStatus({
        state: 'success',
        hash,
        message: 'Move revealed onchain!',
      });
      fetchData();
    } catch (err: any) {
      console.error('Reveal error:', err);
      setTxStatus({
        state: 'error',
        message: parseContractError(err),
      });
    }
  };

  // --- Action: Claim Timeout ---
  const handleClaimTimeout = async (gameId: bigint) => {
    if (!account) return connectWallet();

    try {
      setTxStatus({
        state: 'pending',
        message: 'Claiming timeout settlement...',
      });

      const walletClient = await getWalletClient();
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: potShotAbi,
        functionName: 'claimTimeout',
        args: [gameId],
      });

      setTxStatus({
        state: 'pending',
        hash,
        message: 'Confirming timeout claim...',
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setTxStatus({
        state: 'success',
        hash,
        message: `Timeout processed for Game #${gameId}!`,
      });
      fetchData();
    } catch (err: any) {
      console.error('Claim timeout error:', err);
      setTxStatus({
        state: 'error',
        message: parseContractError(err),
      });
    }
  };

  // --- Action: Withdraw Pending Balance ---
  const handleWithdraw = async () => {
    if (!account || pendingBalance <= 0n) return;

    try {
      setTxStatus({
        state: 'pending',
        message: `Withdrawing ${formatBOT(pendingBalance)} BOT to your wallet...`,
      });

      const walletClient = await getWalletClient();
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: potShotAbi,
        functionName: 'withdraw',
      });

      setTxStatus({
        state: 'pending',
        hash,
        message: 'Withdrawing funds... Confirming transaction...',
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setTxStatus({
        state: 'success',
        hash,
        message: 'Withdrawal complete! Funds are in your wallet.',
      });
      fetchData();
    } catch (err: any) {
      console.error('Withdraw error:', err);
      setTxStatus({
        state: 'error',
        message: parseContractError(err),
      });
    }
  };

  // --- Secret Backup to Clipboard ---
  const handleBackupSecret = (game: Game) => {
    if (!account) return;
    const saved = getSecretForGame(
      botTestnet.id,
      contractAddress,
      account,
      game.id,
      account === game.playerA ? game.commitA : game.commitB
    );
    if (!saved) {
      alert('No saved secret found in this browser for this game.');
      return;
    }
    const exportJson = JSON.stringify({
      potshotGameId: game.id.toString(),
      move: saved.move,
      moveName: getMoveName(saved.move),
      salt: saved.salt,
      commitment: saved.commitment,
      contract: contractAddress,
      chainId: botTestnet.id,
    }, null, 2);

    navigator.clipboard.writeText(exportJson).then(() => {
      setCopiedBackup(true);
      setTimeout(() => setCopiedBackup(false), 2500);
    });
  };

  // --- Active Game Computations ---
  const isPlayerA = useMemo(
    () => (activeGame && account ? activeGame.playerA.toLowerCase() === account.toLowerCase() : false),
    [activeGame, account]
  );
  const isPlayerB = useMemo(
    () => (activeGame && account ? activeGame.playerB.toLowerCase() === account.toLowerCase() : false),
    [activeGame, account]
  );
  const isParticipant = isPlayerA || isPlayerB;

  const myMoveRevealed = useMemo(() => {
    if (!activeGame || !account) return false;
    if (isPlayerA) return activeGame.moveA !== Move.None;
    if (isPlayerB) return activeGame.moveB !== Move.None;
    return false;
  }, [activeGame, account, isPlayerA, isPlayerB]);

  const opponentRevealed = useMemo(() => {
    if (!activeGame || !account) return false;
    if (isPlayerA) return activeGame.moveB !== Move.None;
    if (isPlayerB) return activeGame.moveA !== Move.None;
    return false;
  }, [activeGame, account, isPlayerA, isPlayerB]);

  const savedSecretForActive = useMemo(() => {
    if (!activeGame || !account || !isParticipant) return null;
    return getSecretForGame(
      botTestnet.id,
      contractAddress,
      account,
      activeGame.id,
      isPlayerA ? activeGame.commitA : activeGame.commitB
    );
  }, [activeGame, account, isParticipant, isPlayerA]);

  const secondsUntilDeadline = useMemo(() => {
    if (!activeGame || activeGame.status !== Status.Committed) return 0;
    return Number(activeGame.revealDeadline) - nowSec;
  }, [activeGame, nowSec]);

  const deadlinePassed = secondsUntilDeadline <= 0;

  return (
    <div className="app-container">
      <div className="scanlines"></div>

      {/* --- Header --- */}
      <header className="header">
        <div className="brand" onClick={navigateToLobby}>
          <span className="brand-icon">🎯</span>
          <div>
            <h1 className="brand-title">PotShot</h1>
            <p className="brand-tagline">One throw. One pot.</p>
          </div>
        </div>

        <div className="header-actions">
          {/* Network Switcher */}
          {account && !isCorrectChain && (
            <button className="btn-arcade btn-magenta btn-sm" onClick={switchToBotMainnet}>
              ⚠️ Switch to BOT Mainnet
            </button>
          )}

          {/* Connect / Account */}
          {account ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="badge badge-open">
                🟢 {shortenAddress(account)}
              </span>
              <span className="badge badge-won" title="Wallet Balance">
                {formatBOT(userBalance)} BOT
              </span>
            </div>
          ) : (
            <button className="btn-arcade btn-cyan" onClick={connectWallet}>
              ⚡ Connect Wallet
            </button>
          )}

          {/* How it Works Pill */}
          <button
            className="btn-arcade btn-dark btn-sm"
            onClick={() => setShowHowItWorks(!showHowItWorks)}
          >
            ❓ Rules
          </button>
        </div>
      </header>

      {/* --- Pending Withdrawal Banner --- */}
      {pendingBalance > 0n && (
        <div className="pending-banner">
          <div className="pending-info">
            <span style={{ fontSize: '28px' }}>💰</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase' }}>
                Winnings & Refunds Ready
              </div>
              <div className="pending-amount">
                {formatBOT(pendingBalance)} BOT ready to withdraw
              </div>
            </div>
          </div>
          <button className="btn-arcade btn-yellow btn-lg" onClick={handleWithdraw}>
            💸 Withdraw All Now
          </button>
        </div>
      )}

      {/* --- User Record Ribbon (when connected) --- */}
      {account && (
        <div className="stats-ribbon">
          <div className="stat-card">
            <div className="stat-label">Wins</div>
            <div className="stat-value stat-wins">🏆 {userRecord.wins}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Losses</div>
            <div className="stat-value stat-losses">💀 {userRecord.losses}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Draws</div>
            <div className="stat-value stat-draws">🤝 {userRecord.draws}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Contract</div>
            <div style={{ fontSize: '11px', color: 'var(--neon-cyan)', fontFamily: 'monospace' }}>
              <a
                href={`${explorerBaseUrl}/address/${contractAddress}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                {shortenAddress(contractAddress)} ↗
              </a>
            </div>
          </div>
        </div>
      )}

      {/* --- VIEW: Single Game Details (Hash Route #/game/:id) --- */}
      {activeGameId !== null ? (
        activeGame ? (
          <div className="card" style={{ maxWidth: '820px', margin: '0 auto' }}>
            <div className="card-header">
              <button className="btn-arcade btn-dark btn-sm" onClick={navigateToLobby}>
                ← Back to Lobby
              </button>
              <div className="card-title">
                Game #{activeGame.id.toString()}
              </div>
              <span
                className={`badge badge-${
                  activeGame.status === Status.Open
                    ? 'open'
                    : activeGame.status === Status.Committed
                    ? 'committed'
                    : activeGame.status === Status.Won
                    ? 'won'
                    : activeGame.status === Status.Draw
                    ? 'draw'
                    : 'timeout'
                }`}
              >
                {getStatusLabel(activeGame.status)}
              </span>
            </div>

            {/* Stepper */}
            <div className="stepper">
              <div
                className={`step ${
                  activeGame.status === Status.Open ? 'active' : 'completed'
                }`}
              >
                1. Waiting
              </div>
              <div
                className={`step ${
                  activeGame.status === Status.Committed && !myMoveRevealed && !opponentRevealed
                    ? 'active'
                    : activeGame.status !== Status.Open
                    ? 'completed'
                    : ''
                }`}
              >
                2. Locked In
              </div>
              <div
                className={`step ${
                  activeGame.status === Status.Committed && (myMoveRevealed || opponentRevealed)
                    ? 'active'
                    : activeGame.status >= Status.Won
                    ? 'completed'
                    : ''
                }`}
              >
                3. Revealing
              </div>
              <div
                className={`step ${
                  activeGame.status >= Status.Won ? 'active completed' : ''
                }`}
              >
                4. Showdown
              </div>
            </div>

            {/* Duel Arena */}
            <div className="showdown-stage">
              {/* Fighter A */}
              <div className="fighter-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600 }}>Player A</span>
                  {isPlayerA && <span className="badge-you">YOU</span>}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {shortenAddress(activeGame.playerA)}
                </div>

                <div
                  className={`fighter-hand ${
                    activeGame.status === Status.Committed ? 'shake-left' : ''
                  }`}
                >
                  {activeGame.moveA !== Move.None
                    ? getMoveEmoji(activeGame.moveA)
                    : activeGame.status === Status.Open
                    ? '⏳'
                    : '🔒'}
                </div>

                <div style={{ fontSize: '11px', fontFamily: 'var(--font-arcade)', color: 'var(--neon-cyan)' }}>
                  {activeGame.moveA !== Move.None ? getMoveName(activeGame.moveA) : 'Secret Move'}
                </div>
              </div>

              {/* VS & Pot */}
              <div style={{ textAlign: 'center' }}>
                <div className="vs-badge">VS</div>
                <div className="pot-callout">
                  POT: {formatBOT(activeGame.stake * 2n)} BOT
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Stake: {formatBOT(activeGame.stake)} BOT each
                </div>
              </div>

              {/* Fighter B */}
              <div className="fighter-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600 }}>Player B</span>
                  {isPlayerB && <span className="badge-you">YOU</span>}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {activeGame.playerB !== '0x0000000000000000000000000000000000000000'
                    ? shortenAddress(activeGame.playerB)
                    : 'Waiting for challenger...'}
                </div>

                <div
                  className={`fighter-hand ${
                    activeGame.status === Status.Committed ? 'shake-right' : ''
                  }`}
                >
                  {activeGame.moveB !== Move.None
                    ? getMoveEmoji(activeGame.moveB)
                    : activeGame.playerB === '0x0000000000000000000000000000000000000000'
                    ? '❓'
                    : '🔒'}
                </div>

                <div style={{ fontSize: '11px', fontFamily: 'var(--font-arcade)', color: 'var(--neon-magenta)' }}>
                  {activeGame.moveB !== Move.None
                    ? getMoveName(activeGame.moveB)
                    : activeGame.playerB === '0x0000000000000000000000000000000000000000'
                    ? 'Open Slot'
                    : 'Secret Move'}
                </div>
              </div>
            </div>

            {/* Countdown bar during Committed phase */}
            {activeGame.status === Status.Committed && (
              <div className="countdown-box">
                <span>⏱️ Reveal Deadline:</span>
                <span style={{ fontWeight: 'bold' }}>
                  {formatCountdown(secondsUntilDeadline)}
                </span>
              </div>
            )}

            {/* --- Terminal Results Banner --- */}
            {activeGame.status === Status.Won && (
              <div
                className={`result-banner ${
                  account && activeGame.winner.toLowerCase() === account.toLowerCase()
                    ? 'result-won'
                    : 'result-lost'
                }`}
              >
                {account && activeGame.winner.toLowerCase() === account.toLowerCase() ? (
                  <div>
                    <div>🎉 YOU WON {formatBOT(activeGame.stake * 2n)} BOT! 🏆</div>
                    <div style={{ fontSize: '11px', marginTop: '6px', color: '#fff' }}>
                      Funds are in your pending balance ready to withdraw!
                    </div>
                  </div>
                ) : (
                  <div>
                    <div>Winner: {shortenAddress(activeGame.winner)}</div>
                    <div style={{ fontSize: '11px', marginTop: '6px' }}>
                      {isParticipant ? 'Better luck next throw!' : 'Game settled.'}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeGame.status === Status.Draw && (
              <div className="result-banner result-draw">
                🤝 DRAW! Both players threw the same move.
                <div style={{ fontSize: '11px', marginTop: '6px', color: '#fff' }}>
                  Stakes ({formatBOT(activeGame.stake)} BOT each) refunded to pending balances.
                </div>
              </div>
            )}

            {activeGame.status === Status.TimedOut && (
              <div className="result-banner result-draw">
                {activeGame.winner !== '0x0000000000000000000000000000000000000000' ? (
                  <div>
                    ⏰ TIMEOUT FORFEIT!
                    <div style={{ fontSize: '13px', marginTop: '6px' }}>
                      Winner:{' '}
                      {account && activeGame.winner.toLowerCase() === account.toLowerCase()
                        ? 'YOU! 🏆'
                        : shortenAddress(activeGame.winner)}
                    </div>
                    <div style={{ fontSize: '11px', marginTop: '4px' }}>
                      The non-revealing player forfeited the full pot.
                    </div>
                  </div>
                ) : (
                  <div>
                    ⏰ TIMEOUT EXPIRED (Neither Revealed)
                    <div style={{ fontSize: '11px', marginTop: '6px' }}>
                      Both players have been refunded their stakes to pending balance.
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeGame.status === Status.Cancelled && (
              <div className="result-banner result-lost">
                🚫 GAME CANCELLED
                <div style={{ fontSize: '11px', marginTop: '6px' }}>
                  Stake refunded to creator's pending balance.
                </div>
              </div>
            )}

            {/* --- Actions Section for Open Game --- */}
            {activeGame.status === Status.Open && (
              <div style={{ marginTop: '20px' }}>
                {isPlayerA ? (
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '14px', fontSize: '13px' }}>
                      Waiting for an opponent to join with {formatBOT(activeGame.stake)} BOT.
                    </p>
                    <button
                      className="btn-arcade btn-magenta"
                      onClick={() => handleCancelGame(activeGame.id)}
                    >
                      ❌ Cancel Game & Refund Stake
                    </button>
                  </div>
                ) : (
                  <div>
                    <h3
                      style={{
                        fontFamily: 'var(--font-arcade)',
                        fontSize: '12px',
                        color: 'var(--neon-cyan)',
                        marginBottom: '12px',
                      }}
                    >
                      Join this game for {formatBOT(activeGame.stake)} BOT:
                    </h3>
                    <div className="move-selector">
                      {[Move.Rock, Move.Paper, Move.Scissors].map((m) => (
                        <div
                          key={m}
                          className={`move-btn ${
                            (joinMoves[activeGame.id.toString()] || Move.Rock) === m ? 'selected' : ''
                          }`}
                          onClick={() =>
                            setJoinMoves({ ...joinMoves, [activeGame.id.toString()]: m })
                          }
                        >
                          <span className="emoji">{getMoveEmoji(m)}</span>
                          <span className="label">{getMoveName(m)}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      className="btn-arcade btn-yellow btn-lg"
                      style={{ width: '100%' }}
                      onClick={() => handleJoinGame(activeGame)}
                    >
                      ⚔️ Lock In & Throw for {formatBOT(activeGame.stake)} BOT
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* --- Actions Section for Committed Game --- */}
            {activeGame.status === Status.Committed && (
              <div style={{ marginTop: '20px' }}>
                {isParticipant ? (
                  <div>
                    {!myMoveRevealed ? (
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ marginBottom: '16px' }}>
                          <button
                            className="btn-arcade btn-green btn-lg"
                            style={{ width: '100%', fontSize: '16px', background: 'var(--neon-green)', color: '#000' }}
                            onClick={() => handleRevealMove(activeGame)}
                          >
                            🔓 Reveal My Secret Move Now!
                          </button>
                        </div>

                        {savedSecretForActive ? (
                          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
                            <button
                              className="btn-arcade btn-dark btn-sm"
                              onClick={() => handleBackupSecret(activeGame)}
                            >
                              📋 {copiedBackup ? 'Secret Copied!' : 'Back Up My Secret'}
                            </button>
                            <button
                              className="btn-arcade btn-dark btn-sm"
                              onClick={() => setShowManualSecret(!showManualSecret)}
                            >
                              ⚙️ Manual Reveal Fallback
                            </button>
                          </div>
                        ) : (
                          <div className="secret-alert">
                            ⚠️ No saved secret found in this browser storage! If you cleared your
                            cache or changed devices, enter your move and salt manually below.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '16px', background: 'rgba(0, 240, 255, 0.05)', borderRadius: '8px' }}>
                        <div style={{ fontFamily: 'var(--font-arcade)', fontSize: '13px', color: 'var(--neon-cyan)', marginBottom: '8px' }}>
                          ✅ Your move is revealed!
                        </div>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                          Waiting for your opponent to reveal. If they fail to reveal before the deadline,
                          you can claim the full {formatBOT(activeGame.stake * 2n)} BOT pot by forfeit!
                        </p>
                      </div>
                    )}

                    {/* Manual Reveal Fallback */}
                    {showManualSecret && !myMoveRevealed && (
                      <div
                        style={{
                          marginTop: '20px',
                          padding: '16px',
                          border: '1px solid var(--border-arcade)',
                          borderRadius: '8px',
                          background: 'var(--bg-dark)',
                        }}
                      >
                        <h4 style={{ fontFamily: 'var(--font-arcade)', fontSize: '11px', marginBottom: '10px', color: 'var(--neon-yellow)' }}>
                          Manual Reveal Entry:
                        </h4>
                        <div className="move-selector">
                          {[Move.Rock, Move.Paper, Move.Scissors].map((m) => (
                            <div
                              key={m}
                              className={`move-btn ${manualMove === m ? 'selected' : ''}`}
                              onClick={() => setManualMove(m)}
                            >
                              <span className="emoji">{getMoveEmoji(m)}</span>
                              <span className="label">{getMoveName(m)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="input-group">
                          <label className="input-label">32-Byte Secret Salt (hex):</label>
                          <input
                            type="text"
                            className="input-chunky"
                            placeholder="0x..."
                            value={manualSalt}
                            onChange={(e) => setManualSalt(e.target.value.trim())}
                          />
                        </div>
                        <button
                          className="btn-arcade btn-yellow"
                          onClick={() => handleRevealMove(activeGame, manualMove, manualSalt)}
                        >
                          Submit Manual Reveal
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                    Game in progress between players.
                  </p>
                )}

                {/* Claim Timeout button if deadline passed */}
                {deadlinePassed && (
                  <div
                    style={{
                      marginTop: '24px',
                      padding: '16px',
                      border: '2px solid var(--neon-magenta)',
                      borderRadius: '8px',
                      background: 'rgba(255, 0, 127, 0.1)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontFamily: 'var(--font-arcade)', fontSize: '13px', color: 'var(--neon-yellow)', marginBottom: '8px' }}>
                      ⏳ Reveal Deadline Has Passed!
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                      Anyone can trigger timeout settlement. If one player revealed, they take the entire pot (2x stake). If neither revealed, both players are refunded.
                    </p>
                    <button
                      className="btn-arcade btn-magenta btn-lg"
                      onClick={() => handleClaimTimeout(activeGame.id)}
                    >
                      ⚡ Claim Timeout Settlement
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
            <h3 style={{ fontFamily: 'var(--font-arcade)', color: 'var(--neon-magenta)' }}>
              Game Not Found
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginTop: '8px', marginBottom: '20px' }}>
              Game #{activeGameId.toString()} does not exist or has not been created yet.
            </p>
            <button className="btn-arcade btn-cyan" onClick={navigateToLobby}>
              Return to Lobby
            </button>
          </div>
        )
      ) : (
        /* --- VIEW: Main Lobby & Create Game --- */
        <div className="arcade-grid">
          {/* Left Column: Create Game & Lookup */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Create Game Card */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">🎯 Create a Game</span>
                <span className="badge badge-open">PVP</span>
              </div>

              <label className="input-label">1. Choose your secret throw:</label>
              <div className="move-selector">
                <div
                  className={`move-btn ${createMove === Move.Rock ? 'selected' : ''}`}
                  onClick={() => setCreateMove(Move.Rock)}
                >
                  <span className="emoji">✊</span>
                  <span className="label">Rock</span>
                </div>
                <div
                  className={`move-btn ${createMove === Move.Paper ? 'selected' : ''}`}
                  onClick={() => setCreateMove(Move.Paper)}
                >
                  <span className="emoji">✋</span>
                  <span className="label">Paper</span>
                </div>
                <div
                  className={`move-btn ${createMove === Move.Scissors ? 'selected' : ''}`}
                  onClick={() => setCreateMove(Move.Scissors)}
                >
                  <span className="emoji">✌️</span>
                  <span className="label">Scissors</span>
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">2. Stake Amount (BOT):</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.0001"
                  className="input-chunky"
                  value={createStake}
                  onChange={(e) => setCreateStake(e.target.value)}
                  placeholder="0.1"
                />
              </div>

              <div className="secret-alert">
                🛡️ <strong>Commit-Reveal:</strong> Your move stays secret until both of you have locked in.
                The secret salt is stored safely in your browser.
              </div>

              <button
                className="btn-arcade btn-yellow btn-lg"
                style={{ width: '100%' }}
                onClick={handleCreateGame}
              >
                🚀 Create & Lock Move
              </button>
            </div>

            {/* Quick Game Lookup Box */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">🔍 Find Game by ID</span>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="number"
                  className="input-chunky"
                  placeholder="e.g. 1"
                  value={lookupIdInput}
                  onChange={(e) => setLookupIdInput(e.target.value)}
                />
                <button
                  className="btn-arcade btn-cyan"
                  onClick={() => {
                    if (lookupIdInput.trim()) {
                      navigateToGame(BigInt(lookupIdInput.trim()));
                    }
                  }}
                >
                  Open
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Open Games & My Games */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Open Games (Lobby) */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">⚔️ Open Games ({openGames.length})</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {loading ? 'Fetching games...' : 'Auto-refreshing'}
                </span>
              </div>

              {loading && openGames.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px 12px', color: 'var(--text-muted)' }}>
                  <div className="spinner" style={{ width: '32px', height: '32px', marginBottom: '12px' }}></div>
                  <p style={{ fontFamily: 'var(--font-arcade)', fontSize: '10px' }}>Loading open games...</p>
                </div>
              ) : openGames.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px 12px', color: 'var(--text-muted)' }}>
                  <p style={{ fontSize: '32px', marginBottom: '8px' }}>🎮</p>
                  <p style={{ fontFamily: 'var(--font-arcade)', fontSize: '11px' }}>
                    No open games right now.
                  </p>
                  <p style={{ fontSize: '13px', marginTop: '6px' }}>
                    Create one above to challenge the testnet!
                  </p>
                </div>
              ) : (
                <div className="lobby-list">
                  {openGames.map((game) => {
                    const isOwn =
                      account && game.playerA.toLowerCase() === account.toLowerCase();
                    const chosen = joinMoves[game.id.toString()] || Move.Rock;

                    return (
                      <div key={game.id.toString()} className="game-row">
                        <div className="game-row-meta">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="game-row-id">#{game.id.toString()}</span>
                            <span className="badge badge-open">Open</span>
                            {isOwn && <span className="badge-you">YOUR GAME</span>}
                          </div>
                          <div className="game-row-stake">
                            {formatBOT(game.stake)} BOT <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>pot: {formatBOT(game.stake * 2n)} BOT</span>
                          </div>
                          <div className="game-row-players">
                            Creator: {shortenAddress(game.playerA)} • {formatRelativeTime(game.createdAt)}
                          </div>
                        </div>

                        {/* Join actions */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {!isOwn ? (
                            <>
                              <div style={{ display: 'flex', gap: '4px' }}>
                                {[Move.Rock, Move.Paper, Move.Scissors].map((m) => (
                                  <button
                                    key={m}
                                    style={{
                                      padding: '6px 8px',
                                      fontSize: '18px',
                                      cursor: 'pointer',
                                      background: chosen === m ? 'rgba(0, 240, 255, 0.2)' : 'var(--bg-dark)',
                                      border: chosen === m ? '2px solid var(--neon-cyan)' : '1px solid var(--border-arcade)',
                                      borderRadius: '4px',
                                    }}
                                    onClick={() =>
                                      setJoinMoves({
                                        ...joinMoves,
                                        [game.id.toString()]: m,
                                      })
                                    }
                                    title={getMoveName(m)}
                                  >
                                    {getMoveEmoji(m)}
                                  </button>
                                ))}
                              </div>
                              <button
                                className="btn-arcade btn-yellow btn-sm"
                                onClick={() => handleJoinGame(game)}
                              >
                                Join for {formatBOT(game.stake)} BOT
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn-arcade btn-dark btn-sm"
                              onClick={() => navigateToGame(game.id)}
                            >
                              Manage Game
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* My Games */}
            {account && userGames.length > 0 && (
              <div className="card">
                <div className="card-header">
                  <span className="card-title">📜 My Games ({userGames.length})</span>
                </div>

                <div className="lobby-list">
                  {userGames.slice(0, 10).map((g) => (
                    <div
                      key={g.id.toString()}
                      className="game-row"
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigateToGame(g.id)}
                    >
                      <div className="game-row-meta">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="game-row-id">#{g.id.toString()}</span>
                          <span
                            className={`badge badge-${
                              g.status === Status.Open
                                ? 'open'
                                : g.status === Status.Committed
                                ? 'committed'
                                : g.status === Status.Won
                                ? 'won'
                                : g.status === Status.Draw
                                ? 'draw'
                                : 'timeout'
                            }`}
                          >
                            {getStatusLabel(g.status)}
                          </span>
                        </div>
                        <div style={{ fontSize: '13px' }}>
                          Stake: {formatBOT(g.stake)} BOT
                        </div>
                      </div>

                      <button className="btn-arcade btn-dark btn-sm">
                        View Arena →
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- Collapsible "How PotShot Works" Section --- */}
      <div className="how-it-works-box">
        <div
          className="how-header"
          onClick={() => setShowHowItWorks(!showHowItWorks)}
        >
          <span>📖 How PotShot Works</span>
          <span>{showHowItWorks ? '▲ Hide' : '▼ View Rules'}</span>
        </div>

        {showHowItWorks && (
          <div className="how-content">
            <h4>1. Commit-Reveal Fairness</h4>
            <p>
              When you create or join a game, your chosen move (Rock, Paper, or Scissors) is hashed with a cryptographically random 32-byte salt and your wallet address: <code>keccak256(abi.encode(player, move, salt))</code>. Nobody—not even the smart contract or miners—can see your move until the reveal phase.
            </p>

            <h4>2. Reveal Window & Timeout Forfeit</h4>
            <p>
              Once both players have matched stakes and locked in their moves, a {Number(contractRevealWindow) / 60} minute countdown timer begins. Both players must reveal their moves. If an opponent sees what you threw and refuses to reveal, they forfeit the match after the deadline passes, and you claim the entire 2x pot!
            </p>

            <h4>3. Ties & Withdrawals</h4>
            <p>
              If both players reveal the same move, it's a draw and both stakes are refunded. All payouts and refunds are held in <code>pendingBalance</code> so malicious reentrancy is impossible. You can withdraw your winnings to your wallet at any time with 0% platform fee.
            </p>

            <h4>4. Security & Secret Safety</h4>
            <p>
              Your salt is stored in your browser's localStorage. Always reveal your move promptly, and use the "Back up my secret" button if you switch browsers or clear history.
            </p>

            <p style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '12px' }}>
              Note: PotShot is deployed on the BOT Mainnet (Chain ID 677) as a trustless peer-to-peer commit-reveal gaming platform.
            </p>
          </div>
        )}
      </div>

      {/* --- Footer Sections 1 & 2 --- */}
      <footer className="potshot-footer">
        {/* Section 1: Proof on bot mainnet */}
        <div className="footer-proof-section">
          <div className="footer-proof-badge">
            <span className="proof-status-dot">●</span>
            <span className="proof-heading">Proof on bot mainnet</span>
          </div>

          <div className="proof-info-grid">
            <div className="proof-info-item">
              <span className="proof-label">Chain id:</span>
              <span className="proof-value">677</span>
            </div>
            <div className="proof-info-sep">•</div>
            <div className="proof-info-item">
              <span className="proof-label">Contract:</span>
              <a
                href={`https://scan.botchain.ai/address/${contractAddress}`}
                target="_blank"
                rel="noreferrer"
                className="proof-contract-link"
              >
                {contractAddress}
              </a>
            </div>
          </div>

          <div className="footer-links-row">
            <a
              href="https://www.botchain.ai/en/"
              target="_blank"
              rel="noreferrer"
              className="footer-external-link"
            >
              BOT Chain Website
            </a>
            <span className="footer-links-sep">•</span>
            <a
              href="https://scan.botchain.ai/"
              target="_blank"
              rel="noreferrer"
              className="footer-external-link"
            >
              BOTScan explorer
            </a>
          </div>
        </div>

        {/* Section 2: Part of the Ecosystem */}
        <div className="ecosystem-section">
          <div className="ecosystem-header-label">PART OF THE ECOSYSTEM</div>

          <div className="ecosystem-logo-circle">
            <img src={botLogo} alt="BOT Chain Logo" className="ecosystem-logo" />
          </div>

          <h3 className="ecosystem-title">
            <span className="ecosystem-title-bot">BOT</span>
            <span className="ecosystem-title-chain"> Chain</span>
          </h3>

          <p className="ecosystem-tagline">
            One throw. One pot.
          </p>

          <div className="ecosystem-divider">
            <span className="ecosystem-divider-line" />
            <span className="ecosystem-divider-diamond">◆</span>
            <span className="ecosystem-divider-line" />
          </div>

          <div className="ecosystem-links">
            <a
              href="https://www.botchain.ai/en/"
              target="_blank"
              rel="noreferrer"
              className="ecosystem-link"
            >
              <svg className="ecosystem-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span>botchain.ai</span>
            </a>

            <a
              href="https://scan.botchain.ai/"
              target="_blank"
              rel="noreferrer"
              className="ecosystem-link"
            >
              <svg className="ecosystem-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span>Explorer</span>
            </a>
          </div>

          <div className="ecosystem-copyright">
            © 2026 <strong>BOT Chain</strong> · Mainnet · Chain ID <strong>677</strong>
          </div>
        </div>
      </footer>

      {/* --- Transaction Modal --- */}
      {txStatus.state !== 'idle' && (
        <div className="tx-modal-overlay">
          <div className="tx-modal">
            {txStatus.state === 'pending' && <div className="spinner"></div>}
            {txStatus.state === 'success' && <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎉</div>}
            {txStatus.state === 'error' && <div style={{ fontSize: '48px', marginBottom: '12px' }}>⚠️</div>}

            <h3
              style={{
                fontFamily: 'var(--font-arcade)',
                fontSize: '14px',
                color:
                  txStatus.state === 'success'
                    ? 'var(--neon-green)'
                    : txStatus.state === 'error'
                    ? 'var(--neon-magenta)'
                    : 'var(--neon-cyan)',
                marginBottom: '10px',
              }}
            >
              {txStatus.state === 'pending'
                ? 'Processing Transaction'
                : txStatus.state === 'success'
                ? 'Success!'
                : 'Action Failed'}
            </h3>

            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              {txStatus.message}
            </p>

            {txStatus.description && (
              <p style={{ fontSize: '12px', color: 'var(--neon-yellow)', marginBottom: '16px' }}>
                {txStatus.description}
              </p>
            )}

            {txStatus.hash && (
              <p style={{ fontSize: '11px', marginBottom: '16px' }}>
                <a
                  href={`${explorerBaseUrl}/tx/${txStatus.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--neon-cyan)' }}
                >
                  View on BOTScan ({shortenAddress(txStatus.hash)}) ↗
                </a>
              </p>
            )}

            {txStatus.state !== 'pending' && (
              <button
                className="btn-arcade btn-cyan btn-sm"
                onClick={() => setTxStatus({ state: 'idle' })}
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
