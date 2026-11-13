/**
 * The shared shape of a trade intent.
 *
 * Types only — this module is imported by both the server (which builds the
 * intent) and the browser (which signs it), so it must not pull in any
 * server-only code.
 */

export interface TradeSummary {
  from: string;
  to: string;
  amount: string;
  receive: string;
  provider: string;
  costUsd: number;
}

/** Everything the browser needs to build and sign the swap block. */
export interface TradeIntent {
  tradeId: string;
  kind: 'swap';
  /** The source token's address — the browser builds the block from it. */
  from: string;
  /** The destination token's address. */
  to: string;
  /** The source token's ticker, for display. */
  fromSymbol: string;
  /** The destination token's ticker, for display. */
  toSymbol: string;
  /** Display units. */
  amount: string;
  /** Base units, as the block needs them. */
  rawAmount: string;
  affinity: 'from' | 'to';
  /** The liquidity provider that will settle the swap. */
  providerAccount: string;
  /** How much of the destination token the provider guarantees. */
  convertedAmount: string;
  /** The provider's fee, in the token it charges. */
  costAmount: string;
  costToken: string | null;
  /** The serialized quote, forwarded to the provider as-is. */
  quote: unknown;
  /** Where to POST the signed block. */
  createExchangeUrl: string;
  summary: TradeSummary;
  /** Set for proposals that came from an automation (signed with the automation key). */
  fromAutomation?: boolean;
}
