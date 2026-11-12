'use client';

/**
 * Device-side wallet helpers.
 *
 * The Keeta client ships a browser build, so a seed can be generated and an
 * address derived *in the browser* — the server never sees a new seed at all.
 * The bundle is large, so it is only pulled in when the user actually creates
 * or imports a wallet.
 */

export async function generateSeedOnDevice(): Promise<string> {
  const KeetaNet = await import('@keetanetwork/keetanet-client');
  return KeetaNet.lib.Account.generateRandomSeed({ asString: true });
}

export async function addressFromSeedOnDevice(seed: string): Promise<string> {
  const KeetaNet = await import('@keetanetwork/keetanet-client');
  return KeetaNet.lib.Account.fromSeed(seed.trim(), 0).publicKeyString.get();
}
