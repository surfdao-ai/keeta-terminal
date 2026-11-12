/**
 * Persistent store for a single-user terminal.
 *
 * Backends, in order of preference:
 *   1. Postgres — DATABASE_URL is set (marketplace Neon/Supabase/…).
 *   2. Blob     — BLOB_STORE_ID is set (Vercel Blob, private store, OIDC creds).
 *   3. File     — a JSON file under .data/ (local development only).
 *
 * The file backend cannot work on Vercel Functions: the bundle is mounted
 * read-only, so every write fails with ENOENT and each instance would see a
 * different store. On Vercel we therefore fail loudly instead of silently
 * falling back to the file.
 *
 * Every backend supports compare-and-set: a writer states the revision it
 * read, and the write only lands if nothing changed in between. That is what
 * makes read-modify-write safe when the cron tick and the UI write to the
 * same list at the same time — see dbUpdate().
 *
 * Stored keys:
 *   wallet      — { seedCiphertext, seedIv, seedTag, salt, address, createdAt }
 *   trades      — array of executed trades (append-only log)
 *   cap:<date>  — { spentUsd } daily cap counter, keyed by UTC date
 *   automations — list of price alerts / recurring swaps
 *   chats       — saved chat history
 */
import { promises as fs, accessSync, constants } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'terminal.json');
const BLOB_PREFIX = 'kt-kv';

type KV = Record<string, unknown>;

/** A stored value together with the revision it was read at. */
export interface KVEntry<T = unknown> {
  value: T | null;
  rev: string | null;
}

/** Raised when another writer changed the key since it was read. */
export class StoreConflictError extends Error {
  constructor(key: string) {
    super(`Concurrent modification of "${key}"`);
    this.name = 'StoreConflictError';
  }
}

interface KVBackend {
  read<T>(key: string): Promise<KVEntry<T>>;
  /** Compare-and-set: write only if the stored revision is still `expectedRev`. */
  write<T>(key: string, value: T, expectedRev: string | null): Promise<string | null>;
  /** Unconditional overwrite (last writer wins). */
  overwrite<T>(key: string, value: T): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * File backend (development only)
 * ------------------------------------------------------------------ */

async function writeFileKey(key: string, value: unknown): Promise<void> {
  let parsed: KV = {};
  try {
    parsed = (JSON.parse(await fs.readFile(DATA_FILE, 'utf8')) as KV) ?? {};
  } catch {
    /* first write */
  }
  parsed[key] = value;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(parsed, null, 2));
}

const fileDB: KVBackend = {
  async read<T>(key: string) {
    try {
      const raw = await fs.readFile(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw) as KV;
      return { value: (parsed[key] ?? null) as T | null, rev: null };
    } catch {
      return { value: null as T | null, rev: null };
    }
  },
  async write<T>(key: string, value: T) {
    // Single-process dev store: there is no revision to compare against.
    await writeFileKey(key, value);
    return null;
  },
  async overwrite<T>(key: string, value: T) {
    await writeFileKey(key, value);
  },
};

/* ------------------------------------------------------------------ *
 * Postgres backend
 * ------------------------------------------------------------------ */

interface PgDB extends KVBackend {
  sql: unknown;
}

let pgPromise: Promise<PgDB> | null = null;

async function getPostgres(): Promise<PgDB> {
  if (!pgPromise) {
    pgPromise = (async () => {
      const postgres = (await import('postgres')).default;
      const sql = postgres(process.env.DATABASE_URL!, {
        ssl: 'require',
        // Serverless-friendly pool: few connections, released between requests.
        max: 5,
        idle_timeout: 20,
        connect_timeout: 10,
        // Pooler-safe: no server-side prepared statements.
        prepare: false,
      });
      await sql`CREATE TABLE IF NOT EXISTS kt_store (key text primary key, value jsonb not null, rev integer not null default 0, updated timestamptz not null default now())`;
      // Deployments before the revision column existed still have rows.
      await sql`ALTER TABLE kt_store ADD COLUMN IF NOT EXISTS rev integer not null default 0`;
      return {
        sql,
        async read<T>(key: string) {
          const rows = await sql`SELECT value, rev FROM kt_store WHERE key = ${key}`;
          const row = rows[0] as { value: unknown; rev: number } | undefined;
          return { value: (row?.value ?? null) as T | null, rev: row ? String(row.rev) : null };
        },
        async write<T>(key: string, value: T, expectedRev: string | null) {
          if (expectedRev === null) {
            // Create only when the key is still absent.
            const res = await sql`INSERT INTO kt_store (key, value, rev) VALUES (${key}, ${sql.json(
              value as object,
            )}, 1) ON CONFLICT (key) DO NOTHING`;
            if (res.count === 0) throw new StoreConflictError(key);
            return '1';
          }
          const res = await sql`UPDATE kt_store SET value = ${sql.json(
            value as object,
          )}, rev = rev + 1, updated = now() WHERE key = ${key} AND rev = ${Number(expectedRev)}`;
          if (res.count === 0) throw new StoreConflictError(key);
          return String(Number(expectedRev) + 1);
        },
        async overwrite<T>(key: string, value: T) {
          await sql`INSERT INTO kt_store (key, value, rev) VALUES (${key}, ${sql.json(
            value as object,
          )}, 1) ON CONFLICT (key) DO UPDATE SET value = excluded.value, rev = kt_store.rev + 1, updated = now()`;
        },
      };
    })();
  }
  return pgPromise;
}

function hasPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/* ------------------------------------------------------------------ *
 * Blob backend: one JSON object per key in a private Vercel Blob store.
 * ------------------------------------------------------------------ */

/** Blob pathnames only allow a safe character set, so map + hash the key. */
function blobPath(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${BLOB_PREFIX}/${safe}.${h.toString(16)}.json`;
}

function isBlobNotFound(e: unknown): boolean {
  const name = (e as { name?: string })?.name ?? '';
  const msg = (e as { message?: string })?.message ?? '';
  return name === 'BlobNotFoundError' || /not found/i.test(msg);
}

/** The write did not land because someone else changed the object first. */
function isBlobConflict(e: unknown): boolean {
  const name = (e as { name?: string })?.name ?? '';
  const msg = (e as { message?: string })?.message ?? '';
  return (
    name === 'BlobPreconditionFailedError' ||
    // "This blob already exists" — the object appeared since we read it.
    /already exists/i.test(msg) ||
    // "Precondition failed: ETag mismatch" — the object changed since we read it.
    /precondition/i.test(msg) ||
    // "The conditional request cannot succeed due to a conflicting operation
    // against this resource" — another writer is mid-flight on the same object.
    /conflicting operation/i.test(msg) ||
    /conditional request/i.test(msg)
  );
}

/**
 * If-Match only accepts *strong* validators. Blob's GET response can hand
 * back a weak one ("W/\"abc\""), which never matches on write — so strip the
 * weak prefix and compare with the strong form.
 */
function strongEtag(etag: string | null | undefined): string | null {
  if (!etag) return null;
  return etag.startsWith('W/') ? etag.slice(2) : etag;
}

const blobDB: KVBackend = {
  async read<T>(key: string) {
    const { get } = await import('@vercel/blob');
    try {
      // Pin the same store the writer uses; never fall back to OIDC/store-id
      // resolution, which could point at a different store than the token.
      // useCache: false reads from origin storage — the CDN copy of an
      // overwritten object is stale for a short while.
      const res = await get(blobPath(key), {
        access: 'private',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        useCache: false,
      });
      if (!res || res.statusCode !== 200) return { value: null as T | null, rev: null };
      const text = await new Response(res.stream).text();
      const rev = strongEtag(res.blob.etag);
      return { value: JSON.parse(text) as T, rev };
    } catch (e) {
      if (isBlobNotFound(e)) return { value: null as T | null, rev: null };
      throw e;
    }
  },
  async write<T>(key: string, value: T, expectedRev: string | null) {
    const { put } = await import('@vercel/blob');
    try {
      const res = await put(blobPath(key), JSON.stringify(value), {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        token: process.env.BLOB_READ_WRITE_TOKEN,
        // With a known revision the write is conditional; without one the
        // write must fail if the object appeared in the meantime.
        ...(expectedRev ? { ifMatch: expectedRev } : { allowOverwrite: false }),
      });
      return res.etag;
    } catch (e) {
      if (isBlobConflict(e)) throw new StoreConflictError(key);
      throw e;
    }
  },
  async overwrite<T>(key: string, value: T) {
    const { put } = await import('@vercel/blob');
    await put(blobPath(key), JSON.stringify(value), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      // Same key -> same object: overwrite in place.
      allowOverwrite: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
  },
};

function hasBlob(): boolean {
  return Boolean(process.env.BLOB_STORE_ID);
}

export type BackendName = 'postgres' | 'blob' | 'file';

let cwdWritable: boolean | null = null;

/**
 * Vercel Functions mount the bundle read-only (/var/task), so the working
 * directory is not writable there. That is the reliable signal that we are
 * running on Vercel — the VERCEL* env vars are also present in local
 * .env.local files.
 */
function isRuntimeWritable(): boolean {
  if (cwdWritable === null) {
    try {
      accessSync(process.cwd(), constants.W_OK);
      cwdWritable = true;
    } catch {
      cwdWritable = false;
    }
  }
  return cwdWritable;
}

/**
 * KV_BACKEND pins the backend (postgres | blob | file). Unset means
 * auto-detect: Postgres, then Blob (on Vercel, where the store is connected
 * with OIDC credentials), then the local file store.
 */
function selectedBackend(): BackendName {
  const forced = process.env.KV_BACKEND?.trim().toLowerCase();
  if (forced === 'postgres' || forced === 'blob' || forced === 'file') return forced;
  if (hasPostgres()) return 'postgres';
  // Blob auth relies on the Vercel OIDC token (or a read-write token).
  if (hasBlob() && (process.env.VERCEL_OIDC_TOKEN || process.env.BLOB_READ_WRITE_TOKEN)) return 'blob';
  return 'file';
}

async function backend(): Promise<KVBackend> {
  const name = selectedBackend();
  if (name === 'postgres') return getPostgres();
  if (name === 'blob') return blobDB;
  // A read-only runtime means the file store cannot work at all: surface the
  // misconfiguration instead of silently losing every write.
  if (!isRuntimeWritable()) {
    throw new Error(
      'No persistent store configured. Set DATABASE_URL (Postgres) or BLOB_STORE_ID (Vercel Blob) for this environment.',
    );
  }
  return fileDB;
}

export async function dbRead<T = unknown>(key: string): Promise<T | null> {
  const db = await backend();
  return (await db.read<T>(key)).value;
}

export async function dbWrite(key: string, value: unknown): Promise<void> {
  const db = await backend();
  await db.overwrite(key, value);
}

/**
 * Per-key mutex, per instance.
 *
 * Compare-and-set already protects against writers in *other* instances, but
 * writers inside one instance would keep colliding with each other (each
 * round only one wins). Serialising them locally turns a thundering herd
 * into a queue.
 */
const keyLocks = new Map<string, Promise<void>>();

async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = keyLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => gate);
  keyLocks.set(key, chain);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (keyLocks.get(key) === chain) keyLocks.delete(key);
  }
}

/**
 * Read-modify-write with optimistic concurrency.
 *
 * `mutate` receives the current value and returns the new one. If another
 * writer changed the key in between, the write is rejected and the whole
 * read-modify-write is retried against the fresh value — so a concurrent
 * update is never silently lost.
 *
 * Each round only one writer can win (everybody else holds a stale
 * revision), so a burst of writers drains one per round. The retry therefore
 * backs off exponentially with jitter, which spreads the writers out instead
 * of letting them collide again on the next attempt.
 *
 * `mutate` may run more than once and must therefore be side-effect free.
 */
export async function dbUpdate<T>(
  key: string,
  mutate: (current: T | null) => T | Promise<T>,
  opts?: { attempts?: number },
): Promise<T> {
  const attempts = opts?.attempts ?? 20;
  const db = await backend();

  return withKeyLock(key, async () => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      // Desynchronise the writers before reading.
      if (attempt > 0) await sleep(Math.random() * 15);

      const { value, rev } = await db.read<T>(key);
      const next = await mutate(value);
      try {
        await db.write(key, next, rev);
        return next;
      } catch (e) {
        if (!(e instanceof StoreConflictError)) throw e;
        // Someone else wrote first — back off and retry against their value.
        const backoff = Math.min(20 * 2 ** attempt, 500) * (0.5 + Math.random());
        await sleep(backoff);
      }
    }

    // The conditional retries did not converge (a burst of writers across
    // several instances). Merge onto the freshest value and force the write:
    // the merge still applies our change to whatever is stored now, so the
    // common case keeps every writer's data.
    const { value } = await db.read<T>(key);
    const next = await mutate(value);
    console.error(`[kv] "${key}" fell back to a forced write after ${attempts} conflicting attempts`);
    await db.overwrite(key, next);
    return next;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
