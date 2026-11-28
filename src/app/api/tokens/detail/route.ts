import { NextResponse } from 'next/server';
import { guardRead, ownerOf } from '@/lib/auth/guard';
import { getTokenDetail } from '@/lib/keeta/token-detail';

/**
 * Full read-only detail for a token (ledger identity, supply, treasury, ACL).
 *
 *   GET /api/tokens/detail?token=<keeta_ address>
 *
 * The `holder` is the signed-in wallet (so the view can show "your balance"),
 * but the reads themselves are keyless — the node serves public account data.
 */
export async function GET(req: Request) {
  const { session, error } = await guardRead(req);
  if (error) return error;

  const token = new URL(req.url).searchParams.get('token')?.trim();
  if (!token || !token.startsWith('keeta_')) {
    return NextResponse.json({ error: 'token must be a keeta_ address' }, { status: 400 });
  }

  try {
    const detail = await getTokenDetail(token, ownerOf(session));
    if (!detail) {
      return NextResponse.json({ error: 'token not found on the ledger' }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || 'could not read token detail' },
      { status: 502 },
    );
  }
}
