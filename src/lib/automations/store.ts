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
import { dbRead, dbUpdate } from '../db';
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

export async function upsertAutomation(a: Automation): Promise<Automation> {
  // Compare-and-set: the UI editing one automation must not drop another.
  await dbUpdate<Automation[]>(KEY, (current) => {
    const list = current ?? [];
    const idx = list.findIndex((x) => x.id === a.id);
    if (idx >= 0) list[idx] = a;
    else list.unshift(a);
    return list.slice(0, 100);
  });
  return a;
}

export async function removeAutomation(id: string): Promise<void> {
  await dbUpdate<Automation[]>(KEY, (current) => (current ?? []).filter((x) => x.id !== id));
}

export async function appendLog(entry: Omit<AutomationLogEntry, 'id' | 'at'>): Promise<void> {
  await dbUpdate<AutomationLogEntry[]>(LOG_KEY, (current) => {
    const log = current ?? [];
    log.unshift({ ...entry, id: crypto.randomUUID(), at: new Date().toISOString() });
    return log.slice(0, 200);
  });
}

/**
 * Apply field-level patches to the stored automations.
 *
 * The runner works off a snapshot; writing that snapshot back would discard
 * anything the user changed meanwhile (or vice versa). Patching only the
 * fields the runner owns, compare-and-set, keeps both sides intact.
 */
export async function patchAutomations(patches: Map<string, Partial<Automation>>): Promise<void> {
  if (patches.size === 0) return;
  await dbUpdate<Automation[]>(KEY, (current) => {
    const live = current ?? [];
    for (const a of live) {
      const p = patches.get(a.id);
      if (p) Object.assign(a, p);
    }
    return live;
  });
}

/**
 * Patch a single automation. The caller supplies the values to set (not a
 * toggle), so a retry after a conflict cannot flip the field twice.
 */
export async function patchAutomation(
  id: string,
  fields: Partial<Automation>,
): Promise<Automation | null> {
  let updated: Automation | null = null;
  await dbUpdate<Automation[]>(KEY, (current) => {
    const list = current ?? [];
    const a = list.find((x) => x.id === id);
    if (!a) return list;
    Object.assign(a, fields);
    updated = a;
    return list;
  });
  return updated;
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
