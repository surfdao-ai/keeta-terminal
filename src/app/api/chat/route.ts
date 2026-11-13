import { createMCPClient } from '@ai-sdk/mcp';
import {
  streamText,
  UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  toUIMessageStream,
  isStepCount,
  type ToolSet,
} from 'ai';
import { buildTools } from '@/lib/agent/tools';
import { buildModel } from '@/lib/llm';
import type { ProviderConfig } from '@/lib/llm';

// Reasoning models can take a while before the first token; give the stream
// room to finish instead of cutting it off mid-answer.
export const maxDuration = 120;

const ALLOWED_MCP_TOOLS = new Set([
  'get_account',
  'get_activity',
  'get_balance',
  'get_block',
  'get_directory',
  'get_ecosystem',
  'get_fx_reference',
  'get_outbox',
  'get_permissions',
  'get_portfolio',
  'get_price',
  'get_providers',
  'get_representatives',
  'get_stablecoins',
  'get_storage_quotas',
  'get_supply',
  'get_token',
  'get_x402_health',
  'list_skills',
  'lookup_username',
  'read_skill',
  'search_tokens',
]);

const SYSTEM_PROMPT = `You are the KTerminal agent — a terminal-style AI trading agent for the Keeta Network (no smart contracts; token-level rules engine).

OUTPUT FORMAT — you are a terminal, so your output must read like one:
- Use plain, terse lines. No paragraphs, no emoji, no marketing tone.
- Prefix output blocks with a short label, e.g.
    PORTFOLIO  keeta_ab…cd
    KTA         1.2450
    USDC       250.0000
- Use a compact key/value or table layout for balances, quotes, and trades.
- Short status lines like: ok  quote received 1 KTA -> 0.412 USDC
- Errors as: err  <reason>   (and never invent success)
- Never use markdown headers, bold, or bullet-heavy prose. Minimal plain text only.

CONCISION — the user reads a terminal, not an essay:
- Lead with the answer. No preamble ("Sure!", "Great question"), no recap of what you are about to do, no closing summary.
- Default to 1-6 lines. Go longer only when the user asks for detail or the data genuinely needs it.
- Never restate the user's question, and never repeat numbers the tool output already showed.
- One block per topic. Do not print the same table twice.
- Never volunteer your capabilities or list your tools unless the user asks what you can do.
- For long catalogues (more than ~10 rows), show the most relevant ones, say how many more there are, and offer the rest.

CAPABILITIES:
- get_portfolio      — balances for the unlocked wallet (your holdings)
- list_tokens       — every token with a Keeta FX anchor (chain-wide catalogue, NOT your holdings)
- get_token_info    — metadata/decimals/supply for a token
- get_estimate      — non-binding price estimate
- get_binding_quote — binding (signed) quote; may be unavailable
- check_liquidity   — is a pair tradable right now (binding quote / estimate / route)
- propose_trade     — creates a pending trade; the user confirms it in the UI
- propose_token_launch — launches a NEW native Keeta token (symbol, name, supply, decimals); user confirms
- get_trade_history — executed/failed trades
- get_cap_status    — spend vs daily cap
- ks_* tools        — read-only KeeSpecs data (price, providers, tokens, skills).
                       These are reads; your own tools above are the actions.

SAFETY RULES (non-negotiable):
1. Always propose before executing. Never claim a trade executed unless the user confirmed it in the UI.
2. Show from token, amount, to token, expected receive before proposing.
3. Estimates are non-binding; binding quotes may be unavailable on mainnet. Say so plainly.
4. Surface remaining daily budget when proposing.
5. Keeta has no AMM/DEX — liquidity comes from FX anchor providers, and on Keeta-native pairs it is often thin. Check with check_liquidity before proposing: if there is no binding quote, say so and offer the cross-chain route (the Base anchor, e.g. USDC on Base) instead of proposing a trade that cannot fill.
6. Never ask for or repeat the passphrase or seed.
7. If the wallet is locked, tell the user to unlock in the sidebar.
8. Token launches are native to Keeta (no contract). Initial supply is minted to the creator and needs KTA for fees.`;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    messages: UIMessage[];
    providerConfig?: ProviderConfig;
    /** Wallet seed, sent by the browser for this request only. */
    seed?: string;
  };
  const seed = typeof body.seed === 'string' && body.seed.trim() ? body.seed.trim() : null;

  let model;
  try {
    model = buildModel(body.providerConfig ?? null);
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  // The Vercel AI Gateway is only usable with a credit card on the account.
  // Without a provider of our own there is nothing to talk to, so say so
  // instead of failing later with an opaque 403.
  if (!body.providerConfig && !process.env.AI_GATEWAY_API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          'No model configured. Open "Model setup" and pick a provider. "Free, no key" works immediately with no account and no credit card; OpenRouter, Groq, Together and Ollama Cloud also work without one.',
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  const tools: ToolSet = buildTools({ seed }) as ToolSet;

  const mcpUrl = process.env.KEESPECS_MCP_URL || 'https://keespecs.xyz/mcp';
  let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;
  try {
    mcpClient = await createMCPClient({ transport: { type: 'http', url: mcpUrl } });
    const mcpTools = await mcpClient.tools();
    for (const [name, t] of Object.entries(mcpTools)) {
      if (ALLOWED_MCP_TOOLS.has(name)) (tools as Record<string, unknown>)[`ks_${name}`] = t;
    }
  } catch (e) {
    console.error('KeeSpecs MCP unavailable:', e instanceof Error ? e.message : e);
  }

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(body.messages),
    tools,
    stopWhen: isStepCount(8),
    onEnd: async () => {
      try {
        await mcpClient?.close();
      } catch {
        /* ignore */
      }
    },
  });

  // onError lives on the stream (not the response): it replaces the default
  // "An error occurred." with the real reason. The inner stream carries the
  // provider failure, so the handler has to be attached there.
  const uiStream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          onError: (error) => friendlyModelError(error),
        }),
      );
    },
    onError: (error) => friendlyModelError(error),
  });

  return createUIMessageStreamResponse({ stream: uiStream });
}

/**
 * Turn provider failures into something actionable. The default AI SDK
 * message ("An error occurred.") hides the reason — which matters most for
 * the gateway, where the real cause is a billing requirement.
 */
function friendlyModelError(error: unknown): string {
  const err = error as { name?: string; message?: string; statusCode?: number; cause?: { message?: string } };
  const blob = `${err?.name ?? ''} ${err?.message ?? ''} ${err?.cause?.message ?? ''}`;
  console.error('[chat-error]', err?.name, JSON.stringify(blob).slice(0, 400));

  if (/credit card|customer_verification_required|unlock your free credits/i.test(blob)) {
    return 'The Vercel AI Gateway needs a credit card on this account. Open "Model setup" and switch to a provider that works without one (Ollama Cloud, Kilo Gateway, OpenRouter, Groq, Together).';
  }
  if (/GatewayAuthenticationError|authentication failed|invalid api key|Unauthenticated/i.test(blob)) {
    return 'The server-side AI Gateway credential is not usable. Open "Model setup" and pick a provider (Ollama Cloud, Kilo Gateway, OpenRouter, Groq, Together) — those need no Vercel credit card.';
  }
  if (/api key|unauthorized|401/i.test(blob)) {
    return 'Provider rejected the API key. Open "Model setup" and check the key.';
  }
  return `Model request failed: ${err?.message ?? 'unknown error'}`;
}
