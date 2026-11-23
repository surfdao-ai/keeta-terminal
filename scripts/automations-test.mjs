/**
 * The automations engine, walked the way the app walks it.
 *
 *   - a price alert that should fire (threshold well under the live KTA
 *     price) and one that should not (threshold absurdly high) — proving the
 *     engine fires real alerts and does not false-positive;
 *   - a recurring (DCA) swap forced past its due time, proving it *proposes*
 *     a pending trade that waits for the user to sign — it never auto-executes
 *     (the key stays in the browser, and a dry pair would simply stay pending).
 *
 * The DCA "force it due" step edits the local file store directly, so it only
 * runs when the app under test is the file backend (local dev). Against a
 * Postgres/Blob backend it is skipped with a note; the alert path runs either
 * way.
 *
 * Usage: BASE=http://localhost:3111 npm run test:automations
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/* ------------------------------------------------------------------ *
 * The browser, simulated (same shape as the wallet-flow test)
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

const BASE = process.env.BASE ?? 'http://localhost:3111';
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

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

const csrf = () => cookies.get('kt_csrf') ?? '';
async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(method !== 'GET' ? { 'x-kt-csrf': csrf() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/* ------------------------------------------------------------------ *
 * Sign in with a throwaway wallet
 * ------------------------------------------------------------------ */

const { createWallet, signInWithWallet } = await import('../src/lib/client/signin.ts');
const PASSPHRASE = 'automations test passphrase';
const setup = await createWallet({ mode: 'passphrase', passphrase: PASSPHRASE });
check('created a throwaway wallet', setup.address.startsWith('keeta_'), setup.address);
const who = await signInWithWallet(setup.seed, setup.address);
check('signed in', who === setup.address && cookies.has('kt_session'), who);

// The DCA "force it due" step edits the local file store directly, so it is
// only possible when the app under test is the local dev server (file
// backend). Against Postgres/Blob (production) there is no store to poke, so
// the step is skipped — the proposal path is still covered by the trade test.
const isLocal = /localhost|127\.0\.0\.1/.test(BASE);
const DATA_FILE = path.join(process.cwd(), '.data', 'terminal.json');
const canForceDue = isLocal && fs.existsSync(DATA_FILE);

let alertId = '';
let dcaId = '';

/* ------------------------------------------------------------------ *
 * 1. A price alert that should fire + one that should not
 * ------------------------------------------------------------------ */

console.log('\n== alert: one that fires, one that must not ==');
// KTA is ~$0.04; a "gt $0.01" alert is above the line today, "$10000" is not.
const fire = await api('POST', '/api/automations', {
  kind: 'alert',
  name: 'test-fire',
  symbol: 'KTA',
  op: 'gt',
  valueUsd: 0.01,
});
check('created the firing alert', fire.status === 200 && fire.json.automation, JSON.stringify(fire.json).slice(0, 120));
alertId = fire.json.automation?.id ?? '';

const quiet = await api('POST', '/api/automations', {
  kind: 'alert',
  name: 'test-quiet',
  symbol: 'KTA',
  op: 'gt',
  valueUsd: 10000,
});
const quietId = quiet.json.automation?.id ?? '';
check('created the non-firing alert', quiet.status === 200 && Boolean(quietId));

const run = await api('POST', '/api/automations/run', {});
check('the run answered', run.status === 200 && run.json.ok === true, JSON.stringify(run.json).slice(0, 140));
check('the run reported a trigger', (run.json.triggered ?? 0) >= 1, `triggered=${run.json.triggered}`);

const state = await api('GET', '/api/automations');
const fireA = (state.json.automations ?? []).find((a) => a.id === alertId);
const quietA = (state.json.automations ?? []).find((a) => a.id === quietId);
check('the firing alert is marked triggered', fireA?.triggered === true, JSON.stringify(fireA ?? {}).slice(0, 160));
check('it recorded the price it saw', typeof fireA?.lastPriceUsd === 'number' && fireA.lastPriceUsd > 0, `lastPriceUsd=${fireA?.lastPriceUsd}`);
check('the high alert did NOT fire', quietA?.triggered === false, JSON.stringify(quietA ?? {}).slice(0, 160));
const logTrigger = (state.json.log ?? []).some((l) => l.automationId === alertId && l.status === 'triggered');
check('the alert is in the activity log', logTrigger);

/* ------------------------------------------------------------------ *
 * 2. A recurring (DCA) swap, forced due, must *propose* not execute
 * ------------------------------------------------------------------ */

console.log('\n== dca: recurring swap is proposed, never auto-executed ==');
const dca = await api('POST', '/api/automations', {
  kind: 'recurring',
  name: 'test-dca',
  fromToken: 'KTA',
  toToken: 'USDC',
  amount: '0.01',
  everyMinutes: 15,
});
check('created the recurring swap', dca.status === 200 && dca.json.automation, JSON.stringify(dca.json).slice(0, 160));
dcaId = dca.json.automation?.id ?? '';
const dcaNext = dca.json.automation?.nextRunAt;

let run2;
if (dcaId && canForceDue) {
  // The API always schedules the first run 15m out. Nudge it into the past in
  // the file store, the way the real scheduler would after 15 minutes.
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const key = `u:${setup.address.toLowerCase()}:automations`;
  const list = data[key] ?? [];
  const a = list.find((x) => x.id === dcaId);
  if (a) {
    a.nextRunAt = new Date(Date.now() - 60_000).toISOString();
    data[key] = list;
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log('   (forced the due time 1m into the past in the file store)');
  } else {
    console.log('   (could not find the DCA in the file store)');
  }

  run2 = await api('POST', '/api/automations/run', {});
  check('the run answered', run2.status === 200 && run2.json.ok === true, JSON.stringify(run2.json).slice(0, 140));
  check('the due swap was proposed', (run2.json.proposed ?? 0) >= 1, `proposed=${run2.json.proposed}`);

  const st2 = await api('GET', '/api/automations');
  const dcaA = (st2.json.automations ?? []).find((x) => x.id === dcaId);
  check('the swap is waiting for approval', dcaA?.lastStatus === 'proposed', `lastStatus=${dcaA?.lastStatus}`);
  check('nothing was auto-executed', dcaA?.lastStatus !== 'executed' && dcaA?.lastStatus !== 'submitted', dcaA?.lastMessage ?? '');
  check('it left a pending trade to sign', (st2.json.pending ?? []).length >= 1, `pending=${st2.json.pending?.length}`);
  const logProp = (st2.json.log ?? []).some((l) => l.automationId === dcaId && l.status === 'proposed');
  check('the proposal is in the activity log', logProp);
} else if (dcaId) {
  console.log('   (skipped: the due time can only be forced against the local file store — the proposal path is covered by the trade test)');
  // The swap is still a valid, scheduled automation: it simply is not due yet,
  // so a run must *not* propose or execute it.
  const runX = await api('POST', '/api/automations/run', {});
  check('a not-yet-due swap is left alone', (runX.json.proposed ?? 0) === 0 && (runX.json.executed ?? 0) === 0, JSON.stringify(runX.json).slice(0, 120));
  const stX = await api('GET', '/api/automations');
  const dcaX = (stX.json.automations ?? []).find((x) => x.id === dcaId);
  check('it is still scheduled, untouched', dcaX?.nextRunAt === dcaNext, dcaX?.nextRunAt ?? '');
}

/* ------------------------------------------------------------------ *
 * Cleanup: delete the automations, then the wallet
 * ------------------------------------------------------------------ */

for (const id of [dcaId, alertId, quietId]) {
  if (id) await api('POST', '/api/automations', { action: 'delete', id });
}
try {
  const del = await api('POST', '/api/wallet', { action: 'delete' });
  if (del.status === 200) console.log(`\ncleaned up ${setup.address.slice(0, 20)}…`);
} catch {
  /* the wallet was disposable */
}

console.log(`\n${failures === 0 ? 'ALL AUTOMATIONS CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
