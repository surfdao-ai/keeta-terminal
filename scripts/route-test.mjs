/**
 * The routing policy, tested two ways.
 *
 * The picker is pure, so it is unit-tested directly (no network). The two
 * live behaviours — that a real quote carries a human route, and that a pair
 * with no live liquidity answers gracefully instead of erroring — are checked
 * against the server.
 *
 * Usage: BASE=http://localhost:3111 DATABASE_URL=... node --experimental-strip-types --import ./scripts/alias-register.mjs scripts/route-test.mjs
 */
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { pickBestQuoteIndex, ROUTE_TIE_TOLERANCE_PCT } from '../src/lib/keeta/quote-routing.ts';
import { routeKind, routeLabel } from '../src/lib/keeta/routes.ts';

const BASE = process.env.BASE ?? 'http://localhost:3111';
let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

const ANCHOR = 'keeta-stablecoin-fx-anchor.keeta.com';
const ONCHAIN = 'some-dex.example';
const q = (providerId, out) => ({ providerId, convertedAmount: BigInt(out) });

/* ------------------------------------------------------------------ *
 * 1. The picker (pure)
 * ------------------------------------------------------------------ */
console.log('== picker ==');
check('no quotes -> no pick', pickBestQuoteIndex([]) === -1);
check('one quote -> it', pickBestQuoteIndex([q(ANCHOR, 100)]) === 0);

// Anchor pays 100, on-chain 101 (1% better) -> within? no, 1% > 0.5% so on-chain wins on outcome.
check(
  'on-chain clearly better (> tolerance) -> on-chain',
  pickBestQuoteIndex([q(ANCHOR, 100), q(ONCHAIN, 102)]) === 1,
);
// Anchor pays 100, on-chain 98 (2% worse) -> anchor wins on outcome.
check(
  'anchor clearly better -> anchor',
  pickBestQuoteIndex([q(ANCHOR, 100), q(ONCHAIN, 98)]) === 0,
);
// Within tolerance (0.4%) but on-chain slightly better -> stay on-chain.
check(
  `within ${ROUTE_TIE_TOLERANCE_PCT}% and on-chain edges it -> on-chain`,
  pickBestQuoteIndex([q(ANCHOR, 100000), q(ONCHAIN, 100400)]) === 1,
);
// Within tolerance and on-chain slightly worse -> still prefer on-chain (native).
check(
  `within ${ROUTE_TIE_TOLERANCE_PCT}% but on-chain slightly worse -> still on-chain`,
  pickBestQuoteIndex([q(ANCHOR, 100000), q(ONCHAIN, 99800)]) === 1,
);
// Three quotes: best outcome wins outright.
check(
  'three quotes, best outcome wins',
  pickBestQuoteIndex([q(ANCHOR, 100), q(ONCHAIN, 101), q('x', 110)]) === 2,
);

/* ------------------------------------------------------------------ *
 * 2. Route classification
 * ------------------------------------------------------------------ */
console.log('== route classification ==');
check('anchor id -> anchor', routeKind(ANCHOR) === 'anchor');
check('other id -> onchain', routeKind(ONCHAIN) === 'onchain');
check('anchor label', routeLabel(routeKind(ANCHOR)) === 'base anchor');
check('onchain label', routeLabel(routeKind(ONCHAIN)) === 'on-chain');

/* ------------------------------------------------------------------ *
 * 3. Live: a real quote carries a human route
 * ------------------------------------------------------------------ */
const jar = new Map();
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
const store = (res) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [p] = c.split(';');
    const i = p.indexOf('=');
    jar.set(p.slice(0, i), p.slice(i + 1));
  }
};
async function req(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (jar.size) headers.set('cookie', cookie());
  const csrf = jar.get('kt_csrf');
  if (csrf) headers.set('x-kt-csrf', csrf);
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    init = { ...init, body: JSON.stringify(init.json) };
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
  store(res);
  return res;
}

// Seed a pending proposal straight into the owner-scoped store (the same
// shortcut the trade test uses).
async function seedProposal(owner, from, to, amount) {
  const key = `u:${owner.toLowerCase()}:pendingTrades`;
  const proposal = {
    id: crypto.randomUUID(),
    kind: 'swap',
    fromToken: from,
    toToken: to,
    amount,
    affinity: 'from',
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
  };
  if (process.env.DATABASE_URL) {
    const postgres = (await import('postgres')).default;
    const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require', prepare: false });
    try {
      const rows = await sql`SELECT value FROM kt_store WHERE key = ${key}`;
      const current = Array.isArray(rows[0]?.value) ? rows[0].value : [];
      const next = [proposal, ...current];
      await sql`INSERT INTO kt_store (key, value, rev) VALUES (${key}, ${sql.json(next)}, 0) ON CONFLICT (key) DO UPDATE SET value = ${sql.json(next)}, rev = kt_store.rev + 1`;
      return proposal.id;
    } finally {
      await sql.end();
    }
  }
  const fs = await import('node:fs');
  const path = await import('node:path');
  const file = path.join(process.cwd(), '.data', 'terminal.json');
  let parsed = {};
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) ?? {};
  } catch {
    parsed = {};
  }
  const current = Array.isArray(parsed[key]) ? parsed[key] : [];
  parsed[key] = [proposal, ...current];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2));
  return proposal.id;
}

async function cleanupWallet() {
  try {
    const r = await req('/api/wallet', { method: 'POST', json: { action: 'delete' } });
    if (r.ok) console.log('   cleaned up test wallet');
  } catch {}
}

// Sign in.
const seed = KeetaNet.lib.Account.generateRandomSeed({ asString: true });
const account = KeetaNet.lib.Account.fromSeed(seed, 0);
const address = account.publicKeyString.get();
const nonce = await (await req('/api/auth/nonce', { method: 'POST' })).json();
const sig = await account.sign(new TextEncoder().encode(nonce.nonce).buffer);
await req('/api/auth/login', {
  method: 'POST',
  json: { address, nonce: nonce.nonce, signature: Buffer.from(sig.getBuffer()).toString('base64') },
});

console.log('== live: a fillable pair routes ==');
{
  const id = await seedProposal(address, '$KBUSD', '$KUSD', '1');
  const prep = await req('/api/trades/prepare', { method: 'POST', json: { tradeId: id } });
  const j = await prep.json();
  const route = j.intent?.summary?.route;
  check('prepare returned an intent', Boolean(j.intent), j.error ?? '');
  check('the intent names a route', route === 'base anchor' || route === 'on-chain', String(route));
  // Today the only live provider is the base anchor, so expect it — but do not
  // hard-fail if a second provider starts quoting.
  if (route === 'base anchor') check('the live fill is via the base anchor', true, route);
}

console.log('== live: a non-fillable pair is graceful ==');
{
  // KTA->USDC has no executable quote (only an estimate) — the dead end.
  const id = await seedProposal(address, '$KTA', '$USDC', '1');
  const prep = await req('/api/trades/prepare', { method: 'POST', json: { tradeId: id } });
  const j = await prep.json();
  check('it does not 409 the user', prep.status === 200, `status ${prep.status}`);
  check('it reports no liquidity', j.noLiquidity === true, JSON.stringify(j).slice(0, 120));
  check('it gives a human reason', typeof j.error === 'string' && /liquidity|executable|try later/i.test(j.error), j.error ?? '');
  check('it includes the estimate', typeof j.error === 'string' && /est 1 KTA/.test(j.error), j.error ?? '');
}

await cleanupWallet();
console.log(`\n${failures === 0 ? 'ALL ROUTING CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
