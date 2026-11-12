/**
 * Keeta network layer — client construction, decimals, token metadata.
 */
import * as KeetaNet from '@keetanetwork/keetanet-client';
import type * as KeetaAnchor from '@keetanetwork/anchor';

export type KeetaAccount = InstanceType<typeof KeetaNet.lib.Account>;
export type KeetaUserClient = InstanceType<typeof KeetaNet.UserClient>;

/** Normalize a user/LLM-provided token reference to what the anchor resolver expects. */
export function normalizeToken(ref: string): string {
  const t = ref.trim();
  if (t.startsWith('keeta_') || t.startsWith('$')) return t;
  return `$${t.toUpperCase()}`;
}

export function networkAlias(): 'main' | 'test' {
  return process.env.KEETA_NETWORK === 'test' ? 'test' : 'main';
}

/** Open a UserClient. Caller must `destroy()` (or `await using`) when done. */
export function userClient(account: KeetaAccount | null): KeetaUserClient {
  return KeetaNet.UserClient.fromNetwork(networkAlias(), account as never);
}

export const KTA_DECIMALS = 18;

/** Token metadata carries decimals as base64 JSON {"decimalPlaces": n}. */
export function decimalsFromMetadata(metadata: string | null | undefined): number | null {
  if (!metadata) return null;
  try {
    const json = JSON.parse(Buffer.from(metadata, 'base64').toString('utf8')) as {
      decimalPlaces?: number;
    };
    return typeof json.decimalPlaces === 'number' ? json.decimalPlaces : null;
  } catch {
    return null;
  }
}

export function toDisplay(raw: bigint, decimals: number | null, fallback = 18): string {
  const d = decimals ?? fallback;
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(d);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(d, '0').slice(0, Math.min(d, 8));
  const s = frac ? `${whole}.${frac}` : whole.toString();
  return negative ? `-${s}` : s;
}

export function fromDisplay(display: string, decimals: number | null, fallback = 18): bigint {
  const d = decimals ?? fallback;
  const clean = display.replace(/[,_\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(clean)) throw new Error(`Invalid amount: ${display}`);
  const negative = clean.startsWith('-');
  const [whole, frac = ''] = clean.replace('-', '').split('.');
  const fracPadded = frac.padEnd(d, '0').slice(0, d);
  let raw = BigInt(whole || '0') * 10n ** BigInt(d) + BigInt(fracPadded || '0');
  if (negative) raw = -raw;
  return raw;
}

interface TokenInfoLite {
  address: string;
  symbol: string;
  name: string;
  description: string;
  decimals: number | null;
  supply: string | null;
}

/** Read token metadata + supply for a token address (read-only client). */
export async function getTokenInfo(address: string): Promise<TokenInfoLite> {
  await using client = KeetaNet.Client.fromNetwork(networkAlias());
  const info = (await client.getAccountInfo(address)) as {
    info?: { name?: string; description?: string; metadata?: string };
    supply?: bigint;
  };
  let supply: bigint | null = null;
  try {
    supply = await client.getTokenSupply(address);
  } catch {
    supply = null;
  }
  return {
    address,
    symbol: info?.info?.name || '?',
    name: info?.info?.name || '?',
    description: info?.info?.description || '',
    decimals: decimalsFromMetadata(info?.info?.metadata),
    supply: supply !== null ? supply.toString() : null,
  };
}

/**
 * Format an FX quote/estimate payload for LLM + UI consumption.
 */
export function summarizeQuote(
  q: {
    isQuote: boolean;
    quote?: { convertedAmount: bigint; cost?: { amount: bigint; token?: { publicKeyString?: { get(): string } } } } | null;
    estimate?: { convertedAmount: bigint; convertedAmountBound?: [bigint, bigint] } | null;
    request?: { from?: unknown; to?: unknown; amount?: bigint };
  },
  fromDecimals: number | null,
  toDecimals: number | null,
) {
  const converted = q.isQuote ? q.quote?.convertedAmount : q.estimate?.convertedAmount;
  const bound = q.estimate?.convertedAmountBound;
  return {
    kind: q.isQuote ? 'binding-quote' : 'estimate',
    convertedAmountDisplay: converted !== undefined ? toDisplay(converted, toDecimals) : null,
    convertedAmountBoundDisplay:
      bound && bound.length === 2
        ? [toDisplay(bound[0], toDecimals), toDisplay(bound[1], toDecimals)]
        : null,
    feeDisplay:
      q.quote?.cost?.amount !== undefined
        ? `${toDisplay(q.quote.cost.amount, null)} (${String(q.quote.cost.token?.publicKeyString?.get?.() ?? '')})`
        : null,
  };
}

/** Type helper for anchor FX client. */
export type FXClient = InstanceType<typeof KeetaAnchor.FX.Client>;

export async function loadFXClient(client: KeetaUserClient): Promise<FXClient> {
  const anchor = await import('@keetanetwork/anchor');
  return new anchor.FX.Client(client, { root: client.networkAddress }) as unknown as FXClient;
}
