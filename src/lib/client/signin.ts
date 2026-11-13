'use client';

/**
 * The sign-in flow, as logic rather than interface.
 *
 * The screen in `SignInGate.tsx` is a thin layer over these functions, which
 * keeps the flow testable without a browser: create a wallet, import one,
 * unlock the one on this device, and prove control of it to the server.
 *
 * The seed never leaves this module's caller — it is generated, sealed and
 * used to sign, and only the signature travels.
 */
import { apiFetch } from '@/lib/client/api';
import { signNonce } from '@/lib/keeta/browser-signer';
import {
  createVault,
  openVaultFull,
  readVault,
  writeVault,
  PrfUnsupportedError,
  type VaultRecord,
} from '@/lib/vault';
import { generateSeedOnDevice, addressFromSeedOnDevice } from '@/lib/keeta/device';

export const MIN_PASSPHRASE = 8;

/** How the seed is protected on this device. */
export type SealMode = 'passkey' | 'passphrase';

export interface WalletSetup {
  /** The seed — keep it in memory only. */
  seed: string;
  /** Its public address. */
  address: string;
  /** The vault record that was stored on this device. */
  vault: VaultRecord;
}

export interface UnlockedWallet {
  seed: string;
  address: string;
  /** The low-balance automation wallet, if this device holds one. */
  automation?: { seed: string; address: string };
}

/** What is wrong with this passphrase, or null when it is fine. */
export function passphraseProblem(passphrase: string): string | null {
  if (passphrase.length < MIN_PASSPHRASE) {
    return `Use a passphrase of at least ${MIN_PASSPHRASE} characters.`;
  }
  return null;
}

/**
 * Seal a seed into a vault and store it on this device.
 *
 * A passkey that cannot derive a key (no PRF support) is reported as such,
 * so the caller can fall back to a passphrase instead of failing outright.
 */
async function sealAndStore(
  seed: string,
  address: string,
  mode: SealMode,
  passphrase?: string,
): Promise<VaultRecord> {
  if (mode === 'passphrase') {
    const problem = passphraseProblem(passphrase ?? '');
    if (problem) throw new Error(problem);
  }

  let vault: VaultRecord;
  try {
    vault = await createVault({
      seed,
      address,
      mode,
      ...(mode === 'passphrase' ? { passphrase } : {}),
    });
  } catch (e) {
    if (e instanceof PrfUnsupportedError) {
      throw new Error(
        'This device cannot protect the seed with a passkey, so use a passphrase instead. ' +
          'Your written-down seed remains the recovery copy.',
      );
    }
    throw e;
  }

  writeVault(vault);
  return vault;
}

/**
 * Create a wallet in this browser.
 *
 * The seed is generated here, sealed into the device vault and shown to the
 * user exactly once so it can be written down.
 */
export async function createWallet(opts: {
  mode?: SealMode;
  passphrase?: string;
}): Promise<WalletSetup> {
  const seed = await generateSeedOnDevice();
  const address = await addressFromSeedOnDevice(seed);
  const vault = await sealAndStore(seed, address, opts.mode ?? 'passphrase', opts.passphrase);
  return { seed, address, vault };
}

/** Import an existing seed and seal it into this device's vault. */
export async function importWallet(
  rawSeed: string,
  opts: { mode?: SealMode; passphrase?: string } = {},
): Promise<WalletSetup> {
  const seed = rawSeed.trim();
  if (!seed) throw new Error('Paste your seed first.');
  const address = await addressFromSeedOnDevice(seed);
  const vault = await sealAndStore(seed, address, opts.mode ?? 'passphrase', opts.passphrase);
  return { seed, address, vault };
}

/**
 * Unlock the wallet stored on this device.
 *
 * A passphrase vault needs the passphrase; a passkey vault needs the
 * authenticator (a Face ID / Touch ID tap).
 */
export async function unlockWallet(passphrase?: string): Promise<UnlockedWallet> {
  const vault = readVault();
  if (!vault) throw new Error('There is no wallet on this device.');

  try {
    const { seed, automation } = await openVaultFull(vault, passphrase);
    return { seed, address: vault.address, automation };
  } catch (e) {
    if (e instanceof PrfUnsupportedError) {
      throw new Error(
        'This device cannot open the passkey vault. Restore the wallet from your written-down ' +
          'seed ("Import an existing wallet") and seal it with a passphrase.',
      );
    }
    // The crypto layer reports a failed decryption as a generic DOMException.
    // What it means to a person is that the passphrase is not the right one.
    throw new Error('That passphrase does not open this wallet. Try again.');
  }
}

/**
 * Prove control of the wallet and open a session.
 *
 * The server issues a one-time nonce, the browser signs it with the wallet
 * key and the server verifies the signature against the public address. Only
 * the signature travels — never the seed.
 */
export async function signInWithWallet(seed: string, address: string): Promise<string> {
  const nonceRes = await apiFetch('/api/auth/nonce', { method: 'POST' });
  const nonceJson = await nonceRes.json();
  if (!nonceRes.ok) throw new Error(nonceJson.error ?? 'could not start sign-in');
  if (!nonceJson.nonce) throw new Error(nonceJson.error ?? 'the server issued no challenge');

  const signature = await signNonce(seed, nonceJson.nonce);
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    json: { address, signature, nonce: nonceJson.nonce },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? 'sign-in failed');

  // Register the public address so the server knows which wallet this is.
  // The session already carries it, so a failure here is not fatal.
  await apiFetch('/api/wallet', {
    method: 'POST',
    json: { action: 'register', address },
  }).catch(() => undefined);

  return String(j.address ?? address);
}
