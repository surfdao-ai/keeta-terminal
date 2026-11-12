import { NextResponse } from 'next/server';
import { createAutomationWallet, getAutomationWallet, automationEnabled } from '@/lib/automations/wallet';
import { userClient } from '@/lib/keeta/network';
import { unlockAutomationWallet } from '@/lib/automations/wallet';

export async function GET() {
  const wallet = await getAutomationWallet();
  let balances: { token: string; display: string }[] = [];
  if (wallet) {
    const unlocked = await unlockAutomationWallet();
    if (unlocked) {
      try {
        await using client = userClient(unlocked.account);
        const all = await client.allBalances();
        balances = all.map((b) => ({
          token: b.token.publicKeyString.get(),
          display: b.balance.toString(),
        }));
      } catch {
        balances = [];
      }
    }
  }
  return NextResponse.json({
    wallet: wallet ? { address: wallet.address, createdAt: wallet.createdAt } : null,
    balances,
    automationKeyConfigured: automationEnabled(),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { seed?: string };
  const seed = typeof body.seed === 'string' && body.seed.trim() ? body.seed.trim() : null;
  if (!seed) {
    return NextResponse.json({ error: 'Wallet locked — unlock first.' }, { status: 401 });
  }
  try {
    const wallet = await createAutomationWallet();
    return NextResponse.json({ ok: true, wallet: { address: wallet.address } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
