/**
 * Dedicated automation wallet.
 *
 * Unattended automations need a key that can sign without a human present.
 * We never reuse the user's main wallet for that: the automation wallet is a
 * separate account whose seed is encrypted with a server-side key
 * (AUTOMATION_KEY env var). The user funds it explicitly, so an automation can
 * only ever move funds that were deliberately left there.
 */
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import * as KeetaNet from '@keetanetwork/keetanet-client';
import type { KeetaAccount } from '../keeta/network';
import { dbRead, dbWrite } from '../db';

export interface StoredAutomationWallet {
  ciphertext: string;
  iv: string;
  tag: string;
  salt: string;
  address: string;
  createdAt: string;
}

function serverKey(): Buffer | null {
  const raw = process.env.AUTOMATION_KEY;
  if (!raw || raw.length < 16) return null;
  return scryptSync(raw, 'kterminal-automation-wallet', 32);
}

export function automationEnabled(): boolean {
  return serverKey() !== null;
}

export async function getAutomationWallet(): Promise<StoredAutomationWallet | null> {
  return dbRead<StoredAutomationWallet>('automationWallet');
}

export async function createAutomationWallet(): Promise<StoredAutomationWallet> {
  const key = serverKey();
  if (!key) throw new Error('AUTOMATION_KEY is not configured on the server.');
  const existing = await getAutomationWallet();
  if (existing) return existing;

  const seed = KeetaNet.lib.Account.generateRandomSeed({ asString: true });
  const account = KeetaNet.lib.Account.fromSeed(seed, 0);
  const address = account.publicKeyString.get();

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', scryptSync(key, salt, 32), iv);
  const ct = Buffer.concat([cipher.update(seed, 'utf8'), cipher.final()]);

  const wallet: StoredAutomationWallet = {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    salt: salt.toString('base64'),
    address,
    createdAt: new Date().toISOString(),
  };
  await dbWrite('automationWallet', wallet);
  return wallet;
}

export async function unlockAutomationWallet(): Promise<{ account: KeetaAccount; address: string } | null> {
  const key = serverKey();
  if (!key) return null;
  const w = await getAutomationWallet();
  if (!w) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', scryptSync(key, Buffer.from(w.salt, 'base64'), 32), Buffer.from(w.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(w.tag, 'base64'));
    const seed = Buffer.concat([
      decipher.update(Buffer.from(w.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const account = KeetaNet.lib.Account.fromSeed(seed, 0);
    return { account, address: account.publicKeyString.get() };
  } catch {
    return null;
  }
}
