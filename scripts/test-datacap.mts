/**
 * Unit tests for the daily data-read cap (reserve/refund/CAS semantics).
 *
 * Uses the file KV backend against a throwaway cwd, so it never touches the
 * real .data store. Run: npx tsx scripts/test-datacap.mts
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-datacap-'));
process.chdir(tmp);

// Import after chdir so the file backend points at the temp store.
const {
  reserveDataCap,
  dataCapSpent,
  dataCapUsd,
  setDataCap,
  getSettings,
  DEFAULT_DATA_CAP_USD,
} = await import('../src/lib/agent/safety');

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

const owner = 'keeta_ownerfortest';

// Default cap is the low one, not the trade default.
check('default data cap is $1', (await dataCapUsd(owner)) === DEFAULT_DATA_CAP_USD);
check('fresh owner has $0 spent', (await dataCapSpent(owner)) === 0);

// A 0.01 read fits.
let r = await reserveDataCap(owner, 0.01);
check('first 0.01 fits', r.ok === true && Math.abs(r.spentUsd - 0.01) < 1e-9);

// Many reads accumulate; the boundary is enforced.
r = await reserveDataCap(owner, 0.99);
check('0.01 + 0.99 = cap exactly still fits', r.ok === true && Math.abs(r.spentUsd - 1.0) < 1e-9);

r = await reserveDataCap(owner, 0.01);
check('one more 0.01 is refused at the cap', r.ok === false);
check('refusal reports spent = cap', Math.abs(r.spentUsd - 1.0) < 1e-9);

// Float drift must not eat the budget: under a $1 cap, a run of 0.01 reads
// should admit 99-100 of them (one read of slack for float error, never more).
await fs.rmSync(path.join(tmp, '.data'), { recursive: true, force: true });
let fits = 0;
while ((await reserveDataCap(owner, 0.01)).ok) {
  fits++;
  if (fits > 200) break;
}
check(
  `float-safe boundary: ${fits} reads of 0.01 admitted under a $1 cap (expect 99-100)`,
  fits >= 99 && fits <= 100,
);

// Refund frees the budget again (the submit route mirrors this on failure).
const day = new Date().toISOString().slice(0, 10);
const key = `u:${owner.toLowerCase()}:datacap:${day}`;
const raw = await fs.promises.readFile(path.join(tmp, '.data', 'terminal.json'), 'utf8');
const store = JSON.parse(raw) as Record<string, unknown>;
const before = (store[key] as { spentUsd: number }).spentUsd;
// Simulate the refund: CAS subtract floored at 0.
store[key] = { spentUsd: Math.max(0, before - 0.01) };
await fs.promises.writeFile(path.join(tmp, '.data', 'terminal.json'), JSON.stringify(store, null, 2));
r = await reserveDataCap(owner, 0.01);
check('after a refund the next 0.01 fits again', r.ok === true);

// Raising the cap admits more.
const s = await setDataCap(owner, 5);
check('setDataCap stores 5', s.dataCapUsd === 5);
check('dataCapUsd follows the setting', (await dataCapUsd(owner)) === 5);
check('trade cap untouched by setDataCap', (await getSettings(owner)).dailyCapUsd > 0);

// And the setting round-trips without clobbering the trade cap.
const before2 = (await getSettings(owner)).dailyCapUsd;
await setDataCap(owner, 2);
check('trade cap survives a data-cap change', (await getSettings(owner)).dailyCapUsd === before2);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
