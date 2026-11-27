// Signed /api/rails check: expect 18 directions, 9 live, no KTA/fiat leakage.
const BASE = process.env.BASE ?? 'http://localhost:3111';
import KeetaNet from '@keetanetwork/keetanet-client';
const seed = KeetaNet.lib.Account.generateRandomSeed({ asString: true });
const account = KeetaNet.lib.Account.fromSeed(seed, 0);
const address = account.publicKeyString.get();
const cookies = new Map();
async function req(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (cookies.size) headers.cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.body ? {} : {}), ...headers },
    body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
    redirect: 'manual',
  });
  for (const h of res.headers.getSetCookie?.() ?? []) {
    const pair = h.split(';')[0];
    const idx = pair.indexOf('=');
    cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  return res;
}
const n = await (await req('/api/auth/nonce', { method: 'POST' })).json();
const sig = await account.sign(new TextEncoder().encode(n.nonce).buffer);
const login = await req('/api/auth/login', { method: 'POST', body: { address, nonce: n.nonce, signature: Buffer.from(sig.getBuffer()).toString('base64') } });
console.log('login', login.status);
const r = await req('/api/rails');
const j = await r.json();
console.log('status', r.status, 'directions', j.directions?.length, 'live', j.directions?.filter(d => d.live).length, 'fallback', j.fromFallback);
const ok = (x) => /^(K|KB)(USD|EUR|JPY|MXN|CAD|AED|GBP|HKD|CNY)$/.test(x);
const bad = (j.directions ?? []).filter(d => !ok(d.from) || !ok(d.to));
console.log('malformed/KTA rows (want 0):', bad.length);
console.log('sample:', JSON.stringify(j.directions?.find(d => d.from === 'KBUSD')));
process.exit(login.status === 200 && r.status === 200 && j.directions?.length === 18 && bad.length === 0 ? 0 : 1);
