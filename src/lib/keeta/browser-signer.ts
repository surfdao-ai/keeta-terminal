'use client';

/**
 * Browser-side signing.
 *
 * The seed lives here and only here: the vault holds it encrypted, this
 * module turns it into signatures, and the signatures (never the seed) are
 * what leaves the browser.
 */
import * as KeetaNet from '@keetanetwork/keetanet-client';
import type { TradeIntent } from './trade-types';

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** A public-key-only account — no private key, just the address. */
function publicAccount(publicKeyString: string) {
  return KeetaNet.lib.Account.fromPublicKeyString(publicKeyString);
}

export function accountFromSeed(seed: string) {
  return KeetaNet.lib.Account.fromSeed(seed.trim(), 0);
}

/** Sign a login nonce with the wallet key. */
export async function signNonce(seed: string, nonce: string): Promise<string> {
  const account = accountFromSeed(seed);
  const signature = await account.sign(new TextEncoder().encode(nonce).buffer as ArrayBuffer);
  return toBase64(new Uint8Array(signature.getBuffer()));
}

/**
 * Build the swap block for an intent and sign it locally.
 *
 * This mirrors what the FX anchor does internally: a receive for the
 * liquidity provider, a tagged send of the source amount, and the provider's
 * external on the send so the provider can match it to the quote. The result
 * is a signed block — the server only forwards it to the provider.
 */
export async function signSwapBlock(intent: TradeIntent, seed: string): Promise<string> {
  const account = accountFromSeed(seed);
  await using client = KeetaNet.UserClient.fromNetwork('main', account);

  const anchor = await import('@keetanetwork/anchor');
  const ExternalBuilder = anchor.lib.AnchorExternal.Builder;

  // The SDK types these as token-key accounts; a public-key account is enough.
  const provider = publicAccount(intent.providerAccount);
  const costToken = intent.costToken ? publicAccount(intent.costToken) : null;
  const requestAmount = BigInt(intent.rawAmount);
  const sendAmount = intent.affinity === 'to' ? BigInt(intent.convertedAmount) : requestAmount;
  const receiveAmount = intent.affinity === 'to' ? requestAmount : BigInt(intent.convertedAmount);
  const costAmount = BigInt(intent.costAmount);

  const builder = client.initBuilder();
  const costUsesSendToken = costAmount > 0n && costToken !== null && costToken.publicKeyString.get() === intent.from;
  if (costAmount > 0n && !costUsesSendToken && costToken) {
    builder.send(provider as never, costAmount, costToken as never);
  }
  builder.receive(provider as never, receiveAmount, publicAccount(intent.to) as never, intent.affinity === 'to');

  const externalBuilder = new ExternalBuilder().setAnchor(provider, {
    transactionId: crypto.randomUUID(),
  });
  const external = await externalBuilder.build();
  const taggedSendAmount = costUsesSendToken ? sendAmount + costAmount : sendAmount;
  builder.send(provider as never, taggedSendAmount, publicAccount(intent.from) as never, external);

  const blocks = await builder.computeBlocks();
  if (blocks.blocks.length !== 1) {
    throw new Error('Building the swap produced more than one block.');
  }
  return toBase64(new Uint8Array(blocks.blocks[0].toBytes()));
}

export interface LaunchSpec {
  name: string;
  symbol: string;
  description: string;
  supply: string;
  decimals: number;
}

/**
 * Build and sign a native token launch (CREATE_IDENTIFIER + supply + info).
 *
 * The blocks are published from the browser too — the Keeta node allows
 * cross-origin writes, so no key has to travel.
 */
export async function signAndPublishTokenLaunch(
  spec: LaunchSpec,
  seed: string,
): Promise<{ address: string; block: string }> {
  const account = accountFromSeed(seed);
  await using client = KeetaNet.UserClient.fromNetwork('main', account);

  const builder = client.initBuilder();

  // 1. create the token identifier natively (no contract)
  const token = builder.generateIdentifier(KeetaNet.lib.Account.AccountKeyAlgorithm.TOKEN);

  // 2. computing resolves the pending identifier into a real token account
  await client.computeBuilderBlocks(builder);

  // 3. mint the initial supply to the creator
  const rawSupply = BigInt(Math.floor(Number(spec.supply) * 10 ** spec.decimals));
  builder.modifyTokenSupply(rawSupply, { account: token.account });

  // 4. attributes + metadata (decimalPlaces drives display math)
  builder.setInfo({
    name: spec.name,
    description: spec.description,
    metadata: Buffer.from(
      JSON.stringify({ decimalPlaces: spec.decimals }),
      'utf8',
    ).toString('base64'),
  } as never);

  const blocks = await builder.computeBlocks();
  const signed = blocks.blocks[blocks.blocks.length - 1];
  await client.transmit(blocks.blocks);

  return {
    address: token.account.publicKeyString.get(),
    block: toBase64(new Uint8Array(signed.toBytes())),
  };
}
