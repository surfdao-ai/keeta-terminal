/**
 * One-off migration: copy the KV objects from the Vercel Blob store into the
 * Postgres store (the app prefers Postgres as soon as DATABASE_URL is set).
 *
 * Usage:
 *   DATABASE_URL=postgres://... BLOB_READ_WRITE_TOKEN=... \
 *   BLOB_STORE_ID=store_... node scripts/migrate-blob-to-postgres.mjs
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { list, get } from '@vercel/blob';

const envFile = process.env.ENV_FILE;
const env = envFile
  ? Object.fromEntries(
      readFileSync(envFile, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=');
          let v = l.slice(i + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
          return [l.slice(0, i).trim(), v];
        }),
    )
  : process.env;

const databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL;
const token = process.env.BLOB_READ_WRITE_TOKEN || env.BLOB_READ_WRITE_TOKEN;
const storeId = process.env.BLOB_STORE_ID || env.BLOB_STORE_ID;

if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (!token) {
  console.error('BLOB_READ_WRITE_TOKEN is required');
  process.exit(1);
}

const sql = postgres(databaseUrl, { ssl: 'require', max: 2, prepare: false });
await sql`CREATE TABLE IF NOT EXISTS kt_store (key text primary key, value jsonb not null, rev integer not null default 0, updated timestamptz not null default now())`;
await sql`ALTER TABLE kt_store ADD COLUMN IF NOT EXISTS rev integer not null default 0`;

const { blobs } = await list({ access: 'private', storeId, token, prefix: 'kt-kv/' });
console.log(`blob objects: ${blobs.length}`);

let moved = 0;
for (const b of blobs) {
  // The key is the object path minus the prefix and the trailing ".json"; the
  // hash suffix is dropped — the app looks keys up by their plain name.
  const key = b.pathname.replace(/^kt-kv\//, '').replace(/\.[0-9a-f]+\.json$/, '');
  const res = await get(b.pathname, { access: 'private', storeId, token, useCache: false });
  if (!res || res.statusCode !== 200) continue;
  const value = JSON.parse(await new Response(res.stream).text());

  const existing = await sql`SELECT value FROM kt_store WHERE key = ${key}`;
  if (existing.length) {
    console.log(`  skip ${key} (already in postgres)`);
    continue;
  }
  await sql`INSERT INTO kt_store (key, value, rev) VALUES (${key}, ${sql.json(value)}, 1)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, rev = kt_store.rev + 1, updated = now()`;
  console.log(`  moved ${key}`);
  moved++;
}

const rows = await sql`SELECT key, rev FROM kt_store ORDER BY key`;
console.log(`\nmoved ${moved} key(s); postgres now holds:`, rows.map((r) => r.key).join(', ') || '(empty)');
await sql.end();
