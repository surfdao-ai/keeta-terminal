import { createMCPClient } from '@ai-sdk/mcp';
import {
  streamText,
  UIMessage,
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  gateway,
  isStepCount,
} from 'ai';
import { getSession } from '@/lib/agent/session';
import { buildTools } from '@/lib/agent/tools';

export const runtime = 'nodejs';
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

const SYSTEM_PROMPT = `You are the Keeta Terminal assistant — an AI trading terminal for the Keeta Network (no smart contracts; token-level rules engine).

You help the user:
- Check balances and portfolio (get_portfolio)
- Discover tokens and providers (list_tokens, get_token_info)
- Get price estimates and binding quotes (get_estimate, get_binding_quote)
- Propose trades for the user to confirm (propose_trade) — you NEVER execute; the user confirms in the UI
- Review trade history and daily spend cap (get_trade_history, get_cap_status)

You also have read-only Keeta market data tools from KeeSpecs (ks_get_price, ks_get_providers, ks_search_tokens, etc.).

Safety rules you must follow:
1. Always propose before executing. Never claim a trade has been executed unless the user confirms it in the UI.
2. Show amounts, tokens, and expected receive before proposing.
3. Estimates are non-binding; binding quotes may be unavailable on mainnet. Be honest about that.
4. Remind the user of the daily spend cap and remaining budget.
5. Keeta has no AMM/DEX — liquidity comes from FX anchor providers. If none quote a pair, say so.
6. Never ask for or repeat the user's passphrase or seed.
7. Keep answers concise and terminal-style.

When the wallet is locked, portfolio and trade tools will return an error — guide the user to unlock.`;

export async function POST(req: Request) {
  const body = (await req.json()) as { messages: UIMessage[] };
  const cookie = req.headers.get('cookie') ?? '';
  const sid = cookie.match(/kt_sid=([^;]+)/)?.[1];
  const session = getSession(sid);
  const passphrase = session?.passphrase ?? null;

  const tools = buildTools({ passphrase }) as Record<string, unknown>;

  const mcpUrl = process.env.KEESPECS_MCP_URL || 'https://keespecs.xyz/mcp';
  let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;
  try {
    mcpClient = await createMCPClient({ transport: { type: 'http', url: mcpUrl } });
    const mcpTools = await mcpClient.tools();
    for (const [name, t] of Object.entries(mcpTools)) {
      if (ALLOWED_MCP_TOOLS.has(name)) tools[`ks_${name}`] = t;
    }
  } catch (e) {
    console.error('KeeSpecs MCP unavailable:', e instanceof Error ? e.message : e);
  }

  const result = streamText({
    model: gateway(process.env.AI_MODEL || 'anthropic/claude-sonnet-4.5'),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(body.messages),
    tools: tools as never,
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
