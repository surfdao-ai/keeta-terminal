/**
 * Device vault — the wallet seed never lives on the server.
 *
 * The seed is held by the browser, sealed with a key that the server cannot
 * derive:
 *
 *   passkey     the key comes from the WebAuthn PRF extension, i.e. it is
 *               derived inside the authenticator from a non-exportable,
 *               device-bound credential. Unlocking is a Face ID / Touch ID
 *               tap — the seed is never typed.
 *   passphrase  the key is derived from a passphrase with PBKDF2. Convenience
 *               fallback for devices without PRF support.
 *
 * The written-down seed is the *recovery* copy: it restores the vault on a new
 * device and is never needed in normal use.
 *
 * Only the public address is registered with the server.
 */

const VAULT_KEY = 'kt-vault-v1';

export type VaultMode = 'passkey' | 'passphrase';

/** Raised when the device cannot derive a key from a passkey (no PRF support). */
export class PrfUnsupportedError extends Error {
  constructor() {
    super('This device cannot derive a key from the passkey (no PRF support).');
    this.name = 'PrfUnsupportedError';
  }
}

/**
 * Raised when a legacy vault was left in the corrupted state by the first
 * automation-wallet release: the encrypted slot that should hold the MAIN seed
 * was overwritten with the automation seed, so the main key is not recoverable
 * from the record on this device. The remedy (re-import the main seed) is
 * spelled out so it is not swallowed as a "wrong passphrase".
 */
export class CorruptedVaultError extends Error {
  constructor(address: string) {
    super(
      'This device’s vault was left in a bad state by an earlier kterminal bug: the ' +
        'automation wallet was stored in the main wallet’s slot, so the main key on this ' +
        'device can no longer be opened. Re-import your main wallet from the seed you wrote ' +
        'down (sign-in → “Import an existing wallet”), then create the automation wallet ' +
        'again. The automation wallet ' + address + ' is unaffected and still works.',
    );
    this.name = 'CorruptedVaultError';
  }
}

/** What the browser tells us about WebAuthn PRF support. */
export type PrfSupport = 'yes' | 'no' | 'unknown';

export interface VaultRecord {
  v: 1;
  mode: VaultMode;
  address: string;
  /**
   * A second, deliberately low-balance wallet for unattended automations.
   * The record keeps the public address only — the key is sealed inside the
   * same encrypted slot as the main seed (a v2 payload), so it never reaches
   * the server or sits in plaintext on this device.
   *
   * Legacy (pre-fix) records carry `{ seed, address }` in plaintext: the
   * record without the seed is the healthy shape, the record *with* the seed
   * means the broken release ran (see isCorruptedVault).
   */
  automation?: { address: string; seed?: string };
  /** base64 — PRF salt (passkey) or PBKDF2 salt (passphrase). */
  salt: string;
  /** base64 — AES-GCM iv. */
  iv: string;
  /** base64 — AES-GCM ciphertext (without the tag). */
  ciphertext: string;
  /** base64 — AES-GCM tag. */
  tag: string;
  /** base64url — the passkey credential id (passkey mode only). */
  credentialId?: string;
  createdAt: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ---------------------------------------------------------------- *
 * encoding helpers
 * ---------------------------------------------------------------- */

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of view) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toB64Url(bytes: ArrayBuffer | Uint8Array): string {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return fromB64(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/* ---------------------------------------------------------------- *
 * storage
 * ---------------------------------------------------------------- */

export function readVault(): VaultRecord | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as VaultRecord;
    return rec?.v === 1 ? rec : null;
  } catch {
    return null;
  }
}

export function writeVault(rec: VaultRecord): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(rec));
}

/**
 * Add (or replace) the low-balance automation wallet inside a vault record.
 *
 * The automation key is sealed into the same encrypted slot as the main key
 * (as part of a v2 payload), so the record never holds either seed in
 * plaintext and the main key is never disturbed. The slot is re-sealed with
 * the record's own key — a passkey vault asks the authenticator, a passphrase
 * vault uses the given passphrase — so both modes are treated identically.
 */
export async function withAutomationWallet(
  rec: VaultRecord,
  passphrase: string | undefined,
  seed: string,
  address: string,
): Promise<VaultRecord> {
  if (isCorruptedVault(rec)) {
    // The broken earlier release left its automation seed in the record in
    // plaintext and overwrote the main key. Stacking another wallet on top
    // would compound the damage: refuse — the main wallet must be re-imported
    // first, and the re-import carries this automation wallet over.
    throw new CorruptedVaultError(rec.automation?.address ?? '');
  }
  const key = await vaultKey(rec, passphrase);
  const current = await openSlot(key, rec);
  const payload: VaultPayload = { ...current, automationSeed: seed };
  const next: VaultRecord = { ...rec, automation: { address } };
  const { iv, ciphertext, tag } = await sealSlot(key, payload);
  const merged: VaultRecord = { ...next, iv, ciphertext, tag };
  writeVault(merged);
  return merged;
}

export function clearVault(): void {
  localStorage.removeItem(VAULT_KEY);
}

/* ---------------------------------------------------------------- *
 * key derivation
 * ---------------------------------------------------------------- */

async function aesKeyFromBytes(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function passphraseKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 310_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

interface PrfResults {
  prf?: { first?: ArrayBuffer; second?: ArrayBuffer };
}

function prfBytes(results: PrfResults | undefined): Uint8Array | null {
  const first = results?.prf?.first;
  return first ? new Uint8Array(first) : null;
}

/**
 * Whether this browser can derive a key from a passkey (WebAuthn PRF).
 *
 * Only some engines expose `getClientCapabilities` (Chrome). Where it is
 * missing the answer is genuinely unknown, so callers must be ready for the
 * passkey path to fail — see PrfUnsupportedError.
 */
export async function prfSupport(): Promise<PrfSupport> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return 'no';
  try {
    const caps = (await (
      window.PublicKeyCredential as unknown as {
        getClientCapabilities?: () => Promise<{ extensions?: { prf?: boolean } }>;
      }
    ).getClientCapabilities?.()) ?? { extensions: {} };
    if (caps.extensions?.prf === true) return 'yes';
    if (caps.extensions?.prf === false) return 'no';
  } catch {
    /* getClientCapabilities is optional — the answer stays unknown */
  }
  return 'unknown';
}

/** Kept for callers that only need a yes/no answer. */
export async function passkeySupported(): Promise<boolean> {
  return (await prfSupport()) !== 'no';
}

/**
 * Register a passkey and derive the vault key from it.
 * The credential is resident (discoverable) so it can be found later.
 */
async function createPasskey(salt: Uint8Array): Promise<{ credentialId: string; key: CryptoKey }> {
  const challenge = randomBytes(32);
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge as BufferSource,
      rp: { name: 'KTerminal', id: window.location.hostname },
      user: {
        id: randomBytes(16) as BufferSource,
        name: 'kterminal-wallet',
        displayName: 'KTerminal wallet',
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error('Passkey registration was cancelled.');

  // A registration does not return PRF output; derive it with an assertion.
  const key = await passkeyKey(credential.id, salt);
  return { credentialId: toB64Url(credential.rawId), key };
}

/** Ask the passkey for the vault key (a Face ID / Touch ID prompt). */
async function passkeyKey(
  credentialId: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      allowCredentials: [{ id: fromB64Url(credentialId) as BufferSource, type: 'public-key' }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: salt as BufferSource } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error('Passkey unlock was cancelled.');

  const response = assertion.response as AuthenticatorAssertionResponse;
  const results = (
    response as unknown as { getClientExtensionResults?: () => PrfResults }
  ).getClientExtensionResults?.();
  const bytes = prfBytes(results);
  if (!bytes) {
    // The authenticator accepted the assertion but produced no PRF output:
    // this engine cannot derive a key from a passkey.
    throw new PrfUnsupportedError();
  }
  return aesKeyFromBytes(bytes);
}

/* ---------------------------------------------------------------- *
 * seal / open
 * ---------------------------------------------------------------- */

/**
 * What is inside the encrypted slot.
 *
 * v1 (legacy): the main seed as a plain string.
 * v2: JSON `{ v: 2, seed, automationSeed? }` — both keys in the same slot, so
 * the record never holds either seed in plaintext and the automation key can
 * never overwrite the main one (an earlier release did exactly that).
 */
export interface VaultPayload {
  seed: string;
  automationSeed?: string;
}

/** Parse an unsealed slot into a payload (v1 plain text or v2 JSON). */
function parseVaultPayload(plain: string): VaultPayload {
  const t = plain.trim();
  if (t.startsWith('{')) {
    const obj = JSON.parse(t) as { seed?: unknown; automationSeed?: unknown };
    if (typeof obj.seed !== 'string' || !obj.seed) throw new Error('Unreadable vault payload.');
    return {
      seed: obj.seed,
      ...(typeof obj.automationSeed === 'string' && obj.automationSeed ? { automationSeed: obj.automationSeed } : {}),
    };
  }
  return { seed: t };
}

/** Seal a payload (both keys) into one encrypted slot. */
async function sealSlot(
  key: CryptoKey,
  payload: VaultPayload,
): Promise<{ iv: string; ciphertext: string; tag: string }> {
  const plain = JSON.stringify({
    v: 2,
    seed: payload.seed,
    ...(payload.automationSeed ? { automationSeed: payload.automationSeed } : {}),
  });
  const iv = randomBytes(12);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, encoder.encode(plain) as BufferSource),
  );
  // WebCrypto appends the 16-byte tag to the ciphertext.
  return {
    iv: toB64(iv),
    ciphertext: toB64(sealed.slice(0, sealed.length - 16)),
    tag: toB64(sealed.slice(sealed.length - 16)),
  };
}

/** Open the encrypted slot into a payload. */
async function openSlot(key: CryptoKey, rec: VaultRecord): Promise<VaultPayload> {
  const combined = new Uint8Array([...fromB64(rec.ciphertext), ...fromB64(rec.tag)]);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(rec.iv) as BufferSource, tagLength: 128 },
    key,
    combined as BufferSource,
  );
  return parseVaultPayload(decoder.decode(plain));
}

/**
 * Derive the record's own encryption key. A passkey record asks the
 * authenticator (no passphrase is used); a passphrase record uses the one
 * given.
 */
async function vaultKey(rec: VaultRecord, passphrase?: string): Promise<CryptoKey> {
  const salt = fromB64(rec.salt);
  return rec.mode === 'passkey'
    ? await passkeyKey(rec.credentialId ?? '', salt)
    : await passphraseKey(passphrase ?? '', salt);
}

/**
 * True when an earlier, broken automation-wallet release left this record
 * behind: healthy records never carry the automation seed in plaintext, and
 * the broken one overwrote the main key in the encrypted slot with it.
 */
export function isCorruptedVault(rec: VaultRecord): boolean {
  return Boolean(rec.automation?.seed);
}

export interface VaultOptions {
  /** The seed to protect. */
  seed: string;
  /** The public address of that seed. */
  address: string;
  /**
   * An optional second, low-balance wallet for automations, carried over when
   * re-sealing the same record (for example, re-importing the main wallet
   * after the earlier corruption: the automation wallet survives it).
   */
  automation?: { seed?: string; address: string };
  /** 'passkey' uses WebAuthn PRF; 'passphrase' uses PBKDF2. */
  mode: VaultMode;
  /** Required for mode='passphrase'. */
  passphrase?: string;
}

/** Seal the seed into a new vault record (does not store it). */
export async function createVault(opts: VaultOptions): Promise<VaultRecord> {
  const salt = randomBytes(32);
  let key: CryptoKey;
  let credentialId: string | undefined;

  if (opts.mode === 'passkey') {
    const created = await createPasskey(salt);
    key = created.key;
    credentialId = created.credentialId;
  } else {
    if (!opts.passphrase || opts.passphrase.length < 8) {
      throw new Error('Choose a passphrase of at least 8 characters.');
    }
    key = await passphraseKey(opts.passphrase, salt);
  }

  const payload: VaultPayload = {
    seed: opts.seed,
    ...(opts.automation?.seed ? { automationSeed: opts.automation.seed } : {}),
  };
  const { iv, ciphertext, tag } = await sealSlot(key, payload);
  return {
    v: 1,
    mode: opts.mode,
    address: opts.address,
    ...(opts.automation?.address ? { automation: { address: opts.automation.address } } : {}),
    salt: toB64(salt),
    iv,
    ciphertext,
    tag,
    ...(credentialId ? { credentialId } : {}),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Unlock the vault and return the seed (and the automation wallet, if any).
 *
 * The automation seed is read from the same encrypted slot as the main seed,
 * never from the record itself.
 */
export async function openVaultFull(
  rec: VaultRecord,
  passphrase?: string,
): Promise<{ seed: string; automation?: { seed: string; address: string } }> {
  const key = await vaultKey(rec, passphrase);
  const payload = await openSlot(key, rec);
  return {
    seed: payload.seed,
    ...(rec.automation?.address && payload.automationSeed
      ? { automation: { seed: payload.automationSeed, address: rec.automation.address } }
      : {}),
  };
}

/** Unlock the vault and return just the main seed. */
export async function openVault(rec: VaultRecord, passphrase?: string): Promise<string> {
  return (await openVaultFull(rec, passphrase)).seed;
}
