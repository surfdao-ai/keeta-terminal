/**
 * Exercise the real device vault: seal a seed with a passphrase, store it,
 * read it back and open it — plus the failure modes.
 *
 * Usage: node --experimental-strip-types scripts/vault-test.mjs
 */
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

const { createVault, openVault, readVault, writeVault, clearVault } = await import(
  '../src/lib/vault.ts'
);

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

const SEED = 'keeta-test-seed-0123456789abcdef';
const ADDR = 'keeta_aab6pyrhzscrj4flngdedu6nycckcmad57m4yp4nv23ks3xqlsf5nfhjzn7nyki';

console.log('--- passphrase vault ---');
const rec = await createVault({
  seed: SEED,
  address: ADDR,
  mode: 'passphrase',
  passphrase: 'correct horse battery staple',
});
check('record is created', Boolean(rec));
check('record has no plaintext seed', !JSON.stringify(rec).includes(SEED));
check('mode is passphrase', rec.mode === 'passphrase');
check('salt/iv/tag present', Boolean(rec.salt && rec.iv && rec.tag && rec.ciphertext));
check('address kept', rec.address === ADDR);

writeVault(rec);
const stored = readVault();
check('record survives storage', stored?.address === ADDR && stored?.mode === 'passphrase');

const opened = await openVault(stored, 'correct horse battery staple');
check('opens with the right passphrase', opened === SEED, opened);

let wrongRejected = false;
try {
  await openVault(stored, 'wrong passphrase');
} catch {
  wrongRejected = true;
}
check('wrong passphrase is rejected', wrongRejected);

let missingRejected = false;
try {
  await openVault(stored, '');
} catch {
  missingRejected = true;
}
check('empty passphrase is rejected', missingRejected);

const tampered = { ...stored, ciphertext: stored.ciphertext.slice(0, -4) + 'AAAA' };
let tamperRejected = false;
try {
  await openVault(tampered, 'correct horse battery staple');
} catch {
  tamperRejected = true;
}
check('tampered ciphertext is rejected', tamperRejected);

console.log('\n--- short passphrase ---');
let shortRejected = false;
try {
  await createVault({ seed: SEED, address: ADDR, mode: 'passphrase', passphrase: 'short' });
} catch {
  shortRejected = true;
}
check('passphrase under 8 chars is rejected', shortRejected);

clearVault();
check('vault can be cleared', readVault() === null);

console.log(failures === 0 ? '\nall vault checks passed' : `\n${failures} vault check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
