import { NextResponse } from 'next/server';
import { guardRead, guardWrite, ownerOf } from '@/lib/auth/guard';
import {
  capSpent,
  setDailyCap,
  getSettings,
  MAX_CAP_USD,
  MAX_DATA_CAP_USD,
  DEFAULT_DATA_CAP_USD,
  dataCapUsd,
  dataCapSpent,
  setDataCap,
} from '@/lib/agent/safety';

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
    dataCapUsd: await dataCapUsd(owner),
    dataSpentUsd: await dataCapSpent(owner),
    maxDataCapUsd: MAX_DATA_CAP_USD,
    defaultDataCapUsd: DEFAULT_DATA_CAP_USD,
  });
}

export async function POST(req: Request) {
  const { session, error } = await guardWrite(req);
  if (error) return error;
  const owner = ownerOf(session);

  const body = (await req.json()) as { dailyCapUsd?: number; dataCapUsd?: number };
  if (body.dailyCapUsd === undefined && body.dataCapUsd === undefined) {
    return NextResponse.json({ error: 'dailyCapUsd or dataCapUsd is required.' }, { status: 400 });
  }

  try {
    let settings = await getSettings(owner);
    if (body.dailyCapUsd !== undefined) {
      const value = Number(body.dailyCapUsd);
      if (!Number.isFinite(value) || value <= 0) {
        return NextResponse.json({ error: 'Cap must be a positive number.' }, { status: 400 });
      }
      settings = await setDailyCap(owner, value);
    }
    if (body.dataCapUsd !== undefined) {
      const value = Number(body.dataCapUsd);
      if (!Number.isFinite(value) || value <= 0) {
        return NextResponse.json({ error: 'Data cap must be a positive number.' }, { status: 400 });
      }
      settings = await setDataCap(owner, value);
    }
    const spent = await capSpent(owner);
    return NextResponse.json({
      ok: true,
      dailyCapUsd: settings.dailyCapUsd,
      spentUsd: spent,
      remainingUsd: Math.max(0, settings.dailyCapUsd - spent),
      updatedAt: settings.updatedAt,
      maxCapUsd: MAX_CAP_USD,
      dataCapUsd: await dataCapUsd(owner),
      dataSpentUsd: await dataCapSpent(owner),
      maxDataCapUsd: MAX_DATA_CAP_USD,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
