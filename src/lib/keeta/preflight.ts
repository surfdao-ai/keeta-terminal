/**
 * Preflight: free KeeSpecs reads that turn into ONE line on the confirm card.
 *
 * Everything here is advisory. A check that cannot be read is skipped, never
 * blocks the trade, and the trade itself is decided by the user either way.
 * The reads are cheap and public; results are cached for a couple of minutes
 * server-side so the confirm step stays snappy.
 */
import { capSpent, dailyCapUsd } from '../agent/safety';
import type { PreflightCheck, PreflightResult } from './trade-types';

const KEESPECS_PRICE = 'https://keespecs.xyz/api/price';
const KEESPECS_PROVIDERS = 'https://keespecs.xyz/api/providers';

const CACHE_TTL_MS = 2 * 60_000;

interface KtaPrice {
  at: number;
  priceUsd: number | null;
  change24hPct: number | null;
  change1hPct: number | null;
}

interface ProviderList {
  at: number;
  ids: string[];
}

let priceCache: KtaPrice | null = null;
let providerCache: ProviderList | null = null;

async function fetchPrice(): Promise<KtaPrice> {
  if (priceCache && Date.now() - priceCache.at < CACHE_TTL_MS) return priceCache;
  const res = await fetch(KEESPECS_PRICE, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`keespecs price: ${res.status}`);
  const j = (await res.json()) as { priceUsd?: number; change24hPct?: number; change1hPct?: number };
  priceCache = {
    at: Date.now(),
    priceUsd: typeof j.priceUsd === 'number' ? j.priceUsd : null,
    change24hPct: typeof j.change24hPct === 'number' ? j.change24hPct : null,
    change1hPct: typeof j.change1hPct === 'number' ? j.change1hPct : null,
  };
  return priceCache;
}

async function fetchProviderIds(): Promise<string[]> {
  if (providerCache && Date.now() - providerCache.at < CACHE_TTL_MS) return providerCache.ids;
  const res = await fetch(KEESPECS_PROVIDERS, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`keespecs providers: ${res.status}`);
  const j = (await res.json()) as { providers?: { id?: string }[] };
  const ids = (Array.isArray(j.providers) ? j.providers : [])
    .map((p) => p?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  providerCache = { at: Date.now(), ids };
  return ids;
}

const fmtPct = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

/** Does this pair move KTA, in either direction? */
function touchesKta(fromSymbol: string, toSymbol: string): boolean {
  const has = (s: string) => s.toUpperCase() === 'KTA' || s.toUpperCase().includes('KEETA');
  return has(fromSymbol) || has(toSymbol);
}

/**
 * Run the free preflight reads for a trade the user is about to confirm.
 *
 * Never throws — a failed read simply skips its check. `costUsd` is the
 * trade's USD value (0 when neither side is a dollar coin).
 */
export async function runPreflight(input: {
  owner: string;
  fromSymbol: string;
  toSymbol: string;
  providerId: string;
  costUsd: number;
}): Promise<PreflightResult> {
  const { owner, fromSymbol, toSymbol, providerId, costUsd } = input;
  const checks: PreflightCheck[] = [];

  // 1. KTA volatility — matters when KTA is one leg of the trade.
  if (touchesKta(fromSymbol, toSymbol)) {
    try {
      const p = await fetchPrice();
      const c24 = p.change24hPct;
      const c1 = p.change1hPct;
      const volatile = (c24 !== null && Math.abs(c24) >= 5) || (c1 !== null && Math.abs(c1) >= 2);
      checks.push({
        id: 'kta',
        level: volatile ? 'warn' : 'ok',
        text:
          c24 !== null
            ? `KTA ${fmtPct(c24)}/24h${c1 !== null ? ` · ${fmtPct(c1)}/1h` : ''}`
            : 'KTA price n/a',
      });
    } catch {
      checks.push({ id: 'kta', level: 'skip', text: 'KTA price unreadable' });
    }
  }

  // 2. Provider health — is the routing provider in the published list?
  //    (An empty `movement` is not an outage, per KeeSpecs; only absence is.)
  try {
    const ids = await fetchProviderIds();
    const known = ids.includes(providerId);
    checks.push({
      id: 'provider',
      level: known ? 'ok' : 'warn',
      text: known ? 'provider active' : 'provider not in published list',
    });
  } catch {
    checks.push({ id: 'provider', level: 'skip', text: 'provider list unreadable' });
  }

  // 3. Cap headroom — does this trade eat a big share of today's remaining cap?
  if (costUsd > 0) {
    try {
      const spent = await capSpent(owner);
      const cap = await dailyCapUsd(owner);
      const remaining = Math.max(0, cap - spent);
      const share = remaining > 0 ? costUsd / remaining : 1;
      checks.push({
        id: 'cap',
        level: share >= 0.5 ? 'warn' : 'ok',
        text:
          remaining <= 0
            ? 'daily cap exhausted'
            : `uses ${Math.min(999, Math.round(share * 100))}% of remaining cap`,
      });
    } catch {
      checks.push({ id: 'cap', level: 'skip', text: 'cap unreadable' });
    }
  }

  const warnings = checks.filter((c) => c.level === 'warn');
  const line =
    warnings.length > 0
      ? `preflight warnings — ${warnings.map((c) => c.text).join(' · ')}`
      : `preflight ok — ${checks.map((c) => c.text).join(' · ')}`;

  return { level: warnings.length > 0 ? 'warn' : 'ok', checks, line };
}
