/**
 * Offline-ish unit check for the live-rails module against the live anchor
 * (the anchor is the source of truth, so this needs network): the advertised
 * pair list must be the base anchor's clean $K/$KB pegs — no KTA, no bare
 * fiat, and the live/quiet split must be sane.
 *
 *   npx tsx scripts/rails-check.mts
 */
import { getLiveRails, livePegLine, cachedLiveRails } from '../src/lib/keeta/live-rails';

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.error(`FAIL  ${name} ${extra}`);
  }
}

const rails = await getLiveRails();
check('18 advertised directions (9 pegs x2)', rails.directions.length === 18, `got ${rails.directions.length}`);
check('metadata read, not fallback', rails.fromFallback === false);

const ok = (x: string) => /^(K|KB)(USD|EUR|JPY|MXN|CAD|AED|GBP|HKD|CNY)$/.test(x);
const bad = rails.directions.filter((d) => !ok(d.from) || !ok(d.to));
check('no KTA / bare-fiat leakage', bad.length === 0, JSON.stringify(bad.slice(0, 3)));

// Every advertised pair has an address that starts with keeta_
check('all pairs carry keeta_ addresses', rails.directions.every((d) => d.fromAddress.startsWith('keeta_') && d.toAddress.startsWith('keeta_')));

// A live direction always carries a rate
const live = rails.directions.filter((d) => d.live);
check('at least one live direction', live.length > 0);
check('live directions carry a rate', live.every((d) => d.rate !== null));

// The pegs are same-currency: KBUSD->KUSD, KUSD->KBUSD, ...
const pairs = new Set(rails.directions.map((d) => d.from.replace(/^KB?/, '') + d.to.replace(/^KB?/, '')));
check('every pair is same-currency', [...pairs].every((c) => c.length === 6 && c[0] === c[3]), JSON.stringify(pairs));

// cachedLiveRails returns the warm cache
check('cached rails warm after build', cachedLiveRails() !== null);

console.log(`\npeg line: ${livePegLine(rails)}`);
console.log(live.length === 0 ? '0 passed, 1 failed' : `checked, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
