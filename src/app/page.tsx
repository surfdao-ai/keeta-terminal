'use client';

import { useState, useEffect, useRef } from 'react';
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
  { id: 'vercel', label: 'Vercel AI Gateway', type: 'gateway', defaultModel: 'anthropic/claude-sonnet-4.5' },
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
  const [state, setState] = useState<{ balances: unknown; cap: { spentUsd: number; capUsd: number } } | null>(null);

  const transport = new DefaultChatTransport({
    api: '/api/chat',
    prepareSendMessagesRequest: ({ messages }) => ({
      body: { messages, providerConfig: cfg ?? undefined },
    }),
  });
  const { messages, sendMessage, status } = useChat({ transport });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = loadCfg();
    setCfg(c);
    if (!c) setSetupOpen(true);
  }, []);

  async function refresh() {
    const r = await fetch('/api/state');
    const j = await r.json();
    setUnlock({ hasWallet: j.hasWallet, address: j.address, unlocked: j.unlocked });
    setState(j);
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status]);

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
  const balances = (state?.balances as { token: string; display: string }[] | null) || [];
  const cap = state?.cap;

  return (
    <div className="flex flex-col h-screen bg-[#0a0b0f] text-zinc-100">
      {/* top bar */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/80 bg-[#0d0e13]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center font-bold text-black text-sm">K</div>
          <div>
            <h1 className="text-base font-bold tracking-tight">KTerminal</h1>
            <p className="text-[11px] text-zinc-500">AI trading · Keeta Network</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
            {cfg ? `${cfg.type === 'gateway' ? 'Gateway' : cfg.name || 'OpenAI-compat'} · ${cfg.model}` : 'No model'}
          </span>
          {unlock.address && (
            <span className="font-mono px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
              {unlock.address.slice(0, 10)}…{unlock.address.slice(-4)}
            </span>
          )}
          <button onClick={openSetup} className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700">Model</button>
          {unlock.unlocked ? (
            <button onClick={lock} className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700">Lock</button>
          ) : (
            <span className="px-3 py-1.5 rounded bg-amber-900/40 border border-amber-700 text-amber-300">locked</span>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* sidebar */}
        <aside className="w-80 border-r border-zinc-800/80 bg-[#0d0e13] flex flex-col">
          {/* wallet card */}
          <div className="p-4 border-b border-zinc-800/80">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs uppercase tracking-wider text-zinc-500">Wallet</h2>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${unlock.unlocked ? 'bg-emerald-900/40 text-emerald-300' : 'bg-zinc-800 text-zinc-400'}`}>
                {unlock.unlocked ? 'unlocked' : unlock.hasWallet ? 'locked' : 'none'}
              </span>
            </div>
            {!unlock.hasWallet ? (
              <p className="text-sm text-zinc-400">No wallet yet. Create one below.</p>
            ) : !unlock.unlocked ? (
              <p className="text-sm text-amber-300">Unlock to view balances & trade.</p>
            ) : (
              <div className="space-y-2">
                {balances.length === 0 && <p className="text-sm text-zinc-500">No balances yet.</p>}
                {balances.map((b, i) => (
                  <div key={i} className="flex items-center justify-between bg-zinc-900/60 rounded px-3 py-2 border border-zinc-800">
                    <span className="font-mono text-xs text-zinc-300">{b.token.slice(0, 10)}…</span>
                    <span className="font-mono text-sm text-emerald-300">{b.display}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* unlock form */}
          <div className="p-4 border-b border-zinc-800/80">
            <form onSubmit={doUnlock} className="flex flex-col gap-2">
              <div className="flex gap-1 text-xs">
                <button type="button" onClick={() => setMode('unlock')} className={`flex-1 py-1.5 rounded ${mode === 'unlock' ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-400'}`}>Unlock</button>
                <button type="button" onClick={() => setMode('create')} className={`flex-1 py-1.5 rounded ${mode === 'create' ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-400'}`}>Create</button>
              </div>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder={mode === 'create' ? 'choose a strong passphrase' : 'passphrase'}
                className="px-3 py-2 rounded bg-zinc-900 border border-zinc-700 text-sm focus:outline-none focus:border-emerald-500"
              />
              <button disabled={busy} className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-medium">
                {busy ? '…' : mode === 'create' ? 'Create wallet' : 'Unlock'}
              </button>
              {msg && <p className="text-xs text-red-400">{msg}</p>}
            </form>
          </div>

          {/* daily cap */}
          <div className="p-4 border-b border-zinc-800/80">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs uppercase tracking-wider text-zinc-500">Daily cap</h2>
              <span className="text-xs text-zinc-400">
                ${cap ? cap.spentUsd.toFixed(2) : '0.00'} / ${cap ? cap.capUsd : 100}
              </span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all"
                style={{ width: `${cap ? Math.min(100, (cap.spentUsd / cap.capUsd) * 100) : 0}%` }}
              />
            </div>
          </div>

          {/* tips */}
          <div className="p-4 text-xs text-zinc-500 mt-auto">
            <p className="mb-1">Try commands:</p>
            <p className="font-mono text-zinc-400">portfolio · tokens · estimate 1 KTA→USDC · propose 0.5 KTA→USDC</p>
          </div>
        </aside>

        {/* chat */}
        <main className="flex flex-col flex-1 min-h-0 bg-[#0a0b0f]">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.length === 0 && (
              <div className="max-w-2xl mx-auto mt-10 text-center">
                <div className="text-4xl mb-3">⚡</div>
                <h2 className="text-xl font-bold mb-2">KTerminal</h2>
                <p className="text-zinc-400 text-sm">Chat with your AI trading agent. Ask for balances, token lists, quotes, or propose a trade.</p>
                <div className="mt-6 grid grid-cols-2 gap-2 text-xs">
                  {['What\'s my portfolio?', 'List tradable tokens', 'Estimate 1 KTA to USDC', 'Propose 0.1 KTA for USDC'].map((q) => (
                    <button
                      key={q}
                      onClick={() => { setInput(q); }}
                      className="px-3 py-2 rounded bg-zinc-900 border border-zinc-800 hover:border-emerald-600 text-zinc-300 text-left"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-3xl ${m.role === 'user' ? 'bg-emerald-600/90 text-white' : 'bg-zinc-900 border border-zinc-800'} rounded-2xl px-4 py-3`}>
                  {m.role === 'assistant' && (
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Agent</div>
                  )}
                  {m.parts.map((part, i) => {
                    if (part.type === 'text') {
                      return <div key={i} className="whitespace-pre-wrap text-sm leading-relaxed">{part.text}</div>;
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
            {loading && (
              <div className="flex justify-start">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim() || loading) return;
              sendMessage({ text: input });
              setInput('');
            }}
            className="border-t border-zinc-800/80 p-4 bg-[#0d0e13]"
          >
            <div className="flex gap-2 items-center max-w-4xl mx-auto">
              <span className="text-emerald-500 font-mono text-sm">$</span>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask the terminal… (e.g. propose 0.5 KTA for USDC)"
                className="flex-1 px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-sm focus:outline-none focus:border-emerald-500 font-mono"
              />
              <button disabled={loading || !input.trim()} className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-sm font-medium">
                Send
              </button>
            </div>
          </form>
        </main>
      </div>

      {setupOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={saveSetup} className="bg-[#0d0e13] border border-zinc-800 rounded-2xl p-7 w-full max-w-lg flex flex-col gap-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center font-bold text-black">K</div>
              <div>
                <h2 className="text-xl font-bold">Model setup</h2>
                <p className="text-xs text-zinc-500">Choose a provider and paste your key. Stored only in your browser.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => {
                    setPresetId(p.id);
                    setBaseUrl(p.baseUrl || '');
                    setModel(p.defaultModel);
                  }}
                  className={`px-3 py-2.5 rounded-xl border text-sm font-medium text-left transition ${
                    presetId === p.id
                      ? 'bg-emerald-600/15 border-emerald-500 text-emerald-300'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {preset.type === 'openai-compatible' && (
              <div className="space-y-3">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-zinc-400">Base URL</span>
                  <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 focus:outline-none focus:border-emerald-500" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-zinc-400">API key</span>
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." className="px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 focus:outline-none focus:border-emerald-500" />
                </label>
              </div>
            )}
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-zinc-400">Model</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} className="px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 focus:outline-none focus:border-emerald-500" />
            </label>
            <div className="flex gap-2 justify-end pt-2">
              {cfg && <button type="button" onClick={() => { clearSetup(); }} className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">Clear</button>}
              <button type="button" onClick={() => setSetupOpen(false)} className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium">Save & close</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
