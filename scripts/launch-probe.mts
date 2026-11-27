/**
 * Reproduce the token-launch SET_INFO validation both ways (no network writes —
 * an unfunded throwaway wallet, and validation happens at computeBlocks):
 *   - without { account: token.account }  -> expect "Non-Identifier accounts
 *     cannot have default permissions" (the browser bug)
 *   - with { account: token.account }     -> expect a clean block set (the fix)
 *
 *   npx tsx scripts/launch-probe.mts
 */
import * as KeetaNet from '@keetanetwork/keetanet-client';

function freshBuilder(client: ReturnType<typeof KeetaNet.UserClient.fromNetwork>) {
  const builder = client.initBuilder();
  const token = builder.generateIdentifier(KeetaNet.lib.Account.AccountKeyAlgorithm.TOKEN);
  return { builder, token };
}

const spec = { symbol: 'PROBE', name: 'Probe', description: 'probe', supply: '1000', decimals: 6 };
const rawSupply = BigInt(Math.floor(Number(spec.supply) * 10 ** spec.decimals));

// --- 1. the OLD (buggy) sequence: setInfo without an account target ---
{
  const account = KeetaNet.lib.Account.fromSeed(KeetaNet.lib.Account.generateRandomSeed({ asString: true }), 0);
  const client = KeetaNet.UserClient.fromNetwork('main', account);
  try {
    const { builder, token } = freshBuilder(client);
    await client.computeBuilderBlocks(builder); // resolves the pending identifier
    builder.modifyTokenSupply(rawSupply, { account: token.account });
    builder.setInfo({
      name: spec.symbol,
      description: spec.description,
      metadata: Buffer.from(JSON.stringify({ decimalPlaces: spec.decimals })).toString('base64'),
      defaultPermission: new KeetaNet.lib.Permissions(['ACCESS'], []),
    } as never);
    try {
      await builder.computeBlocks();
      console.log('OLD sequence: UNEXPECTEDLY PASSED (bug not reproduced)');
      process.exit(1);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (/Non-Identifier accounts cannot have default permissions/.test(msg)) {
        console.log('OLD sequence: reproduced the browser error  ->', msg.slice(0, 80));
      } else {
        console.log('OLD sequence: failed for a different reason ->', msg.slice(0, 120));
        process.exit(1);
      }
    }
  } finally {
    await client.destroy().catch(() => undefined);
  }
}

// --- 2. the NEW (fixed) sequence: setInfo targeting the token account ---
{
  const account = KeetaNet.lib.Account.fromSeed(KeetaNet.lib.Account.generateRandomSeed({ asString: true }), 0);
  const client = KeetaNet.UserClient.fromNetwork('main', account);
  try {
    const { builder, token } = freshBuilder(client);
    await client.computeBuilderBlocks(builder); // resolves the pending identifier
    builder.modifyTokenSupply(rawSupply, { account: token.account });
    builder.setInfo(
      {
        name: spec.symbol,
        description: spec.description,
        metadata: Buffer.from(JSON.stringify({ decimalPlaces: spec.decimals })).toString('base64'),
        defaultPermission: new KeetaNet.lib.Permissions(['ACCESS'], []),
      } as never,
      { account: token.account },
    );
    const { blocks } = await builder.computeBlocks();
    // A SET_INFO op is the one that carries a defaultPermission.
    const infoBlocks = blocks.filter((b) =>
      b.operations.some((o) => (o as { defaultPermission?: unknown }).defaultPermission !== undefined),
    );
    console.log(`NEW sequence: ${blocks.length} blocks computed, ${infoBlocks.length} carries SET_INFO`);
    if (blocks.length < 2 || infoBlocks.length !== 1) {
      console.log('NEW sequence: shape unexpected');
      process.exit(1);
    }
    // the SET_INFO block must belong to the token account, not the creator
    const ok = infoBlocks[0].account.comparePublicKey(token.account);
    console.log('SET_INFO block targets the token account:', ok);
    if (!ok) process.exit(1);
  } finally {
    await client.destroy().catch(() => undefined);
  }
}
console.log('LAUNCH PROBE OK');
