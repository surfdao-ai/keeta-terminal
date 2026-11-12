import { NextResponse } from 'next/server';
import { createSession, destroySession } from '@/lib/agent/session';
import { createWallet, unlockWallet, hasWallet, walletAddress } from '@/lib/keeta/wallet';


export async function GET() {
  const addr = await walletAddress();
  return NextResponse.json({ hasWallet: await hasWallet(), address: addr });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { passphrase?: string; mode?: 'create' | 'unlock' };
  const passphrase = (body.passphrase ?? '').trim();
  if (!passphrase) return NextResponse.json({ error: 'passphrase required' }, { status: 400 });

  try {
    if (body.mode === 'create') {
      const { address } = await createWallet(passphrase);
      const sid = createSession(passphrase);
      const res = NextResponse.json({ ok: true, address, created: true });
      res.cookies.set('kt_sid', sid, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 8 * 3600 });
      return res;
    }
    const { address } = await unlockWallet(passphrase);
    const sid = createSession(passphrase);
    const res = NextResponse.json({ ok: true, address, created: false });
    res.cookies.set('kt_sid', sid, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 8 * 3600 });
    return res;
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const cookie = req.headers.get('cookie') ?? '';
  const sid = cookie.match(/kt_sid=([^;]+)/)?.[1];
  destroySession(sid);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('kt_sid');
  return res;
}
