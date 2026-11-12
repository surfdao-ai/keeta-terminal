/**
 * Wallet registry.
 *
 * The server stores the *public address only* — never the seed, never a
 * passphrase, never anything that could sign. The seed lives in the device
 * vault (see src/lib/vault.ts) and travels with the individual requests that
 * need a signature.
 *
 * The dedicated automation wallet is the one deliberate exception: it exists
 * so the unattended cron can sign on its own. Its seed is sealed with the
 * server-side AUTOMATION_KEY and its balance is the blast radius.
 */
import { dbRead, dbWrite } from '../db';
import * as KeetaNet from '@keetanetwork/keetanet-client';
import type { KeetaAccount } from './network';

export interface StoredWallet {
  address: string;
  createdAt: string;
  updatedAt: string;
}

const KEY = 'wallet';

/** Keeta addresses: 'keeta_' + base58. Be lenient about the alphabet. */
const ADDRESS_RE = /^keeta_[1-9A-HJ-NP-Za-km-z]{32,}$/;

export async function hasWallet(): Promise<boolean> {
  return Boolean(await getWallet());
}

export async function getWallet(): Promise<StoredWallet | null> {
  const w = await dbRead<StoredWallet>(KEY);
  if (!w?.address) return null;
  return w;
}

export async function walletAddress(): Promise<string | null> {
  return (await getWallet())?.address ?? null;
}

/** Register the public address of a wallet. Nothing secret is written. */
export async function registerWallet(address: string): Promise<StoredWallet> {
  if (!ADDRESS_RE.test(address.trim())) {
    throw new Error('That does not look like a Keeta address.');
  }
  const existing = await getWallet();
  const wallet: StoredWallet = {
    address: address.trim(),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await dbWrite(KEY, wallet);
  return wallet;
}

/** Forget the registered wallet (the seed is unaffected — it lives on device). */
export async function forgetWallet(): Promise<void> {
  await dbWrite(KEY, null);
}

/**
 * Build a signing account from a seed.
 *
 * The seed is used in memory only and is never written anywhere. The caller
 * receives the account for the lifetime of one request.
 */
export function accountFromSeed(seed: string): { account: KeetaAccount; address: string } {
  const trimmed = seed.trim();
  if (!trimmed) throw new Error('Missing wallet seed.');
  const account = KeetaNet.lib.Account.fromSeed(trimmed, 0);
  return { account, address: account.publicKeyString.get() };
}

/** Derive the public address of a seed without storing anything. */
export function addressFromSeed(seed: string): string {
  return accountFromSeed(seed).address;
}
