import { NextResponse } from 'next/server';
import { guardWrite, ownerOf } from '@/lib/auth/guard';
import { buildSwapIntent, submitSignedSwap } from '@/lib/keeta/trade-intent';

/**
 * Submit a trade the browser signed.
 *
 * The request carries only the signed block — never a key. The server checks
 * the cap again, forwards the block to the FX provider and records the result.
 */
export async function POST(req: Request) {
  const { session, error } = await guardWrite(req);
  if (error) return error;
  const owner = ownerOf(session);

  const body = (await req.json().catch(() => ({}))) as {
    tradeId?: string;
    signedBlock?: string;
  };
  if (!body.tradeId || !body.signedBlock) {
    return NextResponse.json({ error: 'tradeId and signedBlock are required' }, { status: 400 });
  }

  try {
    // Rebuild the intent so the provider gets the same quote the browser signed.
    const { intent } = await buildSwapIntent(owner, body.tradeId);
    const result = await submitSignedSwap(owner, intent, body.signedBlock);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, status: result.status }, { status: 409 });
    }
    return NextResponse.json({ ...result, ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
