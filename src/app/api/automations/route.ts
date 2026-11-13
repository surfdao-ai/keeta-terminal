import { NextResponse } from 'next/server';
import { guardRead, guardWrite, ownerOf } from '@/lib/auth/guard';
import {
  listAutomations,
  upsertAutomation,
  patchAutomation,
  removeAutomation,
  listLog,
  type Automation,
} from '@/lib/automations/store';
import { getAutomationWallet } from '@/lib/automations/wallet';
import { resolveToken } from '@/lib/automations/prices';
import { listPending } from '@/lib/agent/safety';

export async function GET(req: Request) {
  const { session, error } = await guardRead(req);
  if (error) return error;
  const owner = ownerOf(session);

  const wallet = await getAutomationWallet(owner);
  return NextResponse.json({
    automations: await listAutomations(owner),
    pending: await listPending(owner),
    log: await listLog(owner, 25),
    wallet: wallet ? { address: wallet.address, createdAt: wallet.createdAt } : null,
    minEveryMinutes: 15,
    maxAutomationUsd: 100,
  });
}

export async function POST(req: Request) {
  const { session, error } = await guardWrite(req);
  if (error) return error;
  const owner = ownerOf(session);

  const body = (await req.json()) as { action?: string; [k: string]: unknown };

  if (body.action === 'delete') {
    await removeAutomation(owner, String(body.id));
    return NextResponse.json({ ok: true, automations: await listAutomations(owner) });
  }

  if (body.action === 'toggle') {
    const list = await listAutomations(owner);
    const a = list.find((x) => x.id === body.id);
    if (!a) return NextResponse.json({ error: 'Automation not found.' }, { status: 404 });
    // Compute the target state first so a conflict retry cannot flip twice.
    const updated = await patchAutomation(owner, a.id, { enabled: !a.enabled });
    return NextResponse.json({ ok: true, automation: updated ?? a });
  }

  const kind = body.kind === 'recurring' ? 'recurring' : 'alert';
  const name = String(body.name ?? '').trim() || (kind === 'alert' ? 'Price alert' : 'Recurring swap');

  if (kind === 'alert') {
    const symbol = String(body.symbol ?? '').trim();
    if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    const valueUsd = Number(body.valueUsd);
    if (!Number.isFinite(valueUsd) || valueUsd <= 0) {
      return NextResponse.json({ error: 'valueUsd must be a positive number' }, { status: 400 });
    }
    const op = body.op === 'lt' ? 'lt' : 'gt';
    const automation: Automation = {
      id: crypto.randomUUID(),
      kind: 'alert',
      name,
      symbol,
      op,
      valueUsd,
      enabled: true,
      createdAt: new Date().toISOString(),
      triggered: false,
    };
    await upsertAutomation(owner, automation);
    return NextResponse.json({ ok: true, automation });
  }

  // Recurring swap
  const fromRef = String(body.fromToken ?? '').trim();
  const toRef = String(body.toToken ?? '').trim();
  const amount = String(body.amount ?? '').trim();
  const everyMinutes = Number(body.everyMinutes ?? 60);

  if (!fromRef || !toRef || !amount) {
    return NextResponse.json({ error: 'fromToken, toToken and amount are required' }, { status: 400 });
  }
  if (!Number.isFinite(everyMinutes) || everyMinutes < 15) {
    return NextResponse.json(
      { error: 'everyMinutes must be at least 15 (Vercel Hobby schedules run every 15m)' },
      { status: 400 },
    );
  }

  const from = await resolveToken(fromRef).catch(() => null);
  const to = await resolveToken(toRef).catch(() => null);
  if (!from || !to) {
    return NextResponse.json({ error: `Could not resolve ${!from ? fromRef : toRef} on Keeta` }, { status: 400 });
  }

  const automation: Automation = {
    id: crypto.randomUUID(),
    kind: 'recurring',
    name,
    fromToken: from.address,
    toToken: to.address,
    amount,
    everyMinutes,
    enabled: true,
    createdAt: new Date().toISOString(),
    nextRunAt: new Date(Date.now() + everyMinutes * 60_000).toISOString(),
  };
  await upsertAutomation(owner, automation);
  return NextResponse.json({ ok: true, automation });
}
