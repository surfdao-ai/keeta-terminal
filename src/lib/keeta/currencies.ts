/**
 * Token reference resolution.
 *
 * The FX anchor works with symbols like `$USDC`, but the ledger works with
 * token addresses, and each token has its own number of decimals (KTA has 18,
 * the stablecoins have 6). Getting the decimals wrong means an amount is
 * off by a factor of a trillion, so every amount that crosses from a display
 * value to a raw value is resolved through here first.
 */
import { getTokenInfo } from './network';

const CURRENCY_MAP_URL = 'https://static.network.keeta.com/metadata/currencyMap';

let currencyMap: Record<string, string> | null = null;
let mapPromise: Promise<Record<string, string>> | null = null;

/** The official currency map: `$USDC` -> the token address. */
async function loadCurrencyMap(): Promise<Record<string, string>> {
  if (currencyMap) return currencyMap;
  if (!mapPromise) {
    mapPromise = (async () => {
      try {
        const res = await fetch(CURRENCY_MAP_URL, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`currency map: ${res.status}`);
        const json = (await res.json()) as Record<string, string>;
        currencyMap = json ?? {};
        return currencyMap;
      } catch {
        currencyMap = {};
        return currencyMap;
      } finally {
        mapPromise = null;
      }
    })();
  }
  return mapPromise;
}

/**
 * Resolve a token reference to its address.
 *
 * Accepts a raw address, a `$SYMBOL` or a bare `SYMBOL`.
 */
export async function resolveTokenAddress(ref: string): Promise<string | null> {
  const raw = ref.trim();
  if (!raw) return null;
  if (raw.startsWith('keeta_')) return raw;

  const symbol = raw.startsWith('$') ? raw.toUpperCase() : `$${raw.toUpperCase()}`;
  const map = await loadCurrencyMap();
  return map[symbol] ?? null;
}

const decimalsCache = new Map<string, number | null>();

/**
 * The number of decimals for a token reference.
 *
 * `null` when the token cannot be resolved — callers then use their own
 * fallback rather than guessing.
 */
export async function tokenDecimals(ref: string): Promise<number | null> {
  const address = await resolveTokenAddress(ref);
  if (!address) return null;
  if (decimalsCache.has(address)) return decimalsCache.get(address) ?? null;

  let decimals: number | null = null;
  try {
    const info = await getTokenInfo(address);
    decimals = info.decimals ?? null;
  } catch {
    decimals = null;
  }
  decimalsCache.set(address, decimals);
  return decimals;
}

/** The symbol of a token reference, for display. */
export async function tokenSymbol(ref: string): Promise<string> {
  const address = await resolveTokenAddress(ref);
  if (!address) return ref.trim();
  try {
    const info = await getTokenInfo(address);
    return info.symbol || ref.trim();
  } catch {
    return ref.trim();
  }
}
