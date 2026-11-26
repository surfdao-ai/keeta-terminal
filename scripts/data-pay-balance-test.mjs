/**
 * Balance-gate e2e for the x402 data-payment submit route.
 *
 * Two phases driven by PHASE so the store can be seeded while the server is
 * stopped (the file backend forbids concurrent out-of-band writes):
 *
 *   PHASE=seed   npx tsx scripts/data-pay-balance-test.mjs   (server DOWN)
 *     generates a wallet, writes one pending payment (the live keespecs
 *     requirement) into .data, and saves the seed+address to a temp file.
 *
 *   PHASE=submit npx tsx scripts/data-pay-balance-test.mjs   (server UP)
 *     signs in as that wallet, fetches the requirement, submits a block, and
 *     asserts the unfunded wallet is refused with 409 and no cap charge.
 *
 * A real 0.01 settle needs a funded wallet (same known limitation as trades).
 */
import fs from 'node:fs';
import path from 'node:path';
import KeetaNet from '@keetanetwork/keetanet-client';

const BASE = process.env.BASE || 'http://localhost:3111';
const PHASE = process.env.PHASE || 'seed';
const DATA_FILE = path.join(process.cwd(), '.data', 'terminal.json');
const META = '/tmp/kt-data-pay-meta.json';

const PAYTO = 'keeta_aabz6zxbs2n4r7iiobclndobrnowxdf4pjrb5lwe6bvpeo564bot6krjbrsbbvy';
const USDC = 'keeta_amnkge74xitii5dsobstldatv3irmyimujfjotftx7plaaaseam4bntb7wnna';
const REQ = {
  scheme: 'exact',
  network: 'keeta:21378',
  amount: '10000', // 0.01 USDC
  asset: USDC,
  payTo: PAYTO,
};

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.error(`FAIL  ${name} ${extra}`); }
}

if (PHASE === 'seed') {
  const seed = KeetaNet.lib.Account.generateRandomSeed({ asString: true });
  const account = KeetaNet.lib.Account.fromSeed(seed, 0);
  const address = account.publicKeyString.get();
  const owner = address.toLowerCase();

  const paymentId = 'e2e-balance-gate-1';
  const pending = {
    id: paymentId,
    payUrl: 'https://keespecs.xyz/api/status',
    label: 'ledger status',
    requirement: REQ,
    priceUsd: 0.01,
    createdAt: Date.now(),
    expiresAt: Date.now() + 120_000,
  };

  let store = {};
  try { store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { /* first write */ }
  const key = `u:${owner}:dataPayments`;
  store[key] = [pending];
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));

  fs.writeFileSync(META, JSON.stringify({ seed, address, paymentId }, null, 2));
  console.log(`seeded pending payment for ${address.slice(0, 16)}… id=${paymentId}`);
  process.exit(0);
}

// --- submit phase ---
const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
const { seed, address, paymentId } = meta;
const account = KeetaNet.lib.Account.fromSeed(seed, 0);

const cookies = new Map();
async function req(p, { method = 'GET', json } = {}) {
  const headers = { accept: 'application/json' };
  if (json) headers['content-type'] = 'application/json';
  if (cookies.size) headers.cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const csrf = cookies.get('kt_csrf');
  if (csrf && method === 'POST') headers['x-kt-csrf'] = csrf;
  const res = await fetch(`${BASE}${p}`, { method, headers, body: json ? JSON.stringify(json) : undefined, redirect: 'manual' });
  for (const set of res.headers.getSetCookie?.() ?? []) {
    const [pair] = set.split(';'); const i = pair.indexOf('='); cookies.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return res;
}

// sign in
const n = await (await req('/api/auth/nonce', { method: 'POST' })).json();
const sig = await account.sign(new TextEncoder().encode(n.nonce).buffer);
const login = await req('/api/auth/login', { method: 'POST', json: { address, nonce: n.nonce, signature: Buffer.from(sig.getBuffer()).toString('base64') } });
check('signed in as the seeded wallet', login.status === 200, JSON.stringify(await login.clone().json()).slice(0, 60));

// the GET requirement route returns the stored (server-validated) requirement
const g = await req('/api/data-pay', { method: 'POST', json: { paymentId } });
const gj = await g.json();
check('GET requirement returns the stored payee', g.status === 200 && gj.requirement?.payTo === PAYTO, JSON.stringify(gj).slice(0, 120));
check('GET requirement reports 0.01 price', gj.priceUsd === 0.01);

// capture the cap before
const before = (await (await req('/api/state')).json()).dataCap;

// submit a signed block (the wallet is unfunded, so the server must refuse
// on balance BEFORE fetching the merchant or charging the cap).
const s = await req('/api/data-pay/submit', { method: 'POST', json: { paymentId, signedBlock: 'AAAA' } });
const sj = await s.json();
check('unfunded wallet -> 409', s.status === 409, `got ${s.status}`);
check('error mentions USDC/fund', /USDC|fund/i.test(sj.error ?? ''), sj.error ?? '');

// the cap must be untouched — nothing was charged for a refused payment
const after = (await (await req('/api/state')).json()).dataCap;
check('cap not charged for a refused payment', after.spentUsd === before.spentUsd, `before=${before.spentUsd} after=${after.spentUsd}`);

// the pending payment survives a balance refusal (retry after funding within
// its TTL; replaying the same signed block dedupes on the ledger)
const g2 = await req('/api/data-pay', { method: 'POST', json: { paymentId } });
check('refused payment is still retriable', g2.status === 200, `got ${g2.status}`);

// a second refusal must not charge the cap either (no leak on repeat)
const s2 = await req('/api/data-pay/submit', { method: 'POST', json: { paymentId, signedBlock: 'AAAA' } });
check('second refusal also 409', s2.status === 409, `got ${s2.status}`);
const after2 = (await (await req('/api/state')).json()).dataCap;
check('cap still untouched after repeat refusal', after2.spentUsd === before.spentUsd, `after=${after2.spentUsd}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
