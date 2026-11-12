import { gateway } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export interface ProviderConfig {
  type: 'gateway' | 'openai-compatible';
  model: string;
  baseUrl?: string;
  apiKey?: string;
  name?: string;
}

const PRESETS: Record<string, { baseUrl: string; name: string }> = {
  pollinations: { baseUrl: 'https://text.pollinations.ai/openai', name: 'pollinations' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', name: 'openrouter' },
  ollama: { baseUrl: 'http://localhost:11434/v1', name: 'ollama' },
  'ollama-cloud': { baseUrl: 'https://ollama.com/v1', name: 'ollama-cloud' },
  lmstudio: { baseUrl: 'http://localhost:1234/v1', name: 'lmstudio' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', name: 'groq' },
  together: { baseUrl: 'https://api.together.xyz/v1', name: 'together' },
  kilo: { baseUrl: 'https://api.kilo.ai/api/gateway', name: 'kilo' },
  vercel: { baseUrl: 'https://ai-gateway.vercel.sh/v1', name: 'vercel' },
};

export function resolveBaseUrl(cfg: ProviderConfig): string | undefined {
  if (cfg.baseUrl) return cfg.baseUrl;
  if (cfg.type === 'openai-compatible') {
    const preset = cfg.name ? PRESETS[cfg.name.toLowerCase()] : undefined;
    if (preset) return preset.baseUrl;
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Tool-name repair
 *
 * Some models served through Ollama-style chat templates append a channel
 * marker to the tool name they call, e.g.
 *   "ks_read_skill<|channel|>commentary"
 * The AI SDK then rejects the call ("Model tried to call unavailable tool"),
 * so the marker is stripped from the streamed tool names before the SDK
 * assembles them.
 * ------------------------------------------------------------------ */

/**
 * A tool name never contains "<", so everything from the first "<" onwards is
 * the model's channel annotation ("<|channel|>commentary") and can be cut.
 */function repairToolNames(text: string): string {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return text;
  }
  const calls = (json as {
    choices?: { delta?: { tool_calls?: { function?: { name?: string } }[] } }[];
  })?.choices?.[0]?.delta?.tool_calls;
  if (!calls?.length) return text;

  let changed = false;
  for (const call of calls) {
    const name = call.function?.name;
    if (typeof name !== 'string' || !name.includes('<')) continue;
    const cleaned = name.slice(0, name.indexOf('<'));
    call.function!.name = cleaned;
    changed = true;
  }
  if (!changed) return text;
  return JSON.stringify(json);
}

/** The fetch signature the SDK expects from a provider. */
type ProviderFetch = NonNullable<Parameters<typeof createOpenAICompatible>[0]['fetch']>;

/**
 * Wrap fetch so the streamed SSE payload can be repaired on the way through.
 * Non-SSE responses pass through untouched.
 */
function repairingFetch(base: ProviderFetch): ProviderFetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await base(input, init);
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.body || !contentType.includes('text/event-stream')) return res;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';

    const stream = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          const out: string[] = [];
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              out.push(`data: ${repairToolNames(line.slice(6))}`);
            } else {
              out.push(line);
            }
          }
          controller.enqueue(encoder.encode(out.join('\n') + '\n'));
        },
        flush(controller) {
          if (!buffer) return;
          if (buffer.startsWith('data: ')) {
            controller.enqueue(encoder.encode(`data: ${repairToolNames(buffer.slice(6))}\n`));
          } else {
            controller.enqueue(encoder.encode(buffer));
          }
        },
      }),
    );

    return new Response(stream, { status: res.status, headers: res.headers });
  }) as ProviderFetch;
}

export function buildModel(cfg: ProviderConfig | null): LanguageModel {
  if (!cfg) {
    return gateway(process.env.AI_MODEL || 'anthropic/claude-sonnet-4.5');
  }
  if (cfg.type === 'gateway') {
    return gateway(cfg.model || process.env.AI_MODEL || 'anthropic/claude-sonnet-4.5');
  }
  const baseURL = resolveBaseUrl(cfg);
  if (!baseURL) throw new Error('baseUrl required for openai-compatible provider');
  const provider = createOpenAICompatible({
    name: cfg.name || 'custom',
    baseURL,
    apiKey: cfg.apiKey || '',
    fetch: repairingFetch as unknown as NonNullable<
      Parameters<typeof createOpenAICompatible>[0]['fetch']
    >,
  });
  return provider.chatModel(cfg.model);
}
