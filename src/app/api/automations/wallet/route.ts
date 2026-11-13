import { NextResponse } from 'next/server';
import { guardRead, guardWrite, ownerOf } from '@/lib/auth/guard';
import { getAutomationWallet, registerAutomationWallet } from '@/lib/automations/wallet';

/**
 * The automation wallet — a separate, low-balance account the user created in
 * their browser for unattended automations.
 *
 * Only its public address is stored here. The key stays in the browser, so
 * this server can never move those funds.
 */
export async function GET(req: Request) {
  const { session, error } = await guardRead(req);
  if (error) return error;
  const wallet = await getAutomationWallet(ownerOf(session));
  return NextResponse.json({
    wallet: wallet ? { address: wallet.address, createdAt: wallet.createdAt } : null,
    balances: null,
  });
}

export async function POST(req: Request) {
  const { session, error } = await guardWrite(req);
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as { action?: string; address?: string };
  if (body.action !== 'register') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }

  try {
    const wallet = await registerAutomationWallet(ownerOf(session), String(body.address ?? ''));
    return NextResponse.json({ ok: true, wallet: { address: wallet.address } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
