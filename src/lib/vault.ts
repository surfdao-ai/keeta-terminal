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

/** What the browser tells us about WebAuthn PRF support. */
export type PrfSupport = 'yes' | 'no' | 'unknown';

export interface VaultRecord {
  v: 1;
  mode: VaultMode;
  address: string;
  /**
   * A second, deliberately low-balance wallet for unattended automations.
   * It is sealed in the same vault, so it never reaches the server either.
   */
  automation?: { seed: string; address: string };
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
 * The record is re-sealed with the same passphrase, so the automation seed is
 * protected exactly like the main one.
 */
export async function withAutomationWallet(
  rec: VaultRecord,
  passphrase: string,
  seed: string,
  address: string,
): Promise<VaultRecord> {
  const salt = fromB64(rec.salt);
  const key = await passphraseKey(passphrase, salt);
  const next: VaultRecord = { ...rec, automation: { seed, address } };
  const { iv, ciphertext, tag } = await seal(key, seed);
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

async function seal(key: CryptoKey, seed: string): Promise<{ iv: string; ciphertext: string; tag: string }> {
  const iv = randomBytes(12);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, encoder.encode(seed) as BufferSource),
  );
  // WebCrypto appends the 16-byte tag to the ciphertext.
  return {
    iv: toB64(iv),
    ciphertext: toB64(sealed.slice(0, sealed.length - 16)),
    tag: toB64(sealed.slice(sealed.length - 16)),
  };
}

async function open(key: CryptoKey, rec: VaultRecord): Promise<string> {
  const combined = new Uint8Array([...fromB64(rec.ciphertext), ...fromB64(rec.tag)]);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(rec.iv) as BufferSource, tagLength: 128 },
    key,
    combined as BufferSource,
  );
  return decoder.decode(plain);
}

export interface VaultOptions {
  /** The seed to protect. */
  seed: string;
  /** The public address of that seed. */
  address: string;
  /** An optional second, low-balance wallet for automations. */
  automation?: { seed: string; address: string };
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

  const { iv, ciphertext, tag } = await seal(key, opts.seed);
  return {
    v: 1,
    mode: opts.mode,
    address: opts.address,
    ...(opts.automation ? { automation: opts.automation } : {}),
    salt: toB64(salt),
    iv,
    ciphertext,
    tag,
    ...(credentialId ? { credentialId } : {}),
    createdAt: new Date().toISOString(),
  };
}

/** Unlock the vault and return the seed (and the automation wallet, if any). */
export async function openVaultFull(
  rec: VaultRecord,
  passphrase?: string,
): Promise<{ seed: string; automation?: { seed: string; address: string } }> {
  const salt = fromB64(rec.salt);
  const key =
    rec.mode === 'passkey'
      ? await passkeyKey(rec.credentialId ?? '', salt)
      : await passphraseKey(passphrase ?? '', salt);
  const seed = await open(key, rec);
  return { seed, ...(rec.automation ? { automation: rec.automation } : {}) };
}

/** Unlock the vault and return just the main seed. */
export async function openVault(rec: VaultRecord, passphrase?: string): Promise<string> {
  return (await openVaultFull(rec, passphrase)).seed;
}
