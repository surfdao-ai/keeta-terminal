import { NextResponse } from 'next/server';
import { guardRead, ownerOf } from '@/lib/auth/guard';
import {
  loadDataPayment,
  validateRequirement,
  validatePayUrl,
  dataCapState,
} from '@/lib/x402/paid-reads';

/**
 * The browser reads the stored payment requirement before signing, so the
 * block it signs is always for what the server validated at proposal time —
 * not whatever the model echoed back in the card.
 */
export async function POST(req: Request) {
  const { session, error } = await guardRead(req);
  if (error) return error;
  const owner = ownerOf(session);

  const body = (await req.json().catch(() => ({}))) as { paymentId?: string };
  if (!body.paymentId) {
    return NextResponse.json({ error: 'paymentId is required' }, { status: 400 });
  }

  const pending = await loadDataPayment(owner, body.paymentId);
  if (!pending) {
    return NextResponse.json(
      { error: 'That data payment expired or was already used.' },
      { status: 409 },
    );
  }

  const invalid = validateRequirement(pending.requirement);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 409 });
  }
  const badUrl = validatePayUrl(pending.payUrl);
  if (badUrl) {
    return NextResponse.json({ error: badUrl }, { status: 409 });
  }

  const cap = await dataCapState(owner);
  return NextResponse.json({
    requirement: pending.requirement,
    label: pending.label,
    priceUsd: pending.priceUsd,
    expiresAt: pending.expiresAt,
    cap,
  });
}
