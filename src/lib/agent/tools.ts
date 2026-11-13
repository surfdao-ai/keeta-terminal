import { tool } from 'ai';
import { z } from 'zod';
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { networkAlias, userClient, loadFXClient, toDisplay, fromDisplay, getTokenInfo, readBalances, summarizeQuote, normalizeToken } from '../keeta/network';
import { accountFromSeed } from '../keeta/wallet';
import { newPendingTrade, savePending, listTrades, capSpent, dailyCapUsd } from './safety';
import { validateTokenSpec } from '../keeta/tokens';

export interface ToolContext {
  /** The wallet seed, sent by the browser for this request only. null = locked. */
  seed: string | null;
}

function locked() {
  return { error: 'Wallet is locked. Ask the user to unlock via the UI first.' };
}

export function buildTools(ctx: ToolContext) {
  return {
    get_portfolio: tool({
      description:
        'Get the trading account address, base token, and all balances with display amounts. Requires an unlocked wallet.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!ctx.seed) return locked();
        const { account, address } = accountFromSeed(ctx.seed);
        const rows = await readBalances(account);
        return { address, network: networkAlias(), baseToken: account.publicKeyString.get(), balances: rows };
      },
    }),

    list_tokens: tool({
      description:
        'List the tokens tradable on Keeta — the chain-wide catalogue of every currency with an FX anchor, NOT what is in the wallet. Use get_portfolio for holdings.',
      inputSchema: z.object({}),
      execute: async () => {
        const acct = KeetaNet.lib.Account.fromSeed(KeetaNet.lib.Account.generateRandomSeed({ asString: true }), 0);
        await using client = userClient(acct);
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
        const acct = KeetaNet.lib.Account.fromSeed(KeetaNet.lib.Account.generateRandomSeed({ asString: true }), 0);
        await using client = userClient(acct);
        const fx = await loadFXClient(client);
        // resolve decimals
        const f = normalizeToken(from);
        const t = normalizeToken(to);
        const fromInfo = await getTokenInfo(f).catch(() => ({ decimals: null }));
        const toInfo = await getTokenInfo(t).catch(() => ({ decimals: null }));
        const rawAmount = fromDisplay(amount, fromInfo.decimals);
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
              fromInfo.decimals,
              toInfo.decimals,
            );
            return {
              providerId: String((p as { provider?: { providerID?: unknown } }).provider?.providerID ?? 'unknown'),
              isBindingQuote: isQuote,
              ...summary,
            };
          }),
          fromDecimals: fromInfo.decimals,
          toDecimals: toInfo.decimals,
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
        const fromInfo = await getTokenInfo(f).catch(() => ({ decimals: null }));
        const toInfo = await getTokenInfo(t).catch(() => ({ decimals: null }));
        const rawAmount = fromDisplay(amount, fromInfo.decimals);

        const acct = KeetaNet.lib.Account.fromSeed(KeetaNet.lib.Account.generateRandomSeed({ asString: true }), 0);
        await using client = userClient(acct);
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
                convertedAmount: binding.quote?.convertedAmount?.toString() ?? null,
                display: toDisplay(binding.quote?.convertedAmount ?? 0n, toInfo.decimals),
              }
            : null,
          estimate: estimate
            ? {
                provider: String((estimate as { provider?: { providerID?: unknown } })?.provider?.providerID ?? 'unknown'),
                convertedAmount: estimate.estimate?.convertedAmount?.toString() ?? null,
                display: toDisplay(estimate.estimate?.convertedAmount ?? 0n, toInfo.decimals),
                canPerformExchange: estimate.estimate?.canPerformExchange ?? null,
              }
            : null,
          // Keeta-native liquidity is thin; the practical route is usually the
          // Base anchor (bridge the asset on Base, then swap on Keeta).
          note: tradable
            ? 'A provider is quoting this pair — a trade can be proposed.'
            : 'No provider is issuing a binding quote for this pair right now. Keeta-native liquidity is thin; the practical route is to hold the asset on Base (the Base anchor, e.g. USDC on Base) and bridge it in. Do not propose a trade that cannot fill.',
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
        const acct = KeetaNet.lib.Account.fromSeed(KeetaNet.lib.Account.generateRandomSeed({ asString: true }), 0);
        await using client = userClient(acct);
        const fx = await loadFXClient(client);
        const f = normalizeToken(from);
        const t = normalizeToken(to);
        const fromInfo = await getTokenInfo(f).catch(() => ({ decimals: null }));
        const toInfo = await getTokenInfo(t).catch(() => ({ decimals: null }));
        const rawAmount = fromDisplay(amount, fromInfo.decimals);
        const res = await fx.getQuotes({ from: f, to: t, amount: rawAmount, affinity } as unknown as Parameters<typeof fx.getQuotes>[0]);
        if (!res || res.length === 0) return { providers: [], note: 'No binding quotes available right now.' };
        return {
          providers: res.map((p) => ({
            providerId: String((p as { provider?: { providerID?: unknown } }).provider?.providerID ?? 'unknown'),
            ...summarizeQuote({ isQuote: true, quote: (p as { quote: unknown }).quote as never }, fromInfo.decimals, toInfo.decimals),
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
        await savePending(pending);
        // best-effort estimate for display
        let preview: unknown = null;
        try {
          const acct = KeetaNet.lib.Account.fromSeed(KeetaNet.lib.Account.generateRandomSeed({ asString: true }), 0);
          await using client = userClient(acct);
          const fx = await loadFXClient(client);
        const fromInfo = await getTokenInfo(f).catch(() => ({ decimals: null }));
          const toInfo = await getTokenInfo(t).catch(() => ({ decimals: null }));
          const rawAmount = fromDisplay(amount, fromInfo.decimals);
          const res = await fx.getQuotesOrEstimates({ from: f, to: t, amount: rawAmount, affinity } as unknown as Parameters<typeof fx.getQuotesOrEstimates>[0]);
          preview = res?.[0] ? summarizeQuote({ isQuote: (res[0] as { isQuote: boolean }).isQuote, quote: (res[0] as { quote?: unknown }).quote as never, estimate: (res[0] as { estimate?: unknown }).estimate as never }, fromInfo.decimals, toInfo.decimals) : null;
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
        await savePending(pending);
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
      execute: async ({ limit }) => ({ trades: await listTrades(limit) }),
    }),

    get_cap_status: tool({
      description: 'Show today\'s spend vs the daily cap.',
      inputSchema: z.object({}),
      execute: async () => {
        const cap = await dailyCapUsd();
        const spent = await capSpent();
        return {
          spentUsd: spent,
          capUsd: cap,
          remainingUsd: Math.max(0, cap - spent),
        };
      },
    }),
  };
}
