/**
 * Safety rails for mainnet: pending actions, daily cap, trade history.
 *
 * Every record is scoped to the signed-in wallet address, so one visitor can
 * never see or alter another's state.
 */
import { dbRead, dbUpdate } from '../db';
import type { LaunchRecord } from '../keeta/trade-types';

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

export async function loadPending(owner: string, id: string): Promise<PendingTrade | null> {
  const raw = await dbRead<PendingTrade[]>('pendingTrades', owner);
  const all = Array.isArray(raw) ? raw : [];
  return all.find((t) => t.id === id) ?? null;
}

export async function savePending(owner: string, t: PendingTrade): Promise<void> {
  await dbUpdate<PendingTrade[]>('pendingTrades', (current) => {
    const all = Array.isArray(current) ? current : [];
    all.unshift(t);
    return all.slice(0, 50);
  }, { owner });
}

/** The proposals waiting for the user to approve and sign. */
export async function listPending(owner: string): Promise<PendingTrade[]> {
  const raw = await dbRead<PendingTrade[]>('pendingTrades', owner);
  const all = Array.isArray(raw) ? raw : [];
  return all.filter((t) => !isExpired(t));
}

export async function removePending(owner: string, id: string): Promise<void> {
  await dbUpdate<PendingTrade[]>(
    'pendingTrades',
    (current) => (Array.isArray(current) ? current : []).filter((t) => t.id !== id),
    { owner },
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
  /** Where the swap settled, in words: "base anchor" or "on-chain". */
  route?: string;
  exchangeId: string | null;
  createdAt: string;
  status: 'executed' | 'pending' | 'failed';
  error?: string;
  capSpentUsd: number;
  token?: { address: string; symbol: string; supply: string; decimals: number };
}

export async function appendTrade(owner: string, r: TradeRecord): Promise<void> {
  await dbUpdate<TradeRecord[]>('trades', (current) => {
    const all = Array.isArray(current) ? current : [];
    // A tradeId is unique (its proposal was consumed): a duplicate — e.g. a
    // retried submit — replaces the earlier record instead of double-counting.
    const next = all.filter((t) => t.id !== r.id);
    next.unshift(r);
    return next.slice(0, 500);
  }, { owner });
}

export async function listTrades(owner: string, limit = 50): Promise<TradeRecord[]> {
  const raw = await dbRead<TradeRecord[]>('trades', owner);
  const all = Array.isArray(raw) ? raw : [];
  return all.slice(0, limit);
}

export type { LaunchRecord } from '../keeta/trade-types';

export async function appendLaunch(owner: string, rec: LaunchRecord): Promise<void> {
  await dbUpdate<LaunchRecord[]>('launches', (current) => {
    const all = Array.isArray(current) ? current : [];
    all.unshift(rec);
    return all.slice(0, 100);
  }, { owner });
}

export async function listLaunches(owner: string): Promise<LaunchRecord[]> {
  const raw = await dbRead<LaunchRecord[]>('launches', owner);
  return Array.isArray(raw) ? raw : [];
}

export function capKey(owner: string, day = new Date().toISOString().slice(0, 10)): string {
  return `cap:${day}`;
}

export async function capSpent(owner: string): Promise<number> {
  const v = await dbRead<{ spentUsd: number }>(capKey(owner), owner);
  return v?.spentUsd ?? 0;
}

export async function addCapSpend(owner: string, usd: number): Promise<void> {
  // Compare-and-set: two concurrent trades must both be counted against the
  // cap, otherwise the daily limit could be exceeded.
  await dbUpdate<{ spentUsd: number }>(
    capKey(owner),
    (current) => ({ spentUsd: (current?.spentUsd ?? 0) + usd }),
    { owner },
  );
}

/**
 * Atomically check the daily cap and reserve `costUsd` against it.
 *
 * `dbUpdate` is compare-and-set, so on contention the check runs again — two
 * concurrent settles cannot both pass the cap. Returns `ok: false` when the
 * cost does not fit, with the current spent amount for the caller's message.
 */
export async function reserveCap(
  owner: string,
  costUsd: number,
): Promise<{ ok: boolean; spentUsd: number; capUsd: number }> {
  const cap = await dailyCapUsd(owner);
  let ok = false;
  let spentUsd = 0;
  await dbUpdate<{ spentUsd: number }>(
    capKey(owner),
    (current) => {
      const next = (current?.spentUsd ?? 0) + costUsd;
      if (next > cap) return current ?? { spentUsd: 0 };
      ok = true;
      spentUsd = next;
      return { spentUsd: next };
    },
    { owner },
  );
  if (!ok) {
    const cur = await dbRead<{ spentUsd: number }>(capKey(owner), owner);
    spentUsd = cur?.spentUsd ?? 0;
  }
  return { ok, spentUsd, capUsd: cap };
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

export async function getSettings(owner: string): Promise<TerminalSettings> {
  const s = await dbRead<TerminalSettings>('settings', owner);
  if (s && Number.isFinite(s.dailyCapUsd) && s.dailyCapUsd > 0) return s;
  return { dailyCapUsd: defaultCapUsd(), updatedAt: '' };
}

/** The effective daily cap (user setting, else env default). */
export async function dailyCapUsd(owner: string): Promise<number> {
  return (await getSettings(owner)).dailyCapUsd;
}

export async function setDailyCap(owner: string, usd: number): Promise<TerminalSettings> {
  if (!Number.isFinite(usd) || usd <= 0) throw new Error('Cap must be a positive number');
  if (usd > MAX_CAP_USD) throw new Error(`Cap cannot exceed $${MAX_CAP_USD.toLocaleString()}`);
  const settings: TerminalSettings = { dailyCapUsd: usd, updatedAt: new Date().toISOString() };
  await dbUpdate<TerminalSettings>('settings', () => settings, { owner });
  return settings;
}
