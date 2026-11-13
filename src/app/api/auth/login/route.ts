import { NextResponse } from 'next/server';
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { consumeNonce, consumeRateLimit, createSession, SESSION_COOKIE, CSRF_COOKIE } from '@/lib/auth/session';

/**
 * Step 2 of sign-in: the browser proves it controls the wallet.
 *
 * The browser signs a one-time nonce with the wallet key — in the browser,
 * with the key that never leaves it — and posts the signature here. We
 * verify it against the public key and, if it checks out, issue a session
 * cookie bound to that address.
 */
export async function POST(req: Request) {
  const limit = await consumeRateLimit('auth', 20, 60);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many sign-in attempts. Try again in a minute.' },
      { status: 429, headers: { 'retry-after': String(limit.resetSeconds) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    address?: string;
    signature?: string;
    nonce?: string;
  };

  const address = String(body.address ?? '');
  const nonce = String(body.nonce ?? '');
  const signature = String(body.signature ?? '');

  if (!address.startsWith('keeta_') || !nonce || !signature) {
    return NextResponse.json({ error: 'address, nonce and signature are required' }, { status: 400 });
  }

  // The nonce is single-use: burn it before anything else.
  const fresh = await consumeNonce(nonce);
  if (!fresh) {
    return NextResponse.json({ error: 'That sign-in challenge has expired. Try again.' }, { status: 400 });
  }

  try {
    const account = KeetaNet.lib.Account.fromPublicKeyString(address);
    const sigBytes = Buffer.from(signature, 'base64');
    const ok = account.verify(
      new TextEncoder().encode(nonce).buffer as ArrayBuffer,
      new Uint8Array(sigBytes).buffer as ArrayBuffer,
    );
    if (!ok) {
      return NextResponse.json({ error: 'Signature does not match that address.' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Could not verify the signature.' }, { status: 401 });
  }

  const { token, csrf } = createSession(address);
  const res = NextResponse.json({ ok: true, address });
  const secure = process.env.NODE_ENV === 'production';
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  // The CSRF token is deliberately readable by the browser: it is echoed in a
  // header on every mutating request, which a cross-site attacker cannot do.
  res.cookies.set(CSRF_COOKIE, csrf, {
    httpOnly: false,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  return res;
}
