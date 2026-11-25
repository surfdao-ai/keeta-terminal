/**
 * The Keeta skills, straight from the KeeSpecs MCP.
 *
 * A skill is a short instruction sheet for one read (or one paid read). The
 * catalogue is free; the browser lets you read them without asking the agent.
 */
import { createMCPClient } from '@ai-sdk/mcp';

const MCP_URL = process.env.KEESPECS_MCP_URL || 'https://keespecs.xyz/mcp';

export interface Skill {
  id: string;
  title: string;
  description: string;
}

type ToolResult = { content?: { type: string; text?: string }[] };

function textOf(result: ToolResult): string {
  const parts = (result.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string);
  return parts.join('\n');
}

/**
 * One shared MCP client, kept warm.
 *
 * A fresh client pays a full HTTP connect + initialize handshake per call,
 * which made every skill list fetch and every skill open feel like a dead
 * button. Reusing the connection drops a read from ~850ms to ~200ms. If a
 * call fails the connection is likely stale, so it is closed and one retry
 * happens over a fresh handshake.
 */
let shared: Awaited<ReturnType<typeof createMCPClient>> | null = null;

async function ensureClient(): Promise<Awaited<ReturnType<typeof createMCPClient>>> {
  if (shared) return shared;
  const client = await createMCPClient({ transport: { type: 'http', url: MCP_URL } });
  shared = client;
  return client;
}

async function withClient<T>(fn: (client: Awaited<ReturnType<typeof createMCPClient>>) => Promise<T>): Promise<T> {
  const client = await ensureClient();
  try {
    return await fn(client);
  } catch (e) {
    await client.close().catch(() => undefined);
    shared = null;
    const fresh = await ensureClient();
    return await fn(fresh);
  }
}

export async function listSkills(): Promise<Skill[]> {
  const raw = await withClient((client) =>
    client.callTool({ name: 'list_skills', arguments: {} }) as Promise<ToolResult>,
  );
  const text = textOf(raw).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as Skill[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function readSkill(id: string): Promise<string> {
  const raw = await withClient((client) =>
    client.callTool({ name: 'read_skill', arguments: { id } }) as Promise<ToolResult>,
  );
  return textOf(raw);
}
