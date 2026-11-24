/**
 * Pair liquidity, as a plain state.
 *
 * "Does this pair trade right now?" is asked in three places — preparing a
 * trade, the automation runner (to keep DCA cards honest and to power
 * liquidity alerts), and the agent's liquidity check. This is the one shared
 * definition: an executable quote is "quoted"; only a non-binding estimate is
 * "estimate-only"; neither is "unknown".
 */
import { loadFXClient, userClient, fromDisplay, toDisplay } from './network';
import { tokenDecimals } from './currencies';
import { ephemeralAccount } from './ephemeral';

export interface PairLiquidityState {
  state: 'quoted' | 'estimate-only' | 'unknown';
  /** Destination-side estimate in display units, when only an estimate exists. */
  estimate?: string;
}

/**
 * Probe a pair for a live quote, with a non-binding estimate as fallback.
 * Amount is in display units; a throwaway account is enough (no user key).
 */
export async function probePairLiquidity(
  from: string,
  to: string,
  amount: string,
): Promise<PairLiquidityState> {
  let fromDecimals: number | null = null;
  let toDecimals: number | null = null;

  try {
    await using client = userClient(ephemeralAccount());
    const fx = await loadFXClient(client);

    fromDecimals = await tokenDecimals(from);
    toDecimals = await tokenDecimals(to);
    const rawAmount = fromDisplay(amount, fromDecimals);

    const quotes = await fx.getQuotes({
      from,
      to,
      amount: rawAmount,
      affinity: 'from',
    } as unknown as Parameters<typeof fx.getQuotes>[0]);

    if (quotes && quotes.length > 0) {
      return { state: 'quoted' };
    }

    // No executable quote: is there at least a non-binding estimate?
    const res = await fx.getQuotesOrEstimates({
      from,
      to,
      amount: rawAmount,
      affinity: 'from',
    } as unknown as Parameters<typeof fx.getQuotesOrEstimates>[0]);
    const est = res?.find((r) => !r.isQuote && r.estimate) as
      | { estimate?: { convertedAmount?: bigint } }
      | undefined;
    const converted = est?.estimate?.convertedAmount;
    if (converted !== undefined) {
      return { state: 'estimate-only', estimate: toDisplay(converted, toDecimals) };
    }
  } catch {
    /* a probe failure reads as "unknown", never a crash */
  }

  return { state: 'unknown' };
}
