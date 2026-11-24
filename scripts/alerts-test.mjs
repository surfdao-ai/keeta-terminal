/**
 * The alert-surfacing helper, unit-tested.
 *
 * It decides which fired alert (if any) is "new" relative to a watermark, so
 * the app chimes exactly once per alert — not on every poll, and not for
 * alerts that fired before the app opened.
 *
 * Usage: node --experimental-strip-types --import ./scripts/alias-register.mjs scripts/alerts-test.mjs
 */
import { latestNewAlert } from '../src/lib/agent/alerts.ts';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

const a = (id, at, kind = 'alert', status = 'triggered', message = id) => ({
  id,
  at,
  kind,
  status,
  message,
});

console.log('== latestNewAlert ==');

// No log, no watermark.
check('empty log -> nothing', latestNewAlert([], null) === null);

// No watermark: the most recent fired alert is returned (fresh load, told once).
check(
  'no watermark -> most recent fired alert',
  latestNewAlert([a('x', '2026-11-23T10:00:00Z'), a('y', '2026-11-23T12:00:00Z')], null)?.id === 'y',
);

// Watermark equal to the newest -> nothing new.
check(
  'watermark at the newest -> nothing',
  latestNewAlert([a('y', '2026-11-23T12:00:00Z')], '2026-11-23T12:00:00Z') === null,
);

// A newer alert after the watermark -> it is returned.
check(
  'a newer alert after the watermark -> it',
  latestNewAlert(
    [a('y', '2026-11-23T12:00:00Z'), a('z', '2026-11-23T13:00:00Z')],
    '2026-11-23T12:00:00Z',
  )?.id === 'z',
);

// Only alert/triggered entries count; recurring and other statuses are ignored.
check(
  'ignores non-alert and non-triggered entries',
  latestNewAlert(
    [
      a('r', '2026-11-23T14:00:00Z', 'recurring', 'proposed'),
      a('s', '2026-11-23T14:00:00Z', 'alert', 'skipped'),
      a('ok', '2026-11-23T14:00:00Z', 'alert', 'triggered'),
    ],
    null,
  )?.id === 'ok',
);

// Liquidity ("is back") alerts are surfaced too; everything else is not.
check(
  'a liquidity alert fires in the banner',
  latestNewAlert([a('l', '2026-11-23T14:00:00Z', 'liquidity', 'triggered')], null)?.id === 'l',
);
check(
  'non-triggered liquidity entries are ignored',
  latestNewAlert([a('l', '2026-11-23T14:00:00Z', 'liquidity', 'skipped')], null) === null,
);
check(
  'price alert newer than a liquidity alert wins',
  latestNewAlert(
    [
      a('l', '2026-11-23T13:00:00Z', 'liquidity', 'triggered'),
      a('p', '2026-11-23T14:00:00Z', 'alert', 'triggered'),
    ],
    '2026-11-23T12:00:00Z',
  )?.id === 'p',
);

// Multiple new: the newest by timestamp wins, regardless of array order.
check(
  'multiple new -> newest by timestamp',
  latestNewAlert(
    [a('old', '2026-11-23T12:00:00Z'), a('newest', '2026-11-23T15:00:00Z'), a('mid', '2026-11-23T13:00:00Z')],
    '2026-11-23T11:00:00Z',
  )?.id === 'newest',
);

// An exactly-equal timestamp to the watermark is not "newer" (not re-announced).
check(
  'equal timestamp is not newer',
  latestNewAlert([a('y', '2026-11-23T12:00:00Z')], '2026-11-23T12:00:00Z') === null,
);

console.log(`\n${failures === 0 ? 'ALL ALERTS CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
