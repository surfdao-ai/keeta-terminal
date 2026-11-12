import { createMCPClient } from '@ai-sdk/mcp';
import {
  streamText,
  UIMessage,
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  gateway,
  isStepCount,
  type ToolSet,
} from 'ai';
import { getSession } from '@/lib/agent/session';
import { buildTools } from '@/lib/agent/tools';
import { buildModel } from '@/lib/llm';
import type { ProviderConfig } from '@/lib/llm';

export const maxDuration = 60;

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

CAPABILITIES:
- get_portfolio      — balances for the unlocked wallet
- list_tokens       — tradable tokens via Keeta FX anchors
- get_token_info    — metadata/decimals/supply for a token
- get_estimate      — non-binding price estimate
- get_binding_quote — binding (signed) quote; may be unavailable
- propose_trade     — creates a pending trade; the user confirms it in the UI
- propose_token_launch — launches a NEW native Keeta token (symbol, name, supply, decimals); user confirms
- get_trade_history — executed/failed trades
- get_cap_status    — spend vs daily cap
- ks_* tools        — read-only KeeSpecs market data (price, providers, tokens)

SAFETY RULES (non-negotiable):
1. Always propose before executing. Never claim a trade executed unless the user confirmed it in the UI.
2. Show from token, amount, to token, expected receive before proposing.
3. Estimates are non-binding; binding quotes may be unavailable on mainnet. Say so plainly.
4. Surface remaining daily budget when proposing.
5. Keeta has no AMM/DEX — liquidity comes from FX anchor providers. If none quote a pair, report it.
6. Never ask for or repeat the passphrase or seed.
7. If the wallet is locked, tell the user to unlock in the sidebar.
8. Token launches are native to Keeta (no contract). Initial supply is minted to the creator and needs KTA for fees.`;

export async function POST(req: Request) {
  const body = (await req.json()) as { messages: UIMessage[]; providerConfig?: ProviderConfig };
  const cookie = req.headers.get('cookie') ?? '';
  const sid = cookie.match(/kt_sid=([^;]+)/)?.[1];
  const session = getSession(sid);
  const passphrase = session?.passphrase ?? null;

  let model;
  try {
    model = buildModel(body.providerConfig ?? null);
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  const tools: ToolSet = buildTools({ passphrase }) as ToolSet;

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

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
