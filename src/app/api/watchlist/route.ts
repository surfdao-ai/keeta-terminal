import { NextResponse } from 'next/server';
import { guardRead, guardWrite, ownerOf } from '@/lib/auth/guard';
import { addWatch, listWatchlist, refreshWatchlist, removeWatch } from '@/lib/automations/watchlist';

/**
 * The watchlist: tokens you keep an eye on, with live prices.
 *
 *   GET                            -> the entries with their last price snapshot
 *   POST { action:'add', symbol }   -> start watching a token
 *   POST { action:'remove', id }    -> stop watching it
 *   POST { action:'refresh' }       -> re-read the prices now
 */
export async function GET(req: Request) {
  const { session, error } = await guardRead(req);
  if (error) return error;
  return NextResponse.json({ watchlist: await listWatchlist(ownerOf(session)) });
}

export async function POST(req: Request) {
  const { session, error } = await guardWrite(req);
  if (error) return error;
  const owner = ownerOf(session);

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    symbol?: string;
    id?: string;
  };

  try {
    if (body.action === 'add') {
      const entry = await addWatch(owner, String(body.symbol ?? ''));
      if (!entry) {
        return NextResponse.json({ error: 'That token is already on the watchlist.' }, { status: 400 });
      }
      return NextResponse.json({ ok: true, entry });
    }

    if (body.action === 'remove') {
      if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      await removeWatch(owner, body.id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'refresh') {
      return NextResponse.json({ ok: true, watchlist: await refreshWatchlist(owner) });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
