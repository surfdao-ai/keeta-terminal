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

export interface SwapResult {
  ok: boolean;
  convertedAmount?: string;
  provider?: string;
  exchangeId?: string | null;
  usdValue: number;
  error?: string;
}

/** Rough USD value of a swap leg, used for cap accounting. */
export function usdValueOf(token: string, amountDisplay: string, tokenSymbol?: string): number {
  const sym = (tokenSymbol ?? '').toUpperCase();
  if (sym.includes('USD')) return Number(amountDisplay) || 0;
  return 0;
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
  const exchangeId = (exchange as { exchange?: { id?: string } })?.exchange?.id ?? null;

  return {
    ok: true,
    convertedAmount: convertedDisplay,
    provider: String(provider.provider?.providerID ?? 'unknown'),
    exchangeId,
    usdValue,
  };
}
