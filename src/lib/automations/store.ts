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
      lastStatus?: 'executed' | 'submitted' | 'proposed' | 'failed' | 'skipped';
      lastMessage?: string;
      /** USD value of the last swap, so a pending one can be capped on settle. */
      usdValue?: number;
      /** Exchange id of a swap that was submitted but has not settled yet. */
      lastExchangeId?: string | null;
      /** FX provider that accepted the pending swap. */
      lastProviderId?: string | null;
    };

export interface AutomationLogEntry {
  id: string;
  at: string;
  automationId: string;
  kind: Automation['kind'];
  status: 'triggered' | 'executed' | 'submitted' | 'proposed' | 'failed' | 'skipped';
  message: string;
}

const KEY = 'automations';
const LOG_KEY = 'automationLog';

export async function listAutomations(owner: string): Promise<Automation[]> {
  const raw = await dbRead<Automation[]>(KEY, owner);
  // A malformed record must not take the runner down.
  return Array.isArray(raw) ? raw : [];
}

export async function upsertAutomation(owner: string, a: Automation): Promise<Automation> {
  // Compare-and-set: the UI editing one automation must not drop another.
  await dbUpdate<Automation[]>(
    KEY,
    (current) => {
      const list = Array.isArray(current) ? current : [];
      const idx = list.findIndex((x) => x.id === a.id);
      if (idx >= 0) list[idx] = a;
      else list.unshift(a);
      return list.slice(0, 100);
    },
    { owner },
  );
  await rememberOwner(owner);
  return a;
}

export async function removeAutomation(owner: string, id: string): Promise<void> {
  await dbUpdate<Automation[]>(
    KEY,
    (current) => (Array.isArray(current) ? current : []).filter((x) => x.id !== id),
    { owner },
  );
}

export async function appendLog(
  owner: string,
  entry: Omit<AutomationLogEntry, 'id' | 'at'>,
): Promise<void> {
  await dbUpdate<AutomationLogEntry[]>(
    LOG_KEY,
    (current) => {
      const log = Array.isArray(current) ? current : [];
      log.unshift({ ...entry, id: crypto.randomUUID(), at: new Date().toISOString() });
      return log.slice(0, 200);
    },
    { owner },
  );
}

/**
 * Apply field-level patches to the stored automations.
 *
 * The runner works off a snapshot; writing that snapshot back would discard
 * anything the user changed meanwhile (or vice versa). Patching only the
 * fields the runner owns, compare-and-set, keeps both sides intact.
 */
export async function patchAutomations(
  owner: string,
  patches: Map<string, Partial<Automation>>,
): Promise<void> {
  if (patches.size === 0) return;
  await dbUpdate<Automation[]>(
    KEY,
    (current) => {
      const live = Array.isArray(current) ? current : [];
      for (const a of live) {
        const p = patches.get(a.id);
        if (p) Object.assign(a, p);
      }
      return live;
    },
    { owner },
  );
}

/**
 * Patch a single automation. The caller supplies the values to set (not a
 * toggle), so a retry after a conflict cannot flip the field twice.
 */
export async function patchAutomation(
  owner: string,
  id: string,
  fields: Partial<Automation>,
): Promise<Automation | null> {
  let updated: Automation | null = null;
  await dbUpdate<Automation[]>(
    KEY,
    (current) => {
      const list = Array.isArray(current) ? current : [];
      const a = list.find((x) => x.id === id);
      if (!a) return list;
      Object.assign(a, fields);
      updated = a;
      return list;
    },
    { owner },
  );
  return updated;
}

export async function listLog(owner: string, limit = 50): Promise<AutomationLogEntry[]> {
  const raw = await dbRead<AutomationLogEntry[]>(LOG_KEY, owner);
  return (Array.isArray(raw) ? raw : []).slice(0, limit);
}

/**
 * The addresses that have automations.
 *
 * The scheduler needs to know whose automations to evaluate; this index holds
 * public addresses only — no keys, no state.
 */
const OWNERS_KEY = 'automationOwners';

async function rememberOwner(owner: string): Promise<void> {
  await dbUpdate<string[]>(OWNERS_KEY, (current) => {
    const list = Array.isArray(current) ? current : [];
    if (list.includes(owner)) return list;
    return [owner, ...list].slice(0, 500);
  });
}

export async function listAutomationOwners(): Promise<string[]> {
  const raw = await dbRead<string[]>(OWNERS_KEY);
  return Array.isArray(raw) ? raw : [];
}

export function nextRunAt(everyMinutes: number, from = Date.now()): string {
  return new Date(from + everyMinutes * 60_000).toISOString();
}

/** Minimum cadence: Hobby Vercel schedules can only fire every 15 minutes. */
export const MIN_EVERY_MINUTES = 15;

/** Per-automation spend ceiling (USD) — a single run may never exceed this. */
export const MAX_AUTOMATION_USD = 100;

export async function capRemainingUsd(owner: string): Promise<number> {
  const cap = await dailyCapUsd(owner);
  const spent = await capSpent(owner);
  return Math.max(0, cap - spent);
}

export async function recordSpend(owner: string, usd: number): Promise<void> {
  if (usd > 0) await addCapSpend(owner, usd);
}
