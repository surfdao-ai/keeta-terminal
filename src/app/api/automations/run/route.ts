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
  const bySchedule = Boolean(secret) && auth === `Bearer ${secret}`;

  const session = sessionFromRequest(req);
  if (!bySchedule) {
    if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
    if (!csrfOk(req, session)) {
      return NextResponse.json({ error: 'CSRF check failed.' }, { status: 403 });
    }
  }

  const scope = session?.address ?? 'schedule';
  const limit = await consumeRateLimit(`automations:${scope}`, 12, 60);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many automation runs. Try again shortly.' },
      { status: 429, headers: { 'retry-after': String(limit.resetSeconds) } },
    );
  }

  const report = await runAutomations();
  console.log(
    `automations run: checked=${report.checked} triggered=${report.triggered} proposed=${report.proposed} skipped=${report.skipped}`,
  );

  return NextResponse.json({ ok: true, ...report });
}
