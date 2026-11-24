import { NextResponse } from 'next/server';
import { guardWrite } from '@/lib/auth/guard';
import { consumeRateLimit } from '@/lib/auth/session';

/**
 * Speech-to-text for the chat composer.
 *
 * The browser records the mic (MediaRecorder — always a supported format)
 * and posts the blob here with the user's own Venice API key, the same
 * way the model's providerConfig rides along with every chat request. The
 * key only reaches Venice; the audio is never stored.
 *
 * Venice is OpenAI-compatible: /api/v1/audio/transcriptions with a model
 * (its docs say the model is required — a request without one is a 400).
 * whisper-large-v3 is the free one and returns segment timestamps.
 */
const VENICE_API = 'https://api.venice.ai/api/v1';
const STT_MODEL = 'openai/whisper-large-v3';
// Vercel caps function request bodies at 4.5 MB, so the *decoded* audio must
// stay well under it once base64-inflated (x4/3) and wrapped in JSON.
// 3 MB of opus mic audio is ~an hour at typical bitrates — plenty.
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

export async function POST(req: Request) {
  const { session, error } = await guardWrite(req);
  if (error) return error;

  const limit = await consumeRateLimit(`stt:${session.address}`, 20, 60);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many transcription requests. Try again shortly.' },
      { status: 429, headers: { 'retry-after': String(limit.resetSeconds) } },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    audioBase64?: string;
    apiKey?: string;
  } | null;
  const apiKey = String(body?.apiKey ?? '').trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'No Venice API key. Open "Model setup" and add a Venice key to use voice input.' },
      { status: 400 },
    );
  }

  let bytes: Uint8Array;
  try {
    const b64 = String(body?.audioBase64 ?? '');
    if (!b64) throw new Error('empty');
    bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return NextResponse.json({ error: 'No audio received.' }, { status: 400 });
  }
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: 'That recording is too long. Keep it to a minute or two and try again.' },
      { status: 400 },
    );
  }

  const form = new FormData();
  form.append('file', new Blob([bytes as BlobPart], { type: 'audio/webm' }), 'recording.webm');
  form.append('model', STT_MODEL);
  form.append('response_format', 'json');

  let res: Response;
  try {
    res = await fetch(`${VENICE_API}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch {
    return NextResponse.json(
      { error: 'Could not reach the speech-to-text service. Check your connection and try again.' },
      { status: 502 },
    );
  }

  const text = await res.text();
  let json: { text?: string; error?: unknown } = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body — handled below */
  }
  if (!res.ok) {
    const detail = typeof json.error === 'string' ? json.error : text.slice(0, 200);
    if (res.status === 401) {
      return NextResponse.json({ error: `Venice rejected the API key (${detail}).` }, { status: 401 });
    }
    if (res.status === 402) {
      return NextResponse.json(
        { error: 'Venice says this key needs payment (402). Add credit to the Venice account or try again later.' },
        { status: 402 },
      );
    }
    return NextResponse.json({ error: `Transcription failed: ${detail || res.status}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, text: String(json.text ?? '').trim() });
}
