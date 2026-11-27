/**
 * Live rails — which Keeta pairs actually trade right now.
 *
 * The FX base anchor (keeta-stablecoin-fx-anchor.keeta.com) is the only venue
 * with binding quotes, and it only offers same-currency $K/$KB pegs (e.g.
 * KBUSD→KUSD at 1:1 + a small fee). Everything else — KTA, USDC, community
 * tokens — has no executable venue today, so surfacing the live set (instead
 * of pretending any pair might work) is the honest product state.
 *
 * The pair list is read from the anchor's own advertised service metadata
 * (the network is the source of truth); a known list is the fallback when the
 * metadata read fails. Each direction is probed with one nominal quote. The
 * result is cached for a couple of minutes: the list moves slowly and the UI
 * polls it from the Trade view and the Launchpad.
 */
import { loadFXClient, userClient, fromDisplay, toDisplay } from './network';
import { tokenDecimals, resolveTokenAddress } from './currencies';
import { ephemeralAccount } from './ephemeral';
import { BASE_ANCHOR_PROVIDER } from './routes';

export interface RailDirection {
  /** Symbols, for display: 'KBUSD', 'KUSD'. */
  from: string;
  to: string;
  fromAddress: string;
  toAddress: string;
  /** A provider returned a binding quote for this direction. */
  live: boolean;
  /** Quote of a nominal 1.0 `from`, in `to` display units. */
  rate: string | null;
  /** The provider fee in `from` display units, when the quote names one. */
  fee: string | null;
}

export interface LiveRails {
  asOf: string;
  provider: string;
  /** Every advertised direction, both ways per peg. */
  directions: RailDirection[];
  /** True when the metadata read fell back to the known list. */
  fromFallback: boolean;
}

const CACHE_TTL_MS = 2 * 60_000;
let cache: { at: number; rails: LiveRails } | null = null;
let inFlight: Promise<LiveRails> | null = null;

/**
 * The known peg currencies, in display order. Used only when the anchor's
 * advertised metadata cannot be read — the network list always wins.
 */
const KNOWN_PEGS: [string, string][] = [
  ['KBUSD', 'KUSD'],
  ['KBEUR', 'KEUR'],
  ['KBJPY', 'KJPY'],
  ['KBMXN', 'KMXN'],
  ['KBCAD', 'KCAD'],
  ['KBAED', 'KAED'],
  ['KBGBP', 'KGBP'],
  ['KBHKD', 'KHKD'],
  ['KBCNY', 'KCNY'],
];

/**
 * The anchor's advertised directed pair list, straight from its service
 * metadata. Returns null when the metadata cannot be read (caller falls back).
 */
async function advertisedPairs(fx: unknown): Promise<{ from: string; to: string }[] | null> {
  const inner = fx as {
    getBaseProvidersForConversion?: (req: object, opts?: object) => Promise<unknown[]>;
  };
  if (typeof inner.getBaseProvidersForConversion !== 'function') return null;
  try {
    // A conversion the anchor is known to advertise is enough to make it
    // return its full serviceInfo; forcing the provider keeps @pricing out.
    const kb = await resolveTokenAddress('KBUSD');
    const ku = await resolveTokenAddress('KUSD');
    if (!kb || !ku) return null;
    const providers = await inner.getBaseProvidersForConversion(
      { from: kb, to: ku, amount: '1000000', affinity: 'from' },
    );
    // Only the base anchor's own advertised list: the resolver also returns
    // @pricing (which advertises one giant token-to-token group), and we do
    // not want its cross-product.
    const anchor = (providers ?? []).find(
      (p) => (p as { providerID?: string }).providerID === BASE_ANCHOR_PROVIDER,
    );
    const groups = (anchor as { serviceInfo?: { from?: { currencyCodes?: string[]; to?: string[] }[] } } | undefined)
      ?.serviceInfo?.from;
    const pairs: { from: string; to: string }[] = [];
    for (const g of groups ?? []) {
      for (const c of g.currencyCodes ?? []) {
        for (const t of g.to ?? []) {
          if (c !== t) pairs.push({ from: c, to: t });
        }
      }
    }
    return pairs.length > 0 ? pairs : null;
  } catch {
    return null;
  }
}

/** One nominal quote per direction, in parallel. Read failure reads as quiet. */
async function probeDirections(
  fx: unknown,
  pairs: { from: string; to: string }[],
): Promise<RailDirection[]> {
  const inner = fx as {
    getQuotes: (x: object) => Promise<
      | null
      | {
          quote: {
            convertedAmount: bigint;
            cost?: { amount: bigint; token?: { publicKeyString?: { get(): string } } };
          };
        }[]
    >;
  };

  // Resolve every symbol/decimals up front (a bounded number of reads, mostly
  // cache hits) so the probes themselves are pure network calls in parallel.
  const meta = new Map<string, { dec: number; sym: string }>(
    await Promise.all(
      [...new Set(pairs.flatMap((p) => [p.from, p.to]))].map(
        async (addr): Promise<[string, { dec: number; sym: string }]> => [
          addr,
          { dec: (await tokenDecimals(addr)) ?? 6, sym: await symbolFor(addr) },
        ],
      ),
    ),
  );

  return Promise.all(
    pairs.map(async (pair): Promise<RailDirection> => {
      const fromDec = meta.get(pair.from)?.dec ?? 6;
      const toDec = meta.get(pair.to)?.dec ?? 6;
      const dir: RailDirection = {
        from: meta.get(pair.from)?.sym ?? pair.from.slice(0, 10),
        to: meta.get(pair.to)?.sym ?? pair.to.slice(0, 10),
        fromAddress: pair.from,
        toAddress: pair.to,
        live: false,
        rate: null,
        fee: null,
      };
      try {
        const quotes = await inner.getQuotes({
          from: pair.from,
          to: pair.to,
          amount: fromDisplay('1', fromDec),
          affinity: 'from',
        } as never);
        const q = quotes?.[0];
        if (q) {
          dir.live = true;
          dir.rate = toDisplay(q.quote.convertedAmount, toDec);
          const cost = q.quote.cost;
          if (cost && cost.amount > 0n) {
            dir.fee = toDisplay(cost.amount, fromDec);
          }
        }
      } catch {
        /* quiet */
      }
      return dir;
    }),
  );
}

async function symbolFor(address: string): Promise<string> {
  try {
    const { getTokenInfo } = await import('./network');
    const info = await getTokenInfo(address);
    return info.symbol || address.slice(0, 10);
  } catch {
    return address.slice(0, 10);
  }
}

async function buildRails(): Promise<LiveRails> {
  await using client = userClient(ephemeralAccount());
  const fx = await loadFXClient(client);

  let pairs = await advertisedPairs(fx);
  let fromFallback = false;
  if (!pairs) {
    fromFallback = true;
    const resolved: { from: string; to: string }[] = [];
    for (const [a, b] of KNOWN_PEGS) {
      const fa = await resolveTokenAddress(a);
      const fb = await resolveTokenAddress(b);
      if (fa && fb) resolved.push({ from: fa, to: fb }, { from: fb, to: fa });
    }
    pairs = resolved;
  }

  const directions = await probeDirections(fx, pairs);
  return { asOf: new Date().toISOString(), provider: BASE_ANCHOR_PROVIDER, directions, fromFallback };
}

/** The live rails, cached for a couple of minutes (single-flight). */
export async function getLiveRails(): Promise<LiveRails> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.rails;
  if (!inFlight) {
    inFlight = buildRails().then((rails) => {
      cache = { at: Date.now(), rails };
      inFlight = null;
      return rails;
    });
  }
  return inFlight;
}

/**
 * The cached rails without any network I/O — for call paths that must stay
 * fast (e.g. a no-liquidity message). Null when the cache is cold.
 */
export function cachedLiveRails(): LiveRails | null {
  return cache && Date.now() - cache.at < CACHE_TTL_MS ? cache.rails : null;
}

/** "KBUSD→KUSD, KBEUR→KEUR, …" — one line naming the live pegs, if any. */
export function livePegLine(rails: LiveRails): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const d of rails.directions) {
    if (!d.live) continue;
    const key = `${d.from}>${d.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(`${d.from}→${d.to}`);
    if (parts.length >= 8) break;
  }
  return parts.join(', ');
}
