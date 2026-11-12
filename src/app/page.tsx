'use client';

import { useState, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import ToolCard from '@/components/ToolCard';

type UnlockState = { hasWallet: boolean; address: string | null; unlocked: boolean };

export default function Home() {
  const [unlock, setUnlock] = useState<UnlockState>({ hasWallet: false, address: null, unlocked: false });
  const [passphrase, setPassphrase] = useState('');
  const [mode, setMode] = useState<'unlock' | 'create'>('unlock');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [input, setInput] = useState('');

  const { messages, sendMessage, status } = useChat();

  async function refresh() {
    const r = await fetch('/api/state');
    const j = await r.json();
    setUnlock({ hasWallet: j.hasWallet, address: j.address, unlocked: j.unlocked });
  }
  useEffect(() => {
    refresh();
  }, []);

  async function doUnlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const r = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passphrase, mode }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setPassphrase('');
      await refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    await fetch('/api/unlock', { method: 'DELETE' });
    await refresh();
  }

  async function confirmTrade(tradeId: string, setter: (r: unknown) => void) {
    const r = await fetch('/api/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tradeId }),
    });
    const j = await r.json();
    setter(j);
    await refresh();
  }

  const loading = status === 'streaming' || status === 'submitted';

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Keeta Terminal</h1>
          <p className="text-xs text-zinc-400">AI chat trading terminal · Keeta</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {unlock.address ? (
            <span className="font-mono text-xs text-zinc-300">{unlock.address.slice(0, 12)}…{unlock.address.slice(-6)}</span>
          ) : (
            <span className="text-zinc-500">no wallet</span>
          )}
          {unlock.unlocked ? (
            <button onClick={lock} className="px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600">Lock</button>
          ) : (
            <span className="text-amber-400">locked</span>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* sidebar */}
        <aside className="w-72 border-r border-zinc-800 bg-zinc-900 p-4 hidden md:flex flex-col gap-4">
          <div>
            <h2 className="text-xs uppercase text-zinc-500 mb-2">Wallet</h2>
            {!unlock.hasWallet && (
              <p className="text-sm text-zinc-400">No wallet yet. Create one to start.</p>
            )}
            {unlock.hasWallet && !unlock.unlocked && (
              <p className="text-sm text-amber-300">Unlock to trade.</p>
            )}
            {unlock.unlocked && (
              <p className="text-sm text-emerald-300">Unlocked · ready to trade</p>
            )}
          </div>
          <form onSubmit={doUnlock} className="flex flex-col gap-2">
            <div className="flex gap-2 text-xs">
              <button type="button" onClick={() => setMode('unlock')} className={`px-2 py-1 rounded ${mode === 'unlock' ? 'bg-zinc-700' : 'bg-zinc-800'}`}>Unlock</button>
              <button type="button" onClick={() => setMode('create')} className={`px-2 py-1 rounded ${mode === 'create' ? 'bg-zinc-700' : 'bg-zinc-800'}`}>Create</button>
            </div>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={mode === 'create' ? 'choose a strong passphrase' : 'passphrase'}
              className="px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-sm"
            />
            <button disabled={busy} className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-medium">
              {busy ? '…' : mode === 'create' ? 'Create wallet' : 'Unlock'}
            </button>
            {msg && <p className="text-xs text-red-400">{msg}</p>}
          </form>
          <p className="text-xs text-zinc-500">
            Passphrase derives the AES key that protects your seed. It never leaves the server memory after unlock.
          </p>
        </aside>

        {/* chat */}
        <main className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-zinc-500 text-sm">
                Try: "what's my portfolio?", "list tradable tokens", "estimate 1 KTA to USDC", "propose trading 0.5 KTA for USDC".
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-3xl rounded-lg px-4 py-3 ${m.role === 'user' ? 'bg-emerald-700' : 'bg-zinc-800'}`}>
                  {m.parts.map((part, i) => {
                    if (part.type === 'text') {
                      return <div key={i} className="whitespace-pre-wrap text-sm">{part.text}</div>;
                    }
                    if (part.type.startsWith('tool-')) {
                      const toolName = part.type.slice(5);
                      const state = (part as { state?: string }).state;
                      const input = (part as { input?: unknown }).input;
                      const output = (part as { output?: unknown }).output;
                      return (
                        <ToolCard
                          key={i}
                          name={toolName}
                          state={state}
                          input={input}
                          output={output}
                          onConfirm={confirmTrade}
                        />
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            ))}
            {loading && <div className="text-zinc-500 text-sm">thinking…</div>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim() || loading) return;
              sendMessage({ text: input });
              setInput('');
            }}
            className="border-t border-zinc-800 p-3 flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the terminal…"
              className="flex-1 px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-sm"
            />
            <button disabled={loading} className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-medium">
              Send
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}
