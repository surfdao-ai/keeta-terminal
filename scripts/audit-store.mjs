/**
 * Inspect the store: what is in it, and does anything still hold a seed?
 *
 * Usage: node scripts/audit-store.mjs [--purge]
 */
const postgres = (await import('postgres')).default;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const purge = process.argv.includes('--purge');
const purgeAll = process.argv.includes('--purge-all');
const sql = postgres(url, { max: 1 });

/** Anything that looks like key material. */
const SEED_FIELDS = [
  'seed',
  'seedCiphertext',
  'ciphertext',
  'seedIv',
  'seedTag',
  'automationSeed',
  'privateKey',
  'mnemonic',
];
const SEED_PATTERNS = [
  /"seed"\s*:/i,
  /"seedCiphertext"\s*:/i,
  /"seedIv"\s*:/i,
  /"seedTag"\s*:/i,
  /"automationSeed"\s*:/i,
  /"privateKey"\s*:/i,
  /"mnemonic"\s*:/i,
  /"ciphertext"\s*:/i,
];

try {
  const rows = await sql`SELECT key, value FROM kt_store ORDER BY key`;
  console.log(`total keys: ${rows.length}\n`);

  const legacy = [];
  const scoped = [];
  const global = [];
  const seeded = [];

  for (const row of rows) {
    const key = row.key;
    const blob = JSON.stringify(row.value ?? null);

    const hasSeed = SEED_FIELDS.some((f) => {
      const v = row.value;
      return v && typeof v === 'object' && f in v;
    }) || SEED_PATTERNS.some((re) => re.test(blob));

    if (hasSeed) seeded.push({ key, blob });

    if (key.startsWith('u:')) scoped.push(key);
    else if (key.startsWith('authnonce:') || key.startsWith('ratelimit:')) global.push(key);
    else legacy.push({ key, blob });
  }

  console.log(`scoped keys (u:<address>:…):   ${scoped.length}`);
  console.log(`ephemeral keys (nonce/limits):  ${global.length}`);
  console.log(`legacy global keys:             ${legacy.length}`);
  console.log(`keys holding seed material:      ${seeded.length}\n`);

  if (legacy.length) {
    console.log('legacy global keys:');
    for (const { key, blob } of legacy) {
      console.log(`  ${key}  ${blob.slice(0, 160)}`);
    }
    console.log('');
  }

  if (seeded.length) {
    console.log('keys holding seed material:');
    for (const { key, blob } of seeded) {
      console.log(`  ${key}  ${blob.slice(0, 200)}`);
    }
    console.log('');
  }

  if (purgeAll) {
    // Empty the store: every scoped record, every nonce, every rate-limit
    // counter and the owners index. Only for a store with no real visitors.
    const res = await sql`DELETE FROM kt_store`;
    console.log(`\nemptied the store (${res.count} key(s) removed)`);
  } else if (purge) {
    const toDelete = [...legacy.map((l) => l.key), ...seeded.map((s) => s.key)];
    const unique = [...new Set(toDelete)];
    if (!unique.length) {
      console.log('nothing to purge');
    } else {
      for (const key of unique) {
        await sql`DELETE FROM kt_store WHERE key = ${key}`;
        console.log(`purged ${key}`);
      }
      console.log(`\npurged ${unique.length} key(s)`);
    }
  }
} finally {
  await sql.end();
}
