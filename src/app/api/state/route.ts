import { NextResponse } from 'next/server';
import { guardRead, ownerOf } from '@/lib/auth/guard';
import { getWallet } from '@/lib/keeta/wallet';
import { capSpent, dailyCapUsd } from '@/lib/agent/safety';
import { readPublicBalances } from '@/lib/keeta/public-reads';

/**
 * The terminal's state for the signed-in visitor.
 *
 * The balances are read with a public, unsigned read — the server never holds
 * a key, so it cannot sign anything on the visitor's behalf.
 */
export async function GET(req: Request) {
  const { session, error } = await guardRead(req);
  if (error) return error;

  const owner = ownerOf(session);
  const registered = await getWallet(owner);
  const balances = await readPublicBalances(session.address).catch(() => null);

  return NextResponse.json({
    // The signed-in address is the wallet.
    hasWallet: true,
    address: session.address,
    registered: registered?.address ?? null,
    unlocked: true,
    balances,
    cap: { spentUsd: await capSpent(owner), capUsd: await dailyCapUsd(owner) },
  });
}
