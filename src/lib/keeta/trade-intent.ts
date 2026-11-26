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
import { loadPending, isExpired, appendTrade, removePending, reserveCap, type PendingTrade } from '../agent/safety';
import { ephemeralAccount } from './ephemeral';
import { probePairLiquidity } from './liquidity';
import { pickBestQuoteIndex } from './quote-routing';
import { routeKind, routeLabel } from './routes';
import { runPreflight } from './preflight';
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
 * "No executable quote" is a market condition, not a crash.
 *
 * This error carries the estimate for the pair, so the caller (the prepare
 * route, and the agent) can tell the user *why* the trade cannot be made and
 * what it would be worth, instead of a bare "no provider" wall.
 */
export class NoLiquidityError extends Error {
  readonly estimateUsd: number | null;
  constructor(message: string, estimateUsd: number | null) {
    super(message);
    this.name = 'NoLiquidityError';
    this.estimateUsd = estimateUsd;
  }
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
  // The display filters expired proposals out; the sign path must enforce it
  // too, or a stale id could still be prepared and signed.
  if (isExpired(pending)) throw new Error('That proposal expired — ask for it again.');
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

  if (!quotes || quotes.length === 0) {
    // Thin-liquidity market state: report the (non-binding) estimate so the
    // user sees what the swap *would* be worth and that it is retryable — not
    // a dead end. The estimate is in destination-token units; when the
    // destination is a USD coin its value is the USD value too.
    const { estimate } = await probePairLiquidity(
      pending.fromToken,
      pending.toToken,
      pending.amount,
    );
    const estDisplay = estimate ?? null;
    let usd: number | null = null;
    if (estDisplay !== null && /USD/i.test(await tokenSymbol(pending.toToken))) {
      usd = Number(estDisplay);
    }

    const fromSymbol = await tokenSymbol(pending.fromToken);
    const toSymbol = await tokenSymbol(pending.toToken);
    const what =
      estDisplay !== null
        ? ` · est ${pending.amount} ${fromSymbol} ≈ ${estDisplay} ${toSymbol}`
        : '';
    throw new NoLiquidityError(
      `No live liquidity for ${fromSymbol}→${toSymbol} right now${what} (not executable — try later).`,
      usd,
    );
  }

  // kterminal picks its own route: best outcome, on-chain as the tie-break.
  const chosen = pickBestQuoteIndex(
    quotes.map((q) => ({
      providerId: String((q.provider as { providerID?: unknown })?.providerID ?? ''),
      convertedAmount: (q.quote as { convertedAmount: bigint }).convertedAmount,
    })),
  );
  const withQuote = quotes[chosen];
  const provider = withQuote.provider as unknown as ProviderShape;
  const providerId = String(provider.providerID ?? 'unknown');
  const quote = withQuote.quote as unknown as {
    request: { from: string; to: string; amount: bigint; affinity: 'from' | 'to' };
    account: unknown;
    convertedAmount: bigint;
    cost: { amount: bigint; token: unknown };
  };
  const route = routeLabel(routeKind(providerId));

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

  // Free preflight reads → one advisory line on the confirm card. Never throws
  // (runPreflight degrades to skips), so a flaky read can't block a trade.
  const preflight = await runPreflight({
    owner,
    fromSymbol: await tokenSymbol(pending.fromToken),
    toSymbol: await tokenSymbol(pending.toToken),
    providerId,
    costUsd,
  });

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
      provider: providerId,
      costUsd,
      route,
    },
    preflight,
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
  // The provider is the authority: a status that is neither completed nor
  // pending means it did not happen — the answer must not claim success.
  const ok = settled || pending;

  // Only a settled swap counts against the daily cap, and the reservation
  // (check + add in one CAS) is atomic — two concurrent settles cannot both
  // pass.
  if (settled && intent.summary.costUsd > 0) {
    const { ok, spentUsd, capUsd } = await reserveCap(owner, intent.summary.costUsd);
    if (!ok) {
      return {
        ok: false,
        status: 'failed',
        exchangeId,
        convertedAmount: intent.summary.receive,
        error: `Daily cap exceeded: $${spentUsd.toFixed(2)} used, $${intent.summary.costUsd.toFixed(2)} more would pass the $${capUsd.toLocaleString()} cap.`,
      };
    }
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
    route: intent.summary.route,
    exchangeId,
    createdAt: new Date().toISOString(),
    status: settled ? 'executed' : pending ? 'pending' : 'failed',
    error: settled ? undefined : pending ? 'The exchange is settling.' : `The exchange is ${status}.`,
    capSpentUsd: settled ? intent.summary.costUsd : 0,
  });
  await removePending(owner, intent.tradeId);

  return {
    ok,
    status,
    exchangeId,
    convertedAmount: intent.summary.receive,
    ...(ok ? {} : { error: `The exchange answered "${status}" — the swap did not complete.` }),
  };
}
