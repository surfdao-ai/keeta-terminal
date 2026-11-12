/**
 * Native token launch on Keeta.
 *
 * Keeta has no smart contracts — tokens are created natively on the ledger
 * (CREATE_IDENTIFIER) with attributes and rules. This issues a new token,
 * mints the initial supply to the creator, and writes the metadata
 * (decimalPlaces) used by every client for display math.
 */
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { userClient, type KeetaAccount } from './network';

export interface TokenLaunchSpec {
  name: string;
  symbol: string;
  description: string;
  supply: string; // display units
  decimals: number;
}

export interface TokenLaunchResult {
  address: string;
  supply: string;
  decimals: number;
  name: string;
  symbol: string;
}

export function validateTokenSpec(spec: TokenLaunchSpec): string | null {
  if (!spec.symbol || !/^[A-Za-z0-9]{1,12}$/.test(spec.symbol)) {
    return 'symbol must be 1-12 alphanumeric characters';
  }
  if (!spec.name || spec.name.length > 64) return 'name must be 1-64 characters';
  if (!Number.isInteger(spec.decimals) || spec.decimals < 0 || spec.decimals > 18) {
    return 'decimals must be an integer between 0 and 18';
  }
  const supply = Number(spec.supply);
  if (!Number.isFinite(supply) || supply <= 0) return 'supply must be a positive number';
  return null;
}

export async function launchToken(
  account: KeetaAccount,
  spec: TokenLaunchSpec,
): Promise<TokenLaunchResult> {
  const invalid = validateTokenSpec(spec);
  if (invalid) throw new Error(invalid);

  await using client = userClient(account);

  // fees are paid in the base token — bail out early if the wallet is dry
  const feeBalance = await client.balance(client.baseToken).catch(() => 0n);
  if (feeBalance <= 0n) {
    throw new Error('Wallet holds no KTA — cannot pay network fees. Fund the wallet first.');
  }

  const builder = client.initBuilder();

  // 1. create the token identifier natively (no contract)
  const token = builder.generateIdentifier(KeetaNet.lib.Account.AccountKeyAlgorithm.TOKEN);

  // 2. computing the blocks resolves the pending identifier into a real token
  //    account (and seals the creation block)
  await client.computeBuilderBlocks(builder);

  // 3. mint the initial supply to the creator
  const rawSupply = BigInt(Math.floor(Number(spec.supply) * 10 ** spec.decimals));
  builder.modifyTokenSupply(rawSupply, { account: token.account });

  // 4. write attributes + metadata (decimalPlaces drives display math)
  builder.setInfo(
    {
      name: spec.symbol,
      description: spec.description || spec.name,
      metadata: Buffer.from(JSON.stringify({ decimalPlaces: spec.decimals })).toString('base64'),
      defaultPermission: new KeetaNet.lib.Permissions(['ACCESS'], []),
    },
    { account: token.account },
  );

  await client.publishBuilder(builder);

  return {
    address: token.account.publicKeyString.get(),
    supply: spec.supply,
    decimals: spec.decimals,
    name: spec.name,
    symbol: spec.symbol,
  };
}
