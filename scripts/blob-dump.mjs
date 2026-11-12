/**
 * Dump the terminal's KV objects from a Vercel Blob store.
 * Usage: node scripts/blob-dump.mjs [storeId]
 */
import { readFileSync } from 'node:fs';
import { list, get } from '@vercel/blob';

const envFile = process.env.ENV_FILE ?? new URL('../.env.local', import.meta.url).pathname;
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [l.slice(0, i).trim(), v];
    }),
);

const storeId = process.argv[2] ?? 'store_6tq8TktycaLduDxz';
const token = env.BLOB_READ_WRITE_TOKEN;
const opts = { access: 'private', storeId, token, prefix: 'kt-kv/' };

console.log(`store: ${storeId}\n`);
const { blobs } = await list(opts);
console.log(`objects: ${blobs.length}\n`);
for (const b of blobs) {
  const res = await get(b.pathname, { access: 'private', storeId, token, useCache: false });
  const text = res && res.statusCode === 200 ? await new Response(res.stream).text() : '<none>';
  console.log(`${b.pathname}  (${b.size}B, uploaded ${b.uploadedAt.toISOString()})`);
  console.log(`  ${text.slice(0, 500)}\n`);
}
