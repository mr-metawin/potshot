import { encodeAbiParameters, keccak256, bytesToHex } from 'viem';
import { Move, SavedSecret } from './types';

export function generateSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function computeCommitment(
  player: `0x${string}`,
  move: Move,
  salt: `0x${string}`
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint8' }, { type: 'bytes32' }],
      [player, move, salt]
    )
  );
}

function getGameStorageKey(
  chainId: number,
  contract: string,
  player: string,
  gameId: string | number | bigint
): string {
  return `potshot_${chainId}_${contract.toLowerCase()}_${player.toLowerCase()}_game_${gameId.toString()}`;
}

function getCommitStorageKey(
  chainId: number,
  contract: string,
  player: string,
  commitment: string
): string {
  return `potshot_${chainId}_${contract.toLowerCase()}_${player.toLowerCase()}_commit_${commitment.toLowerCase()}`;
}

export function saveSecretByCommitment(
  chainId: number,
  contract: string,
  player: string,
  secret: SavedSecret
): void {
  try {
    const key = getCommitStorageKey(chainId, contract, player, secret.commitment);
    localStorage.setItem(key, JSON.stringify(secret));
  } catch (err) {
    console.error('Failed to save secret by commitment:', err);
  }
}

export function saveSecretByGameId(
  chainId: number,
  contract: string,
  player: string,
  gameId: string | number | bigint,
  secret: SavedSecret
): void {
  try {
    const updated = { ...secret, gameId: gameId.toString() };
    const key = getGameStorageKey(chainId, contract, player, gameId);
    localStorage.setItem(key, JSON.stringify(updated));

    // Also keep indexed by commitment for lookup redundancy
    if (secret.commitment) {
      const commitKey = getCommitStorageKey(chainId, contract, player, secret.commitment);
      localStorage.setItem(commitKey, JSON.stringify(updated));
    }
  } catch (err) {
    console.error('Failed to save secret by gameId:', err);
  }
}

export function promoteCommitmentToGameId(
  chainId: number,
  contract: string,
  player: string,
  commitment: string,
  gameId: string | number | bigint
): SavedSecret | null {
  try {
    const commitKey = getCommitStorageKey(chainId, contract, player, commitment);
    const raw = localStorage.getItem(commitKey);
    if (!raw) return null;

    const secret: SavedSecret = JSON.parse(raw);
    saveSecretByGameId(chainId, contract, player, gameId, secret);
    return secret;
  } catch (err) {
    console.error('Failed to promote secret to gameId:', err);
    return null;
  }
}

export function getSecretForGame(
  chainId: number,
  contract: string,
  player: string,
  gameId: string | number | bigint,
  commitment?: string
): SavedSecret | null {
  try {
    // 1. Try lookup by gameId
    const gameKey = getGameStorageKey(chainId, contract, player, gameId);
    const rawGame = localStorage.getItem(gameKey);
    if (rawGame) {
      return JSON.parse(rawGame);
    }

    // 2. Fallback to lookup by commitment
    if (commitment) {
      const commitKey = getCommitStorageKey(chainId, contract, player, commitment);
      const rawCommit = localStorage.getItem(commitKey);
      if (rawCommit) {
        const secret: SavedSecret = JSON.parse(rawCommit);
        // Link it to gameId for future direct access
        saveSecretByGameId(chainId, contract, player, gameId, secret);
        return secret;
      }
    }
  } catch (err) {
    console.error('Failed to load secret for game:', err);
  }
  return null;
}
