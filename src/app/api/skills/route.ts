import { NextResponse } from 'next/server';
import { listSkills, readSkill } from '@/lib/keeta/skills';

/**
 * The Keeta skill catalogue.
 *
 *   GET                  -> every skill (id, title, description)
 *   POST { id }          -> the full text of one skill
 */
export async function GET() {
  try {
    return NextResponse.json({ skills: await listSkills() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, skills: [] }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    return NextResponse.json({ id: body.id, content: await readSkill(body.id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 200 });
  }
}
