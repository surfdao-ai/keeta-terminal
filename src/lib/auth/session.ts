/**
 * Sessions, nonces, CSRF and rate limiting.
 *
 * A session is a stateless, HMAC-signed token that names the wallet address
 * the visitor signed in with. There is no server-side session store and no
 * key material: the cookie proves *which wallet* you are, never what you can
 * sign. The cookie itself carries a CSRF token that has to be echoed in a
 * header on every mutating request.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { dbRead, dbUpdate } from '../db';

export const SESSION_COOKIE = 'kt_session';
export const CSRF_COOKIE = 'kt_csrf';

const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours
const NONCE_TTL_MS = 5 * 60 * 1000;

export interface Session {
  address: string;
  csrf: string;
  exp: number;
}

/** The server-side signing secret. Without it there are no sessions. */
function serverKey(): Buffer | null {
  const raw = process.env.SESSION_SECRET || process.env.AUTOMATION_KEY;
  if (!raw || raw.length < 16) return null;
  return scryptSync(raw, 'kterminal-session-v1', 32);
}

function sign(body: string): string {
  const key = serverKey();
  if (!key) throw new Error('No session secret configured (set SESSION_SECRET).');
  return createHmac('sha256', key).update(body).digest('base64url');
}

export function createSession(address: string): { token: string; csrf: string } {
  const csrf = randomBytes(24).toString('base64url');
  const payload: Session = {
    address,
    csrf,
    exp: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${body}.${sign(body)}`, csrf };
}

export function verifySession(token: string | undefined | null): Session | null {
  if (!token) return null;
  const key = serverKey();
  if (!key) return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let expected: string;
  try {
    expected = sign(body);
  } catch {
    return null;
  }

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Session;
    if (typeof payload.address !== 'string' || !payload.address.startsWith('keeta_')) return null;
    if (typeof payload.csrf !== 'string') return null;
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/** The session cookie value for a request, if it is valid. */
export function sessionFromRequest(req: Request): Session | null {
  const cookie = req.headers.get('cookie') ?? '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return verifySession(match?.[1]);
}

/**
 * The CSRF check: the header must carry the token that was issued with the
 * session. Combined with SameSite=strict this stops another site from
 * driving the API with the visitor's cookie.
 */
export function csrfOk(req: Request, session: Session): boolean {
  const header = req.headers.get('x-kt-csrf');
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(session.csrf);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ *
 * One-time nonces (the sign-in challenge)
 * ------------------------------------------------------------------ */

export async function issueNonce(): Promise<{ nonce: string; expiresAt: number }> {
  const nonce = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + NONCE_TTL_MS;
  await dbWriteNonce(nonce, expiresAt);
  return { nonce, expiresAt };
}

/** Consume a nonce — it works exactly once. */
export async function consumeNonce(nonce: string): Promise<boolean> {
  let ok = false;
  await dbUpdate<{ expiresAt: number } | null>(`authnonce:${nonce}`, (current) => {
    if (!current || current.expiresAt < Date.now()) return null;
    ok = true;
    return null; // burn it
  });
  return ok;
}

async function dbWriteNonce(nonce: string, expiresAt: number): Promise<void> {
  await dbUpdate<{ expiresAt: number } | null>(`authnonce:${nonce}`, () => ({ expiresAt }));
}

/* ------------------------------------------------------------------ *
 * Rate limiting (per session, fixed window)
 * ------------------------------------------------------------------ */

export interface RateLimit {
  ok: boolean;
  remaining: number;
  resetSeconds: number;
}

/** Count one request against a session's budget for this window. */
export async function consumeRateLimit(
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimit> {
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `ratelimit:${scope}:${window}`;
  let count = 0;

  await dbUpdate<number>(key, (current) => {
    count = (typeof current === 'number' ? current : 0) + 1;
    return count;
  });

  const resetSeconds = windowSeconds - Math.floor((Date.now() % (windowSeconds * 1000)) / 1000);
  return { ok: count <= limit, remaining: Math.max(0, limit - count), resetSeconds };
}

/** Read a counter without consuming it (for headers). */
export async function peekRateLimit(
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimit> {
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const current = await dbRead<number>(`ratelimit:${scope}:${window}`);
  const count = typeof current === 'number' ? current : 0;
  const resetSeconds = windowSeconds - Math.floor((Date.now() % (windowSeconds * 1000)) / 1000);
  return { ok: count < limit, remaining: Math.max(0, limit - count), resetSeconds };
}
