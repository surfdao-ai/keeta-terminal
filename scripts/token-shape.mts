/** What does a token account's ledger state actually contain?
 *  Run: npx tsx scripts/token-shape.mts  [tokenAddress]
 */
import * as KeetaNet from '@keetanetwork/keetanet-client';

const KUSD = 'keeta_aorhqgqpkr4it5fttli3hp2vmy5fxx32456nz3c7yuowommiibhj46zsdtdci';
const KTA = 'keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg';
const target = process.argv[2] ?? KUSD;

await using client = KeetaNet.Client.fromNetwork('main');
const info = (await client.getAccountInfo(target)) as unknown as Record<string, unknown>;

const shape = (o: unknown, depth = 0): string => {
  if (o === null || o === undefined) return String(o);
  if (typeof o === 'bigint') return o.toString();
  if (typeof o !== 'object') return String(o).slice(0, 60);
  if (depth > 2) return '{…}';
  const out: string[] = [];
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (v && typeof v === 'object') out.push(`${k}: ${shape(v, depth + 1)}`);
    else out.push(`${k}: ${String(v).slice(0, 50)}`);
  }
  return `{ ${out.join(', ')} }`;
};
console.log('=== getAccountInfo(' + target.slice(0, 20) + '…) ===');
console.log(shape(info));

try {
  const sup = await client.getTokenSupply(target);
  console.log('getTokenSupply:', sup.toString());
} catch (e) {
  console.log('getTokenSupply failed:', (e as Error).message?.slice(0, 100));
}
