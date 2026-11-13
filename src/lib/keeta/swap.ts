/**
 * Shared atomic-swap execution against Keeta FX anchors.
 *
 * Used by the manual confirm flow and by unattended automations. The caller is
 * responsible for any cap checks; this function only refuses to trade when no
 * binding quote is available.
 */
import { userClient, loadFXClient, toDisplay, fromDisplay, getTokenInfo } from './network';
import type { KeetaAccount } from './network';

export interface SwapRequest {
  from: string; // token address or currency code (already normalised)
  to: string;
  amount: string; // display units
  affinity: 'from' | 'to';
}

/**
 * How far the swap got:
 *   completed — settled on-chain (blockhash present)
 *   pending   — the provider accepted the exchange, settlement not final yet
 *   failed    — the provider rejected it
 */
export type SwapStatus = 'completed' | 'pending' | 'failed';

export interface SwapResult {
  ok: boolean;
  status?: SwapStatus;
  convertedAmount?: string;
  provider?: string;
  exchangeId?: string | null;
  blockhash?: string | null;
  usdValue: number;
  error?: string;
}

/** Rough USD value of a swap leg, used for cap accounting. */
export function usdValueOf(token: string, amountDisplay: string, tokenSymbol?: string): number {
  const sym = (tokenSymbol ?? '').toUpperCase();
  if (sym.includes('USD')) return Number(amountDisplay) || 0;
  return 0;
}

interface ExchangeShape {
  ok?: boolean;
  error?: string;
  exchangeID?: string;
  status?: string;
  blockhash?: string;
  exchange?: { exchangeID?: string; status?: string; blockhash?: string };
}

/** Read the exchange id and status out of the provider's response. */
export function readExchange(result: unknown): {
  exchangeId: string | null;
  status: SwapStatus | 'unknown';
  blockhash: string | null;
} {
  const r = (result ?? {}) as ExchangeShape;
  // The SDK's type says { provider, exchange }, but the implementation returns
  // the raw response — support both shapes.
  const ex = r.exchange ?? r;
  const raw = String(ex.status ?? '').toLowerCase();
  const status: SwapStatus | 'unknown' =
    raw === 'completed' || raw === 'pending' || raw === 'failed' ? (raw as SwapStatus) : 'unknown';
  return {
    exchangeId: ex.exchangeID ?? null,
    status,
    blockhash: ex.blockhash ?? null,
  };
}

export async function executeSwap(
  account: KeetaAccount,
  req: SwapRequest,
): Promise<SwapResult> {
  const { from, to, amount, affinity } = req;
  const fromInfo = await getTokenInfo(from).catch(() => ({ decimals: null, symbol: '' }));
  const toInfo = await getTokenInfo(to).catch(() => ({ decimals: null, symbol: '' }));
  const rawAmount = fromDisplay(amount, fromInfo.decimals);

  await using client = userClient(account);
  const fx = await loadFXClient(client);

  const quotes = await fx.getQuotes({
    from,
    to,
    amount: rawAmount,
    affinity,
  } as unknown as Parameters<typeof fx.getQuotes>[0]);

  if (!quotes || quotes.length === 0) {
    return {
      ok: false,
      status: 'failed',
      usdValue: 0,
      error: 'No binding quotes available right now (estimates only).',
    };
  }

  const provider = quotes[0];
  const quote = provider.quote;
  const convertedDisplay = toDisplay(quote.convertedAmount, toInfo.decimals);

  const usdValue =
    usdValueOf(to, convertedDisplay, toInfo.symbol) || usdValueOf(from, amount, fromInfo.symbol);

  const exchange = await (
    provider as { createExchange: (i: unknown) => Promise<unknown> }
  ).createExchange({ quote });
  const { exchangeId, status, blockhash } = readExchange(exchange);

  if (status === 'failed') {
    return {
      ok: false,
      status: 'failed',
      convertedAmount: convertedDisplay,
      provider: String(provider.provider?.providerID ?? 'unknown'),
      exchangeId,
      usdValue,
      error: 'The FX provider rejected the exchange.',
    };
  }

  return {
    ok: true,
    status: status === 'unknown' ? 'completed' : status,
    convertedAmount: convertedDisplay,
    provider: String(provider.provider?.providerID ?? 'unknown'),
    exchangeId,
    blockhash,
    usdValue,
  };
}

/**
 * Check whether an exchange we submitted earlier has settled.
 *
 * The exchange status lives on the FX *provider* that handled it, so the
 * provider is resolved from the conversion again and matched by its id.
 */
export async function exchangeStatus(
  account: KeetaAccount,
  exchangeId: string,
  req: SwapRequest,
  providerId?: string | null,
): Promise<{ status: SwapStatus | 'unknown'; blockhash: string | null }> {
  const fromInfo = await getTokenInfo(req.from).catch(() => ({ decimals: null }));
  const rawAmount = fromDisplay(req.amount, fromInfo.decimals);

  await using client = userClient(account);
  const fx = await loadFXClient(client);

  const providers = await fx.getBaseProvidersForConversion({
    from: req.from,
    to: req.to,
    amount: rawAmount,
    affinity: req.affinity,
  } as unknown as Parameters<typeof fx.getBaseProvidersForConversion>[0]);

  const provider =
    providers?.find((p) => String(p.providerID) === String(providerId)) ?? providers?.[0];
  if (!provider) return { status: 'unknown', blockhash: null };

  const res = await provider.getExchangeStatus(exchangeId);
  const { status, blockhash } = readExchange(res);
  return { status, blockhash };
}
