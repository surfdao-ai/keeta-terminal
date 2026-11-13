/**
 * Watchlist — the tokens you keep an eye on.
 *
 * Separate from the alert automations: a watch entry is a token with a live
 * price snapshot, and it may carry a threshold that also creates (or updates)
 * an alert automation so the terminal tells you when the price crosses it.
 *
 * Prices come from the free KeeSpecs read for KTA and from the FX anchor
 * estimate for everything else.
 */
import { dbRead, dbUpdate } from '../db';
import { getTokenPrice, resolveToken } from './prices';

const KEY = 'watchlist';

export interface WatchEntry {
  id: string;
  /** What the user typed: a ticker or a token address. */
  symbol: string;
  /** The resolved Keeta token address, when we could resolve it. */
  address?: string;
  label?: string;
  lastPriceUsd?: number;
  lastChange24hPct?: number | null;
  lastCheckedAt?: string;
  createdAt: string;
}

export async function listWatchlist(): Promise<WatchEntry[]> {
  const raw = await dbRead<WatchEntry[]>(KEY);
  return Array.isArray(raw) ? raw : [];
}

/** Add a token to the watchlist. Returns null when it is already watched. */
export async function addWatch(symbolRaw: string): Promise<WatchEntry | null> {
  const symbol = symbolRaw.trim();
  if (!symbol) return null;

  const list = await listWatchlist();
  if (list.some((w) => w.symbol.toLowerCase() === symbol.toLowerCase())) return null;

  let address: string | undefined;
  let label: string | undefined;
  try {
    const token = await resolveToken(symbol);
    if (token) {
      address = token.address;
      label = token.name || token.symbol;
    }
  } catch {
    /* the ticker may not resolve — keep the raw symbol */
  }

  const entry: WatchEntry = {
    id: crypto.randomUUID(),
    symbol,
    ...(address ? { address } : {}),
    ...(label ? { label } : {}),
    createdAt: new Date().toISOString(),
  };
  await dbUpdate<WatchEntry[]>(KEY, (current) => {
    const existing = Array.isArray(current) ? current : [];
    if (existing.some((w) => w.symbol.toLowerCase() === symbol.toLowerCase())) return existing;
    return [entry, ...existing].slice(0, 50);
  });
  return entry;
}

export async function removeWatch(id: string): Promise<void> {
  await dbUpdate<WatchEntry[]>(KEY, (current) =>
    (Array.isArray(current) ? current : []).filter((w) => w.id !== id),
  );
}

/** Refresh the price snapshot of every entry. */
export async function refreshWatchlist(): Promise<WatchEntry[]> {
  const list = await listWatchlist();
  if (!list.length) return [];

  const priced = await Promise.all(
    list.map(async (w) => {
      try {
        const price = await getTokenPrice(w.address ?? w.symbol);
        if (!price) return w;
        return {
          ...w,
          lastPriceUsd: price.priceUsd,
          lastChange24hPct: price.change24hPct,
          lastCheckedAt: new Date().toISOString(),
        };
      } catch {
        return w;
      }
    }),
  );

  await dbUpdate<WatchEntry[]>(KEY, (current) => {
    const live = Array.isArray(current) ? current : [];
    // Keep the entries the user added while we were fetching prices.
    const merged = live.map((w) => priced.find((p) => p.id === w.id) ?? w);
    const added = priced.filter((p) => !live.some((w) => w.id === p.id));
    return [...added, ...merged].slice(0, 50);
  });
  return priced;
}
