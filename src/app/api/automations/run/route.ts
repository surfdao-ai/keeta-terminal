import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runAutomations } from '@/lib/automations/runner';
import { consumeRateLimit, csrfOk, sessionFromRequest } from '@/lib/auth/session';

/**
 * Evaluate the automations.
 *
 * Two callers:
 *  - the Vercel schedule, which proves itself with `Authorization: Bearer
 *    $CRON_SECRET` (it has no browser session)
 *  - the signed-in app, which sends its CSRF token
 *
 * Either way the run only *proposes* actions — nothing is signed here.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  // Timing-safe comparison, like CSRF tokens: the schedule proves itself
  // with the shared secret, and response times must not leak it.
  let bySchedule = false;
  if (secret && auth) {
    const a = Buffer.from(auth);
    const b = Buffer.from(`Bearer ${secret}`);
    if (a.length === b.length && timingSafeEqual(a, b)) bySchedule = true;
  }

  const session = sessionFromRequest(req);
  if (!bySchedule) {
    if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
    if (!csrfOk(req, session)) {
      return NextResponse.json({ error: 'CSRF check failed.' }, { status: 403 });
    }
  }

  const limitKey = session?.address ?? 'schedule';
  const limit = await consumeRateLimit(`automations:${limitKey}`, 12, 60);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many automation runs. Try again shortly.' },
      { status: 429, headers: { 'retry-after': String(limit.resetSeconds) } },
    );
  }

  // A signed-in caller only evaluates its own automations. The schedule
  // always sweeps everyone: it proves itself with the Bearer token, and the
  // token — not a stray cookie — decides the scope.
  const scope = bySchedule ? undefined : session?.address;
  const report = await runAutomations(scope);
  console.log(
    `automations run: checked=${report.checked} triggered=${report.triggered} proposed=${report.proposed} skipped=${report.skipped}`,
  );

  return NextResponse.json({ ok: true, ...report });
}
