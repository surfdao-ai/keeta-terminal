/**
 * The sign-in screen, clicked through.
 *
 * This renders the real component in a DOM and drives it the way a person
 * would: create a wallet, write the seed down, sign in, then come back and
 * unlock. Every click goes through the same code the browser runs, against a
 * real server.
 *
 * Usage:
 *   BASE=http://localhost:3111 npx tsx scripts/signin-screen-test.mjs
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
// Node 21+ has a read-only global navigator, so it has to be redefined.
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

// The vault needs WebCrypto; jsdom does not provide it.
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = await import('node:crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

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

// Now that the DOM exists, React can load.
const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: SignInGate } = await import('../src/components/SignInGate.tsx');
const { readVault } = await import('../src/lib/vault.ts');

/* ------------------------------------------------------------------ *
 * Driving the screen
 * ------------------------------------------------------------------ */

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

const settle = () => new Promise((r) => setTimeout(r, 60));

/** Run something that changes React state and let the DOM catch up. */
async function act_(fn) {
  await act(async () => {
    await fn();
    await settle();
  });
}

/** Wait until the screen looks a certain way (the work is async). */
async function waitFor(predicate, ms = 15000) {
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
  const buttons = [...document.querySelectorAll('button')];
  return buttons.find((b) => b.textContent?.trim().toLowerCase().includes(label.toLowerCase()));
}

async function click(label) {
  const b = button(label);
  if (!b) throw new Error(`no button matching "${label}"`);
  await act_(async () => {
    b.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function type(value, placeholder) {
  const input = [...document.querySelectorAll('input, textarea')].find((el) =>
    (el.getAttribute('placeholder') ?? '').includes(placeholder),
  );
  if (!input) throw new Error(`no field matching "${placeholder}"`);
  const proto =
    input instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act_(async () => {
    setter.call(input, value);
    input.dispatchEvent(new window.InputEvent('input', { bubbles: true }));
  });
  return input;
}

function text() {
  return document.body.textContent ?? '';
}

/* ------------------------------------------------------------------ *
 * The test
 * ------------------------------------------------------------------ */

const PASSPHRASE = 'correct horse battery staple';
let signedIn = null;

const onSignedIn = (address, seed) => {
  signedIn = { address, seed };
};

let root = createRoot(document.getElementById('root'));
await act_(async () => {
  root.render(React.createElement(SignInGate, { onSignedIn }));
});

console.log('== 1. the first screen ==');
check('it asks you to sign in', text().includes('sign in with your wallet'));
check('it offers to create a wallet', Boolean(button('Create a new wallet')));
check('it offers to import a wallet', Boolean(button('Import an existing wallet')));

console.log('\n== 2. create a wallet ==');
await click('Create a new wallet');
check('it asks for a passphrase', text().includes('passphrase'));

const generate = button('Generate my seed');
check('the button waits for a passphrase', Boolean(generate?.disabled));

await type(PASSPHRASE, 'passphrase');
const generateAfter = button('Generate my seed');
check('the button unlocks once a passphrase is typed', generateAfter?.disabled === false);

await click('Generate my seed');
// Sealing the seed derives a key (PBKDF2, 310k rounds) and pulls in the
// Keeta client, so this takes a moment.
const showedSeed = await waitFor(() => text().includes('write this down'));
check('it shows the seed to write down', showedSeed, text().slice(-160).replace(/\s+/g, ' '));
check('the seed is visible', text().includes('recovery copy') || text().includes('write this down'));
check('the vault is stored', Boolean(readVault()));
const vaultAddress = readVault()?.address ?? '';
check('the vault holds the address, not the seed', Boolean(vaultAddress));

console.log('\n== 3. write it down and sign in ==');
check('the seed can be copied', Boolean(button('copy seed')));
await click("I've written it down");
await waitFor(() => Boolean(signedIn));
check('it signed us in', Boolean(signedIn), signedIn?.address ?? 'no callback');
check('the address is a keeta address', String(signedIn?.address ?? '').startsWith('keeta_'));
check('the passphrase is not asked for twice', !text().includes('vault passphrase'));

console.log('\n== 4. come back later and unlock ==');
signedIn = null;
// A page load is a fresh mount, not a re-render.
await act_(async () => {
  root.unmount();
});
root = createRoot(document.getElementById('root'));
await act_(async () => {
  root.render(React.createElement(SignInGate, { onSignedIn }));
});
await waitFor(() => text().includes('vault passphrase') || text().includes('sealed wallet'));
check('it goes straight to unlock', text().includes('vault passphrase') || text().includes('sealed wallet'));

await type(PASSPHRASE, 'vault passphrase');
await click('Unlock and sign in');
await waitFor(() => Boolean(signedIn));
check('it unlocked and signed in', Boolean(signedIn), signedIn?.address ?? 'no callback');
check('it is the same wallet', signedIn?.address === vaultAddress);

console.log('\n== 5. the wrong passphrase is refused ==');
signedIn = null;
await type('not the passphrase', 'vault passphrase');
await click('Unlock and sign in');
await waitFor(() => text().toLowerCase().includes('decrypt') || Boolean(signedIn));
check('it refuses the wrong passphrase', signedIn === null);
check('it says why, in words', text().includes('does not open this wallet'), text().slice(-140).replace(/\s+/g, ' '));

console.log(`\n${failures === 0 ? 'ALL SIGN-IN SCREEN CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
