import { NextResponse } from 'next/server';
import { issueNonce, consumeRateLimit } from '@/lib/auth/session';

/**
 * Step 1 of sign-in: the server issues a one-time nonce.
 *
 * The browser signs it with the wallet key (locally) and posts the signature
 * to /api/auth/login. No key material ever reaches this server.
 */
export async function POST() {
  const limit = await consumeRateLimit('auth', 20, 60);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many sign-in attempts. Try again in a minute.' },
      { status: 429, headers: { 'retry-after': String(limit.resetSeconds) } },
    );
  }

  try {
    const { nonce, expiresAt } = await issueNonce();
    return NextResponse.json({ nonce, expiresAt });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
