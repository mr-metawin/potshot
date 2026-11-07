export enum Move {
  None = 0,
  Rock = 1,
  Paper = 2,
  Scissors = 3,
}

export enum Status {
  Open = 0,
  Committed = 1,
  Won = 2,
  Draw = 3,
  Cancelled = 4,
  TimedOut = 5,
}

export interface Game {
  id: bigint;
  playerA: `0x${string}`;
  playerB: `0x${string}`;
  stake: bigint;
  commitA: `0x${string}`;
  commitB: `0x${string}`;
  moveA: Move;
  moveB: Move;
  createdAt: bigint;
  joinedAt: bigint;
  revealDeadline: bigint;
  winner: `0x${string}`;
  status: Status;
}

export interface UserRecord {
  wins: number;
  losses: number;
  draws: number;
}

export interface TxStatus {
  state: 'idle' | 'pending' | 'success' | 'error';
  hash?: string;
  message?: string;
  description?: string;
}

export interface SavedSecret {
  move: Move;
  salt: `0x${string}`;
  commitment: `0x${string}`;
  createdAt: number;
  gameId?: string;
}
