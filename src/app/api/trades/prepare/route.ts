import { NextResponse } from 'next/server';
import { guardWrite, ownerOf } from '@/lib/auth/guard';
import { buildSwapIntent } from '@/lib/keeta/trade-intent';

/**
 * Prepare a proposed trade for signing.
 *
 * The server fetches a binding quote (no key required) and returns an intent:
 * what will happen, to whom, how much — plus the fields the browser needs to
 * build the swap block itself. The browser shows it to the user, checks the
 * cap, signs, and posts the signed block back.
 */
export async function POST(req: Request) {
  const { session, error } = await guardWrite(req);
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as { tradeId?: string };
  if (!body.tradeId) return NextResponse.json({ error: 'tradeId required' }, { status: 400 });

  try {
    const { intent } = await buildSwapIntent(ownerOf(session), body.tradeId);
    return NextResponse.json({ ok: true, intent });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
