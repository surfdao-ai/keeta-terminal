import { NextResponse } from 'next/server';
import { addWatch, listWatchlist, refreshWatchlist, removeWatch } from '@/lib/automations/watchlist';

/**
 * The watchlist: tokens you keep an eye on, with live prices.
 *
 *   GET                            -> the entries with their last price snapshot
 *   POST { action:'add', symbol }   -> start watching a token
 *   POST { action:'remove', id }    -> stop watching it
 *   POST { action:'refresh' }       -> re-read the prices now
 */
export async function GET() {
  return NextResponse.json({ watchlist: await listWatchlist() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    symbol?: string;
    id?: string;
  };

  try {
    if (body.action === 'add') {
      const entry = await addWatch(String(body.symbol ?? ''));
      if (!entry) {
        return NextResponse.json({ error: 'That token is already on the watchlist.' }, { status: 400 });
      }
      return NextResponse.json({ ok: true, entry });
    }

    if (body.action === 'remove') {
      if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      await removeWatch(body.id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'refresh') {
      return NextResponse.json({ ok: true, watchlist: await refreshWatchlist() });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
