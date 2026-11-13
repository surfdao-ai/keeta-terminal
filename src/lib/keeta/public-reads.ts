/**
 * Public, unsigned reads.
 *
 * Everything here works without a key: the Keeta node serves balances and
 * account data for a public address. That is what lets the server answer
 * "what do I hold?" while holding no key material at all.
 */
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { getTokenInfo, networkAlias, toDisplay } from './network';
import type { BalanceRow } from './network';

/** All token balances of a public address. No signer, no key. */
export async function readPublicBalances(address: string): Promise<BalanceRow[] | null> {
  if (!address?.startsWith('keeta_')) return null;

  await using client = KeetaNet.Client.fromNetwork(networkAlias());
  const all = (await client.getAllBalances(address)) as {
    balance?: bigint;
    token?: { publicKeyString: { get(): string } };
  }[];

  const rows = await Promise.all(
    all.map(async (b) => {
      const token = b.token?.publicKeyString?.get() ?? '';
      let decimals: number | null = null;
      try {
        const info = await getTokenInfo(token);
        decimals = info.decimals;
      } catch {
        decimals = null;
      }
      return {
        token,
        raw: (b.balance ?? 0n).toString(),
        display: toDisplay(b.balance ?? 0n, decimals),
        decimals,
      };
    }),
  );

  return rows;
}
