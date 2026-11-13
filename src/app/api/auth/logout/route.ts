import { NextResponse } from 'next/server';
import { sessionFromRequest, csrfOk, SESSION_COOKIE, CSRF_COOKIE } from '@/lib/auth/session';

/** Sign out: drop the session cookie. */
export async function POST(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (!csrfOk(req, session)) {
    return NextResponse.json({ error: 'CSRF check failed.' }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(CSRF_COOKIE);
  return res;
}
