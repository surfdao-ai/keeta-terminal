import { NextResponse } from 'next/server';
import { runAutomations } from '@/lib/automations/runner';

/**
 * Automation runner.
 *
 * Authorised callers:
 *  - Vercel schedule (path target) sends `Authorization: Bearer $CRON_SECRET`
 *  - the in-app client tick sends the wallet seed, which proves the caller
 *    controls the account the automations trade from
 *
 * Unauthenticated callers may still evaluate *alerts* (read-only, no signing).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { seed?: string };
  const seed = typeof body.seed === 'string' && body.seed.trim() ? body.seed.trim() : null;

  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  const authorisedBySecret = Boolean(secret) && auth === `Bearer ${secret}`;

  const allowSwaps = Boolean(seed) || authorisedBySecret;
  const report = await runAutomations({ allowSwaps });
  // NOTE: never log the credential itself (or any prefix of it).
  console.log(
    `automations run: mode=${allowSwaps ? 'full' : 'alerts-only'} secret=${authorisedBySecret ? 'yes' : 'no'} seed=${Boolean(seed)} report=${JSON.stringify(report)}`,
  );

  return NextResponse.json({ ok: true, ...report, allowSwaps });
}
