import { formatEther } from 'viem';
import { Move, Status } from './types';

export function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatRelativeTime(timestampSec: bigint | number): string {
  const now = Math.floor(Date.now() / 1000);
  const ts = typeof timestampSec === 'bigint' ? Number(timestampSec) : timestampSec;
  const diff = now - ts;

  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 24);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export function formatBOT(amountWei: bigint): string {
  const str = formatEther(amountWei);
  const num = parseFloat(str);
  if (num === 0) return '0';
  if (num < 0.0001) return '<0.0001';
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'Deadline passed';
  const h = Math.floor(secondsLeft / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = secondsLeft % 60;
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

export function getMoveEmoji(move: Move): string {
  switch (move) {
    case Move.Rock:
      return '✊';
    case Move.Paper:
      return '✋';
    case Move.Scissors:
      return '✌️';
    default:
      return '❓';
  }
}

export function getMoveName(move: Move): string {
  switch (move) {
    case Move.Rock:
      return 'Rock';
    case Move.Paper:
      return 'Paper';
    case Move.Scissors:
      return 'Scissors';
    default:
      return 'Unknown';
  }
}

export function getStatusLabel(status: Status): string {
  switch (status) {
    case Status.Open:
      return 'Open';
    case Status.Committed:
      return 'Locked In';
    case Status.Won:
      return 'Won';
    case Status.Draw:
      return 'Draw';
    case Status.Cancelled:
      return 'Cancelled';
    case Status.TimedOut:
      return 'Timed Out';
    default:
      return 'Unknown';
  }
}

export function parseContractError(error: any): string {
  if (!error) return 'An unknown error occurred.';

  const str = typeof error === 'string' ? error : error?.message || error?.details || error?.shortMessage || '';

  if (str.includes('User rejected') || str.includes('user rejected') || error?.code === 4001) {
    return 'Transaction rejected by user.';
  }
  if (str.includes('ZeroStake')) {
    return 'Stake must be greater than 0 BOT.';
  }
  if (str.includes('ZeroCommitment')) {
    return 'Commitment cannot be empty.';
  }
  if (str.includes('GameNotFound')) {
    return 'Game not found.';
  }
  if (str.includes('CannotJoinOwnGame')) {
    return 'You cannot join your own game.';
  }
  if (str.includes('IncorrectStake')) {
    return 'Submitted stake does not match the required game stake.';
  }
  if (str.includes('OnlyPlayerA')) {
    return 'Only the game creator can cancel this game.';
  }
  if (str.includes('NotAPlayer')) {
    return 'You are not a participant in this game.';
  }
  if (str.includes('RevealDeadlinePassed')) {
    return 'The reveal deadline has already expired.';
  }
  if (str.includes('RevealDeadlineNotPassed')) {
    return 'The reveal deadline has not expired yet.';
  }
  if (str.includes('InvalidMove')) {
    return 'Invalid move chosen (must be Rock, Paper, or Scissors).';
  }
  if (str.includes('AlreadyRevealed')) {
    return 'You have already revealed your move.';
  }
  if (str.includes('InvalidReveal')) {
    return 'Reveal mismatch! Move or salt does not match your commitment.';
  }
  if (str.includes('InvalidStatus')) {
    return 'Game is not in the required state for this action.';
  }
  if (str.includes('NoPendingBalance')) {
    return 'No pending balance available to withdraw.';
  }
  if (str.includes('insufficient funds')) {
    return 'Insufficient BOT balance for transaction and gas.';
  }

  // Fallback to short message or truncated message
  if (error?.shortMessage) return error.shortMessage;
  if (str.length > 180) return str.slice(0, 180) + '...';
  return str || 'Transaction failed.';
}
