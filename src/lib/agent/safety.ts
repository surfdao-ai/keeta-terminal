/**
 * Safety rails for mainnet: pending trades, daily cap, quote revalidation.
 */
import { dbRead, dbWrite } from '../db';

export interface PendingTrade {
  id: string;
  fromToken: string;
  toToken: string;
  amount: string; // display amount in from-token units
  affinity: 'from' | 'to';
  createdAt: number;
  expiresAt: number;
}

export function newPendingTrade(input: Omit<PendingTrade, 'id' | 'createdAt' | 'expiresAt'>): PendingTrade {
  const now = Date.now();
  return { ...input, id: crypto.randomUUID(), createdAt: now, expiresAt: now + 60_000 };
}

export function isExpired(t: PendingTrade): boolean {
  return Date.now() > t.expiresAt;
}

export async function loadPending(id: string): Promise<PendingTrade | null> {
  const all = (await dbRead<PendingTrade[]>('pendingTrades')) ?? [];
  return all.find((t) => t.id === id) ?? null;
}

export async function savePending(t: PendingTrade): Promise<void> {
  const all = (await dbRead<PendingTrade[]>('pendingTrades')) ?? [];
  all.unshift(t);
  // keep last 50
  await dbWrite('pendingTrades', all.slice(0, 50));
}

export async function removePending(id: string): Promise<void> {
  const all = (await dbRead<PendingTrade[]>('pendingTrades')) ?? [];
  await dbWrite('pendingTrades', all.filter((t) => t.id !== id));
}

export interface TradeRecord {
  id: string;
  fromToken: string;
  toToken: string;
  amount: string;
  affinity: 'from' | 'to';
  convertedAmount: string;
  provider: string;
  exchangeId: string | null;
  createdAt: string;
  status: 'executed' | 'failed';
  error?: string;
  capSpentUsd: number;
}

export async function appendTrade(r: TradeRecord): Promise<void> {
  const all = (await dbRead<TradeRecord[]>('trades')) ?? [];
  all.unshift(r);
  await dbWrite('trades', all.slice(0, 500));
}

export async function listTrades(limit = 50): Promise<TradeRecord[]> {
  const all = (await dbRead<TradeRecord[]>('trades')) ?? [];
  return all.slice(0, limit);
}

export async function capKey(): Promise<string> {
  return `cap:${new Date().toISOString().slice(0, 10)}`;
}

export async function capSpent(): Promise<number> {
  const v = await dbRead<{ spentUsd: number }>(await capKey());
  return v?.spentUsd ?? 0;
}

export async function addCapSpend(usd: number): Promise<void> {
  const key = await capKey();
  const cur = await dbRead<{ spentUsd: number }>(key);
  await dbWrite(key, { spentUsd: (cur?.spentUsd ?? 0) + usd });
}

export function dailyCapUsd(): number {
  const raw = process.env.DAILY_SPEND_CAP_USD;
  const n = raw ? Number(raw) : 100;
  return Number.isFinite(n) && n > 0 ? n : 100;
}
