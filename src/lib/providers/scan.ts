/**
 * Free inference discovery.
 *
 * The candidate list is the part that decays — free tiers appear and die
 * every month. This file is the single place to refresh it (last researched:
 * 2026-11-25, by hitting each endpoint directly). The probe verifies
 * liveness on every request, so the app never presents a dead provider as
 * working: dead ones land under `down` with the reason, and the UI ranks
 * the live ones.
 *
 * Two tiers:
 *  - 'no-key': usable immediately. Probed with a real minimal chat request,
 *    so a hit is genuinely "it works right now".
 *  - 'key': needs a free account key. Probed for reachability (model list,
 *    or an auth-required answer) — a future key cannot be verified ahead of
 *    time, and the UI says exactly that.
 */

export interface ProbeResult {
  id: string;
  label: string;
  baseUrl: string;
  /** A live default model when the probe could pick one. */
  defaultModel: string;
  tier: 'no-key' | 'key';
  /** Where to get the free key (key tier only). */
  keyUrl?: string;
  note?: string;
  ok: boolean;
  /** Human line: "183ms" or the failure reason. */
  detail: string;
  ms: number;
}

export interface ScanResult {
  working: ProbeResult[];
  keyRequired: ProbeResult[];
  down: ProbeResult[];
  scannedAt: number;
}

interface Candidate {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  tier: 'no-key' | 'key';
  keyUrl?: string;
  note?: string;
}

/**
 * The curated list. Keep entries honest: a provider that is dead for weeks
 * belongs in the repo history, not here.
 */
const CANDIDATES: Candidate[] = [
  // ---- no key, usable immediately ----------------------------------------
  {
    id: 'pollinations',
    label: 'Pollinations',
    baseUrl: 'https://text.pollinations.ai/openai',
    defaultModel: 'openai-fast',
    tier: 'no-key',
    note: 'Keyless free limit is ~1 reply / 45s per IP.',
  },
  // Community-hosted keyless OpenAI-compatible relays. They come and go —
  // the probe tells the truth on each run.
  { id: 'gpl-host', label: 'GPL Host', baseUrl: 'https://ai.gpl.host/v1', defaultModel: 'gpt-4o-mini', tier: 'no-key', note: 'community relay' },
  { id: 'digiland', label: 'Digiland', baseUrl: 'https://infer.digiland.in/api/v1', defaultModel: 'gpt-4o-mini', tier: 'no-key', note: 'community relay' },
  { id: 'koyn', label: 'Koyn', baseUrl: 'https://api.koyn.com/v1', defaultModel: 'gpt-4o-mini', tier: 'no-key', note: 'community relay' },

  // ---- free account key ---------------------------------------------------
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'nvidia/nemotron-3.5-lightning:free', tier: 'key', keyUrl: 'https://openrouter.ai/keys', note: 'many :free models' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', tier: 'key', keyUrl: 'https://console.groq.com/keys', note: 'very fast' },
  { id: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', defaultModel: 'llama-3.3-70b', tier: 'key', keyUrl: 'https://cloud.cerebras.ai/keys', note: 'very fast' },
  { id: 'sambanova', label: 'SambaNova', baseUrl: 'https://api.sambanova.ai/v1', defaultModel: 'gpt-oss-120b', tier: 'key', keyUrl: 'https://cloud.sambanova.ai/' },
  { id: 'chutes', label: 'Chutes', baseUrl: 'https://llm.chutes.ai/v1', defaultModel: 'deepseek-ai/DeepSeek-V3.2-TEE', tier: 'key', keyUrl: 'https://chutes.ai/' },
  { id: 'huggingface', label: 'HuggingFace', baseUrl: 'https://router.huggingface.co/v1', defaultModel: 'Qwen/Qwen3.8-27B', tier: 'key', keyUrl: 'https://huggingface.co/settings/tokens', note: 'free inference tier' },
  { id: 'cohere', label: 'Cohere', baseUrl: 'https://api.cohere.com/v1', defaultModel: 'command-r', tier: 'key', keyUrl: 'https://dashboard.cohere.com/api-keys' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest', tier: 'key', keyUrl: 'https://console.mistral.ai/api-keys', note: 'free plan' },
  { id: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.0-flash', tier: 'key', keyUrl: 'https://aistudio.google.com/apikey', note: 'generous free tier' },
];

const PROBE_TIMEOUT_MS = 12_000;

/** Tiny prompt; a working provider answers in under a second. */
const PING = {
  model: (c: Candidate) => c.defaultModel,
  messages: [{ role: 'user', content: 'ping — reply with one word' }],
  max_tokens: 8,
};

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, redirect: 'error' });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A 402 from Pollinations means "free limit reached, retry in 45s" — the
 * provider is alive and usable. Treat rate-limits as alive, not down.
 */
function aliveByRateLimit(status: number, body: string): string | null {
  if (status === 429) return 'up but rate-limited right now';
  if (status === 402 && /limit/i.test(body)) return 'up but at its free limit right now';
  return null;
}

/** Pick a live default model from a public model list, if one looks right. */
function pickModel(ids: string[], fallback: string): string {
  const free = ids.find((i) => i.includes(':free'));
  if (free) return free;
  return ids[0] ?? fallback;
}

async function probeNoKey(c: Candidate): Promise<ProbeResult> {
  const t0 = Date.now();
  const base: ProbeResult = {
    id: c.id, label: c.label, baseUrl: c.baseUrl, defaultModel: c.defaultModel,
    tier: c.tier, note: c.note, ok: false, detail: '', ms: 0,
  };
  try {
    const res = await fetchWithTimeout(`${c.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PING),
    });
    const body = await res.text().catch(() => '');
    const ms = Date.now() - t0;
    if (res.ok && /"content"|choices/.test(body)) {
      return { ...base, ok: true, detail: `${ms}ms`, ms };
    }
    const rl = aliveByRateLimit(res.status, body);
    if (rl) return { ...base, ok: true, detail: rl, ms };
    const reason =
      res.status === 401 || res.status === 403
        ? `now requires a key (HTTP ${res.status})`
        : `HTTP ${res.status}`;
    return { ...base, ok: false, detail: reason, ms };
  } catch (e) {
    return { ...base, ok: false, detail: e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'unreachable', ms: Date.now() - t0 };
  }
}

async function probeKey(c: Candidate): Promise<ProbeResult> {
  const t0 = Date.now();
  const base: ProbeResult = {
    id: c.id, label: c.label, baseUrl: c.baseUrl, defaultModel: c.defaultModel,
    tier: c.tier, keyUrl: c.keyUrl, note: c.note, ok: false, detail: '', ms: 0,
  };
  try {
    const res = await fetchWithTimeout(`${c.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { accept: 'application/json' },
    });
    const ms = Date.now() - t0;
    if (res.ok) {
      const j = (await res.json().catch(() => ({}))) as { data?: { id: string }[] };
      const ids = Array.isArray(j.data) ? j.data.map((m) => m.id).filter(Boolean) : [];
      return {
        ...base, ok: true,
        defaultModel: pickModel(ids, c.defaultModel),
        detail: ids.length ? `up · ${ids.length} models listed` : 'up',
        ms,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { ...base, ok: true, detail: 'up — free key required', ms };
    }
    // Some providers (Gemini) have no OpenAI /models path. A 404 there is not
    // proof of death — fall back to the chat endpoint and read the auth answer.
    if (res.status === 404 || res.status === 405) {
      const chat = await fetchWithTimeout(`${c.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: c.defaultModel, messages: [{ role: 'user', content: 'ping' }], max_tokens: 4 }),
      }).catch(() => null);
      if (chat && (chat.status === 400 || chat.status === 401 || chat.status === 403)) {
        return { ...base, ok: true, detail: 'up — free key required', ms: Date.now() - t0 };
      }
      return { ...base, ok: false, detail: `HTTP ${res.status}`, ms };
    }
    return { ...base, ok: false, detail: `HTTP ${res.status}`, ms };
  } catch (e) {
    return { ...base, ok: false, detail: e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'unreachable', ms: Date.now() - t0 };
  }
}

/**
 * Probe every candidate in parallel. A dead candidate never aborts the scan;
 * it simply lands in `down`.
 */
export async function scanFreeProviders(): Promise<ScanResult> {
  const results = await Promise.all(
    CANDIDATES.map((c) => (c.tier === 'no-key' ? probeNoKey(c) : probeKey(c))),
  );
  return {
    working: results.filter((r) => r.ok && r.tier === 'no-key'),
    keyRequired: results.filter((r) => r.ok && r.tier === 'key'),
    down: results.filter((r) => !r.ok),
    scannedAt: Date.now(),
  };
}
