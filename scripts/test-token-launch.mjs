/**
 * Validates the token-launch flow against Keeta's TEST network.
 * Run: KEETA_NETWORK=test node scripts/test-token-launch.mjs
 */
import * as KeetaNet from '@keetanetwork/keetanet-client';

const network = 'test';
const acct = KeetaNet.lib.Account.fromSeed(
  KeetaNet.lib.Account.generateRandomSeed({ asString: true }),
  0,
);
const address = acct.publicKeyString.get();
console.log('account:', address);

// faucet 5 KTA
const params = new URLSearchParams();
params.append('address', address);
params.append('amount', '5');
const res = await fetch('https://faucet.test.keeta.com', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: params.toString(),
});
console.log('faucet:', res.status);

await using client = KeetaNet.UserClient.fromNetwork(network, acct);

// wait for balance
let balance = 0n;
for (let i = 0; i < 30; i++) {
  balance = await client.balance(client.baseToken);
  if (balance > 0n) break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('base token balance:', balance.toString());

const builder = client.initBuilder();
const token = builder.generateIdentifier(KeetaNet.lib.Account.AccountKeyAlgorithm.TOKEN);
await client.computeBuilderBlocks(builder);
const tokenAddress = token.account.publicKeyString.get();

const rawSupply = 1_000_000n * 10n ** 18n;
builder.modifyTokenSupply(rawSupply, { account: token.account });
builder.setInfo(
  {
    name: 'KTW',
    description: 'KTerminal test token',
    metadata: Buffer.from(JSON.stringify({ decimalPlaces: 18 })).toString('base64'),
    defaultPermission: new KeetaNet.lib.Permissions(['ACCESS'], []),
  },
  { account: token.account },
);

await client.publishBuilder(builder);
console.log('published');
console.log('token address:', tokenAddress);

await new Promise((r) => setTimeout(r, 4000));

const readClient = await KeetaNet.Client.fromNetwork(network);
const info = await readClient.getAccountInfo(tokenAddress);
console.log(
  'token info:',
  JSON.stringify(
    KeetaNet.lib.Utils.Helper.debugPrintableObject(info),
    (k, v) => (typeof v === 'bigint' ? v.toString() : v),
  ).slice(0, 500),
);

const balances = await client.allBalances();
console.log(
  'balances:',
  JSON.stringify(
    balances.map((b) => ({ token: b.token.publicKeyString.get().slice(0, 24), amount: b.balance.toString() })),
  ),
);
process.exit(0);
