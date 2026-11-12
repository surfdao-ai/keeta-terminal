/**
 * Probe Vercel Blob read-after-write behaviour for the terminal's KV store.
 * Usage: node scripts/blob-probe.mjs   (expects .env.local with BLOB_READ_WRITE_TOKEN)
 */
import { readFileSync } from 'node:fs';
import { put, get } from '@vercel/blob';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [l.slice(0, i).trim(), v];
    }),
);

const storeId = process.env.BLOB_STORE_ID || 'store_6tq8TktycaLduDxz';
const token = env.BLOB_READ_WRITE_TOKEN;
const opts = { access: 'private', storeId, token };

const path = 'kt-kv/probe-read-after-write.json';
const payload = { writtenAt: new Date().toISOString(), n: Math.random() };

await put(path, JSON.stringify(payload), { ...opts, contentType: 'application/json', allowOverwrite: true });
console.log('put   ->', payload);

const res = await get(path, opts);
const text = res && res.statusCode === 200 ? await new Response(res.stream).text() : '<none>';
console.log('get   ->', text);
console.log('match ->', text === JSON.stringify(payload));

const again = await get(path, opts);
const text2 = again && again.statusCode === 200 ? await new Response(again.stream).text() : '<none>';
console.log('get2  ->', text2);
console.log('stable ->', text2 === text);

// Overwrite the same path, then read again: does the CDN serve the old body?
const v2 = { writtenAt: new Date().toISOString(), n: Math.random(), revision: 2 };
await put(path, JSON.stringify(v2), { ...opts, contentType: 'application/json', allowOverwrite: true });
console.log('\nput2  ->', v2);
for (let i = 1; i <= 3; i++) {
  const r = await get(path, opts);
  const t = r && r.statusCode === 200 ? await new Response(r.stream).text() : '<none>';
  console.log(`get-after-overwrite #${i} ->`, t, '| fresh =', t === JSON.stringify(v2));
}
