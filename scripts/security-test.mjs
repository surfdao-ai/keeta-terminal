/**
 * Security acceptance test.
 *
 *   1. No session -> 401 on the protected routes
 *   2. Two wallets -> each sees only its own state
 *   3. The sign-in flow (nonce -> signature -> session) works
 *   4. No request body carries a seed
 *
 * Usage: BASE=http://localhost:3000 node scripts/security-test.mjs
 */
import * as KeetaNet from '@keetanetwork/keetanet-client';

const BASE = process.env.BASE ?? 'http://localhost:3000';
let failures = 0;

const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

/** A browser-like client: its own cookie jar, its own wallet. */
function makeBrowser(label) {
  const cookies = new Map();
  const cookieHeader = () =>
    [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

  const store = (res) => {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const c of raw) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
  };

  return {
    label,
    cookies,
    async req(path, init = {}) {
      const headers = new Headers(init.headers ?? {});
      if (cookies.size) headers.set('cookie', cookieHeader());
      const csrf = cookies.get('kt_csrf');
      if (csrf) headers.set('x-kt-csrf', csrf);
      if (init.json !== undefined) {
        headers.set('content-type', 'application/json');
        init = { ...init, body: JSON.stringify(init.json) };
      }
      const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
      store(res);
      return res;
    },
  };
}

/** A wallet in the browser: the key never leaves this function. */
function makeWallet() {
  const seed = KeetaNet.lib.Account.generateRandomSeed({ asString: true });
  const account = KeetaNet.lib.Account.fromSeed(seed, 0);
  return { seed, account, address: account.publicKeyString.get() };
}

async function signIn(browser, wallet) {
  const nonceRes = await browser.req('/api/auth/nonce', { method: 'POST' });
  const nonceJson = await nonceRes.json();
  if (!nonceRes.ok) throw new Error(`nonce: ${nonceJson.error}`);

  const signature = await wallet.account.sign(
    new TextEncoder().encode(nonceJson.nonce).buffer,
  );
  const res = await browser.req('/api/auth/login', {
    method: 'POST',
    json: {
      address: wallet.address,
      nonce: nonceJson.nonce,
      signature: Buffer.from(signature.getBuffer()).toString('base64'),
    },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`login: ${j.error}`);
  return j.address;
}

console.log('== 1. no session -> 401 ==');
const anon = makeBrowser('anon');
for (const [path, method] of [
  ['/api/state', 'GET'],
  ['/api/automations/wallet', 'GET'],
  ['/api/wallet', 'GET'],
  ['/api/automations/run', 'POST'],
  ['/api/automations', 'GET'],
  ['/api/chats', 'GET'],
  ['/api/settings', 'GET'],
  ['/api/watchlist', 'GET'],
  ['/api/skills', 'GET'],
  ['/api/positions', 'GET'],
  ['/api/models', 'POST'],
]) {
  const res = await anon.req(path, { method });
  const text = await res.text();
  check(`${method} ${path} -> 401`, res.status === 401, `got ${res.status} ${text.slice(0, 60)}`);
  if (res.status === 401 && /keeta_|seed|balance/i.test(text)) {
    check(`${method} ${path} leaks no data`, false, text.slice(0, 80));
  }
}

console.log('\n== 2. sign-in with a wallet signature ==');
const walletA = makeWallet();
const walletB = makeWallet();
const browserA = makeBrowser('A');
const browserB = makeBrowser('B');

try {
  const addrA = await signIn(browserA, walletA);
  check('A signed in', addrA === walletA.address, addrA);
  const addrB = await signIn(browserB, walletB);
  check('B signed in', addrB === walletB.address, addrB);
} catch (e) {
  check('sign-in works', false, e.message);
  process.exit(1);
}

console.log('\n== 3. each wallet sees only its own state ==');
const created = await browserA.req('/api/automations', {
  method: 'POST',
  json: { kind: 'alert', name: 'A-only-alert', symbol: 'KTA', op: 'gt', valueUsd: 1 },
});
const createdJson = await created.json();
check('A created an alert', created.ok === true, JSON.stringify(createdJson).slice(0, 80));

const listA = await (await browserA.req('/api/automations')).json();
const listB = await (await browserB.req('/api/automations')).json();
const namesA = (listA.automations ?? []).map((a) => a.name);
const namesB = (listB.automations ?? []).map((a) => a.name);
check('A sees its own alert', namesA.includes('A-only-alert'), namesA.join(','));
check('B does not see A\'s alert', !namesB.includes('A-only-alert'), namesB.join(','));

const stateB = await (await browserB.req('/api/state')).json();
check('B has its own address', stateB.address === walletB.address, String(stateB.address));
const stateA = await (await browserA.req('/api/state')).json();
check('A has its own address', stateA.address === walletA.address, String(stateA.address));

const chatsA = await browserA.req('/api/chats', {
  method: 'POST',
  json: { id: 'a-chat', title: 'A chat', messages: [] },
});
await chatsA.text();
const chatsB = await (await browserB.req('/api/chats')).json();
const chatIdsB = (chatsB.chats ?? []).map((c) => c.id);
check("B cannot see A's chats", !chatIdsB.includes('a-chat'), chatIdsB.join(','));

console.log('\n== 4. the CSRF check ==');
const noCsrf = await fetch(`${BASE}/api/automations`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: `kt_session=${browserA.cookies.get('kt_session')}` },
  body: JSON.stringify({ kind: 'alert', name: 'no-csrf', symbol: 'KTA', op: 'gt', valueUsd: 1 }),
});
check('POST without the CSRF header -> 403', noCsrf.status === 403, `got ${noCsrf.status}`);
await noCsrf.text();

console.log('\n== 5. no seed in any request body ==');
const bad = await browserA.req('/api/automations', {
  method: 'POST',
  json: { kind: 'alert', name: 'seed-attempt', symbol: 'KTA', op: 'gt', valueUsd: 1, seed: walletA.seed },
});
await bad.text();
check('a body carrying a seed is ignored, not accepted', bad.ok === true || bad.status === 400);
const after = await (await browserA.req('/api/automations')).json();
const seeded = JSON.stringify(after).includes(walletA.seed);
check('the server did not store the seed it was sent', !seeded);

console.log(`\n${failures === 0 ? 'ALL SECURITY CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
