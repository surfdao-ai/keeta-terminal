/**
 * Simple persistent store for a single-user terminal.
 *
 * - With DATABASE_URL: Postgres key/value table.
 * - Without: a JSON file under .data/ (development convenience).
 *
 * Stored keys:
 *   wallet      — { seedCiphertext, seedIv, seedTag, salt, address, createdAt }
 *   trades      — array of executed trades (append-only log)
 *   cap:<date>  — { spentUsd } daily cap counter, keyed by UTC date
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'terminal.json');

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
      const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });
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

export async function dbRead<T = unknown>(key: string): Promise<T | null> {
  const db = usePostgres() ? await getPostgres() : fileDB;
  return (await db.read(key)) as T | null;
}

export async function dbWrite(key: string, value: unknown): Promise<void> {
  const db = usePostgres() ? await getPostgres() : fileDB;
  await db.write(key, value);
}
