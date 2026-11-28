/**
 * Full read-only detail for a token, straight from the ledger (no key needed).
 *
 * This is the data behind the "your tokens" detail view: identity, metadata
 * (decimals, logo), supply, the treasury balance, the current holder's balance,
 * and the ACL — the table of who actually controls the token (owner, who can
 * mint/burn, modify balances, change info or permissions).
 *
 * Everything here is a plain read against a public token address, so an
 * unsigned `Client` is enough. Results are cached briefly: the ACL and supply
 * move slowly and the detail view polls on open.
 */
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { networkAlias, toDisplay, decimalsFromMetadata } from './network';

export interface AclRow {
  /** The controlling account (a keeta_ address). */
  principal: string;
  /** Human-readable base flags, e.g. ['OWNER'] or ['ACCESS','ADMIN']. */
  flags: string[];
  /** Raw [base, external] as the ledger reports them. */
  raw: [string, string];
}

export interface TokenDetail {
  address: string;
  /** The on-chain `name` — for a token this is the ticker every client shows. */
  symbol: string;
  description: string;
  decimals: number | null;
  /** Decoded metadata (logoURI, decimalPlaces, anything else written). */
  metadata: Record<string, unknown> | null;
  /** Total supply, raw integer string. */
  supplyRaw: string | null;
  /** Total supply in display units. */
  supply: string | null;
  /** The token account's own balance of itself (its treasury). */
  treasuryRaw: string | null;
  treasury: string | null;
  /** The requesting wallet's balance of this token, in display units. */
  holderBalance: string | null;
  holder: string | null;
  /** Who controls the token. */
  acl: AclRow[];
  /** The default permission granted to anyone (e.g. ACCESS). */
  defaultPermission: string[];
  /** The token's current head block height, for "last changed" framing. */
  headHeight: string | null;
  headBlock: string | null;
  asOf: string;
}

/** The BaseFlag → name map, straight from the SDK's enum. */
const FLAG_NAMES: Record<number, string> = {
  0: 'ACCESS',
  1: 'OWNER',
  2: 'ADMIN',
  3: 'UPDATE_INFO',
  4: 'SEND_ON_BEHALF',
  5: 'TOKEN_ADMIN_CREATE',
  6: 'TOKEN_ADMIN_SUPPLY',
  7: 'TOKEN_ADMIN_MODIFY_BALANCE',
  8: 'STORAGE_CREATE',
  9: 'STORAGE_CAN_HOLD',
  10: 'STORAGE_DEPOSIT',
  11: 'PERMISSION_DELEGATE_ADD',
  12: 'PERMISSION_DELEGATE_REMOVE',
  13: 'MANAGE_CERTIFICATE',
  14: 'MULTISIG_SIGNER',
};

/** Decode a base-flag bitmask (as a bigint) into its flag names. */
function flagsFromBigInt(value: bigint): string[] {
  const out: string[] = [];
  for (const [bit, name] of Object.entries(FLAG_NAMES)) {
    if (value & (1n << BigInt(bit))) out.push(name);
  }
  return out;
}

/** The ACL rows for a token, decoded to flag names. Empty on any read error. */
async function readAcl(client: KeetaNet.Client, token: string): Promise<AclRow[]> {
  const rows = (await (
    client as unknown as { listACLsByEntity: (t: string) => Promise<unknown[]> }
  ).listACLsByEntity(token)) as {
    principal?: string;
    permissions?: { base?: { bigint?: bigint }; external?: { bigint?: bigint } };
  }[];
  const out: AclRow[] = [];
  for (const r of rows ?? []) {
    if (!r.principal) continue;
    const base = BigInt(r.permissions?.base?.bigint ?? 0);
    const external = BigInt(r.permissions?.external?.bigint ?? 0);
    out.push({
      principal: r.principal,
      flags: [...flagsFromBigInt(base), ...flagsFromBigInt(external)],
      raw: [String(base), String(external)],
    });
  }
  return out;
}

/**
 * Full read-only detail for a token. `holder` (the requesting wallet, when
 * known) adds that wallet's balance of the token. Never throws: a missing or
 * unreadable token returns a minimal row rather than failing the view.
 */
export async function getTokenDetail(
  address: string,
  holder?: string | null,
): Promise<TokenDetail | null> {
  if (!address?.startsWith('keeta_')) return null;

  await using client = KeetaNet.Client.fromNetwork(networkAlias());

  let info: {
    info?: { name?: string; description?: string; metadata?: string; defaultPermission?: (string | number)[] };
    supply?: bigint;
    currentHeadBlock?: string;
    currentHeadBlockHeight?: string | number;
  };
  try {
    info = (await client.getAccountInfo(address)) as never;
  } catch {
    return null;
  }

  const decimals = decimalsFromMetadata(info.info?.metadata);
  let metadata: Record<string, unknown> | null = null;
  if (info.info?.metadata) {
    try {
      metadata = JSON.parse(Buffer.from(info.info.metadata, 'base64').toString('utf8'));
    } catch {
      metadata = null;
    }
  }

  // supply (total)
  let supplyRaw: string | null = null;
  try {
    supplyRaw = (await client.getTokenSupply(address)).toString();
  } catch {
    supplyRaw = null;
  }

  // treasury = the token account's own balance of itself
  let treasuryRaw: string | null = null;
  try {
    treasuryRaw = (await client.getBalance(address, address)).toString();
  } catch {
    treasuryRaw = null;
  }

  // the requesting wallet's balance of the token
  let holderBalance: string | null = null;
  if (holder) {
    try {
      holderBalance = (await client.getBalance(holder, address)).toString();
    } catch {
      holderBalance = null;
    }
  }

  const acl = await readAcl(client, address).catch(() => [] as AclRow[]);
  const dp = info.info?.defaultPermission;
  const defaultPermission =
    dp && dp.length ? flagsFromBigInt(BigInt(dp[0] ?? 0)) : ['ACCESS'];

  return {
    address,
    symbol: info.info?.name || '?',
    description: info.info?.description || '',
    decimals,
    metadata,
    supplyRaw,
    supply: supplyRaw !== null ? toDisplay(BigInt(supplyRaw), decimals) : null,
    treasuryRaw,
    treasury: treasuryRaw !== null ? toDisplay(BigInt(treasuryRaw), decimals) : null,
    holderBalance: holderBalance !== null ? toDisplay(BigInt(holderBalance), decimals) : null,
    holder: holder ?? null,
    acl,
    defaultPermission,
    headHeight: info.currentHeadBlockHeight != null ? String(info.currentHeadBlockHeight) : null,
    headBlock: info.currentHeadBlock ?? null,
    asOf: new Date().toISOString(),
  };
}
