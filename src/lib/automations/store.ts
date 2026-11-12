/**
 * Automations: recurring swaps and price alerts.
 *
 * The SDK has no native scheduler (Keeta operations are SEND / RECEIVE /
 * MODIFY_PERMISSIONS / CREATE_IDENTIFIER / ...), so scheduling lives in the
 * app and executes real on-chain swaps through Keeta FX anchors.
 *
 * Unattended execution uses a dedicated *automation wallet* whose seed is
 * encrypted with a server-side key (AUTOMATION_KEY). The user funds that
 * wallet, so the blast radius of an automation is bounded by its balance.
 */
import { dbRead, dbWrite } from '../db';
import { capSpent, addCapSpend, dailyCapUsd } from '../agent/safety';

export type Automation =
  | {
      id: string;
      kind: 'alert';
      name: string;
      symbol: string; // ticker or address
      op: 'gt' | 'lt';
      valueUsd: number;
      enabled: boolean;
      createdAt: string;
      lastCheckedAt?: string;
      lastPriceUsd?: number;
      triggeredAt?: string;
      triggered?: boolean;
    }
  | {
      id: string;
      kind: 'recurring';
      name: string;
      fromToken: string;
      toToken: string;
      amount: string;
      everyMinutes: number;
      enabled: boolean;
      createdAt: string;
      nextRunAt: string;
      lastRunAt?: string;
      lastStatus?: 'executed' | 'failed' | 'skipped';
      lastMessage?: string;
    };

export interface AutomationLogEntry {
  id: string;
  at: string;
  automationId: string;
  kind: Automation['kind'];
  status: 'triggered' | 'executed' | 'failed' | 'skipped';
  message: string;
}

const KEY = 'automations';
const LOG_KEY = 'automationLog';

export async function listAutomations(): Promise<Automation[]> {
  return (await dbRead<Automation[]>(KEY)) ?? [];
}

export async function saveAutomations(list: Automation[]): Promise<void> {
  await dbWrite(KEY, list);
}

export async function upsertAutomation(a: Automation): Promise<Automation> {
  const list = await listAutomations();
  const idx = list.findIndex((x) => x.id === a.id);
  if (idx >= 0) list[idx] = a;
  else list.unshift(a);
  await saveAutomations(list.slice(0, 100));
  return a;
}

export async function removeAutomation(id: string): Promise<void> {
  const list = await listAutomations();
  await saveAutomations(list.filter((x) => x.id !== id));
}

export async function appendLog(entry: Omit<AutomationLogEntry, 'id' | 'at'>): Promise<void> {
  const log = (await dbRead<AutomationLogEntry[]>(LOG_KEY)) ?? [];
  log.unshift({ ...entry, id: crypto.randomUUID(), at: new Date().toISOString() });
  await dbWrite(LOG_KEY, log.slice(0, 200));
}

export async function listLog(limit = 50): Promise<AutomationLogEntry[]> {
  return ((await dbRead<AutomationLogEntry[]>(LOG_KEY)) ?? []).slice(0, limit);
}

export function nextRunAt(everyMinutes: number, from = Date.now()): string {
  return new Date(from + everyMinutes * 60_000).toISOString();
}

/** Minimum cadence: Hobby Vercel schedules can only fire every 15 minutes. */
export const MIN_EVERY_MINUTES = 15;

/** Per-automation spend ceiling (USD) — a single run may never exceed this. */
export const MAX_AUTOMATION_USD = 100;

export async function capRemainingUsd(): Promise<number> {
  const cap = await dailyCapUsd();
  const spent = await capSpent();
  return Math.max(0, cap - spent);
}

export async function recordSpend(usd: number): Promise<void> {
  if (usd > 0) await addCapSpend(usd);
}
