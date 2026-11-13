import { NextResponse } from 'next/server';
import { guardRead, guardWrite, ownerOf } from '@/lib/auth/guard';
import { getWallet, registerWallet } from '@/lib/keeta/wallet';

/**
 * The wallet registry for the signed-in visitor.
 *
 * Only public addresses are stored here. There is no seed action: the seed is
 * generated and kept in the browser (src/lib/vault.ts) and never reaches the
 * server.
 */
export async function GET(req: Request) {
  const { session, error } = await guardRead(req);
  if (error) return error;
  const wallet = await getWallet(ownerOf(session));
  return NextResponse.json({
    address: wallet?.address ?? null,
    createdAt: wallet?.createdAt ?? null,
  });
}

export async function POST(req: Request) {
  const { session, error } = await guardWrite(req);
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as { action?: string; address?: string };
  if (body.action !== 'register') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }

  try {
    const wallet = await registerWallet(ownerOf(session), String(body.address ?? ''));
    return NextResponse.json({ ok: true, wallet });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
