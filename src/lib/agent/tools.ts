import { tool } from 'ai';
import { z } from 'zod';
import { networkAlias, userClient, loadFXClient, toDisplay, fromDisplay, getTokenInfo, summarizeQuote, normalizeToken } from '../keeta/network';
import { readPublicBalances } from '../keeta/public-reads';
import { computePositions } from '../keeta/positions';
import { ephemeralAccount } from '../keeta/ephemeral';
import { tokenDecimals } from '../keeta/currencies';
import { routeKind, routeLabel } from '../keeta/routes';
import { getLiveRails, livePegLine } from '../keeta/live-rails';
import { newPendingTrade, savePending, listTrades, capSpent, dailyCapUsd } from './safety';
import { validateTokenSpec } from '../keeta/tokens';
import { readDocs } from './docs-content';
import {
  saveDataPayment,
  validateRequirement,
  validatePayUrl,
  priceUsdOf,
  dataCapState,
  type PaymentRequirement,
} from '../x402/paid-reads';

export interface ToolContext {
  /** The signed-in wallet address. No key material is ever passed to the server. */
  owner: string;
  address: string;
}

export function buildTools(ctx: ToolContext) {
  return {
    get_portfolio: tool({
      description:
        'Get the trading account address, base token, and all balances with display amounts. Requires an unlocked wallet.',
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await readPublicBalances(ctx.address);
        return {
          address: ctx.address,
          network: networkAlias(),
          balances: rows ?? [],
          note: rows === null ? 'Could not read the balances right now.' : undefined,
        };
      },
    }),

    get_positions: tool({
      description:
        'Get the wallet positions with USD value, cost basis and PnL (unrealised and realised). Use when the user asks for PnL, profit, loss, or "how am I doing". Requires an unlocked wallet.',
      inputSchema: z.object({}),
      execute: async () => {
        const p = await computePositions(ctx.owner, ctx.address);
        return {
          positions: p.positions.map((x) => ({
            token: x.token,
            amount: x.amount,
            valueUsd: x.valueUsd,
            costUsd: x.costUsd,
            pnlUsd: x.pnlUsd,
          })),
          totalValueUsd: p.totalValueUsd,
          totalCostUsd: p.totalCostUsd,
          totalPnlUsd: p.totalPnlUsd,
          realisedPnlUsd: p.realisedPnlUsd,
          trades: p.trades,
          noBasis: p.unpriced.length > 0,
        };
      },
    }),

    list_tokens: tool({
      description:
        'List the tokens tradable on Keeta — the chain-wide catalogue of every currency with an FX anchor, NOT what is in the wallet. Use get_portfolio for holdings.',
      inputSchema: z.object({}),
      execute: async () => {
        await using client = userClient(ephemeralAccount());
        const fx = await loadFXClient(client);
        const tokens = await fx.resolver.listTokens();

        const rows = await Promise.all(
          tokens.map(async (t) => {
            const code = String(t.currency ?? '').replace(/^\$/, '');
            let name = '';
            let decimals: number | null = null;
            try {
              const info = await getTokenInfo(t.token);
              name = info.name ?? '';
              decimals = info.decimals ?? null;
            } catch {
              /* the catalogue still works without the metadata */
            }
            return { code, name, address: t.token, decimals };
          }),
        );
        rows.sort((a, b) => a.code.localeCompare(b.code));

        return {
          scope: 'every token with a Keeta FX anchor (chain-wide, not your wallet)',
          count: rows.length,
          tokens: rows,
          // Pre-formatted so the terminal shows a table instead of raw objects.
          lines: rows.map(
            (r) =>
              `${(r.code || '?').padEnd(6)} ${(r.name || '-').slice(0, 26).padEnd(26)} ${r.address.slice(0, 20)}…${
                r.decimals !== null ? ` ${r.decimals}dp` : ''
              }`,
          ),
        };
      },
    }),

    get_token_info: tool({
      description: 'Get metadata (name, symbol, decimals, supply) for a Keeta token address.',
      inputSchema: z.object({ address: z.string().describe('Token address (keeta_...)') }),
      execute: async ({ address }) => getTokenInfo(address),
    }),

    get_estimate: tool({
      description:
        'Get a non-binding price estimate from FX anchor providers for converting one token to another. Use for previewing rates.',
      inputSchema: z.object({
        from: z.string().describe('Source token address or currency code'),
        to: z.string().describe('Destination token address or currency code'),
        amount: z.string().describe('Amount in display units of the from token'),
        affinity: z.enum(['from', 'to']).default('from').describe("'from' = amount is what you have; 'to' = amount is what you want"),
      }),
      execute: async ({ from, to, amount, affinity }) => {
        await using client = userClient(ephemeralAccount());
        const fx = await loadFXClient(client);
        // resolve decimals
        const f = normalizeToken(from);
        const t = normalizeToken(to);
        const fromDecimals = await tokenDecimals(f);
        const toDecimals = await tokenDecimals(t);
        const rawAmount = fromDisplay(amount, fromDecimals);
        const res = await fx.getQuotesOrEstimates({
          from: f,
          to: t,
          amount: rawAmount,
          affinity,
        } as unknown as Parameters<typeof fx.getQuotesOrEstimates>[0]);
        if (!res || res.length === 0) return { providers: [], note: 'No providers for this pair right now.' };
        return {
          providers: res.map((p) => {
            const isQuote = (p as { isQuote: boolean }).isQuote;
            const q = isQuote ? (p as { quote: unknown }).quote : null;
            const e = !isQuote ? (p as { estimate: unknown }).estimate : null;
            const summary = summarizeQuote(
              { isQuote, quote: q as never, estimate: e as never },
              fromDecimals,
              toDecimals,
            );
            return {
              providerId: String((p as { provider?: { providerID?: unknown } }).provider?.providerID ?? 'unknown'),
              route: routeLabel(routeKind(String((p as { provider?: { providerID?: unknown } }).provider?.providerID ?? ''))),
              isBindingQuote: isQuote,
              ...summary,
            };
          }),
          fromDecimals: fromDecimals,
          toDecimals: toDecimals,
        };
      },
    }),

    check_liquidity: tool({
      description:
        'Check whether a pair can actually be traded right now. Returns the binding quote (if a provider is quoting), the estimate, and the cross-chain route via the Base anchor. Use this before proposing a trade.',
      inputSchema: z.object({
        from: z.string().describe('Source token address or currency code'),
        to: z.string().describe('Destination token address or currency code'),
        amount: z.string().describe('Amount in display units'),
        affinity: z.enum(['from', 'to']).default('from').describe("'from' = amount is what you have; 'to' = amount is what you want"),
      }),
      execute: async ({ from, to, amount, affinity }) => {
        const f = normalizeToken(from);
        const t = normalizeToken(to);
        const fromDecimals = await tokenDecimals(f);
        const toDecimals = await tokenDecimals(t);
        const rawAmount = fromDisplay(amount, fromDecimals);

        await using client = userClient(ephemeralAccount());
        const fx = await loadFXClient(client);

        const quotes = await fx.getQuotes({ from: f, to: t, amount: rawAmount, affinity } as unknown as Parameters<typeof fx.getQuotes>[0]);
        const estimates = await fx.getEstimates({ from: f, to: t, amount: rawAmount, affinity } as unknown as Parameters<typeof fx.getEstimates>[0]);

        const binding = quotes?.[0];
        const estimate = estimates?.[0];
        const tradable = Boolean(binding);

        return {
          tradable,
          pair: `${f} -> ${t}`,
          amount,
          bindingQuote: binding
            ? {
                provider: String((binding as { provider?: { providerID?: unknown } })?.provider?.providerID ?? 'unknown'),
                route: routeLabel(routeKind(String((binding as { provider?: { providerID?: unknown } })?.provider?.providerID ?? ''))),
                convertedAmount: binding.quote?.convertedAmount?.toString() ?? null,
                display: toDisplay(binding.quote?.convertedAmount ?? 0n, toDecimals),
              }
            : null,
          estimate: estimate
            ? {
                provider: String((estimate as { provider?: { providerID?: unknown } })?.provider?.providerID ?? 'unknown'),
                convertedAmount: estimate.estimate?.convertedAmount?.toString() ?? null,
                display: toDisplay(estimate.estimate?.convertedAmount ?? 0n, toDecimals),
                canPerformExchange: estimate.estimate?.canPerformExchange ?? null,
              }
            : null,
          // Keeta-native liquidity is thin; when a provider does quote it is
          // usually the base anchor. The picker routes by best outcome, so the
          // pair fills whenever any provider is live — otherwise report the
          // estimate and that it is retryable, not a failure.
          note: tradable
            ? `A provider is quoting this pair via the ${routeLabel(routeKind(String((binding as { provider?: { providerID?: unknown } })?.provider?.providerID ?? '')))} — a trade can be proposed.`
            : estimate
              ? `No live liquidity for this pair right now. Estimate: ${toDisplay(estimate.estimate?.convertedAmount ?? 0n, toDecimals)} — not executable yet, try again later. Do not propose a trade that cannot fill.`
              : 'No provider is issuing a binding quote for this pair right now, and no estimate is available. Do not propose a trade that cannot fill.',
        };
      },
    }),

    get_live_rails: tool({
      description:
        'Which Keeta pairs can actually be traded RIGHT NOW (a provider is issuing a binding quote). Keeta has no DEX; the only live venue is the base anchor, which quotes same-currency $K/$KB stable pegs (e.g. KBUSD→KUSD at ~1:1). Call this before proposing a trade, or when the user asks "what can I trade?". Pairs NOT in this list are not executable — do not propose them.',
      inputSchema: z.object({}),
      execute: async () => {
        const rails = await getLiveRails();
        const live = rails.directions.filter((d) => d.live);
        return {
          asOf: rails.asOf,
          provider: rails.provider,
          liveCount: live.length,
          // A human one-liner: the pegs that trade right now.
          pegs: livePegLine(rails),
          directions: rails.directions.map((d) => ({
            from: d.from,
            to: d.to,
            live: d.live,
            rate: d.rate,
            fee: d.fee,
          })),
          note: live.length
            ? `Only these ${live.length} direction(s) have a live binding quote. Everything else (KTA, USDC, community tokens) has no executable venue right now — say so instead of proposing a trade that cannot fill.`
            : 'No pair has a live binding quote right now. Nothing is executable — say so plainly.',
        };
      },
    }),

    get_binding_quote: tool({
      description:
        'Request binding (signed) quotes from FX anchor providers. Returns null providers if none are currently issuing binding quotes (common on mainnet).',
      inputSchema: z.object({
        from: z.string().describe('Source token address'),
        to: z.string().describe('Destination token address'),
        amount: z.string().describe('Amount in display units'),
        affinity: z.enum(['from', 'to']).default('from'),
      }),
      execute: async ({ from, to, amount, affinity }) => {
        await using client = userClient(ephemeralAccount());
        const fx = await loadFXClient(client);
        const f = normalizeToken(from);
        const t = normalizeToken(to);
        const fromDecimals = await tokenDecimals(f);
        const toDecimals = await tokenDecimals(t);
        const rawAmount = fromDisplay(amount, fromDecimals);
        const res = await fx.getQuotes({ from: f, to: t, amount: rawAmount, affinity } as unknown as Parameters<typeof fx.getQuotes>[0]);
        if (!res || res.length === 0) return { providers: [], note: 'No binding quotes available right now.' };
        return {
          providers: res.map((p) => ({
            providerId: String((p as { provider?: { providerID?: unknown } }).provider?.providerID ?? 'unknown'),
            ...summarizeQuote({ isQuote: true, quote: (p as { quote: unknown }).quote as never }, fromDecimals, toDecimals),
          })),
        };
      },
    }),

    propose_trade: tool({
      description:
        'Propose a trade for the user to confirm. Does NOT execute. Returns a tradeId that the UI uses for the confirm button. Always show the user the quote details before they confirm.',
      inputSchema: z.object({
        from: z.string().describe('Source token address'),
        to: z.string().describe('Destination token address'),
        amount: z.string().describe('Amount in display units of the from token'),
        affinity: z.enum(['from', 'to']).default('from'),
      }),
      execute: async ({ from, to, amount, affinity }) => {
        const f = normalizeToken(from);
        const t = normalizeToken(to);
        const pending = newPendingTrade({ kind: 'swap', fromToken: f, toToken: t, amount, affinity });
        await savePending(ctx.owner, pending);
        // best-effort estimate for display
        let preview: unknown = null;
        try {
          await using client = userClient(ephemeralAccount());
          const fx = await loadFXClient(client);
        // The decimals decide the raw amount: KTA has 18, the stablecoins 6.
          const fromDecimals = await tokenDecimals(f);
          const toDecimals = await tokenDecimals(t);
          const rawAmount = fromDisplay(amount, fromDecimals);
          const res = await fx.getQuotesOrEstimates({ from: f, to: t, amount: rawAmount, affinity } as unknown as Parameters<typeof fx.getQuotesOrEstimates>[0]);
          preview = res?.[0] ? summarizeQuote({ isQuote: (res[0] as { isQuote: boolean }).isQuote, quote: (res[0] as { quote?: unknown }).quote as never, estimate: (res[0] as { estimate?: unknown }).estimate as never }, fromDecimals, toDecimals) : null;
        } catch {
          preview = null;
        }
        return { tradeId: pending.id, expiresAt: pending.expiresAt, preview };
      },
    }),

    propose_token_launch: tool({
      description:
        'Propose launching a new native Keeta token (symbol, name, total supply, decimals). Does NOT execute — the user confirms in the UI. Use this when the user wants to create/launch a token, coin, or memecoin on Keeta.',
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, 1-12 alphanumeric characters (e.g. KTAW)'),
        name: z.string().describe('Display name of the token'),
        supply: z.string().describe('Total supply in display units (e.g. 1000000)'),
        decimals: z.number().int().min(0).max(18).default(18).describe('Decimal places (usually 18)'),
        description: z.string().default('').describe('Short description / metadata'),
      }),
      execute: async ({ symbol, name, supply, decimals, description }) => {
        const spec = { name, symbol, description, supply, decimals };
        const invalid = validateTokenSpec(spec);
        if (invalid) return { error: invalid };
        const pending = newPendingTrade({
          kind: 'token',
          fromToken: '',
          toToken: '',
          amount: supply,
          affinity: 'from',
          token: spec,
        });
        await savePending(ctx.owner, pending);
        return {
          tokenLaunchId: pending.id,
          expiresAt: pending.expiresAt,
          spec,
          note: 'Token will be created natively on Keeta (no contract). Initial supply is minted to your wallet.',
        };
      },
    }),

    get_trade_history: tool({
      description: 'Get recent executed/failed trades from the terminal log.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(20) }),
      execute: async ({ limit }) => ({ trades: await listTrades(ctx.owner, limit) }),
    }),

    get_cap_status: tool({
      description: 'Show today\'s spend vs the daily cap.',
      inputSchema: z.object({}),
      execute: async () => {
        const cap = await dailyCapUsd(ctx.owner);
        const spent = await capSpent(ctx.owner);
        const data = await dataCapState(ctx.owner);
        return {
          spentUsd: spent,
          capUsd: cap,
          remainingUsd: Math.max(0, cap - spent),
          dataCap: data,
        };
      },
    }),

    read_docs: tool({
      description:
        'Look up Kterminal feature documentation — how to swap, launch a token, manage a token (mint/burn/send/update info/grant admin), set up automations (alert/recurring/liquidity), use the watchlist, set the daily cap, use models/PWA/troubleshooting. Pass the user\'s question as the query.',
      inputSchema: z.object({ query: z.string().describe('The user\'s question about Kterminal features.') }),
      execute: async ({ query }) => ({ answer: readDocs(query) }),
    }),

    propose_data_payment: tool({
      description:
        'Propose paying for a paid KeeSpecs read (0.01-0.02 USDC). Use this when a ks_ quote_* tool returned a payment requirement (payUrl + accepts) and the user wants that data. Does NOT pay — the user confirms in the UI. Pass the requirement exactly as the quote tool returned it.',
      inputSchema: z.object({
        payUrl: z.string().url().describe('The paid URL, from the quote tool\'s payUrl field.'),
        label: z.string().describe('What the read is, in short words, e.g. "ledger status" or "KTA price comparison".'),
        requirement: z
          .object({
            scheme: z.string(),
            network: z.string(),
            amount: z.string(),
            asset: z.string(),
            payTo: z.string(),
          })
          .describe('The payment requirement, from the quote tool\'s accepts[0].'),
      }),
      execute: async ({ payUrl, label, requirement }) => {
        const badUrl = validatePayUrl(payUrl);
        if (badUrl) return { error: badUrl, paymentRequired: true };
        const invalid = validateRequirement(requirement as PaymentRequirement);
        if (invalid) return { error: invalid, paymentRequired: true };
        const priceUsd = priceUsdOf(requirement as PaymentRequirement);
        const data = await dataCapState(ctx.owner);
        if (data.remainingUsd < priceUsd) {
          return {
            paymentRequired: true,
            error: `Daily data cap reached: $${data.spentUsd.toFixed(2)} of $${data.capUsd} used. Raise it in Settings.`,
            cap: data,
          };
        }
        const pending = {
          id: crypto.randomUUID(),
          payUrl,
          label,
          requirement: requirement as PaymentRequirement,
          priceUsd,
          createdAt: Date.now(),
          expiresAt: Date.now() + 120_000,
        };
        await saveDataPayment(ctx.owner, pending);
        return {
          dataPaymentId: pending.id,
          expiresAt: pending.expiresAt,
          label,
          priceUsd,
          requirement: pending.requirement,
          cap: data,
          note: 'The user will be asked to confirm before any USDC is sent.',
        };
      },
    }),
  };
}
