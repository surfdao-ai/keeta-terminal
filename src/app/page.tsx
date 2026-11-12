'use client';

import { useState, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import ToolCard from '@/components/ToolCard';

type ProviderConfig = {
  type: 'gateway' | 'openai-compatible';
  model: string;
  baseUrl?: string;
  apiKey?: string;
  name?: string;
};

const PRESETS: { id: string; label: string; type: ProviderConfig['type']; baseUrl?: string; name?: string; defaultModel: string }[] = [
  { id: 'vercel', label: 'Vercel AI Gateway (server key/OIDC)', type: 'gateway', defaultModel: 'anthropic/claude-sonnet-4.5' },
  { id: 'vercel-key', label: 'Vercel AI Gateway (your key)', type: 'openai-compatible', baseUrl: 'https://ai-gateway.vercel.sh/v1', name: 'vercel', defaultModel: 'anthropic/claude-sonnet-4.5' },
  { id: 'openrouter', label: 'OpenRouter', type: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', name: 'openrouter', defaultModel: 'openai/gpt-4o-mini' },
  { id: 'groq', label: 'Groq', type: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', name: 'groq', defaultModel: 'llama-3.3-70b-versatile' },
  { id: 'together', label: 'Together', type: 'openai-compatible', baseUrl: 'https://api.together.xyz/v1', name: 'together', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { id: 'ollama', label: 'Ollama (local)', type: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', name: 'ollama', defaultModel: 'llama3.1' },
  { id: 'lmstudio', label: 'LM Studio (local)', type: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', name: 'lmstudio', defaultModel: 'local-model' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', type: 'openai-compatible', defaultModel: 'gpt-4o-mini' },
];

const STORAGE_KEY = 'keeta-terminal-provider';

function loadCfg(): ProviderConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ProviderConfig) : null;
  } catch {
    return null;
  }
}

export default function Home() {
  const [cfg, setCfg] = useState<ProviderConfig | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [presetId, setPresetId] = useState('vercel');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('anthropic/claude-sonnet-4.5');

  const [unlock, setUnlock] = useState({ hasWallet: false, address: null as string | null, unlocked: false });
  const [passphrase, setPassphrase] = useState('');
  const [mode, setMode] = useState<'unlock' | 'create'>('unlock');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [input, setInput] = useState('');

  const transport = new DefaultChatTransport({
    api: '/api/chat',
    prepareSendMessagesRequest: ({ messages }) => ({
      body: { messages, providerConfig: cfg ?? undefined },
    }),
  });
  const { messages, sendMessage, status } = useChat({ transport });

  useEffect(() => {
    const c = loadCfg();
    setCfg(c);
    if (!c) setSetupOpen(true);
  }, []);

  async function refresh() {
    const r = await fetch('/api/state');
    const j = await r.json();
    setUnlock({ hasWallet: j.hasWallet, address: j.address, unlocked: j.unlocked });
  }
  useEffect(() => {
    refresh();
  }, []);

  function openSetup() {
    const c = cfg;
    if (c) {
      const p = PRESETS.find((x) => x.baseUrl === c.baseUrl || (c.type === 'gateway' && x.id === 'vercel')) || PRESETS[0];
      setPresetId(p.id);
      setBaseUrl(c.baseUrl || p.baseUrl || '');
      setApiKey(c.apiKey || '');
      setModel(c.model);
    } else {
      const p = PRESETS[0];
      setPresetId(p.id);
      setBaseUrl(p.baseUrl || '');
      setApiKey('');
      setModel(p.defaultModel);
    }
    setSetupOpen(true);
  }

  function saveSetup(e: React.FormEvent) {
    e.preventDefault();
    const p = PRESETS.find((x) => x.id === presetId)!;
    const c: ProviderConfig = {
      type: p.type,
      model: model.trim() || p.defaultModel,
      name: p.name,
    };
    if (p.type === 'openai-compatible') {
      c.baseUrl = (baseUrl.trim() || p.baseUrl) as string;
      if (apiKey.trim()) c.apiKey = apiKey.trim();
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    setCfg(c);
    setSetupOpen(false);
  }

  function clearSetup() {
    localStorage.removeItem(STORAGE_KEY);
    setCfg(null);
    setSetupOpen(true);
  }

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
  const preset = PRESETS.find((x) => x.id === presetId)!;

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Keeta Terminal</h1>
          <p className="text-xs text-zinc-400">
            {cfg ? `${cfg.type === 'gateway' ? 'Gateway' : cfg.name || 'OpenAI-compat'} · ${cfg.model}` : 'No model configured'}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {unlock.address ? (
            <span className="font-mono text-xs text-zinc-300">{unlock.address.slice(0, 12)}…{unlock.address.slice(-6)}</span>
          ) : (
            <span className="text-zinc-500">no wallet</span>
          )}
          <button onClick={openSetup} className="px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-xs">Model setup</button>
          {unlock.unlocked ? (
            <button onClick={lock} className="px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600">Lock</button>
          ) : (
            <span className="text-amber-400">locked</span>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-72 border-r border-zinc-800 bg-zinc-900 p-4 hidden md:flex flex-col gap-4">
          <div>
            <h2 className="text-xs uppercase text-zinc-500 mb-2">Wallet</h2>
            {!unlock.hasWallet && <p className="text-sm text-zinc-400">No wallet yet. Create one to start.</p>}
            {unlock.hasWallet && !unlock.unlocked && <p className="text-sm text-amber-300">Unlock to trade.</p>}
            {unlock.unlocked && <p className="text-sm text-emerald-300">Unlocked · ready to trade</p>}
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

      {setupOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <form onSubmit={saveSetup} className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 w-full max-w-md flex flex-col gap-4">
            <h2 className="text-lg font-bold">Model setup</h2>
            <p className="text-xs text-zinc-400">Choose any OpenAI-compatible provider or Vercel AI Gateway. Your key stays in your browser.</p>
            <label className="flex flex-col gap-1 text-sm">
              Provider
              <select
                value={presetId}
                onChange={(e) => {
                  const p = PRESETS.find((x) => x.id === e.target.value)!;
                  setPresetId(p.id);
                  setBaseUrl(p.baseUrl || '');
                  setModel(p.defaultModel);
                }}
                className="px-3 py-2 rounded bg-zinc-800 border border-zinc-700"
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            {preset.type === 'openai-compatible' && (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  Base URL
                  <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="px-3 py-2 rounded bg-zinc-800 border border-zinc-700" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  API key
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." className="px-3 py-2 rounded bg-zinc-800 border border-zinc-700" />
                </label>
              </>
            )}
            <label className="flex flex-col gap-1 text-sm">
              Model
              <input value={model} onChange={(e) => setModel(e.target.value)} className="px-3 py-2 rounded bg-zinc-800 border border-zinc-700" />
            </label>
            <div className="flex gap-2 justify-end">
              {cfg && <button type="button" onClick={() => { clearSetup(); }} className="px-3 py-2 rounded bg-zinc-700 hover:bg-zinc-600 text-sm">Clear</button>}
              <button type="button" onClick={() => setSetupOpen(false)} className="px-3 py-2 rounded bg-zinc-700 hover:bg-zinc-600 text-sm">Cancel</button>
              <button type="submit" className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-medium">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
