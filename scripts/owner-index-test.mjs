/**
 * The automations owner index — the 15-minute sweep must find EVERY owner
 * that has automations, no matter how many owners there are.
 *
 * The old design kept a capped (500) index that was written when an
 * automation was created and never reconciled with the rows: past the cap
 * the oldest owners were evicted and silently skipped by the sweep forever,
 * and deleted wallets left ghost entries that ate the cap even faster.
 *
 * This test reproduces the cap condition against the local file store:
 *   - 500 fake owners with automations rows, indexed
 *   - one REAL throwaway owner, plus one far owner (beyond the cap) with a
 *     real, armed alert automation
 *   - a cron-authenticated full sweep must evaluate ALL of them — the far
 *     owner's alert must fire and appear in its log
 *   - the index must then be pruned of the dead fake owners
 *   - deleting the throwaway wallet must drop it from the index
 *
 * Usage: BASE=http://localhost:3111 npm run test:owners
 * (needs the CRON_SECRET env var for the schedule-authenticated sweep)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/* --- the browser, simulated (same shape as the wallet-flow test) -------- */
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
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error('CRON_SECRET is required to authenticate the schedule sweep.');
  process.exit(1);
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' && input.startsWith('/') ? `${BASE}${input}` : input;
  const headers = new Headers(init.headers ?? {});
  if (cookies.size && init.credentials !== 'omit') {
    headers.set('cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
  }
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
async function api(method, p, body, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers ?? {}) };
  if (method !== 'GET') headers['x-kt-csrf'] = csrf();
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    ...(opts.withCookie === false ? { credentials: 'omit' } : {}),
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) cookies.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** The local file store, poked the way the test harness does elsewhere. */
const DATA_FILE = path.join(process.cwd(), '.data', 'terminal.json');
if (!fs.existsSync(DATA_FILE)) {
  console.error('the file store is missing — run this against the local dev server (KV_BACKEND=file)');
  process.exit(1);
}
function readStore() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function writeStore(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
const INDEX = 'automationOwners';
const autoKey = (owner) => `u:${owner.toLowerCase()}:automations`;

/* ------------------------------------------------------------------ *
 * Sign in with a throwaway wallet.
 * ------------------------------------------------------------------ */
const { createWallet, signInWithWallet } = await import('../src/lib/client/signin.ts');
const PASSPHRASE = 'owner index test passphrase';
const setup = await createWallet({ mode: 'passphrase', passphrase: PASSPHRASE });
check('created a throwaway wallet', setup.address.startsWith('keeta_'), setup.address);
const who = await signInWithWallet(setup.seed, setup.address);
check('signed in', who === setup.address && cookies.has('kt_session'), who);

/* ------------------------------------------------------------------ *
 * Seed the cap condition: 500 indexed owners with automations rows.
 * ------------------------------------------------------------------ */
console.log('\n== seed 500 indexed owners (the cap condition) ==');
const N = 500;
const farOwner = `keeta_far${'f'.repeat(41)}`; // fake but well-formed, 46 chars
const data = readStore();
const seeded = [];
for (let i = 0; i < N; i++) {
  const owner = `keeta_fake${String(i).padStart(3, '0')}`.padEnd(46, '0').slice(0, 46);
  seeded.push(owner);
  // A real automations ROW for each — the truth the sweep is supposed to find.
  data[autoKey(owner)] = [
    {
      id: `seeded-${i}`,
      kind: 'alert',
      name: `seed-${i}`,
      symbol: 'KTA',
      op: 'gt',
      valueUsd: 1_000_000, // absurdly high: must NOT fire
      enabled: true,
      createdAt: new Date().toISOString(),
    },
  ];
}
// The far owner: beyond the index cap, with a REAL, armed alert that MUST fire.
data[autoKey(farOwner)] = [
  {
    id: 'far-alert',
    kind: 'alert',
    name: 'far-alert',
    symbol: 'KTA',
    op: 'gt',
    valueUsd: 0.000001, // well under the live price: must fire on the sweep
    enabled: true,
    createdAt: new Date().toISOString(),
  },
];
data[INDEX] = [...seeded]; // the index holds the 500 — the far owner is NOT in it
writeStore(data);
check('seeded 500 indexed owners with rows', seeded.length === N);
check('far owner has a row but is not in the index', !readStore()[INDEX].includes(farOwner));

/* ------------------------------------------------------------------ *
 * The throwaway wallet creates one real automation through the API.
 * ------------------------------------------------------------------ */
const mine = await api('POST', '/api/automations', {
  kind: 'alert',
  name: 'mine',
  symbol: 'KTA',
  op: 'gt',
  valueUsd: 1_000_000, // must not fire
});
check('created the throwaway wallet’s alert', mine.status === 200 && mine.json.automation, JSON.stringify(mine.json).slice(0, 120));

/* ------------------------------------------------------------------ *
 * The schedule’s full sweep (cron auth) must evaluate EVERY owner —
 * including the one the old capped index would have lost.
 * ------------------------------------------------------------------ */
console.log('\n== cron sweep over 500+ owners ==');
const run = await api('POST', '/api/automations/run', {}, {
  headers: { authorization: `Bearer ${CRON_SECRET}` },
  withCookie: false, // the real schedule hits this with no session cookie
});
check(
  'the cron sweep answered',
  run.status === 200 && run.json.ok === true,
  JSON.stringify(run.json).slice(0, 160),
);
check(
  'the sweep evaluated every seeded owner plus the wallet and the far one',
  (run.json.checked ?? 0) >= N + 2,
  `checked=${run.json.checked} (expected ≥ ${N + 2})`,
);
check(
  'exactly one alert fired — the far owner’s armed one',
  (run.json.triggered ?? 0) === 1,
  `triggered=${run.json.triggered}`,
);

// The far owner's alert must have actually fired and be logged under ITSELF.
const afterRun = readStore();
const farAuto = (afterRun[autoKey(farOwner)] ?? []).find((a) => a.id === 'far-alert');
check(
  'the far owner’s alert is marked triggered',
  farAuto?.triggered === true,
  JSON.stringify(farAuto ?? {}).slice(0, 140),
);
const farLogEntries = afterRun[`u:${farOwner.toLowerCase()}:automationLog`] ?? [];
check(
  'the far owner’s fire is in ITS activity log',
  farLogEntries.some((l) => l.automationId === 'far-alert' && l.status === 'triggered'),
  `log entries: ${farLogEntries.length}`,
);
check('the far owner’s alert recorded a real price', typeof farAuto?.lastPriceUsd === 'number' && farAuto.lastPriceUsd > 0, `lastPriceUsd=${farAuto?.lastPriceUsd}`);

// The sweep must not propose trades for the throwaway wallet's quiet alert.
const myAuto = (afterRun[autoKey(setup.address)] ?? []).find((a) => a.name === 'mine');
check('the throwaway wallet’s quiet alert did not fire', myAuto?.triggered !== true);

/* ------------------------------------------------------------------ *
 * Index hygiene: dead owners are pruned; the real ones remain.
 * ------------------------------------------------------------------ */
console.log('\n== index hygiene ==');
// The sweep's derivation says only {throwaway, far} have rows anymore… but the
// seeded owners' rows still exist (they are fake-but-valid rows), so they
// remain. Delete a chunk of the fake rows: they must drop from the index on
// the next reconciliation.
const victims = seeded.slice(0, 50);
const d2 = readStore();
for (const v of victims) delete d2[autoKey(v)];
writeStore(d2);

// Reconcile the fallback index: the full sweep reconciles as a side effect of
// listAutomationOwners(). A signed-in (owner-scoped) run does NOT, so use the
// schedule-authenticated full sweep.
const reconcile = await api('POST', '/api/automations/run', {}, {
  headers: { authorization: `Bearer ${CRON_SECRET}` },
  withCookie: false,
});
check('the reconcile run answered', reconcile.status === 200, JSON.stringify(reconcile.json).slice(0, 100));

// The sync in listAutomationOwners() is fire-and-forget, so poll briefly.
const pruneDeadline = Date.now() + 10_000;
let indexNow = readStore()[INDEX] ?? [];
while (indexNow.some((o) => victims.includes(o)) && Date.now() < pruneDeadline) {
  await new Promise((r) => setTimeout(r, 250));
  indexNow = readStore()[INDEX] ?? [];
}
check('dead owners were pruned from the index', !indexNow.some((o) => victims.includes(o)), `index size now: ${indexNow.length}`);
check(
  'live owners remain in the index',
  indexNow.includes(farOwner) || indexNow.includes(setup.address.toLowerCase()),
  `has far=${indexNow.includes(farOwner)} wallet=${indexNow.includes(setup.address.toLowerCase())}`,
);

/* ------------------------------------------------------------------ *
 * Wallet deletion drops the owner from the index.
 * ------------------------------------------------------------------ */
console.log('\n== wallet deletion ==');
const del = await api('POST', '/api/wallet', { action: 'delete' });
check('the wallet deleted', del.status === 200, JSON.stringify(del.json).slice(0, 100));
const afterDel = readStore();
check('the throwaway wallet’s automations row is gone', afterDel[autoKey(setup.address)] === undefined);
check(
  'the throwaway wallet dropped from the index',
  !(afterDel[INDEX] ?? []).includes(setup.address.toLowerCase()),
  `index: ${JSON.stringify(afterDel[INDEX] ?? []).slice(0, 200)}`,
);

/* ------------------------------------------------------------------ *
 * Cleanup: wipe the seeded rows so the store is left as found.
 * ------------------------------------------------------------------ */
const final = readStore();
for (const owner of seeded) delete final[autoKey(owner)];
delete final[autoKey(farOwner)];
delete final[`u:${farOwner.toLowerCase()}:automationLog`];
delete final[INDEX];
writeStore(final);
console.log(`\ncleaned up ${seeded.length} seeded owners + ${farOwner.slice(0, 20)}…`);

console.log(`\n${failures === 0 ? 'ALL OWNER-INDEX CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
