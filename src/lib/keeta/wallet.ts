/**
 * Wallet registry.
 *
 * The server knows public addresses and nothing else. There is no seed
 * handling here on purpose: the seed is generated, stored and used only in
 * the browser (src/lib/vault.ts).
 */
import { dbRead, dbWrite } from '../db';

export interface StoredWallet {
  address: string;
  createdAt: string;
  updatedAt: string;
}

const KEY = 'wallet';

const ADDRESS_RE = /^keeta_[A-Za-z0-9]{32,}$/;

export async function hasWallet(owner: string): Promise<boolean> {
  return Boolean(await getWallet(owner));
}

export async function getWallet(owner: string): Promise<StoredWallet | null> {
  const w = await dbRead<StoredWallet>(KEY, owner);
  if (!w?.address) return null;
  return w;
}

export async function walletAddress(owner: string): Promise<string | null> {
  return (await getWallet(owner))?.address ?? null;
}

/** Register the public address of a wallet for this owner. */
export async function registerWallet(owner: string, address: string): Promise<StoredWallet> {
  if (!ADDRESS_RE.test(address.trim())) {
    throw new Error('That does not look like a Keeta address.');
  }
  const existing = await getWallet(owner);
  const wallet: StoredWallet = {
    address: address.trim(),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await dbWrite(KEY, wallet, owner);
  return wallet;
}

/** Forget the registered wallet (the device copy is unaffected). */
export async function forgetWallet(owner: string): Promise<void> {
  await dbWrite(KEY, null, owner);
}
