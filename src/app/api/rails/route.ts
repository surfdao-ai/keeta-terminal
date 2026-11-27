import { NextResponse } from 'next/server';
import { guardRead } from '@/lib/auth/guard';
import { getLiveRails, cachedLiveRails } from '@/lib/keeta/live-rails';

/**
 * The live rails: which pairs trade right now (the base anchor's pegs).
 *
 * Serves from cache when warm; a cold cache runs the probe (a nominal quote
 * per advertised direction, a couple of seconds). The 2-minute cache and the
 * single-flight guard keep view opens and agent tool calls from stamping the
 * anchor.
 */
export async function GET(req: Request) {
  const { error } = await guardRead(req);
  if (error) return error;

  try {
    const rails = cachedLiveRails() ?? (await getLiveRails());
    return NextResponse.json(rails);
  } catch {
    // The rails are advisory: never fail the view. An empty live set is the
    // honest state ("nothing quoted right now"), not an error.
    return NextResponse.json({
      asOf: new Date().toISOString(),
      provider: 'keeta-stablecoin-fx-anchor.keeta.com',
      directions: [],
      fromFallback: true,
    });
  }
}
