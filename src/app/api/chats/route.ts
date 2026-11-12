import { NextResponse } from 'next/server';
import { listChats, getChat, saveChat, deleteChat, deriveTitle } from '@/lib/chats';
import type { UIMessage } from 'ai';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (id) {
    const chat = await getChat(id);
    return NextResponse.json({ chat });
  }
  const chats = await listChats();
  return NextResponse.json({
    chats: chats.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c.messages.length,
    })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    id?: string;
    title?: string;
    messages?: UIMessage[];
  };

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const existing = body.id ? await getChat(body.id) : null;
  const id = existing?.id ?? body.id ?? crypto.randomUUID();
  const now = new Date().toISOString();

  const chat = await saveChat({
    id,
    title: body.title?.trim() || existing?.title || deriveTitle(messages),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages,
  });

  return NextResponse.json({ ok: true, chat: { id: chat.id, title: chat.title, updatedAt: chat.updatedAt } });
}

export async function DELETE(req: Request) {
  const body = (await req.json()) as { id?: string };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await deleteChat(body.id);
  return NextResponse.json({ ok: true });
}
