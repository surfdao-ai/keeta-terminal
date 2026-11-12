/**
 * Verify the Blob compare-and-set semantics that dbUpdate() relies on.
 *
 *   1. put            -> etag
 *   2. put ifMatch    -> succeeds, new etag
 *   3. put ifMatch    -> with the stale etag must fail
 *   4. put (no overwrite) on an existing object must fail
 *
 * Usage: ENV_FILE=/path/to/.env.prod node scripts/blob-cas-test.mjs
 */
import { readFileSync } from 'node:fs';
import { put, del, get } from '@vercel/blob';

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

const storeId = process.env.BLOB_STORE_ID || 'store_d3z9w2jDRenHC1pO';
const token = env.BLOB_READ_WRITE_TOKEN;
const path = 'kt-kv/cas-probe.json';
const base = { access: 'private', contentType: 'application/json', addRandomSuffix: false, storeId, token };

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
};

try {
  const first = await put(path, JSON.stringify({ v: 1 }), base);
  console.log('etag after first put:', first.etag);
  check('put returns an etag', typeof first.etag === 'string' && first.etag.length > 0);

  const second = await put(path, JSON.stringify({ v: 2 }), { ...base, ifMatch: first.etag });
  check('put with a current ifMatch succeeds', second.etag !== first.etag);

  let staleRejected = false;
  try {
    await put(path, JSON.stringify({ v: 3 }), { ...base, ifMatch: first.etag });
  } catch (e) {
    staleRejected = /precondition/i.test(`${e.name} ${e.message}`);
    console.log('   stale ifMatch rejected with:', e.name, '-', String(e.message).slice(0, 90));
  }
  check('put with a stale ifMatch is rejected', staleRejected);

  let existsRejected = false;
  try {
    await put(path, JSON.stringify({ v: 4 }), { ...base, allowOverwrite: false });
  } catch (e) {
    existsRejected = /already exists/i.test(String(e.message));
    console.log('   duplicate put rejected with:', e.name, '-', String(e.message).slice(0, 90));
  }
  check('put without overwrite on an existing object is rejected', existsRejected);

  const read = await get(path, { ...base, useCache: false });
  const text = read && read.statusCode === 200 ? await new Response(read.stream).text() : '';
  check('the winning value is the one that was read back', text.includes('"v":2'));
} finally {
  await del(path, { storeId, token }).catch(() => undefined);
}

console.log(failures === 0 ? '\nall CAS checks passed' : `\n${failures} CAS check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
