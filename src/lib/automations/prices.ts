/**
 * Price lookups for automations.
 *
 * KeeSpecs publishes free JSON reads (price, token search, token metadata).
 * For tokens without a direct price we fall back to the Keeta FX anchor
 * estimate against USDC.
 */
import { userClient, loadFXClient, getTokenInfo, fromDisplay } from '../keeta/network';
import { ephemeralAccount } from '../keeta/ephemeral';

const KEESPECS = process.env.KEESPECS_API ?? 'https://keespecs.xyz';

export const USDC_ADDRESS = 'keeta_amnkge74xitii5dsobstldatv3irmyimujfjotftx7plaaaseam4bntb7wnna';
export const USDC_DECIMALS = 6;

export interface TokenRef {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

interface KeeSpecsCandidate {
  address: string;
  name?: string;
  code?: string;
  description?: string;
  decimals?: number;
  isOfficial?: boolean;
}

/** Resolve a ticker or address to a Keeta token (KeeSpecs first, SDK fallback). */
export async function resolveToken(ref: string): Promise<TokenRef | null> {
  const query = ref.trim();

  try {
    const url = `${KEESPECS}/api/token/search?q=${encodeURIComponent(query)}&limit=5`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.ok) {
      const json = (await res.json()) as { candidates?: KeeSpecsCandidate[] };
      const hit = json.candidates?.find((c) => c.isOfficial) ?? json.candidates?.[0];
      if (hit?.address) {
        return {
          address: hit.address,
          symbol: hit.code ?? query.toUpperCase(),
          name: hit.name ?? query,
          decimals: hit.decimals ?? 18,
        };
      }
    }
  } catch {
    /* fall through to the SDK */
  }

  if (query.startsWith('keeta_')) {
    const info = await getTokenInfo(query).catch(() => null);
    if (info) {
      return {
        address: query,
        symbol: info.symbol,
        name: info.name,
        decimals: info.decimals ?? 18,
      };
    }
  }
  return null;
}

export interface PriceSnapshot {
  priceUsd: number;
  /** 24-hour change as a percentage, when the source reports one. */
  change24hPct: number | null;
}

/** Spot price in USD for a token, with the 24h change when it is available. */
export async function getTokenPrice(ref: string): Promise<PriceSnapshot | null> {
  const upper = ref.trim().toUpperCase();

  // KTA has a dedicated free price read on KeeSpecs.
  if (upper === 'KTA' || upper === '$KTA') {
    try {
      const res = await fetch(`${KEESPECS}/api/price`, { headers: { accept: 'application/json' } });
      if (res.ok) {
        const json = (await res.json()) as { priceUsd?: number; change24hPct?: number };
        if (typeof json.priceUsd === 'number') {
          return {
            priceUsd: json.priceUsd,
            change24hPct: typeof json.change24hPct === 'number' ? json.change24hPct : null,
          };
        }
      }
    } catch {
      /* fall through */
    }
  }

  const token = await resolveToken(ref);
  if (!token) return null;

  // Estimate one whole token against USDC through the FX anchor.
  await using client = userClient(ephemeralAccount());
  const fx = await loadFXClient(client);
  const raw = fromDisplay('1', token.decimals);
  const res = await fx.getQuotesOrEstimates({
    from: token.address,
    to: USDC_ADDRESS,
    amount: raw,
    affinity: 'from',
  } as unknown as Parameters<typeof fx.getQuotesOrEstimates>[0]);

  const first = res?.[0];
  if (!first) return null;
  const isQuote = (first as { isQuote: boolean }).isQuote;
  const converted = isQuote
    ? (first as { quote: { convertedAmount: bigint } }).quote.convertedAmount
    : (first as { estimate: { convertedAmount: bigint } }).estimate.convertedAmount;
  // The FX estimate is a spot price with no 24h history.
  return { priceUsd: Number(converted) / 10 ** USDC_DECIMALS, change24hPct: null };
}

/** Spot price in USD for a token. */
export async function getTokenPriceUsd(ref: string): Promise<number | null> {
  return (await getTokenPrice(ref))?.priceUsd ?? null;
}
