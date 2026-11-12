import { NextResponse } from 'next/server';
import { getSession } from '@/lib/agent/session';
import {
  listAutomations,
  upsertAutomation,
  removeAutomation,
  listLog,
  nextRunAt,
  MIN_EVERY_MINUTES,
  MAX_AUTOMATION_USD,
  type Automation,
} from '@/lib/automations/store';
import { getAutomationWallet, automationEnabled } from '@/lib/automations/wallet';
import { resolveToken } from '@/lib/automations/prices';

export async function GET() {
  const wallet = await getAutomationWallet();
  return NextResponse.json({
    automations: await listAutomations(),
    log: await listLog(25),
    wallet: wallet ? { address: wallet.address, createdAt: wallet.createdAt } : null,
    automationKeyConfigured: automationEnabled(),
    minEveryMinutes: MIN_EVERY_MINUTES,
    maxAutomationUsd: MAX_AUTOMATION_USD,
  });
}

export async function POST(req: Request) {
  const cookie = req.headers.get('cookie') ?? '';
  const sid = cookie.match(/kt_sid=([^;]+)/)?.[1];
  if (!getSession(sid)) {
    return NextResponse.json({ error: 'Wallet locked — unlock to manage automations.' }, { status: 401 });
  }

  const body = (await req.json()) as { action?: string; [k: string]: unknown };

  if (body.action === 'delete') {
    await removeAutomation(String(body.id));
    return NextResponse.json({ ok: true, automations: await listAutomations() });
  }

  if (body.action === 'toggle') {
    const list = await listAutomations();
    const a = list.find((x) => x.id === body.id);
    if (!a) return NextResponse.json({ error: 'Automation not found.' }, { status: 404 });
    a.enabled = !a.enabled;
    await upsertAutomation(a);
    return NextResponse.json({ ok: true, automation: a });
  }

  // create
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
    await upsertAutomation(automation);
    return NextResponse.json({ ok: true, automation });
  }

  // recurring swap
  const fromRef = String(body.fromToken ?? '').trim();
  const toRef = String(body.toToken ?? '').trim();
  const amount = String(body.amount ?? '').trim();
  const everyMinutes = Number(body.everyMinutes ?? 60);

  if (!fromRef || !toRef || !amount) {
    return NextResponse.json({ error: 'fromToken, toToken and amount are required' }, { status: 400 });
  }
  if (!Number.isFinite(everyMinutes) || everyMinutes < MIN_EVERY_MINUTES) {
    return NextResponse.json(
      { error: `everyMinutes must be at least ${MIN_EVERY_MINUTES} (Vercel Hobby schedules run every 15m)` },
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
    nextRunAt: nextRunAt(everyMinutes),
  };
  await upsertAutomation(automation);
  return NextResponse.json({ ok: true, automation });
}
