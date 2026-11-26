import { NextResponse } from 'next/server';
import { guardWrite, ownerOf } from '@/lib/auth/guard';
import { dbUpdate } from '@/lib/db';
import {
  loadDataPayment,
  removeDataPayment,
  validateRequirement,
  priceUsdOf,
  executePaidGet,
  saveDataRead,
  reserveDataCap,
  dataCapState,
  validatePayUrl,
  USDC_MAINNET,
} from '@/lib/x402/paid-reads';
import { readPublicBalances } from '@/lib/keeta/public-reads';

/**
 * Submit a data payment the browser signed.
 *
 * The request carries only the signed block — never a key. The server
 * re-validates the (stored) requirement, reserves the owner's data cap
 * atomically, retries the paid URL with the block, and stores the result.
 */
export async function POST(req: Request) {
  const { session, error } = await guardWrite(req);
  if (error) return error;
  const owner = ownerOf(session);

  const body = (await req.json().catch(() => ({}))) as {
    paymentId?: string;
    signedBlock?: string;
  };
  if (!body.paymentId || !body.signedBlock) {
    return NextResponse.json(
      { error: 'paymentId and signedBlock are required' },
      { status: 400 },
    );
  }

  const pending = await loadDataPayment(owner, body.paymentId);
  if (!pending) {
    return NextResponse.json(
      { error: 'That data payment expired or was already used.' },
      { status: 409 },
    );
  }

  // Defensively re-validate the stored requirement and the URL: both were
  // checked at proposal time, but nothing here pays on stale trust.
  const invalid = validateRequirement(pending.requirement);
  if (invalid) {
    await removeDataPayment(owner, pending.id);
    return NextResponse.json({ error: invalid }, { status: 409 });
  }
  const badUrl = validatePayUrl(pending.payUrl);
  if (badUrl) {
    await removeDataPayment(owner, pending.id);
    return NextResponse.json({ error: badUrl }, { status: 409 });
  }

  const priceUsd = priceUsdOf(pending.requirement);

  // The wallet must actually hold the USDC being sent — fail closed with a
  // readable reason instead of handing the merchant an unpayable block.
  const balances = await readPublicBalances(session.address).catch(() => null);
  const usdcRow = balances?.find((b) => b.token === USDC_MAINNET);
  const heldUsdc = usdcRow ? Number(usdcRow.display) : 0;
  if (!Number.isFinite(heldUsdc) || heldUsdc < priceUsd) {
    return NextResponse.json(
      {
        error: `Wallet holds ${heldUsdc ? heldUsdc.toFixed(2) : 'no'} USDC — this read costs ${priceUsd.toFixed(2)}. Fund the wallet first.`,
      },
      { status: 409 },
    );
  }

  // Reserve the data cap atomically before anything is sent.
  const res = await reserveDataCap(owner, priceUsd);
  if (!res.ok) {
    return NextResponse.json(
      {
        error: `Daily data cap reached: $${res.spentUsd.toFixed(2)} of $${res.capUsd} used. Raise it in Settings.`,
      },
      { status: 409 },
    );
  }

  const result = await executePaidGet(pending.payUrl, body.signedBlock);

  // The merchant has now seen the block: the money may already have moved.
  // Consume the pending payment BEFORE persisting anything else, so it can
  // never be retried — the signed block is one-shot and a second tap would
  // sign a new send (a double payment).
  await removeDataPayment(owner, pending.id);

  if (result.ok) {
    try {
      await saveDataRead(owner, {
        id: pending.id,
        label: pending.label,
        payUrl: pending.payUrl,
        priceUsd,
        txHash: result.txHash,
        at: new Date().toISOString(),
        response: result.body,
      });
    } catch {
      // The payment settled; only the bookkeeping failed. Never retryable.
      return NextResponse.json(
        {
          ok: false,
          error: 'The payment settled but the result could not be stored — do not pay again.',
          hint: 'Ask the question once more; the read may still be retrievable from the merchant.',
        },
        { status: 500 },
      );
    }
    const cap = await dataCapState(owner);
    return NextResponse.json({
      ok: true,
      label: pending.label,
      priceUsd,
      txHash: result.txHash,
      response: result.body,
      cap: cap,
    });
  }

  // Failure: the block was not accepted. Check whether the USDC left the
  // wallet anyway (settled but response lost) so the user is not nudged into
  // paying twice.
  const after = await readPublicBalances(session.address).catch(() => null);
  const usdcAfter = after?.find((b) => b.token === USDC_MAINNET);
  const heldAfter = usdcAfter ? Number(usdcAfter.display) : 0;
  const likelySettled =
    Number.isFinite(heldAfter) && heldUsdc - heldAfter >= priceUsd - 1e-6;

  // The cap reservation is kept only when the money likely moved; otherwise
  // give it back so a genuinely failed attempt doesn't eat the budget.
  if (!likelySettled) {
    await reserveDataCapRefund(owner, priceUsd);
    return NextResponse.json(
      {
        ok: false,
        status: result.status,
        error: result.error ?? `The merchant rejected the payment (${result.status}).`,
        hint: 'The payment was not made — you have not been charged.',
      },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      status: result.status,
      error: result.error ?? `The merchant answered ${result.status}.`,
      hint: 'The payment appears to have settled but the response was lost. Do not pay again — ask the question once more; if the data does not come, check the trade log.',
    },
    { status: 409 },
  );
}

/**
 * Un-reserve a data-cap spend after a failed payment. The reservation was a
 * compare-and-set add; the mirror is a compare-and-set subtract floored at 0.
 */
async function reserveDataCapRefund(owner: string, usd: number): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await dbUpdate<{ spentUsd: number }>(
    `datacap:${day}`,
    (current) => ({
      spentUsd: Math.max(0, (current?.spentUsd ?? 0) - usd),
    }),
    { owner },
  );
}
