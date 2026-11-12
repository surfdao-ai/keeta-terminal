/**
 * Model discovery for OpenAI-compatible providers.
 *
 * The setup dialog lets the user pick a provider and then choose one of the
 * models that provider actually serves. The key stays in the browser, so the
 * list is fetched through this server-side proxy (also avoids CORS).
 *
 * POST { baseUrl, apiKey } -> { models: string[], error?: string }
 */
import { NextResponse } from 'next/server';

const TIMEOUT_MS = 15_000;
const MAX_MODELS = 800;

/** Only http(s); loopback is allowed for local runtimes (Ollama, LM Studio). */
function parseBaseUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase();
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLoopback) return url;

  // Refuse internal targets: this route fetches a user-supplied URL.
  const isPrivate =
    host === '0.0.0.0' ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    host === '169.254.169.254' ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  return isPrivate ? null : url;
}

/** Pull model ids out of the shapes providers actually return. */
export function extractModelIds(json: unknown): string[] {
  const ids: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) ids.push(v.trim());
  };

  if (Array.isArray(json)) {
    for (const item of json) {
      if (typeof item === 'string') push(item);
      else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        push(o.id ?? o.model ?? o.name);
      }
    }
  } else if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    // OpenAI-compatible: { data: [{ id }] }
    for (const source of [o.data, o.models]) {
      if (!Array.isArray(source)) continue;
      for (const item of source) {
        if (typeof item === 'string') push(item);
        else if (item && typeof item === 'object') {
          const m = item as Record<string, unknown>;
          // Ollama's native /api/tags shape uses `model`, OpenAI uses `id`.
          push(m.id ?? m.model ?? m.name);
        }
      }
    }
  }

  return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).slice(0, MAX_MODELS);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { baseUrl?: string; apiKey?: string };
  const baseUrl = String(body.baseUrl ?? '').trim().replace(/\/+$/, '');
  const apiKey = String(body.apiKey ?? '').trim();

  if (!baseUrl) return NextResponse.json({ models: [], error: 'baseUrl is required' }, { status: 400 });

  const url = parseBaseUrl(baseUrl);
  if (!url) {
    return NextResponse.json(
      { models: [], error: 'unsupported or private base URL (use a public https:// endpoint)' },
      { status: 400 },
    );
  }

  const target = `${url.origin}${url.pathname.replace(/\/+$/, '')}/models`;
  try {
    const res = await fetch(target, {
      headers: {
        accept: 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      return NextResponse.json({
        models: [],
        error: `provider returned ${res.status}${detail ? `: ${detail}` : ''}`,
      });
    }

    const json = await res.json().catch(() => null);
    if (json === null) return NextResponse.json({ models: [], error: 'provider returned a non-JSON response' });

    return NextResponse.json({ models: extractModelIds(json) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'request failed';
    return NextResponse.json({ models: [], error: msg });
  }
}
