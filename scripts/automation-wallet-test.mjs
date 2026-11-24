/**
 * The automation wallet — does it actually work as the UI claims?
 *
 * The claim: "a separate, low-balance account… sealed in your vault" and
 * "Unattended swaps run from this wallet only."
 *
 * The vault has ONE encrypted slot. The release that shipped the automation
 * wallet sealed the automation seed INTO that slot — overwriting the main
 * key — so the first sign-in after creating an automation wallet handed back
 * the automation seed as the "main" one (manual trades would sign as the
 * automation wallet, and the real main key was lost from the device).
 *
 * This test pins the correct behaviour:
 *   1. creating the automation wallet leaves the MAIN seed untouched;
 *   2. no seed (main or automation) ever sits in plaintext in the record;
 *   3. "main" signatures come from the main account, automation signatures
 *      from the automation account (proved on a real signed block);
 *   4. a record left behind by the broken release is DETECTED, refusing to
 *      unlock as the wrong wallet and refusing to stack another one on top;
 *   5. re-importing the main seed (the repair path) carries the still-valid
 *      automation wallet over into a healthy record.
 *
 * Usage: npm run test:automation-wallet   (no server needed)
 */

/* --- a tiny localStorage shim (same shape as the other tests) ------------ */
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

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

const PASSPHRASE = 'automation wallet test passphrase';

const {
  createVault,
  withAutomationWallet,
  openVaultFull,
  readVault,
  writeVault,
  clearVault,
  isCorruptedVault,
  CorruptedVaultError,
} = await import('../src/lib/vault.ts');
const { addressFromSeedOnDevice } = await import('../src/lib/keeta/device.ts');
const KeetaNet = await import('@keetanetwork/keetanet-client');
const { Account } = KeetaNet.lib;

const addrOf = (seed) => Account.fromSeed(seed, 0).publicKeyString.get();

/* ------------------------------------------------------------------ *
 * 1. Create the automation wallet the way the UI does (passphrase).
 * ------------------------------------------------------------------ */

const mainSeed = Account.generateRandomSeed({ asString: true });
const mainAddress = addrOf(mainSeed);
const autoSeed = Account.generateRandomSeed({ asString: true });
const autoAddress = addrOf(autoSeed);

console.log('\n== create the automation wallet (UI path) ==');
writeVault(await createVault({ mode: 'passphrase', passphrase: PASSPHRASE, seed: mainSeed, address: mainAddress }));
check('created a main vault', readVault()?.address === mainAddress, mainAddress);

const after = await withAutomationWallet(readVault(), PASSPHRASE, autoSeed, autoAddress);
check('the vault records the automation ADDRESS', after.automation?.address === autoAddress, autoAddress);

const recordRaw = JSON.stringify(after);
check('the record holds NO plaintext main seed', !recordRaw.includes(mainSeed));
check('the record holds NO plaintext automation seed', !recordRaw.includes(autoSeed));

/* ------------------------------------------------------------------ *
 * 2. Re-unlock: the main seed must still be the main seed.
 * ------------------------------------------------------------------ */

console.log('\n== re-unlock after creating the automation wallet ==');
const unlocked = await openVaultFull(readVault(), PASSPHRASE);

check(
  'the MAIN seed survived creating the automation wallet',
  unlocked.seed === mainSeed,
  unlocked.seed === mainSeed ? 'main intact' : `main slot now holds ${unlocked.seed === autoSeed ? 'the AUTOMATION seed' : 'something else'}`,
);
check('the automation seed is returned alongside it', unlocked.automation?.seed === autoSeed);
check('the automation address is returned with it', unlocked.automation?.address === autoAddress);

// Which account does a "main" login actually sign as?
check(
  'a "main" signature comes from the MAIN account',
  addrOf(unlocked.seed) === mainAddress,
  `signed as ${addrOf(unlocked.seed).slice(0, 24)}…`,
);
check(
  'the automation path resolves to the AUTOMATION account',
  unlocked.automation && addrOf(unlocked.automation.seed) === autoAddress,
  unlocked.automation ? `automation = ${addrOf(unlocked.automation.seed).slice(0, 24)}…` : 'no automation wallet',
);

/* ------------------------------------------------------------------ *
 * 3. Replace (create a second automation wallet) — main still intact.
 * ------------------------------------------------------------------ */

console.log('\n== replace the automation wallet a second time ==');
const autoSeed2 = Account.generateRandomSeed({ asString: true });
const autoAddress2 = addrOf(autoSeed2);
await withAutomationWallet(readVault(), PASSPHRASE, autoSeed2, autoAddress2);
const reUnlocked = await openVaultFull(readVault(), PASSPHRASE);
check('the main seed is still intact after a replace', reUnlocked.seed === mainSeed);
check('the replacement automation seed round-trips', reUnlocked.automation?.seed === autoSeed2);
check('the old automation seed is gone from the record', !JSON.stringify(readVault()).includes(autoSeed));
check('the old automation seed is gone from the slot', reUnlocked.automation?.seed !== autoSeed);

/* ------------------------------------------------------------------ *
 * 4. Proof on a real signed block: the block debits the signer's account.
 *    (The app builds blocks with `client.initBuilder()` from the chosen
 *    seed — the signer IS the funding account.)
 * ------------------------------------------------------------------ */

console.log('\n== the block signer is the funding account ==');
// A token account (KTA) so the builder accepts a SEND.
const token = Account.fromPublicKeyString('keeta_amnkge74xitii5dsobstldatv3irmyimujfjotftx7plaaaseam4bntb7wnna');
const signerFor = async (seed) => {
  const acct = Account.fromSeed(seed, 0);
  const client = await KeetaNet.UserClient.fromNetwork('main', acct);
  const builder = client.initBuilder();
  builder.send(acct, 1000n, token);
  const { blocks } = await builder.computeBlocks();
  const raw = Buffer.from(blocks[0].toBytes()).toString('base64');
  const decoded = new KeetaNet.lib.Block(raw).toJSON();
  return { signer: decoded.signer, hasSignature: Boolean(decoded.signature ?? decoded.signatures) };
};

const mainSigned = await signerFor(mainSeed);
check('a main-signed block names the MAIN account as signer', mainSigned.signer === mainAddress, `signer=${String(mainSigned.signer).slice(0, 24)}…`);
const autoSigned = await signerFor(autoSeed2);
check('an automation-signed block names the AUTOMATION account as signer', autoSigned.signer === autoAddress2, `signer=${String(autoSigned.signer).slice(0, 24)}…`);
check('both blocks carry real signatures', mainSigned.hasSignature && autoSigned.hasSignature);
check(
  'the two signers are different accounts',
  mainSigned.signer !== autoSigned.signer,
);

/* ------------------------------------------------------------------ *
 * 5. The corrupted legacy record (left by the broken release) is
 *    detected, and the repair path carries the automation over.
 * ------------------------------------------------------------------ */

console.log('\n== corrupted legacy record (as the broken release left it) ==');
// A faithful reproduction: build a real vault, then apply exactly what the
// old withAutomationWallet did — PBKDF2(main passphrase) → AES-GCM(automation
// seed) into the slot, and the automation seed in plaintext on the record.
const brokenRecord = await (async () => {
  writeVault(await createVault({ mode: 'passphrase', passphrase: PASSPHRASE, seed: mainSeed, address: mainAddress }));
  const rec = readVault();
  if (!rec) throw new Error('no vault in storage');
  const salt = new Uint8Array(Buffer.from(rec.salt, 'base64'));
  const subtle = crypto.subtle;
  const material = await subtle.importKey('raw', new TextEncoder().encode(PASSPHRASE), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(autoSeed2)),
  );
  const b64 = (b) => Buffer.from(b).toString('base64');
  return {
    ...rec,
    automation: { seed: autoSeed2, address: autoAddress2 },
    iv: b64(iv),
    ciphertext: b64(sealed.slice(0, sealed.length - 16)),
    tag: b64(sealed.slice(sealed.length - 16)),
  };
})();

writeVault(brokenRecord);
check('isCorruptedVault detects the broken record', isCorruptedVault(brokenRecord) === true);
check('a healthy record is NOT flagged', isCorruptedVault(after) === false);

let refused = false;
try {
  await withAutomationWallet(readVault(), PASSPHRASE, Account.generateRandomSeed({ asString: true }), autoAddress2);
} catch (e) {
  refused = e instanceof CorruptedVaultError;
}
check('refuses to stack another automation wallet on a corrupted record', refused);

// Repair: the user re-imports the main seed. The new code carries the
// still-valid automation wallet into the fresh vault (what sealAndStore does).
const repaired = await createVault({
  mode: 'passphrase',
  passphrase: PASSPHRASE,
  seed: mainSeed,
  address: mainAddress,
  automation: { seed: autoSeed2, address: autoAddress2 },
});
writeVault(repaired);
check('the repaired record holds NO plaintext seed', !JSON.stringify(repaired).includes(mainSeed) && !JSON.stringify(repaired).includes(autoSeed2));
check('the repaired record is not flagged corrupted', isCorruptedVault(repaired) === false);
const repairedUnlock = await openVaultFull(readVault(), PASSPHRASE);
check('the repaired vault opens with the MAIN seed', repairedUnlock.seed === mainSeed);
check('the automation wallet survived the repair', repairedUnlock.automation?.seed === autoSeed2 && repairedUnlock.automation?.address === autoAddress2);

clearVault();

console.log(`\n${failures === 0 ? 'ALL AUTOMATION-WALLET CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
