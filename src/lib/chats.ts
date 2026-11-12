/**
 * Saved chats.
 *
 * A chat is a list of UI messages (text + tool parts) kept in the same store
 * as the rest of the terminal state. New chats are created on demand, titles
 * are derived from the first user message.
 */
import type { UIMessage } from 'ai';
import { dbRead, dbWrite } from './db';

export interface SavedChat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: UIMessage[];
}

const KEY = 'chats';
const MAX_CHATS = 100;

export async function listChats(): Promise<SavedChat[]> {
  const chats = (await dbRead<SavedChat[]>(KEY)) ?? [];
  return chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getChat(id: string): Promise<SavedChat | null> {
  const chats = (await dbRead<SavedChat[]>(KEY)) ?? [];
  return chats.find((c) => c.id === id) ?? null;
}

export async function saveChat(chat: SavedChat): Promise<SavedChat> {
  const chats = (await dbRead<SavedChat[]>(KEY)) ?? [];
  const idx = chats.findIndex((c) => c.id === chat.id);
  const record: SavedChat = { ...chat, updatedAt: new Date().toISOString() };
  if (idx >= 0) chats[idx] = record;
  else chats.unshift(record);
  await dbWrite(KEY, chats.slice(0, MAX_CHATS));
  return record;
}

export async function deleteChat(id: string): Promise<void> {
  const chats = (await dbRead<SavedChat[]>(KEY)) ?? [];
  await dbWrite(KEY, chats.filter((c) => c.id !== id));
}

/** Derive a short title from the first user message. */
export function deriveTitle(messages: UIMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  const text = first?.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join(' ')
    .trim();
  if (!text) return 'new chat';
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}
