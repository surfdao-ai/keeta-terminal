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
  /** Where the swap settles, in words: "base anchor" or "on-chain". */
  route: string;
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
  /** Free-read warnings/all-clear computed before the user confirms. */
  preflight?: PreflightResult | null;
  /** Set for proposals that came from an automation (signed with the automation key). */
  fromAutomation?: boolean;
}

/** A native token this wallet launched, kept per owner for the Launchpad. */
export interface LaunchRecord {
  address: string;
  symbol: string;
  name: string;
  supply: string;
  decimals: number;
  at: string;
}

/** One free-read check the preflight runs before the user confirms a trade. */
export interface PreflightCheck {
  id: 'kta' | 'provider' | 'cap';
  level: 'ok' | 'warn' | 'skip';
  /** A short human-facing fragment, e.g. "KTA +1.8%/24h". */
  text: string;
}

export interface PreflightResult {
  level: 'ok' | 'warn';
  checks: PreflightCheck[];
  /** The pre-rendered one-liner shown on the confirm card. */
  line: string;
}
