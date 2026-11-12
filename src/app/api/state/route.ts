import { NextResponse } from 'next/server';
import { getSession } from '@/lib/agent/session';
import { unlockWallet } from '@/lib/keeta/wallet';
import { userClient } from '@/lib/keeta/network';
import { capSpent, dailyCapUsd } from '@/lib/agent/safety';
import { hasWallet, walletAddress } from '@/lib/keeta/wallet';


export async function GET(req: Request) {
  const cookie = req.headers.get('cookie') ?? '';
  const sid = cookie.match(/kt_sid=([^;]+)/)?.[1];
  const session = getSession(sid);
  const has = await hasWallet();
  const address = await walletAddress();
  let balances: unknown = null;
  if (session && address) {
    try {
      const { account } = await unlockWallet(session.passphrase);
      await using client = userClient(account);
      balances = await client.allBalances();
    } catch {
      balances = null;
    }
  }
  return NextResponse.json({
    hasWallet: has,
    address,
    unlocked: Boolean(session),
    balances,
    cap: { spentUsd: await capSpent(), capUsd: await dailyCapUsd() },
  });
}
