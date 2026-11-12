import { NextResponse } from 'next/server';
import { getSession } from '@/lib/agent/session';
import {
  capSpent,
  setDailyCap,
  getSettings,
  MAX_CAP_USD,
} from '@/lib/agent/safety';

export async function GET() {
  const settings = await getSettings();
  const spent = await capSpent();
  return NextResponse.json({
    dailyCapUsd: settings.dailyCapUsd,
    spentUsd: spent,
    remainingUsd: Math.max(0, settings.dailyCapUsd - spent),
    updatedAt: settings.updatedAt,
    maxCapUsd: MAX_CAP_USD,
  });
}

export async function POST(req: Request) {
  const cookie = req.headers.get('cookie') ?? '';
  const sid = cookie.match(/kt_sid=([^;]+)/)?.[1];
  const session = getSession(sid);
  if (!session) {
    return NextResponse.json({ error: 'Wallet locked — unlock before changing the cap.' }, { status: 401 });
  }

  const body = (await req.json()) as { dailyCapUsd?: number };
  const value = Number(body.dailyCapUsd);
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: 'Cap must be a positive number.' }, { status: 400 });
  }
  if (value > MAX_CAP_USD) {
    return NextResponse.json({ error: `Cap cannot exceed $${MAX_CAP_USD.toLocaleString()}.` }, { status: 400 });
  }

  const settings = await setDailyCap(value);
  const spent = await capSpent();
  return NextResponse.json({
    ok: true,
    dailyCapUsd: settings.dailyCapUsd,
    spentUsd: spent,
    remainingUsd: Math.max(0, settings.dailyCapUsd - spent),
    updatedAt: settings.updatedAt,
    maxCapUsd: MAX_CAP_USD,
  });
}
