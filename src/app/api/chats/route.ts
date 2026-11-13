import { NextResponse } from 'next/server';
import { guardRead, guardWrite, ownerOf } from '@/lib/auth/guard';
import { listChats, getChat, saveChat, deleteChat, deriveTitle } from '@/lib/chats';
import type { UIMessage } from 'ai';

/** Saved chats — scoped to the signed-in visitor. */
export async function GET(req: Request) {
  const { session, error } = await guardRead(req);
  if (error) return error;
  const owner = ownerOf(session);

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (id) {
    const chat = await getChat(owner, id);
    return NextResponse.json({ chat });
  }

  const chats = await listChats(owner);
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
  const { session, error } = await guardWrite(req);
  if (error) return error;
  const owner = ownerOf(session);

  const body = (await req.json()) as {
    id?: string;
    title?: string;
    messages?: UIMessage[];
  };

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const existing = body.id ? await getChat(owner, body.id) : null;
  const id = existing?.id ?? body.id ?? crypto.randomUUID();
  const now = new Date().toISOString();

  // The title is the placeholder until there is a first user message to name
  // it after.
  const derived = deriveTitle(messages);
  const current = existing?.title ?? '';
  const title =
    body.title?.trim() || (!current || current === 'new chat' ? derived : current) || current || derived;

  const chat = await saveChat(owner, {
    id,
    title,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages,
  });

  return NextResponse.json({ ok: true, chat: { id: chat.id, title: chat.title, updatedAt: chat.updatedAt } });
}

export async function DELETE(req: Request) {
  const { session, error } = await guardWrite(req);
  if (error) return error;

  const body = (await req.json()) as { id?: string };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await deleteChat(ownerOf(session), body.id);
  return NextResponse.json({ ok: true });
}
