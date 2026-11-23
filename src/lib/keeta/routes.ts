/**
 * Route classification for FX quotes.
 *
 * A "route" is where the swap actually settles. Keeta's own base anchor
 * (keeta-stablecoin-fx-anchor.keeta.com) bridges the asset and settles on the
 * Base chain; any other provider settles on-chain. The picker in
 * quote-routing.ts decides which quote to take; this module only names the
 * route, in words a person can read.
 */

export type RouteKind = 'anchor' | 'onchain';

/** The provider ID of Keeta's base anchor. */
export const BASE_ANCHOR_PROVIDER = 'keeta-stablecoin-fx-anchor.keeta.com';

/** Which route a provider's quote settles on. */
export function routeKind(providerId: string): RouteKind {
  return providerId === BASE_ANCHOR_PROVIDER ? 'anchor' : 'onchain';
}

/** The short, human label for a route — for the confirmation card and chat. */
export function routeLabel(kind: RouteKind): string {
  return kind === 'anchor' ? 'base anchor' : 'on-chain';
}
