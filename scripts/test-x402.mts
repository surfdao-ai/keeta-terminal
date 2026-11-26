/**
 * Unit tests for the x402 paid-reads validation layer.
 *
 * Run: npx tsx scripts/test-x402.mts
 */
import {
  parsePaymentRequirement,
  validateRequirement,
  validatePayUrl,
  priceUsdOf,
  USDC_MAINNET,
} from '../src/lib/x402/paid-reads';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}`);
  }
}

const PAYTO = 'keeta_aabz6zxbs2n4r7iiobclndobrnowxdf4pjrb5lwe6bvpeo564bot6krjbrsbbvy';

// --- parsePaymentRequirement -------------------------------------------------

const goodChallenge = {
  x402Version: 2,
  error: 'Payment required',
  accepts: [
    {
      scheme: 'exact',
      network: 'keeta:21378',
      amount: '10000',
      asset: USDC_MAINNET,
      payTo: PAYTO,
      maxTimeoutSeconds: 300,
      extra: {},
    },
  ],
};

const parsed = parsePaymentRequirement({ body: goodChallenge });
check('parses a live-shaped 402 body', parsed !== null && parsed.payTo === PAYTO && parsed.amount === '10000');
check(
  'parses the PAYMENT-REQUIRED base64 header form',
  parsePaymentRequirement({ headerB64: Buffer.from(JSON.stringify(goodChallenge)).toString('base64') }) !== null,
);
check(
  'rejects a non-b64 header',
  parsePaymentRequirement({ headerB64: 'not-base64-json' }) === null,
);
check(
  'rejects missing accepts',
  parsePaymentRequirement({ body: { accepts: [] } }) === null,
);
check(
  'rejects wrong scheme',
  validateRequirement({ scheme: 'exact2', network: 'keeta:21378', amount: '10000', asset: USDC_MAINNET, payTo: PAYTO }) !== null,
);

// --- validateRequirement -----------------------------------------------------

check(
  'accepts the exact live requirement',
  validateRequirement(parsed!) === null,
);
check(
  'rejects testnet network',
  validateRequirement({ ...parsed!, network: 'keeta:1413829460' })?.includes('network') ?? false,
);
check(
  'rejects a non-USDC asset',
  validateRequirement({ ...parsed!, asset: 'keeta_abc' })?.includes('USDC') ?? false,
);
check(
  'rejects an unknown payee',
  validateRequirement({ ...parsed!, payTo: 'keeta_attackeraddress' })?.includes('known') ?? false,
);
check(
  'rejects an over-limit price (0.06 > 0.05)',
  validateRequirement({ ...parsed!, amount: String(60000) }) !== null,
);
check(
  'accepts the max price (0.05)',
  validateRequirement({ ...parsed!, amount: String(50000) }) === null,
);
check(
  'rejects a zero amount',
  validateRequirement({ ...parsed!, amount: '0' }) !== null,
);
check(
  'rejects a negative amount',
  validateRequirement({ ...parsed!, amount: '-1' }) !== null,
);
check(
  'rejects a malformed amount',
  validateRequirement({ ...parsed!, amount: 'NaN' }) !== null,
);

// --- priceUsdOf --------------------------------------------------------------

check('price 10000 base = 0.01 USDC', priceUsdOf(parsed!) === 0.01);
check('price 20000 base = 0.02 USDC', priceUsdOf({ ...parsed!, amount: '20000' }) === 0.02);

// --- validatePayUrl ----------------------------------------------------------

check('accepts keespecs.xyz /api/ read', validatePayUrl('https://keespecs.xyz/api/status') === null);
check('accepts www subdomain', validatePayUrl('https://www.keespecs.xyz/api/prices') === null);
check('accepts query string', validatePayUrl('https://keespecs.xyz/api/payment-check?hash=ab') === null);
check('rejects a foreign host', validatePayUrl('https://evil.example.com/api/status') !== null);
check('rejects a non-API path', validatePayUrl('https://keespecs.xyz/admin/drain') !== null);
check('rejects http', validatePayUrl('http://keespecs.xyz/api/status') !== null);
check('rejects a subdomain of a trusted host', validatePayUrl('https://evil.keespecs.xyz.attacker.com/api/x') !== null);
check('rejects garbage', validatePayUrl('not a url') !== null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
