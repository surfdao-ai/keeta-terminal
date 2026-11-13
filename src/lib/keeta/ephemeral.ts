/**
 * A throwaway account for read-only market queries.
 *
 * The Keeta FX client insists on a signing account even though the quote
 * requests it sends are unsigned. This account exists only to satisfy that
 * constructor: it holds a random key that is never sent anywhere, never
 * stored, and is unrelated to any user wallet. It cannot sign anything on a
 * user's behalf — the user wallet's key never exists outside their browser.
 */
import * as KeetaNet from '@keetanetwork/keetanet-client';
import type { KeetaAccount } from './network';

let cached: KeetaAccount | null = null;

export function ephemeralAccount(): KeetaAccount {
  if (!cached) {
    const material = KeetaNet.lib.Account.generateRandomSeed({ asString: true });
    cached = KeetaNet.lib.Account.fromSeed(material, 0);
  }
  return cached;
}
