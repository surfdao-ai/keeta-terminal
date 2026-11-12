/**
 * Wallet management for the terminal.
 *
 * - The seed is generated once (random), AES-256-GCM encrypted under a key
 *   derived (scrypt) from the user's passphrase, and stored via db.ts.
 * - Unlock = derive key, decrypt seed, build Account, open UserClient.
 * - Plaintext seed exists only in the in-memory session map.
 */
import { scryptSync, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import * as KeetaNet from '@keetanetwork/keetanet-client';
import type { KeetaAccount } from './network';
import { dbRead, dbWrite } from '../db';

export interface StoredWallet {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
  salt: string; // base64
  address: string;
  createdAt: string;
}

const KEY_LEN = 32;
const SCRYPT_N = 1 << 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
}

function encryptSeed(seed: string, passphrase: string): Omit<StoredWallet, 'address' | 'createdAt'> {
  const salt = randomBytes(16);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(seed, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    salt: salt.toString('base64'),
  };
}

function decryptSeed(w: StoredWallet, passphrase: string): string {
  const salt = Buffer.from(w.salt, 'base64');
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(w.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(w.tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(w.ciphertext, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}

export async function hasWallet(): Promise<boolean> {
  const w = await dbRead<StoredWallet>('wallet');
  return Boolean(w);
}

export async function createWallet(passphrase: string): Promise<{ address: string; wallet: StoredWallet }> {
  if (passphrase.length < 8) throw new Error('Passphrase must be at least 8 characters.');
  const seed = KeetaNet.lib.Account.generateRandomSeed({ asString: true });
  const account = KeetaNet.lib.Account.fromSeed(seed, 0);
  const address = account.publicKeyString.get();
  const enc = encryptSeed(seed, passphrase);
  const wallet: StoredWallet = { ...enc, address, createdAt: new Date().toISOString() };
  await dbWrite('wallet', wallet);
  return { address, wallet };
}

export async function unlockWallet(passphrase: string): Promise<{ account: KeetaAccount; address: string }> {
  const w = await dbRead<StoredWallet>('wallet');
  if (!w) throw new Error('No wallet stored. Create one first.');
  let seed: string;
  try {
    seed = decryptSeed(w, passphrase);
  } catch {
    throw new Error('Wrong passphrase or corrupted wallet.');
  }
  // sanity check: derived account must match stored address
  const account = KeetaNet.lib.Account.fromSeed(seed, 0);
  if (account.publicKeyString.get() !== w.address) throw new Error('Passphrase mismatch.');
  return { account, address: w.address };
}

export async function walletAddress(): Promise<string | null> {
  const w = await dbRead<StoredWallet>('wallet');
  return w?.address ?? null;
}
