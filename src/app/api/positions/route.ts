import { NextResponse } from 'next/server';
import { computePositions, tokenLabel } from '@/lib/keeta/positions';
import { accountFromSeed } from '@/lib/keeta/wallet';

/**
 * Positions and PnL.
 *
 *   POST { seed } -> the tokens you hold, priced, with cost basis and PnL
 *
 * The seed is needed because reading balances is a signed request. It is used
 * for this request only and never stored.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { seed?: string };
  const seed = typeof body.seed === 'string' && body.seed.trim() ? body.seed.trim() : null;
  if (!seed) return NextResponse.json({ error: 'Wallet locked.' }, { status: 401 });

  try {
    const { account } = accountFromSeed(seed);
    const result = await computePositions(account);
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
