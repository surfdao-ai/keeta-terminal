/**
 * Session handling for a single-user terminal.
 *
 * The cookie carries an encrypted token, not an id: the passphrase is sealed
 * with a server-side key (AES-256-GCM) and unsealed on every request. That
 * keeps the session valid across serverless instances — a plain in-memory map
 * loses the unlock as soon as the next request lands on another instance,
 * which makes "unlock, then trade" unreliable.
 *
 * Nothing is written to the database: the passphrase is never stored at rest
 * on the server, only inside the user's own httpOnly cookie.
 *
 * When no server key is configured (local development without AUTOMATION_KEY)
 * the session falls back to an in-memory map, which is fine for one process.
 */
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export interface Session {
  passphrase: string;
  expiresAt: number;
}

const SESSIONS = new Map<string, Session>();
const TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

const IV_LEN = 12;
const TAG_LEN = 16;

/** Derive the session sealing key from the server secret. */
function sessionKey(): Buffer | null {
  const raw = process.env.AUTOMATION_KEY ?? process.env.SESSION_SECRET;
  if (!raw || raw.length < 16) return null;
  return scryptSync(raw, 'kterminal-session-key', 32);
}

/** Encode the passphrase into a self-contained, tamper-proof cookie value. */
function seal(passphrase: string, expiresAt: number): string {
  const key = sessionKey()!;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(passphrase, 'utf8'), cipher.final()]);
  const token = Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
  return `${token}.${expiresAt}`;
}

/** Unseal a cookie value; returns null when it is invalid or expired. */
function unseal(value: string): Session | null {
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const expiresAt = Number(value.slice(dot + 1));
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  const key = sessionKey();
  if (!key) return null;

  try {
    const raw = Buffer.from(value.slice(0, dot), 'base64url');
    if (raw.length <= IV_LEN + TAG_LEN) return null;
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = raw.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const passphrase = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    return { passphrase, expiresAt };
  } catch {
    return null;
  }
}

export function createSession(passphrase: string): string {
  const expiresAt = Date.now() + TTL_MS;
  const id = sessionKey() ? seal(passphrase, expiresAt) : crypto.randomUUID();
  // Keep a copy in memory so repeated requests skip the unseal.
  SESSIONS.set(id, { passphrase, expiresAt });
  return id;
}

export function getSession(id: string | undefined | null): Session | null {
  if (!id) return null;

  const cached = SESSIONS.get(id);
  if (cached) {
    if (Date.now() > cached.expiresAt) {
      SESSIONS.delete(id);
      return null;
    }
    return cached;
  }

  // Not in this instance — the cookie may have been sealed elsewhere.
  const session = unseal(id);
  if (session) SESSIONS.set(id, session);
  return session;
}

export function destroySession(id: string | undefined | null): void {
  if (id) SESSIONS.delete(id);
}
