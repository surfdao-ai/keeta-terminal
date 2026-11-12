import { NextResponse } from 'next/server';
import { readBalances } from '@/lib/keeta/network';
import { getWallet, accountFromSeed } from '@/lib/keeta/wallet';
import { capSpent, dailyCapUsd } from '@/lib/agent/safety';

/**
 * Terminal state.
 *
 *   GET  -> public state (address, cap). No key material involved.
 *   POST -> the same plus the balances, which require the signing seed that
 *           the browser sends for this request only.
 */
export async function GET() {
  const wallet = await getWallet();
  return NextResponse.json({
    hasWallet: Boolean(wallet),
    address: wallet?.address ?? null,
    cap: { spentUsd: await capSpent(), capUsd: await dailyCapUsd() },
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { seed?: string };
  const wallet = await getWallet();
  const seed = typeof body.seed === 'string' && body.seed.trim() ? body.seed.trim() : null;

  let balances: unknown[] | null = null;
  let unlocked = false;

  if (seed) {
    try {
      const { account } = accountFromSeed(seed);
      balances = await readBalances(account);
      unlocked = true;
    } catch {
      balances = null;
    }
  }

  return NextResponse.json({
    hasWallet: Boolean(wallet),
    address: wallet?.address ?? null,
    unlocked,
    balances,
    cap: { spentUsd: await capSpent(), capUsd: await dailyCapUsd() },
  });
}
