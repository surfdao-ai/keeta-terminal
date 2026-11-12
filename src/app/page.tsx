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

type View = 'chat' | 'wallet' | 'trade' | 'automations' | 'settings';

const NAV: { id: View; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'wallet', label: 'Wallet', icon: '👛' },
  { id: 'trade', label: 'Trade', icon: '⇄' },
  { id: 'automations', label: 'Automations', icon: '⚡' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export default function Home() {
  const [cfg, setCfg] = useState<ProviderConfig | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [presetId, setPresetId] = useState('vercel');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('anthropic/claude-sonnet-4.5');

  const [view, setView] = useState<View>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [unlock, setUnlock] = useState({ hasWallet: false, address: null as string | null, unlocked: false });
  const [passphrase, setPassphrase] = useState('');
  const [mode, setMode] = useState<'unlock' | 'create'>('unlock');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [input, setInput] = useState('');
  const [state, setState] = useState<{ balances: { token: string; display: string }[]; cap: { spentUsd: number; capUsd: number } } | null>(null);

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
  const balances = state?.balances || [];
  const cap = state?.cap;

  return (
    <div className="flex h-screen bg-[#09090B] text-[#F7F7F7]">
      {/* sidebar */}
      <aside
        className={`${sidebarOpen ? 'w-[250px]' : 'w-16'} shrink-0 border-r border-zinc-800/80 bg-[#141416] flex flex-col transition-all duration-200`}
      >
        <div className="h-14 flex items-center px-4 border-b border-zinc-800/80 gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-800 flex items-center justify-center font-bold text-white text-sm shrink-0">K</div>
          {sidebarOpen && <span className="font-semibold tracking-tight">KTerminal</span>}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="ml-auto text-zinc-500 hover:text-white text-xs">
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        <button
          onClick={() => { setView('chat'); }}
          className="mx-3 mt-3 px-3 py-2 rounded-lg bg-purple-900/40 border border-purple-700/60 text-sm font-medium text-purple-200 hover:bg-purple-900/60 flex items-center gap-2"
        >
          <span>＋</span>
          {sidebarOpen && <span>New Chat</span>}
        </button>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              className={`w-full px-3 py-2 rounded-lg text-sm flex items-center gap-3 transition ${
                view === n.id
                  ? 'bg-[#4C1D95] text-white font-medium'
                  : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
              }`}
            >
              <span className="w-5 text-center">{n.icon}</span>
              {sidebarOpen && <span>{n.label}</span>}
            </button>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-zinc-800/80 text-[11px] text-zinc-500 space-y-1">
          {sidebarOpen && (
            <>
              <a href="https://docs.keeta.com" target="_blank" rel="noreferrer" className="block hover:text-zinc-300">Docs</a>
              <a href="https://github.com/surfdao-ai/keeta-terminal" target="_blank" rel="noreferrer" className="block hover:text-zinc-300">GitHub</a>
              <div className="pt-1 text-zinc-600">v1.0</div>
            </>
          )}
        </div>
      </aside>

      {/* main */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#09090B]">
        {view === 'chat' && (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center px-6 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-800 flex items-center justify-center font-bold text-white text-2xl mb-6">K</div>
                  <h1 className="text-4xl font-bold tracking-tight mb-2">What's on your mind?</h1>
                  <p className="text-zinc-500 text-sm max-w-md">
                    Ask KTerminal to check balances, list tokens, get quotes, or propose a trade on Keeta.
                  </p>
                  <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl w-full">
                    {['What\'s my portfolio?', 'List tradable tokens', 'Estimate 1 KTA to USDC', 'Propose 0.1 KTA for USDC'].map((q) => (
                      <button
                        key={q}
                        onClick={() => setInput(q)}
                        className="px-4 py-3 rounded-xl bg-[#141416] border border-zinc-800 hover:border-purple-600 text-zinc-300 text-sm text-left transition"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="max-w-3xl mx-auto px-6 py-8 space-y-5">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] ${m.role === 'user' ? 'bg-[#4C1D95] text-white' : 'bg-[#141416] border border-zinc-800 text-[#F7F7F7]'} rounded-2xl px-4 py-3`}>
                        {m.role === 'assistant' && (
                          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Agent</div>
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
                      <div className="bg-[#141416] border border-zinc-800 rounded-2xl px-4 py-3">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-zinc-800/80 p-4 bg-[#09090B]">
              <div className="max-w-3xl mx-auto">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!input.trim() || loading) return;
                    sendMessage({ text: input });
                    setInput('');
                  }}
                  className="flex gap-2 items-end bg-[#141416] border border-zinc-800 rounded-2xl px-4 py-3 focus-within:border-purple-600 transition"
                >
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (input.trim() && !loading) {
                          sendMessage({ text: input });
                          setInput('');
                        }
                      }
                    }}
                    placeholder="Ask anything..."
                    rows={1}
                    className="flex-1 bg-transparent resize-none outline-none text-sm text-[#F7F7F7] placeholder-zinc-500 max-h-40"
                  />
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="px-4 py-2 rounded-xl bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-40 text-sm font-medium text-white shrink-0"
                  >
                    Send
                  </button>
                </form>
                <p className="text-[10px] text-zinc-600 mt-2 text-center">
                  {unlock.unlocked ? `Unlocked · ${unlock.address?.slice(0, 10)}…` : 'Wallet locked — unlock in sidebar to trade'}
                  {cfg ? ` · ${cfg.model}` : ''}
                </p>
              </div>
            </div>
          </>
        )}

        {view === 'wallet' && (
          <div className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full">
            <h1 className="text-2xl font-bold mb-6">Wallet</h1>
            <div className="space-y-4">
              <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
                <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Address</div>
                <div className="font-mono text-sm break-all">{unlock.address || 'No wallet yet'}</div>
              </div>
              <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
                <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">Balances</div>
                {state?.balances?.length ? (
                  <div className="space-y-2">
                    {state.balances.map((b, i) => (
                      <div key={i} className="flex justify-between items-center bg-[#09090B] rounded-lg px-3 py-2">
                        <span className="font-mono text-xs text-zinc-400">{b.token.slice(0, 14)}…</span>
                        <span className="font-mono text-sm text-emerald-300">{b.display}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">No balances.</p>
                )}
              </div>
              <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
                <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">Unlock / Create</div>
                <form onSubmit={doUnlock} className="flex flex-col gap-2">
                  <div className="flex gap-1 text-xs">
                    <button type="button" onClick={() => setMode('unlock')} className={`flex-1 py-1.5 rounded ${mode === 'unlock' ? 'bg-[#4C1D95] text-white' : 'bg-zinc-800 text-zinc-400'}`}>Unlock</button>
                    <button type="button" onClick={() => setMode('create')} className={`flex-1 py-1.5 rounded ${mode === 'create' ? 'bg-[#4C1D95] text-white' : 'bg-zinc-800 text-zinc-400'}`}>Create</button>
                  </div>
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder={mode === 'create' ? 'choose a strong passphrase' : 'passphrase'}
                    className="px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 text-sm focus:outline-none focus:border-purple-600"
                  />
                  <button disabled={busy} className="px-3 py-2.5 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-50 text-sm font-medium text-white">
                    {busy ? '…' : mode === 'create' ? 'Create wallet' : 'Unlock'}
                  </button>
                  {msg && <p className="text-xs text-red-400">{msg}</p>}
                </form>
                {unlock.unlocked && (
                  <button onClick={lock} className="mt-3 w-full px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">Lock wallet</button>
                )}
              </div>
            </div>
          </div>
        )}

        {view === 'trade' && (
          <div className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full">
            <h1 className="text-2xl font-bold mb-6">Trade</h1>
            <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5 mb-4">
              <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Daily cap</div>
              <div className="text-2xl font-bold">${cap ? cap.spentUsd.toFixed(2) : '0.00'} <span className="text-sm text-zinc-500 font-normal">/ ${cap ? cap.capUsd : 100}</span></div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-3">
                <div className="h-full bg-gradient-to-r from-purple-600 to-indigo-500 transition-all" style={{ width: `${cap ? Math.min(100, (cap.spentUsd / cap.capUsd) * 100) : 0}%` }} />
              </div>
            </div>
            <p className="text-sm text-zinc-400">Use the chat to propose trades. Every trade requires confirmation before execution.</p>
          </div>
        )}

        {view === 'automations' && (
          <div className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full">
            <h1 className="text-2xl font-bold mb-2">Automations</h1>
            <p className="text-sm text-zinc-400">Scheduled and conditional trades. Coming soon.</p>
          </div>
        )}

        {view === 'settings' && (
          <div className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full">
            <h1 className="text-2xl font-bold mb-6">Settings</h1>
            <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Model</div>
                  <div className="text-xs text-zinc-500">{cfg ? `${cfg.type} · ${cfg.model}` : 'Not configured'}</div>
                </div>
                <button onClick={openSetup} className="px-3 py-1.5 rounded-lg bg-[#4C1D95] hover:bg-purple-700 text-sm text-white">Configure</button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Network</div>
                  <div className="text-xs text-zinc-500">mainnet (Keeta)</div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Daily cap</div>
                  <div className="text-xs text-zinc-500">${cap ? cap.capUsd : 100} USD</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {setupOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={saveSetup} className="bg-[#141416] border border-zinc-800 rounded-2xl p-7 w-full max-w-lg flex flex-col gap-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-800 flex items-center justify-center font-bold text-white">K</div>
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
                      ? 'bg-[#4C1D95] border-purple-500 text-white'
                      : 'bg-[#09090B] border-zinc-800 text-zinc-300 hover:border-zinc-600'
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
                  <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 focus:outline-none focus:border-purple-600" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-zinc-400">API key</span>
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." className="px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 focus:outline-none focus:border-purple-600" />
                </label>
              </div>
            )}
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-zinc-400">Model</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} className="px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 focus:outline-none focus:border-purple-600" />
            </label>
            <div className="flex gap-2 justify-end pt-2">
              {cfg && <button type="button" onClick={() => { clearSetup(); }} className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">Clear</button>}
              <button type="button" onClick={() => setSetupOpen(false)} className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#4C1D95] hover:bg-purple-700 text-sm font-medium text-white">Save & close</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
