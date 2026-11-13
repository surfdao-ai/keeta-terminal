/**
 * Saved chats.
 *
 * A chat is a list of UI messages (text + tool parts) kept in the same store
 * as the rest of the terminal state. New chats are created on demand, titles
 * are derived from the first user message.
 */
import type { UIMessage } from 'ai';
import { dbRead, dbUpdate } from './db';

export interface SavedChat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: UIMessage[];
}

const KEY = 'chats';
const MAX_CHATS = 100;

export async function listChats(owner: string): Promise<SavedChat[]> {
  const raw = await dbRead<SavedChat[]>(KEY, owner);
  const chats = Array.isArray(raw) ? raw : [];
  return chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getChat(owner: string, id: string): Promise<SavedChat | null> {
  const raw = await dbRead<SavedChat[]>(KEY, owner);
  const chats = Array.isArray(raw) ? raw : [];
  return chats.find((c) => c.id === id) ?? null;
}

export async function saveChat(owner: string, chat: SavedChat): Promise<SavedChat> {
  const record: SavedChat = { ...chat, updatedAt: new Date().toISOString() };
  // Compare-and-set: a concurrent save of a different chat is not lost.
  await dbUpdate<SavedChat[]>(
    KEY,
    (current) => {
      const chats = Array.isArray(current) ? current : [];
      const idx = chats.findIndex((c) => c.id === record.id);
      if (idx >= 0) chats[idx] = record;
      else chats.unshift(record);
      return chats.slice(0, MAX_CHATS);
    },
    { owner },
  );
  return record;
}

export async function deleteChat(owner: string, id: string): Promise<void> {
  await dbUpdate<SavedChat[]>(
    KEY,
    (current) => (Array.isArray(current) ? current : []).filter((c) => c.id !== id),
    { owner },
  );
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
