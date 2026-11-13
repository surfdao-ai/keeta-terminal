/**
 * The wallet flow, walked the way a browser walks it.
 *
 * The screen is thin; the flow lives in src/lib/client/signin.ts, so it can
 * be exercised here: create a wallet, import one, unlock the one on this
 * device, and sign in with each of them against the real server.
 *
 * The browser bits are simulated: a localStorage, a cookie jar (so the
 * session cookie and the CSRF token travel like they do in a browser), and
 * the WebCrypto the vault uses (Node has it).
 *
 * Usage: BASE=https://kterminal.vercel.app node --experimental-strip-types scripts/wallet-flow-test.mjs
 */
import * as KeetaNet from '@keetanetwork/keetanet-client';

/* ------------------------------------------------------------------ *
 * The browser, simulated
 * ------------------------------------------------------------------ */

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  get length() {
    return store.size;
  },
};

const cookies = new Map();
globalThis.document = {
  get cookie() {
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  },
};

// A browser sends the cookies, keeps the ones it is handed, and resolves a
// relative URL against the page it is on.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' && input.startsWith('/') ? `${BASE}${input}` : input;
  const headers = new Headers(init.headers ?? {});
  if (cookies.size) headers.set('cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
  const res = await realFetch(url, { ...init, headers });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    cookies.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return res;
};

const BASE = process.env.BASE ?? 'http://localhost:3111';
let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

/* ------------------------------------------------------------------ *
 * The flow under test
 * ------------------------------------------------------------------ */

const { createWallet, importWallet, unlockWallet, signInWithWallet } = await import(
  '../src/lib/client/signin.ts'
);
const { readVault, clearVault } = await import('../src/lib/vault.ts');

const PASSPHRASE = 'correct horse battery staple';

console.log('== 1. create a wallet ==');
const setup = await createWallet({ mode: 'passphrase', passphrase: PASSPHRASE });
check('a seed was generated', typeof setup.seed === 'string' && setup.seed.length > 20);
check('an address was derived', setup.address.startsWith('keeta_'), setup.address);

const stored = readVault();
check('the vault is stored on this device', Boolean(stored));
check('the stored record holds no plaintext seed', !JSON.stringify(stored).includes(setup.seed));
check('the stored record holds the address', stored?.address === setup.address);
check('the vault is passphrase mode', stored?.mode === 'passphrase');

console.log('\n== 2. sign in with it ==');
const signedInAs = await signInWithWallet(setup.seed, setup.address);
check('the server signed us in as that address', signedInAs === setup.address, signedInAs);
check('a session cookie was set', cookies.has('kt_session'));
check('a CSRF token was set', cookies.has('kt_csrf'));

const state = await (await fetch(`${BASE}/api/state`)).json();
check('the session works', state.address === setup.address, String(state.address));
check('no seed was stored server-side', !JSON.stringify(state).includes(setup.seed));

console.log('\n== 3. unlock it again (a new page load) ==');
clearCookies();
const reopened = await unlockWallet(PASSPHRASE);
check('the vault opens with the passphrase', reopened.seed === setup.seed);
check('the address comes back with it', reopened.address === setup.address);

let wrongRejected = false;
try {
  await unlockWallet('not the passphrase');
} catch {
  wrongRejected = true;
}
check('the wrong passphrase is rejected', wrongRejected);

console.log('\n== 4. import an existing seed ==');
clearCookies();
clearVault();
const otherSeed = KeetaNet.lib.Account.generateRandomSeed({ asString: true });
const imported = await importWallet(otherSeed, { mode: 'passphrase', passphrase: PASSPHRASE });
check('the imported address is derived from the seed', imported.address.startsWith('keeta_'));
check('the imported vault holds no plaintext seed', !JSON.stringify(readVault()).includes(otherSeed));

const importedAs = await signInWithWallet(imported.seed, imported.address);
check('the imported wallet signs in', importedAs === imported.address, importedAs);

console.log('\n== 5. two wallets, two terminals ==');
clearCookies();
const first = await importWallet(setup.seed, { mode: 'passphrase', passphrase: PASSPHRASE });
await signInWithWallet(first.seed, first.address);
const firstState = await (await fetch(`${BASE}/api/state`)).json();

clearCookies();
const second = await importWallet(otherSeed, { mode: 'passphrase', passphrase: PASSPHRASE });
await signInWithWallet(second.seed, second.address);
const secondState = await (await fetch(`${BASE}/api/state`)).json();

check('the first wallet sees its own address', firstState.address === first.address);
check('the second wallet sees its own address', secondState.address === second.address);
check('they are different wallets', first.address !== second.address);

console.log('\n== 6. the seed never crosses the wire ==');
let sawSeed = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const body = typeof init.body === 'string' ? init.body : '';
  if (body.includes(setup.seed) || body.includes(otherSeed)) sawSeed = true;
  return originalFetch(input, init);
};
clearCookies();
await signInWithWallet(setup.seed, setup.address);
globalThis.fetch = originalFetch;
check('no request body carried a seed', !sawSeed);

console.log(`\n${failures === 0 ? 'ALL WALLET FLOW CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

function clearCookies() {
  cookies.clear();
}
