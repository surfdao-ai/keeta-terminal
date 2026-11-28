/**
 * E2E smoke test for the token detail route against a local server.
 *
 * Reads a real mainnet token (KUSD) through /api/tokens/detail (keyless reads)
 * and asserts the full shape: identity, decoded metadata, supply, treasury,
 * ACL + flags, default permission.
 *
 *   BASE=http://localhost:3111 npx tsx scripts/test-token-detail.mts
 */
import KeetaNet from '@keetanetwork/keetanet-client';

const BASE = process.env.BASE || 'http://localhost:3111';
const KUSD = 'keeta_aorhqgqpkr4it5fttli3hp2vmy5fxx32456nz3c7yuowommiibhj46zsdtdci';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name} ${extra}`);
  }
}

const cookies = new Map<string, string>();
async function req(path: string, opts: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (cookies.size) headers.cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  for (const h of res.headers.getSetCookie?.() ?? []) {
    const pair = h.split(';')[0];
    const idx = pair.indexOf('=');
    if (idx >= 0) cookies.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  return res;
}

// sign in with a throwaway wallet
const seed = KeetaNet.lib.Account.generateRandomSeed({ asString: true });
const account = KeetaNet.lib.Account.fromSeed(seed, 0);
const address = account.publicKeyString.get();
const n = await (await req('/api/auth/nonce', { method: 'POST' })).json();
const sig = await account.sign(new TextEncoder().encode(n.nonce).buffer);
const login = await req('/api/auth/login', {
  method: 'POST',
  body: { address, nonce: n.nonce, signature: Buffer.from(sig.getBuffer()).toString('base64') },
});
check('signed in', login.status === 200);

const res = await req(`/api/tokens/detail?token=${encodeURIComponent(KUSD)}`);
const j = (await res.json()) as any;
check('detail 200', res.status === 200, JSON.stringify(j).slice(0, 200));

check('symbol KUSD', j.symbol === 'KUSD', JSON.stringify(j.symbol));
check('decimals 6', j.decimals === 6, JSON.stringify(j.decimals));
check('supply present', typeof j.supply === 'string' && j.supply !== null);
check('supplyRaw present', typeof j.supplyRaw === 'string');
check('treasury present', typeof j.treasury === 'string');
check('metadata decoded', j.metadata && typeof j.metadata.decimalPlaces === 'number', JSON.stringify(j.metadata));
check('logoURI present', typeof j.metadata?.logoURI === 'string');
check('defaultPermission non-empty', Array.isArray(j.defaultPermission) && j.defaultPermission.length > 0, JSON.stringify(j.defaultPermission));
check('acl has OWNER row', j.acl.some((r: any) => r.flags.includes('OWNER')), JSON.stringify(j.acl).slice(0, 300));
check('headHeight present', typeof j.headHeight === 'string');
check('asOf present', typeof j.asOf === 'string');

// a random address format that isn't a known token -> 404 (or 200 with empty info, both fine)
const rand = KeetaNet.lib.Account.generateRandomSeed({ asString: true });
const acct = KeetaNet.lib.Account.fromSeed(rand, 0);
const bad = await req(`/api/tokens/detail?token=${encodeURIComponent(acct.publicKeyString.get())}`);
check('unknown token not 500', bad.status === 404 || bad.status === 200, String(bad.status));

// malformed token -> 400
const malformed = await req('/api/tokens/detail?token=not-a-token');
check('bad token 400', malformed.status === 400);

console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
process.exit(failed === 0 ? 0 : 1);
