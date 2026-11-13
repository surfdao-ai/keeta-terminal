/**
 * Trades: the server proposes, the browser signs.
 *
 * Nothing here ever holds a key. Preparing a trade asks the FX providers for a
 * binding quote (no key needed) and returns an *intent* — everything the
 * browser needs to build and sign the swap block itself. The browser signs
 * and posts back only the signed block; this server forwards it to the
 * provider.
 */
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { loadFXClient, userClient, toDisplay, fromDisplay } from './network';
import { tokenDecimals, tokenSymbol, resolveTokenAddress } from './currencies';
import { loadPending, capSpent, dailyCapUsd, appendTrade, removePending, type PendingTrade } from '../agent/safety';
import { ephemeralAccount } from './ephemeral';
import type { TradeIntent } from './trade-types';

export type { TradeIntent, TradeSummary } from './trade-types';

interface ProviderShape {
  providerID?: unknown;
  account?: { publicKeyString?: { get(): string } };
  /** The provider's operations: each is a getter that yields the URL builder. */
  serviceInfo?: { operations?: Record<string, unknown> };
  quote?: unknown;
}

/**
 * The URL of one of a provider's operations.
 *
 * The SDK exposes each operation as an async getter that resolves to a
 * function building the URL (it substitutes {placeholders} from its
 * parameters), so the URL has to be resolved in two steps.
 */
async function operationUrl(provider: ProviderShape, operation: string): Promise<string> {
  const entry = provider.serviceInfo?.operations?.[operation];
  if (!entry) return '';
  const builder = await entry;
  if (typeof builder === 'function') {
    try {
      return String((builder as () => unknown)());
    } catch {
      return '';
    }
  }
  return typeof builder === 'string' ? builder : '';
}

function pubOf(account: unknown): string {
  const a = account as { publicKeyString?: { get(): string } } | undefined;
  try {
    return a?.publicKeyString?.get() ?? '';
  } catch {
    return '';
  }
}

/**
 * The dollar value of a swap, when one side is a dollar currency.
 *
 * The amount is already in display units here, so the value is simply the
 * amount on the dollar side.
 */
async function usdValue(
  from: string,
  to: string,
  amount: string,
  receive: string,
): Promise<number> {
  const [fromSymbol, toSymbol] = await Promise.all([tokenSymbol(from), tokenSymbol(to)]);
  const receiveNum = Number(receive);
  if (/USD/i.test(toSymbol)) return receiveNum;
  if (/USD/i.test(fromSymbol)) return Number(amount);
  return 0;
}

/**
 * Build the intent for a pending trade: a binding quote plus the fields the
 * browser needs to construct the block.
 */
export async function buildSwapIntent(
  owner: string,
  tradeId: string,
): Promise<{ intent: TradeIntent; pending: PendingTrade }> {
  const pending = await loadPending(owner, tradeId);
  if (!pending) throw new Error('Trade proposal not found or already used.');
  if (pending.kind !== 'swap') throw new Error('That proposal is not a swap.');

  // A throwaway account is enough to ask for a quote — no user key involved.
  await using client = userClient(ephemeralAccount());
  const fx = await loadFXClient(client);

  // The decimals decide the raw amount, so they have to be the token's real
  // ones (KTA has 18, the stablecoins have 6).
  const fromDecimals = await tokenDecimals(pending.fromToken);
  const toDecimals = await tokenDecimals(pending.toToken);
  const rawAmount = fromDisplay(pending.amount, fromDecimals);

  const quotes = await fx.getQuotes({
    from: pending.fromToken,
    to: pending.toToken,
    amount: rawAmount,
    affinity: pending.affinity,
  } as unknown as Parameters<typeof fx.getQuotes>[0]);

  const withQuote = quotes?.[0];
  if (!withQuote) {
    throw new Error('No provider is issuing a binding quote for this pair right now.');
  }

  const provider = withQuote.provider as unknown as ProviderShape;
  const quote = withQuote.quote as unknown as {
    request: { from: string; to: string; amount: bigint; affinity: 'from' | 'to' };
    account: unknown;
    convertedAmount: bigint;
    cost: { amount: bigint; token: unknown };
  };

  const { toJSONSerializable } = KeetaNet.lib.Utils.Conversion;
  const serializedQuote = toJSONSerializable({ quote: withQuote.quote });

  const convertedDisplay = toDisplay(quote.convertedAmount, toDecimals);
  const costUsd = await usdValue(
    pending.fromToken,
    pending.toToken,
    pending.amount,
    convertedDisplay,
  );

  // The browser builds the block from token addresses, so resolve the
  // references the proposal was made with ($KTA, $KBUSD, keeta_…) here.
  const fromAddress = (await resolveTokenAddress(pending.fromToken)) ?? pending.fromToken;
  const toAddress = (await resolveTokenAddress(pending.toToken)) ?? pending.toToken;

  const intent: TradeIntent = {
    tradeId,
    kind: 'swap',
    from: fromAddress,
    to: toAddress,
    fromSymbol: await tokenSymbol(pending.fromToken),
    toSymbol: await tokenSymbol(pending.toToken),
    amount: pending.amount,
    rawAmount: rawAmount.toString(),
    affinity: pending.affinity,
    providerAccount: pubOf(quote.account),
    convertedAmount: quote.convertedAmount.toString(),
    costAmount: quote.cost?.amount?.toString() ?? '0',
    costToken: pubOf(quote.cost?.token) || null,
    quote: serializedQuote,
    createExchangeUrl: await operationUrl(provider, 'createExchange'),
    summary: {
      from: await tokenSymbol(pending.fromToken),
      to: await tokenSymbol(pending.toToken),
      amount: pending.amount,
      receive: convertedDisplay,
      provider: String(provider.providerID ?? 'unknown'),
      costUsd,
    },
  };

  if (!intent.createExchangeUrl) {
    throw new Error('The FX provider did not publish a createExchange endpoint.');
  }

  return { intent, pending };
}

/**
 * Forward a browser-signed block to the FX provider.
 *
 * The block was signed in the browser; this server never had the key.
 */
export async function submitSignedSwap(
  owner: string,
  intent: TradeIntent,
  signedBlockBase64: string,
): Promise<{
  ok: boolean;
  status: string;
  exchangeId: string | null;
  convertedAmount: string;
  error?: string;
}> {
  const body = {
    request: {
      ...(intent.quote as Record<string, unknown>),
      block: signedBlockBase64,
    },
  };

  const res = await fetch(intent.createExchangeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      status: 'failed',
      exchangeId: null,
      convertedAmount: intent.summary.receive,
      error: `The FX provider rejected the exchange: ${text.slice(0, 200)}`,
    };
  }

  let json: {
    ok?: boolean;
    error?: string;
    exchangeID?: string;
    status?: string;
    blockhash?: string;
  };
  try {
    json = JSON.parse(text);
  } catch {
    json = {};
  }

  if (json.ok === false) {
    return {
      ok: false,
      status: 'failed',
      exchangeId: null,
      convertedAmount: intent.summary.receive,
      error: json.error ?? 'The FX provider rejected the exchange.',
    };
  }

  // The provider answers 'completed' once the swap has settled, 'pending'
  // while it settles, and anything else means it did not happen.
  const status = json.status ?? 'completed';
  const exchangeId = json.exchangeID ?? null;
  const settled = status === 'completed';
  const pending = status === 'pending';

  // Only a settled swap counts against the daily cap.
  const cap = await dailyCapUsd(owner);
  const spent = await capSpent(owner);
  if (settled && intent.summary.costUsd > 0 && spent + intent.summary.costUsd > cap) {
    return {
      ok: false,
      status: 'failed',
      exchangeId,
      convertedAmount: intent.summary.receive,
      error: `Daily cap exceeded: ${spent.toFixed(2)} + ${intent.summary.costUsd.toFixed(2)} > ${cap}`,
    };
  }

  await appendTrade(owner, {
    id: intent.tradeId,
    kind: 'swap',
    fromToken: intent.from,
    toToken: intent.to,
    amount: intent.amount,
    affinity: intent.affinity,
    convertedAmount: intent.summary.receive,
    provider: intent.summary.provider,
    exchangeId,
    createdAt: new Date().toISOString(),
    status: settled ? 'executed' : pending ? 'pending' : 'failed',
    error: settled ? undefined : pending ? 'The exchange is settling.' : `The exchange is ${status}.`,
    capSpentUsd: settled ? intent.summary.costUsd : 0,
  });
  await removePending(owner, intent.tradeId);

  return {
    ok: true,
    status,
    exchangeId,
    convertedAmount: intent.summary.receive,
  };
}
