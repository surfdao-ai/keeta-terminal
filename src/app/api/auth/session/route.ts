import { NextResponse } from 'next/server';
import { guardRead } from '@/lib/auth/guard';

/** Who am I? The client calls this on load to find out whether it is signed in. */
export async function GET(req: Request) {
  const { session, error } = await guardRead(req);
  if (error) return error;
  return NextResponse.json({ address: session.address });
}
