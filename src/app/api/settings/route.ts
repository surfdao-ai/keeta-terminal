import { NextResponse } from 'next/server';
import { guardRead, guardWrite, ownerOf } from '@/lib/auth/guard';
import { capSpent, setDailyCap, getSettings, MAX_CAP_USD } from '@/lib/agent/safety';

export async function GET(req: Request) {
  const { session, error } = await guardRead(req);
  if (error) return error;
  const owner = ownerOf(session);
  const settings = await getSettings(owner);
  const spent = await capSpent(owner);
  return NextResponse.json({
    dailyCapUsd: settings.dailyCapUsd,
    spentUsd: spent,
    remainingUsd: Math.max(0, settings.dailyCapUsd - spent),
    updatedAt: settings.updatedAt,
    maxCapUsd: MAX_CAP_USD,
  });
}

export async function POST(req: Request) {
  const { session, error } = await guardWrite(req);
  if (error) return error;
  const owner = ownerOf(session);

  const body = (await req.json()) as { dailyCapUsd?: number };
  const value = Number(body.dailyCapUsd);
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: 'Cap must be a positive number.' }, { status: 400 });
  }

  try {
    const settings = await setDailyCap(owner, value);
    const spent = await capSpent(owner);
    return NextResponse.json({
      ok: true,
      dailyCapUsd: settings.dailyCapUsd,
      spentUsd: spent,
      remainingUsd: Math.max(0, settings.dailyCapUsd - spent),
      updatedAt: settings.updatedAt,
      maxCapUsd: MAX_CAP_USD,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
