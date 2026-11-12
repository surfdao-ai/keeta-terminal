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
 * Stored keys:
 *   wallet      — { seedCiphertext, seedIv, seedTag, salt, address, createdAt }
 *   trades      — array of executed trades (append-only log)
 *   cap:<date>  — { spentUsd } daily cap counter, keyed by UTC date
 *   automations — list of price alerts / recurring swaps
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'terminal.json');
const BLOB_PREFIX = 'kt-kv';

type KV = Record<string, unknown>;

interface FileDB {
  read(key: string): Promise<unknown | null>;
  write(key: string, value: unknown): Promise<void>;
}

const fileDB: FileDB = {
  async read(key) {
    try {
      const raw = await fs.readFile(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw) as KV;
      return parsed[key] ?? null;
    } catch {
      return null;
    }
  },
  async write(key, value) {
    let parsed: KV = {};
    try {
      parsed = (JSON.parse(await fs.readFile(DATA_FILE, 'utf8')) as KV) ?? {};
    } catch {
      /* first write */
    }
    parsed[key] = value;
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(parsed, null, 2));
  },
};

interface PgDB extends FileDB {
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
      await sql`CREATE TABLE IF NOT EXISTS kt_store (key text primary key, value jsonb not null, updated timestamptz not null default now())`;
      return {
        sql,
        async read(key) {
          const rows = await sql`SELECT value FROM kt_store WHERE key = ${key}`;
          return (rows[0] as { value: unknown } | undefined)?.value ?? null;
        },
        async write(key, value) {
          await sql`INSERT INTO kt_store (key, value) VALUES (${key}, ${sql.json(
            value as object,
          )}) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated = now()`;
        },
      };
    })();
  }
  return pgPromise;
}

function usePostgres(): boolean {
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

const blobDB: FileDB = {
  async read(key) {
    const { get } = await import('@vercel/blob');
    try {
      const res = await get(blobPath(key), { access: 'private' });
      if (!res || res.statusCode !== 200) return null;
      const text = await new Response(res.stream).text();
      return JSON.parse(text) as unknown;
    } catch (e) {
      if (isBlobNotFound(e)) return null;
      throw e;
    }
  },
  async write(key, value) {
    const { put } = await import('@vercel/blob');
    await put(blobPath(key), JSON.stringify(value), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
  },
};

function useBlob(): boolean {
  return Boolean(process.env.BLOB_STORE_ID);
}

export type BackendName = 'postgres' | 'blob' | 'file';

/**
 * KV_BACKEND pins the backend (postgres | blob | file). Unset means
 * auto-detect: Postgres, then Blob, then the local file store.
 */
function selectedBackend(): BackendName {
  const forced = process.env.KV_BACKEND?.trim().toLowerCase();
  if (forced === 'postgres' || forced === 'blob' || forced === 'file') return forced;
  if (usePostgres()) return 'postgres';
  if (useBlob()) return 'blob';
  return 'file';
}

async function backend(): Promise<FileDB> {
  const name = selectedBackend();
  if (name === 'postgres') return getPostgres();
  if (name === 'blob') return blobDB;
  // On Vercel a missing store is a configuration error, not a reason to fall
  // back to the (unusable) file backend — surface it instead.
  if (process.env.VERCEL) {
    throw new Error(
      'No persistent store configured. Set DATABASE_URL (Postgres) or BLOB_STORE_ID (Vercel Blob); ' +
        'set KV_BACKEND=file to explicitly opt out of durable storage.',
    );
  }
  return fileDB;
}

export async function dbRead<T = unknown>(key: string): Promise<T | null> {
  const db = await backend();
  return (await db.read(key)) as T | null;
}

export async function dbWrite(key: string, value: unknown): Promise<void> {
  const db = await backend();
  await db.write(key, value);
}
