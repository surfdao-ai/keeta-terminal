/**
 * Safety rails for mainnet: pending actions, daily cap, quote revalidation.
 */
import { dbRead, dbUpdate } from '../db';

export interface TokenLaunchSpec {
  name: string;
  symbol: string;
  description: string;
  supply: string;
  decimals: number;
}

export interface PendingTrade {
  id: string;
  kind: 'swap' | 'token';
  fromToken: string;
  toToken: string;
  amount: string;
  affinity: 'from' | 'to';
  token?: TokenLaunchSpec;
  createdAt: number;
  expiresAt: number;
}

export function newPendingTrade(
  input: Omit<PendingTrade, 'id' | 'createdAt' | 'expiresAt'>,
): PendingTrade {
  const now = Date.now();
  return { ...input, id: crypto.randomUUID(), createdAt: now, expiresAt: now + 60_000 };
}

export function isExpired(t: PendingTrade): boolean {
  return Date.now() > t.expiresAt;
}

export async function loadPending(id: string): Promise<PendingTrade | null> {
  const raw = await dbRead<PendingTrade[]>('pendingTrades');
  const all = Array.isArray(raw) ? raw : [];
  return all.find((t) => t.id === id) ?? null;
}

export async function savePending(t: PendingTrade): Promise<void> {
  await dbUpdate<PendingTrade[]>('pendingTrades', (current) => {
    const all = current ?? [];
    all.unshift(t);
    return all.slice(0, 50);
  });
}

export async function removePending(id: string): Promise<void> {
  await dbUpdate<PendingTrade[]>('pendingTrades', (current) =>
    (current ?? []).filter((t) => t.id !== id),
  );
}

export interface TradeRecord {
  id: string;
  kind: 'swap' | 'token';
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
  token?: { address: string; symbol: string; supply: string; decimals: number };
}

export async function appendTrade(r: TradeRecord): Promise<void> {
  await dbUpdate<TradeRecord[]>('trades', (current) => {
    const all = current ?? [];
    all.unshift(r);
    return all.slice(0, 500);
  });
}

export async function listTrades(limit = 50): Promise<TradeRecord[]> {
  const raw = await dbRead<TradeRecord[]>('trades');
  const all = Array.isArray(raw) ? raw : [];
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
  // Compare-and-set: two concurrent trades must both be counted against the
  // cap, otherwise the daily limit could be exceeded.
  await dbUpdate<{ spentUsd: number }>(key, (current) => ({
    spentUsd: (current?.spentUsd ?? 0) + usd,
  }));
}

export interface TerminalSettings {
  dailyCapUsd: number;
  updatedAt: string;
}

/** Fallback cap when the user has not set one: the DAILY_SPEND_CAP_USD env var. */
export function defaultCapUsd(): number {
  const raw = process.env.DAILY_SPEND_CAP_USD;
  const n = raw ? Number(raw) : 100;
  return Number.isFinite(n) && n > 0 ? n : 100;
}

export const MAX_CAP_USD = 1_000_000;

export async function getSettings(): Promise<TerminalSettings> {
  const s = await dbRead<TerminalSettings>('settings');
  if (s && Number.isFinite(s.dailyCapUsd) && s.dailyCapUsd > 0) return s;
  return { dailyCapUsd: defaultCapUsd(), updatedAt: '' };
}

/** The effective daily cap (user setting, else env default). */
export async function dailyCapUsd(): Promise<number> {
  return (await getSettings()).dailyCapUsd;
}

export async function setDailyCap(usd: number): Promise<TerminalSettings> {
  if (!Number.isFinite(usd) || usd <= 0) throw new Error('Cap must be a positive number');
  if (usd > MAX_CAP_USD) throw new Error(`Cap cannot exceed $${MAX_CAP_USD.toLocaleString()}`);
  const settings: TerminalSettings = { dailyCapUsd: usd, updatedAt: new Date().toISOString() };
  await dbUpdate<TerminalSettings>('settings', () => settings);
  return settings;
}
