import { NextResponse } from 'next/server';
import { sessionFromRequest, csrfOk, consumeRateLimit } from '@/lib/auth/session';
import { unauthorized, forbidden, tooMany } from '@/lib/auth/guard';
import { scanFreeProviders } from '@/lib/providers/scan';

/**
 * Free inference discovery.
 *
 *   POST -> probe every candidate provider (no-key first) and return the
 *           ranked result: working, keyRequired, down.
 *
 * This fetches a fixed, code-defined list of provider endpoints (see
 * src/lib/providers/scan.ts) — never a user-supplied URL — so there is no
 * SSRF surface here. It is rate-limited tightly because each run makes up
 * to ~13 outbound requests.
 */
const SCAN_LIMIT = 5; // scans per minute per session
const SCAN_WINDOW = 60;

export async function POST(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return unauthorized();
  if (!csrfOk(req, session)) return forbidden();

  const limit = await consumeRateLimit(`scan:${session.address}`, SCAN_LIMIT, SCAN_WINDOW);
  if (!limit.ok) return tooMany(limit.resetSeconds);

  try {
    const result = await scanFreeProviders();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || 'the provider scan failed' },
      { status: 200 },
    );
  }
}
