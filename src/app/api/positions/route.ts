import { NextResponse } from 'next/server';
import { guardRead, ownerOf } from '@/lib/auth/guard';
import { computePositions } from '@/lib/keeta/positions';
import { tokenLabel } from '@/lib/keeta/positions';

/**
 * Positions and PnL.
 *
 *   GET -> the tokens you hold, priced, with cost basis and PnL
 *
 * Balances come from a public, unsigned read, so this needs no key.
 */
export async function GET(req: Request) {
  const { session, error } = await guardRead(req);
  if (error) return error;

  try {
    const result = await computePositions(ownerOf(session), session.address);
    const labels = await Promise.all(
      result.positions.map((p) => tokenLabel(p.token).then((l) => l?.symbol ?? null)),
    );
    return NextResponse.json({
      ...result,
      positions: result.positions.map((p, i) => ({ ...p, symbol: labels[i] })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
