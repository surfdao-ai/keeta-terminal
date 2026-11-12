import { NextResponse } from 'next/server';
import { runAutomations } from '@/lib/automations/runner';
import { getSession } from '@/lib/agent/session';

/**
 * Automation runner.
 *
 * Authorised callers:
 *  - Vercel schedule (path target) sends `Authorization: Bearer $CRON_SECRET`
 *  - the in-app client tick carries the unlocked wallet session
 *
 * Unauthenticated callers may still evaluate *alerts* (read-only, no signing).
 */
export async function POST(req: Request) {
  const cookie = req.headers.get('cookie') ?? '';
  const sid = cookie.match(/kt_sid=([^;]+)/)?.[1];
  const session = getSession(sid);

  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  const authorisedBySecret = Boolean(secret) && auth === `Bearer ${secret}`;

  const allowSwaps = Boolean(session) || authorisedBySecret;
  const report = await runAutomations({ allowSwaps });
  console.log(
    `automations run: mode=${allowSwaps ? 'full' : 'alerts-only'} secret=${authorisedBySecret ? 'yes' : 'no'} session=${Boolean(session)} report=${JSON.stringify(report)}`,
  );

  return NextResponse.json({ ok: true, ...report, allowSwaps });
}
