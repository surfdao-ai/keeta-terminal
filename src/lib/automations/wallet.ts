/**
 * The automation wallet — a separate, low-balance account the user created in
 * their browser for unattended automations.
 *
 * The server stores its public address only. The key that signs for it lives
 * in the browser vault, so the server can never move those funds on its own.
 * An automation therefore *proposes* an action; the browser signs it.
 */
import { dbRead, dbWrite } from '../db';

export interface StoredAutomationWallet {
  address: string;
  createdAt: string;
}

const KEY = 'automationWallet';

const ADDRESS_RE = /^keeta_[A-Za-z0-9]{32,}$/;

export async function getAutomationWallet(owner: string): Promise<StoredAutomationWallet | null> {
  const w = await dbRead<StoredAutomationWallet>(KEY, owner);
  return w?.address ? w : null;
}

/**
 * Register an automation wallet the browser created.
 * The seed never reaches this function.
 */
export async function registerAutomationWallet(
  owner: string,
  address: string,
): Promise<StoredAutomationWallet> {
  if (!ADDRESS_RE.test(address.trim())) {
    throw new Error('That does not look like a Keeta address.');
  }
  const existing = await getAutomationWallet(owner);
  const wallet: StoredAutomationWallet = {
    address: address.trim(),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await dbWrite(KEY, wallet, owner);
  return wallet;
}

export async function forgetAutomationWallet(owner: string): Promise<void> {
  await dbWrite(KEY, null, owner);
}
