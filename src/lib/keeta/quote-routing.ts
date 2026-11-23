/**
 * The quote picker: kterminal chooses its own best route.
 *
 * Keeta-native liquidity is thin, so a conversion can have several executable
 * quotes (on-chain providers, the base anchor) or none. The policy:
 *
 *   - outcome first — the quote that returns the most of the destination
 *     token wins, because that is what the user actually cares about;
 *   - tie-break — when two quotes are within ROUTE_TIE_TOLERANCE_PCT of each
 *     other, the on-chain fill is preferred over the base anchor, so trades
 *     stay on Keeta whenever the rate is effectively the same;
 *   - fallback — when only the anchor quotes (the common case today), it is
 *     simply the best quote, and when nothing quotes, the caller reports the
 *     estimate gracefully instead of failing.
 *
 * The function is pure, so it is testable without a network.
 */
import { routeKind } from './routes';

/** Within this many percent, a native fill is preferred over the anchor. */
export const ROUTE_TIE_TOLERANCE_PCT = 0.5;

export interface QuoteCandidate {
  /** The provider issuing the quote (its route is derived from this). */
  providerId: string;
  /** How much of the destination token the quote guarantees. */
  convertedAmount: bigint;
}

/**
 * The index of the quote to take, or -1 when there is nothing to pick.
 *
 * Best outcome first: the quote that returns the most. Then, if an on-chain
 * quote is within tolerance of the best, take the on-chain one — a marginally
 * worse rate is not worth bridging, so trades stay on Keeta whenever the
 * outcome is effectively the same.
 */
export function pickBestQuoteIndex(candidates: QuoteCandidate[]): number {
  if (candidates.length === 0) return -1;
  if (candidates.length === 1) return 0;

  const out = candidates.map((c) => Number(c.convertedAmount));
  let best = 0;
  for (let i = 1; i < candidates.length; i++) {
    if (out[i] > out[best]) best = i;
  }

  const bestOut = out[best];
  if (routeKind(candidates[best].providerId) === 'onchain') return best;

  // The best is the anchor. Is there an on-chain quote within tolerance of it?
  for (let i = 0; i < candidates.length; i++) {
    if (i === best) continue;
    if (routeKind(candidates[i].providerId) !== 'onchain') continue;
    const diffPct = ((bestOut - out[i]) / Math.max(bestOut, 1)) * 100;
    if (diffPct <= ROUTE_TIE_TOLERANCE_PCT) return i;
  }
  return best;
}
