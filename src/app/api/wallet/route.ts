import { NextResponse } from 'next/server';
import { guardRead, guardWrite, ownerOf } from '@/lib/auth/guard';
import { deleteWalletData, forgetWallet, getWallet, registerWallet } from '@/lib/keeta/wallet';

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
  const owner = ownerOf(session);

  if (body.action === 'delete') {
    // Deleting the wallet deletes everything the server stores for it:
    // chats, trades, settings, cap, automations, watchlist, registry. The
    // browser clears the sealed vault (and only it holds the seed).
    try {
      await deleteWalletData(owner);
      await forgetWallet(owner);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (body.action !== 'register') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }

  try {
    const wallet = await registerWallet(owner, String(body.address ?? ''));
    return NextResponse.json({ ok: true, wallet });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
