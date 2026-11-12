/**
 * In-memory session map for a single-user terminal.
 * Maps session id -> { passphrase, expiresAt }.
 *
 * On cold start (e.g. new serverless instance) the session is gone and the
 * user must unlock again. That is acceptable for a personal terminal.
 */
export interface Session {
  passphrase: string;
  expiresAt: number;
}

const SESSIONS = new Map<string, Session>();
const TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export function createSession(passphrase: string): string {
  const id = crypto.randomUUID();
  SESSIONS.set(id, { passphrase, expiresAt: Date.now() + TTL_MS });
  return id;
}

export function getSession(id: string | undefined | null): Session | null {
  if (!id) return null;
  const s = SESSIONS.get(id);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    SESSIONS.delete(id);
    return null;
  }
  return s;
}

export function destroySession(id: string | undefined | null): void {
  if (id) SESSIONS.delete(id);
}
