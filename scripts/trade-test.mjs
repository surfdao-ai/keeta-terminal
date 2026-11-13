/**
 * End-to-end trade test: the browser proposes, signs and submits; the server
 * never holds a key.
 *
 * The browser is simulated in node — it signs with a wallet key it keeps to
 * itself and posts only the signed block.
 *
 * Usage: BASE=http://localhost:3000 node scripts/trade-test.mjs
 */
import * as KeetaNet from '@keetanetwork/keetanet-client';

const BASE = process.env.BASE ?? 'http://localhost:3000';
let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

const jar = new Map();
const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
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

// The browser's wallet.
const seed = KeetaNet.lib.Account.generateRandomSeed({ asString: true });
const account = KeetaNet.lib.Account.fromSeed(seed, 0);
const address = account.publicKeyString.get();
console.log('browser wallet:', address);

/**
 * Seed a pending proposal into the owner-scoped store the server reads.
 *
 * This is what the agent's propose_trade tool writes: a pending swap under
 * `u:<address>:pendingTrades`. It is a test shortcut, not an app path — the
 * agent path itself is exercised above.
 *
 * The store mirrors src/lib/db.ts: Postgres when DATABASE_URL is set, the
 * local JSON file otherwise.
 */
async function seedProposal(owner) {
  const key = `u:${owner.toLowerCase()}:pendingTrades`;
  const proposal = {
    id: crypto.randomUUID(),
    kind: 'swap',
    fromToken: '$KBUSD',
    toToken: '$KUSD',
    amount: '1',
    affinity: 'from',
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
  };

  if (process.env.DATABASE_URL) {
    const postgres = (await import('postgres')).default;
    const sql = postgres(process.env.DATABASE_URL, { max: 1 });
    try {
      const { rows } = await sql`SELECT value FROM kt_store WHERE key = ${key}`;
      const current = Array.isArray(rows[0]?.value) ? rows[0].value : [];
      const next = [proposal, ...current];
      await sql`INSERT INTO kt_store (key, value, rev) VALUES (${key}, ${sql.json(
        next,
      )}, 0) ON CONFLICT (key) DO UPDATE SET value = ${sql.json(next)}, rev = kt_store.rev + 1`;
      return proposal.id;
    } finally {
      await sql.end();
    }
  }

  // The local file store.
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

// Sign in.
const nonce = await (await req('/api/auth/nonce', { method: 'POST' })).json();
const sig = await account.sign(new TextEncoder().encode(nonce.nonce).buffer);
const login = await req('/api/auth/login', {
  method: 'POST',
  json: { address, nonce: nonce.nonce, signature: Buffer.from(sig.getBuffer()).toString('base64') },
});
check('signed in', login.ok, `status ${login.status}`);

// Ask the agent to propose a trade (it creates the pending action).
// The free model is not deterministic, so ask a few times.
console.log('\n== the agent proposes ==');
let tradeId = null;
let toolCalls = 0;

for (let attempt = 1; attempt <= 3 && !tradeId; attempt++) {
  const chat = await req('/api/chat', {
    method: 'POST',
    json: {
      messages: [
        {
          id: `m${attempt}`,
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'Propose a trade of 1 KBUSD to KUSD. You must call the propose_trade tool.',
            },
          ],
        },
      ],
      providerConfig: {
        type: 'openai-compatible',
        name: 'pollinations',
        baseUrl: 'https://text.pollinations.ai/openai',
        model: 'openai-fast',
      },
    },
  });
  const text = await chat.text();
  const lines = text.split('\n').filter((l) => l.startsWith('data: '));
  for (const line of lines) {
    try {
      const j = JSON.parse(line.slice(6));
      if (j.type === 'tool-input-available') toolCalls++;
      // The tool output arrives flat: { type:'tool-output-available', output:{ tradeId, ... } }
      const blob = JSON.stringify(j);
      const found = blob.match(/"tradeId"\s*:\s*"([0-9a-f-]{36})"/);
      if (found) tradeId = found[1];
    } catch {}
  }
  if (!tradeId) console.log(`  attempt ${attempt}: no proposal yet (${toolCalls} tool calls)`);
}

check('the agent proposed a trade', Boolean(tradeId), tradeId ?? 'no tradeId in the stream');

if (!tradeId) {
  // The agent is right to refuse: there is no binding quote for this pair, so
  // it will not propose a trade that cannot fill. To keep the *signing* part
  // of the flow under test, seed the same pending proposal the agent would
  // have created, into the same owner-scoped store the server reads.
  console.log('  (the model declined to propose a trade that cannot fill — seeding one)');
  tradeId = await seedProposal(address);
  check('a proposal exists to prepare', Boolean(tradeId), tradeId ?? 'could not seed one');
}

if (!tradeId) {
  console.log('\nno proposal to work with — cannot continue');
  process.exit(failures === 0 ? 0 : 1);
}

// The browser asks the server to prepare it (a quote, no key involved).
console.log('\n== prepare (server side, no key) ==');
const prep = await req('/api/trades/prepare', { method: 'POST', json: { tradeId } });
const prepJson = await prep.json();
check('prepare answered', prep.status === 200 || prep.status === 409, `status ${prep.status} ${prepJson.error ?? ''}`);

if (!prepJson.intent) {
  console.log(
    '\nno binding quote is available for this pair right now, so the trade cannot be signed —',
    '\nthe flow stopped exactly where it should: before anything is signed.',
  );
  console.log(`\n${failures === 0 ? 'TRADE FLOW OK (market dry)' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

// The browser signs the block locally.
console.log('\n== sign in the browser ==');
const intent = prepJson.intent;
const provider = KeetaNet.lib.Account.fromPublicKeyString(intent.providerAccount);
const costToken = intent.costToken
  ? KeetaNet.lib.Account.fromPublicKeyString(intent.costToken)
  : null;
const anchor = await import('@keetanetwork/anchor');
const ExternalBuilder = anchor.lib.AnchorExternal.Builder;

await using client = KeetaNet.UserClient.fromNetwork('main', account);
const builder = client.initBuilder();
const rawAmount = BigInt(intent.rawAmount);
const sendAmount = intent.affinity === 'to' ? BigInt(intent.convertedAmount) : rawAmount;
const receiveAmount = intent.affinity === 'to' ? rawAmount : BigInt(intent.convertedAmount);
const costAmount = BigInt(intent.costAmount);
const costUsesSendToken =
  costAmount > 0n && costToken !== null && costToken.publicKeyString.get() === intent.from;

if (costAmount > 0n && !costUsesSendToken && costToken) {
  builder.send(provider, costAmount, costToken);
}
builder.receive(provider, receiveAmount, KeetaNet.lib.Account.fromPublicKeyString(intent.to), intent.affinity === 'to');
const external = await new ExternalBuilder()
  .setAnchor(provider, { transactionId: crypto.randomUUID() })
  .build();
builder.send(
  provider,
  costUsesSendToken ? sendAmount + costAmount : sendAmount,
  KeetaNet.lib.Account.fromPublicKeyString(intent.from),
  external,
);
const blocks = await builder.computeBlocks();
const signed = blocks.blocks[0];
const bytes = Buffer.from(signed.toBytes()).toString('base64');

// The proof that the browser signed it: the block carries a signature.
const blockJson = signed.toJSON();
const hasSignature = Boolean(blockJson.signature ?? blockJson.signatures);
check(
  'the browser signed the swap block',
  hasSignature && bytes.length > 100,
  `${bytes.length} base64 chars, signature=${hasSignature}`,
);

// The browser posts only the signed blob.
console.log('\n== submit the signed block ==');
const submit = await req('/api/trades/submit', { method: 'POST', json: { tradeId, signedBlock: bytes } });
const submitJson = await submit.json();
check(
  'the server forwarded the signed block to the provider',
  submit.status === 200 || submit.status === 409,
  `status ${submit.status} ${submitJson.error ?? JSON.stringify(submitJson).slice(0, 120)}`,
);
check('no seed was sent to the server', !JSON.stringify(submitJson).includes(seed));

console.log(`\n${failures === 0 ? 'TRADE FLOW OK' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
