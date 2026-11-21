/**
 * Deleting a wallet, walked the way a browser walks it.
 *
 * The screen is thin; the flow is: the server forgets everything it stores
 * for the address, the browser wipes the sealed vault, and the visitor ends
 * at the sign-in screen. This test drives the real screen AND inspects the
 * store directly, so "the button worked" means "the rows are gone".
 *
 * Usage:
 *   DATABASE_URL=... BASE=http://localhost:3111 npx tsx scripts/delete-wallet-test.mjs
 *
 * The DATABASE_URL check is skipped when it is not given.
 */
import { JSDOM } from 'jsdom';

/* ------------------------------------------------------------------ *
 * The DOM first — React has to be imported after it exists
 * ------------------------------------------------------------------ */

const BASE = process.env.BASE ?? 'http://localhost:3111';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: BASE,
  pretendToBeVisual: true,
});

const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: window.navigator,
  configurable: true,
  writable: true,
});
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.InputEvent = window.InputEvent;
globalThis.MouseEvent = window.MouseEvent;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.localStorage = window.localStorage;
globalThis.getComputedStyle = window.getComputedStyle?.bind(window);
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

if (!globalThis.crypto?.subtle) {
  const { webcrypto } = await import('node:crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

// jsdom has no scrolling.
window.HTMLElement.prototype.scrollTo = window.HTMLElement.prototype.scrollTo ?? (() => {});
window.Element.prototype.scrollTo = window.Element.prototype.scrollTo ?? (() => {});

// A browser keeps the cookies it is handed and sends them back.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' && input.startsWith('/') ? `${BASE}${input}` : input;
  const headers = new Headers(init.headers ?? {});
  const cookie = globalThis.document.cookie;
  if (cookie) headers.set('cookie', cookie);
  const res = await realFetch(url, { ...init, headers });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    globalThis.document.cookie = `${pair.slice(0, i)}=${pair.slice(i + 1)}; path=/`;
  }
  return res;
};

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: SignInGate } = await import('../src/components/SignInGate.tsx');
const { default: WalletPanel } = await import('../src/components/WalletPanel.tsx');
const { readVault } = await import('../src/lib/vault.ts');
const { apiFetch } = await import('../src/lib/client/api.ts');

/* ------------------------------------------------------------------ *
 * The store, seen from the outside
 * ------------------------------------------------------------------ */

let sql = null;
if (process.env.DATABASE_URL) {
  const postgres = (await import('postgres')).default;
  sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 2, prepare: false });
}

async function storeKeysFor(address) {
  if (!sql) return null;
  const prefix = `u:${address.toLowerCase()}:`;
  const rows = await sql`SELECT key FROM kt_store WHERE key LIKE ${prefix + '%'} ORDER BY key`;
  return rows.map((r) => r.key);
}

/* ------------------------------------------------------------------ *
 * Driving
 * ------------------------------------------------------------------ */

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

const settle = () => new Promise((r) => setTimeout(r, 60));
async function act_(fn) {
  await act(async () => {
    await fn();
    await settle();
  });
}
async function waitFor(predicate, ms = 20000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (predicate()) return true;
    await act_(async () => {
      await settle();
    });
  }
  return false;
}
function button(label) {
  return [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.trim().toLowerCase().includes(label.toLowerCase()),
  );
}
async function click(label) {
  const b = button(label);
  if (!b) throw new Error(`no button matching "${label}"`);
  await act_(async () => {
    b.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}
function text() {
  return document.body.textContent ?? '';
}

/* ------------------------------------------------------------------ *
 * Sign in, put data on the server
 * ------------------------------------------------------------------ */

const PASSPHRASE = 'correct horse battery staple';
let signedIn = null;

const onSignedIn = (address) => {
  signedIn = address;
};

let root = createRoot(document.getElementById('root'));
await act_(async () => {
  root.render(React.createElement(SignInGate, { onSignedIn }));
});
await click('Create a new wallet');
{
  const input = document.querySelector('input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act_(async () => {
    setter.call(input, PASSPHRASE);
    input.dispatchEvent(new window.InputEvent('input', { bubbles: true }));
  });
}
await click('Generate my seed');
await waitFor(() => text().includes('write this down'));
await click("I've written it down");
await waitFor(() => Boolean(signedIn));
check('signed in', Boolean(signedIn), String(signedIn));
const address = signedIn;
check('the vault is on this device', Boolean(readVault()));

// A chat and a non-default cap: data that must not survive the delete.
const chatId = `del-test-${Date.now()}`;
let savedChat = null;
{
  const r = await apiFetch('/api/chats', {
    method: 'POST',
    json: { id: chatId, messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'to be deleted' }] }] },
  });
  savedChat = r.ok;
}
check('a chat was saved', Boolean(savedChat));
{
  const r = await apiFetch('/api/settings', { method: 'POST', json: { dailyCapUsd: 77 } });
  check('the cap was raised to $77', r.ok && (await r.json()).dailyCapUsd === 77);
}

const before = await storeKeysFor(address);
if (before) {
  console.log('   store keys before:', before.join(', '));
  check('the store has rows for this wallet', before.length >= 3, String(before.length));
  check('the chat row exists', before.some((k) => k.endsWith(':chats')));
  check('the settings row exists', before.some((k) => k.endsWith(':settings')));
} else {
  console.log('   (no DATABASE_URL — skipping direct store checks)');
}

/* ------------------------------------------------------------------ *
 * Delete it from the real screen
 * ------------------------------------------------------------------ */

await act_(async () => {
  root.unmount();
});
root = createRoot(document.getElementById('root'));
let signedOut = false;
await act_(async () => {
  root.render(
    React.createElement(WalletPanel, {
      address,
      onSignOut: () => {
        signedOut = true;
      },
    }),
  );
});

check('the address is shown', text().includes(address));
check('it offers to delete the wallet', Boolean(button('delete wallet')));
check('the vault is still here before the delete', Boolean(readVault()));

await click('delete wallet');
check('it asks for confirmation', text().includes('cannot be undone'));
check('the vault is still here while confirming', Boolean(readVault()));

await click('yes, delete it and sign out');
await waitFor(() => Boolean(signedOut), 20000);
check('it signed out', signedOut);
check('the sealed vault is wiped from this device', !readVault());

/* ------------------------------------------------------------------ *
 * What the server kept
 * ------------------------------------------------------------------ */

const after = await storeKeysFor(address);
if (after) {
  check('the store has no rows left for this wallet', after.length === 0, after.join(', '));
}

// The session is still valid (stateless token), but the wallet is gone.
{
  const r = await apiFetch('/api/wallet');
  const j = await r.json();
  check('the server no longer knows the wallet', j.address === null, JSON.stringify(j));
}

// The data must be gone too, not just the registry: the cap reverts to the
// default and the chat list is empty. This is what a deleted Postgres row
// looks like through the API — a row the file backend would happily keep.
{
  const r = await apiFetch('/api/settings');
  const j = await r.json();
  check('the cap reverted to the default', j.dailyCapUsd === 100, String(j.dailyCapUsd));
}
{
  const r = await apiFetch('/api/chats');
  const j = await r.json();
  check('the saved chat is gone', (j.chats ?? []).length === 0, JSON.stringify(j.chats));
}

// Delete without a CSRF token is refused (a fresh session cookie, no header).
{
  const { signNonce } = await import('../src/lib/keeta/browser-signer.ts');
  const KeetaNet = await import('@keetanetwork/keetanet-client');
  const seed = KeetaNet.lib.Account.generateRandomSeed({ asString: true });
  const addr2 = KeetaNet.lib.Account.fromSeed(seed, 0).publicKeyString.get();
  const nonceRes = await realFetch(`${BASE}/api/auth/nonce`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const nonceJson = await nonceRes.json();
  const signature = await signNonce(seed, nonceJson.nonce);
  const loginRes = await realFetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: addr2, signature, nonce: nonceJson.nonce }),
  });
  const setCookie = (loginRes.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
  const r = await realFetch(`${BASE}/api/wallet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: setCookie },
    body: JSON.stringify({ action: 'delete' }),
  });
  check('a delete without the CSRF token is refused', r.status === 403, String(r.status));
  // Clean up the throwaway session's nothing: it registered nothing.
}

// Coming back: the same seed, a fresh start.
await act_(async () => {
  root.unmount();
});
signedIn = null;
root = createRoot(document.getElementById('root'));
await act_(async () => {
  root.render(React.createElement(SignInGate, { onSignedIn }));
});
await waitFor(() => text().includes('Unlock the wallet on this device') || text().includes('sign in'), 5000);
// The vault was wiped, so the only way back is importing the seed — which is
// exactly the recovery path the warning on the screen promises.
const hasImport = Boolean(button('Import an existing wallet'));
check('the recovery path is offered (import the written-down seed)', hasImport);

/* ------------------------------------------------------------------ */

if (sql) await sql.end();
console.log(`\n${failures === 0 ? 'ALL DELETE-WALLET CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
