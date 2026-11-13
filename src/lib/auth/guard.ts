/**
 * The guard every API route uses.
 *
 * - Reads need a valid session (the visitor signed in with a wallet).
 * - Mutations additionally need the CSRF token that was issued with the
 *   session, echoed in the x-kt-csrf header.
 * - Every session gets its own rate-limit budget.
 */
import { NextResponse } from 'next/server';
import { consumeRateLimit, csrfOk, sessionFromRequest, type Session } from './session';

export const READ_LIMIT = 120; // per minute
export const WRITE_LIMIT = 30; // per minute

export function unauthorized(message = 'Sign in required.'): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = 'CSRF check failed.'): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function tooMany(resetSeconds: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Try again shortly.' },
    { status: 429, headers: { 'retry-after': String(resetSeconds) } },
  );
}

/** The session for this request, or null. */
export function sessionOf(req: Request): Session | null {
  return sessionFromRequest(req);
}

/**
 * Gate a read: a valid session and a rate-limit budget.
 * Returns the session, or a response to send instead.
 */
export async function guardRead(
  req: Request,
): Promise<{ session: Session; error: NextResponse | null }> {
  const session = sessionOf(req);
  if (!session) return { session: null as unknown as Session, error: unauthorized() };

  const limit = await consumeRateLimit(session.address, READ_LIMIT, 60);
  if (!limit.ok) return { session, error: tooMany(limit.resetSeconds) };
  return { session, error: null };
}

/**
 * Gate a mutation: a valid session, a matching CSRF token and a rate-limit
 * budget.
 */
export async function guardWrite(
  req: Request,
): Promise<{ session: Session; error: NextResponse | null }> {
  const session = sessionOf(req);
  if (!session) return { session: null as unknown as Session, error: unauthorized() };

  if (!csrfOk(req, session)) return { session, error: forbidden() };

  const limit = await consumeRateLimit(session.address, WRITE_LIMIT, 60);
  if (!limit.ok) return { session, error: tooMany(limit.resetSeconds) };
  return { session, error: null };
}

/** The owner scope for every per-visitor record. */
export function ownerOf(session: Session): string {
  return session.address.toLowerCase();
}
