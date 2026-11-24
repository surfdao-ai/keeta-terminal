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
import { dbRead, dbUpdate, dbListKeys } from '../db';
import { capSpent, addCapSpend, dailyCapUsd } from '../agent/safety';

/** The pair's quote state as of the last check, refreshed every run. */
export interface PairLiquidity {
  state: 'quoted' | 'estimate-only' | 'unknown';
  at: string;
  /** Destination-side estimate, in display units, when only an estimate exists. */
  estimate?: string;
}

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
      /** Re-arm after firing so it notifies on every crossing, not just the first. */
      repeat?: boolean;
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
      /** Live state of the pair, refreshed each run so the card is never stale. */
      liquidity?: PairLiquidity;
    }
  | {
      id: string;
      kind: 'liquidity';
      name: string;
      fromToken: string;
      toToken: string;
      enabled: boolean;
      createdAt: string;
      /** One-shot: fires the first time the pair is quoting, then disarms. */
      armed?: boolean;
      lastCheckedAt?: string;
      lastState?: PairLiquidity['state'];
      lastFiredAt?: string;
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
 * The addresses that have automations — who the scheduler must evaluate.
 *
 * The truth is the automations rows themselves: every storage key embeds its
 * owner (`u:<address>:automations`), so the list is derived from the keys
 * when the backend can enumerate them (Postgres, file). That makes the list
 * *exact*: there is no cap to hit and no cache to drift, and an owner stays
 * schedulable for as long as a row exists.
 *
 * The capped `automationOwners` index is kept only as a fallback for
 * backends that cannot enumerate keys (Blob: keys are hashed into blob
 * paths). It is best-effort there — the cap can in theory evict an owner —
 * so it is also pruned as best the backend allows.
 */
const OWNERS_KEY = 'automationOwners';
/** The suffix of every owner's automations storage key (`u:<address>:automations`). */
const AUTOMATIONS_STORAGE_SUFFIX = `:${KEY}`;

/** Parse the owner address out of a `u:<address>:automations` key. */
function ownerFromKey(key: string): string | null {
  if (!key.startsWith('u:')) return null;
  const rest = key.slice(2);
  const sep = rest.indexOf(':');
  if (sep <= 0) return null;
  const owner = rest.slice(0, sep);
  // Addresses never contain ':'; a second separator means a malformed key.
  return owner.includes(':') ? null : owner;
}

/**
 * Reconcile the fallback index with the owners that actually have rows.
 *
 * The derivation is exhaustive — if an address is not in `known`, its
 * automations row is gone (deleted wallet, or the last automation removed),
 * so the index entry is stale and can be dropped without re-reading rows.
 */
async function syncOwnerIndex(known: string[]): Promise<void> {
  const raw = await dbRead<string[]>(OWNERS_KEY);
  const list = Array.isArray(raw) ? raw : [];
  const kept = list.filter((o) => known.includes(o));
  if (kept.length === list.length) return;
  await dbUpdate<string[]>(OWNERS_KEY, (current) => {
    const live = Array.isArray(current) ? current : [];
    return live.filter((o) => known.includes(o));
  });
}

export async function listAutomationOwners(): Promise<string[]> {
  // 1. Derive from the rows — exact and unbounded: an owner is schedulable
  //    for exactly as long as its row exists, with no cap to hit and no cache
  //    to drift.
  const keys = await dbListKeys({ prefix: 'u:', suffix: AUTOMATIONS_STORAGE_SUFFIX }).catch(
    () => null,
  );
  if (keys !== null) {
    const owners = [...new Set(keys.map(ownerFromKey).filter((o): o is string => Boolean(o)))];
    // Best-effort: keep the fallback index honest on this backend too.
    void syncOwnerIndex(owners).catch(() => undefined);
    return owners;
  }

  // 2. Backend cannot enumerate keys (Blob): fall back to the capped index.
  //    Ghosts (deleted wallets) are not pruned here — verifying each entry
  //    would cost a blob GET per owner, which the fallback does not justify.
  const raw = await dbRead<string[]>(OWNERS_KEY);
  return Array.isArray(raw) ? raw : [];
}

/**
 * Record that an owner has automations (for the non-enumerable fallback).
 *
 * Best-effort: on backends that derive the owner list from the rows this is a
 * no-op that costs nothing important, and on the Blob backend it is what
 * makes the sweep work at all.
 */
async function rememberOwner(owner: string): Promise<void> {
  await dbUpdate<string[]>(OWNERS_KEY, (current) => {
    const list = Array.isArray(current) ? current : [];
    if (list.includes(owner)) return list;
    return [owner, ...list].slice(0, 500);
  });
}

/** Forget an owner's index entry (wallet deletion). No-op when absent. */
export async function forgetAutomationOwner(owner: string): Promise<void> {
  await dbUpdate<string[]>(OWNERS_KEY, (current) => {
    const list = Array.isArray(current) ? current : [];
    return list.filter((o) => o !== owner);
  });
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
