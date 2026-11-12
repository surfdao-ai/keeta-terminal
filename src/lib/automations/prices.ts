/**
 * Price lookups for automations.
 *
 * KeeSpecs publishes free JSON reads (price, token search, token metadata).
 * For tokens without a direct price we fall back to the Keeta FX anchor
 * estimate against USDC.
 */
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { userClient, loadFXClient, getTokenInfo, fromDisplay } from '../keeta/network';

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

/** Spot price in USD for a token. */
export async function getTokenPriceUsd(ref: string): Promise<number | null> {
  const upper = ref.trim().toUpperCase();

  // KTA has a dedicated free price read on KeeSpecs.
  if (upper === 'KTA' || upper === '$KTA') {
    try {
      const res = await fetch(`${KEESPECS}/api/price`, { headers: { accept: 'application/json' } });
      if (res.ok) {
        const json = (await res.json()) as { priceUsd?: number };
        if (typeof json.priceUsd === 'number') return json.priceUsd;
      }
    } catch {
      /* fall through */
    }
  }

  const token = await resolveToken(ref);
  if (!token) return null;

  // Estimate one whole token against USDC through the FX anchor.
  const acct = KeetaNet.lib.Account.fromSeed(
    KeetaNet.lib.Account.generateRandomSeed({ asString: true }),
    0,
  );
  await using client = userClient(acct);
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
  return Number(converted) / 10 ** USDC_DECIMALS;
}
