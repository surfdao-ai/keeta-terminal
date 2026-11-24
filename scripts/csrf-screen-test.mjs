/**
 * Every mutating request has to carry the session's CSRF token.
 *
 * The server checks it on every POST, so a request that forgets it comes
 * back as "CSRF check failed" — which is exactly what a prompt in the
 * terminal used to do. This test drives the real screens and watches every
 * request that goes out.
 *
 * Usage:
 *   BASE=http://localhost:3111 npx tsx scripts/csrf-screen-test.mjs
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

/* ------------------------------------------------------------------ *
 * Watch every request
 * ------------------------------------------------------------------ */

const requests = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? input);
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers ?? {});
  requests.push({
    method,
    url,
    csrf: headers.get('x-kt-csrf') ?? '',
    hasCsrf: headers.has('x-kt-csrf'),
  });

  const absolute = url.startsWith('/') ? `${BASE}${url}` : url;
  const cookie = globalThis.document.cookie;
  if (cookie) headers.set('cookie', cookie);
  const res = await realFetch(absolute, { ...init, headers });
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
const { default: ChatPanel } = await import('../src/components/ChatPanel.tsx');
const { default: SignInGate } = await import('../src/components/SignInGate.tsx');
const { default: SkillsBrowser } = await import('../src/components/SkillsBrowser.tsx');

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
  // Match by accessible name — visible text OR aria-label — since the send
  // button is icon-only.
  return [...document.querySelectorAll('button')].find((b) => {
    const name = `${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`;
    return name.trim().toLowerCase().includes(label.toLowerCase());
  });
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
 * Sign in first (the sign-in routes are the only POSTs without a token)
 * ------------------------------------------------------------------ */

const PASSPHRASE = 'correct horse battery staple';
let signedIn = null;
const onSignedIn = (address) => {
  signedIn = address;
};

const root = createRoot(document.getElementById('root'));
await act_(async () => {
  root.render(React.createElement(SignInGate, { onSignedIn }));
});
await click('Create a new wallet');
await type(PASSPHRASE, 'passphrase');
await click('Generate my seed');
await waitFor(() => text().includes('write this down'));
await click("I've written it down");
await waitFor(() => Boolean(signedIn));
check('signed in', Boolean(signedIn), String(signedIn));

// The sign-in routes are the only POSTs that cannot carry a token.
const SIGN_IN_ROUTES = ['/api/auth/nonce', '/api/auth/login'];

/* ------------------------------------------------------------------ *
 * Prompt the terminal — this is the one that was broken
 * ------------------------------------------------------------------ */

await act_(async () => {
  root.unmount();
});
const chatRoot = createRoot(document.getElementById('root'));
await act_(async () => {
  chatRoot.render(
    React.createElement(ChatPanel, {
      chatId: 'csrf-test-chat',
      initialMessages: [],
      providerConfig: {
        type: 'openai-compatible',
        name: 'pollinations',
        baseUrl: 'https://text.pollinations.ai/openai',
        model: 'openai-fast',
      },
      tradeIntent: null,
      onSignTrade: () => undefined,
      onCancelTrade: () => undefined,
      cap: { spentUsd: 0, capUsd: 100 },
      unlocked: true,
      address: signedIn,
      modelLabel: 'pollinations',
      onSaved: () => undefined,
      onConfirm: () => undefined,
    }),
  );
});
await settle();

const composer = [...document.querySelectorAll('textarea, input')].find((el) =>
  /message|ask|prompt/i.test(el.getAttribute('placeholder') ?? ''),
);
check('the terminal has a composer', Boolean(composer));

if (composer) {
  const setter = Object.getOwnPropertyDescriptor(
    composer instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype,
    'value',
  ).set;
  await act_(async () => {
    setter.call(composer, 'say hello');
    composer.dispatchEvent(new window.InputEvent('input', { bubbles: true }));
  });
  const send = button('send');
  if (send) {
    await act_(async () => {
      send.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }
  // Wait for the chat request to go out.
  await waitFor(() => requests.some((r) => r.url.includes('/api/chat')), 20000);
}

const chatRequest = requests.find((r) => r.url.includes('/api/chat'));
check('the prompt reached /api/chat', Boolean(chatRequest), chatRequest?.url ?? 'no request');
check('the prompt carried the CSRF token', Boolean(chatRequest?.hasCsrf && chatRequest?.csrf));
check(
  'the prompt was not refused',
  !text().includes('CSRF check failed'),
  text().slice(-160).replace(/\s+/g, ' '),
);

/* ------------------------------------------------------------------ *
 * And the rest of the app
 * ------------------------------------------------------------------ */

await act_(async () => {
  chatRoot.unmount();
});
const skillsRoot = createRoot(document.getElementById('root'));
await act_(async () => {
  skillsRoot.render(React.createElement(SkillsBrowser));
});
await settle();
await waitFor(() => Boolean(button('read') || button('open')), 20000);
const read = button('read') ?? button('open');
if (read) {
  await act_(async () => {
    read.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await waitFor(() => requests.some((r) => r.url.includes('/api/skills') && r.method === 'POST'), 10000);
}

/* ------------------------------------------------------------------ *
 * The rule
 * ------------------------------------------------------------------ */

// Self-cleanup: the throwaway wallet leaves no rows behind.
try {
  const cr = await realFetch(`${BASE}/api/wallet`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-kt-csrf': globalThis.document.cookie.match(/(?:^|;\s*)kt_csrf=([^;]+)/)?.[1] ?? '',
      cookie: globalThis.document.cookie,
    },
    body: JSON.stringify({ action: 'delete' }),
  });
  if (cr.ok) console.log(`cleaned up ${signedIn.slice(0, 20)}…`);
} catch {
  /* the wallet was disposable; a failed cleanup is not a test failure */
}

console.log('\n-- every mutating request --');
const mutating = requests.filter((r) => r.method !== 'GET');
for (const r of mutating) {
  const exempt = SIGN_IN_ROUTES.includes(r.url.split('?')[0]);
  const ok = exempt || (r.hasCsrf && r.csrf.length > 0);
  check(`${r.method} ${r.url}${exempt ? ' (sign-in route, exempt)' : ''}`, ok, r.csrf ? '' : 'no token');
}

console.log(`\n${failures === 0 ? 'ALL CSRF CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
