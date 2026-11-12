'use client';

import { useState, useEffect, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import ToolCard from '@/components/ToolCard';
import PwaRegister, { type BeforeInstallPromptEvent } from '@/components/PwaRegister';

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
  const [navOpen, setNavOpen] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

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
    <div className="flex h-[100dvh] bg-[#09090B] text-[#F7F7F7]">
      {/* mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 h-12 flex items-center gap-3 px-3 bg-[#141416]/95 backdrop-blur border-b border-zinc-800/80 pt-[env(safe-area-inset-top)]">
        <button
          onClick={() => setNavOpen(!navOpen)}
          aria-label="Toggle navigation"
          className="w-9 h-9 flex items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 active:bg-zinc-800"
        >
          ☰
        </button>
        <span className="font-mono text-[13px] font-semibold">kterminal</span>
        <span className="ml-auto font-mono text-[10px] text-zinc-500 truncate max-w-[45%]">
          {unlock.unlocked ? 'wallet unlocked' : 'wallet locked'}
        </span>
      </div>

      {/* mobile backdrop */}
      {navOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/60"
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* sidebar */}
      <aside
        className={`${sidebarOpen ? 'md:w-[250px]' : 'md:w-16'} w-[250px] shrink-0 border-r border-zinc-800/80 bg-[#141416] flex flex-col transition-all duration-200 fixed md:static inset-y-0 left-0 z-40 md:z-auto pt-12 md:pt-0 ${navOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        <div className="h-14 flex items-center px-4 border-b border-zinc-800/80 gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-800 flex items-center justify-center font-bold text-white text-sm shrink-0">K</div>
          {sidebarOpen && <span className="font-mono text-[13px] font-semibold tracking-tight">kterminal</span>}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="ml-auto font-mono text-[11px] text-zinc-600 hover:text-white">
            {sidebarOpen ? '[–]' : '[+]'}
          </button>
        </div>

        <button
          onClick={() => { setView('chat'); setNavOpen(false); }}
          className="mx-3 mt-3 px-3 py-2 rounded-lg bg-purple-900/40 border border-purple-700/60 font-mono text-[13px] text-purple-200 hover:bg-purple-900/60 flex items-center gap-2"
        >
          <span className="text-purple-400">+</span>
          {sidebarOpen && <span>new chat</span>}
        </button>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {sidebarOpen && <div className="px-2 pb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-700">workspace</div>}
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => { setView(n.id); setNavOpen(false); }}
              className={`w-full px-3 py-2 rounded-lg font-mono text-[13px] flex items-center gap-3 transition ${
                view === n.id
                  ? 'bg-[#4C1D95] text-white'
                  : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
              }`}
            >
              <span className="w-4 text-center text-[11px]">{n.icon}</span>
              {sidebarOpen && <span>{n.label.toLowerCase()}</span>}
            </button>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-zinc-800/80 font-mono text-[11px] text-zinc-600 space-y-1 pb-[env(safe-area-inset-bottom)]">
          {sidebarOpen && (
            <>
              {installEvent && (
                <button
                  onClick={async () => {
                    await installEvent.prompt();
                    await installEvent.userChoice;
                    setInstallEvent(null);
                  }}
                  className="w-full mb-2 px-2 py-1.5 rounded bg-purple-900/40 border border-purple-700/60 text-purple-200"
                >
                  install app
                </button>
              )}
              <a href="https://docs.keeta.com" target="_blank" rel="noreferrer" className="block hover:text-zinc-300">docs</a>
              <a href="https://github.com/surfdao-ai/keeta-terminal" target="_blank" rel="noreferrer" className="block hover:text-zinc-300">github</a>
              <div className="pt-1 text-zinc-700">v1.0.0 · keeta mainnet</div>
            </>
          )}
        </div>
      </aside>

      {/* main */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#09090B] pt-12 md:pt-0">
        {view === 'chat' && (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center px-6">
                  <div className="w-full max-w-2xl">
                    <div className="bg-[#0d0d10] border border-zinc-800 rounded-lg overflow-hidden shadow-[0_0_60px_-20px_rgba(76,29,149,0.5)]">
                      <div className="flex items-center gap-2 px-4 py-2 bg-[#141416] border-b border-zinc-800">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                        <span className="ml-3 font-mono text-[11px] text-zinc-500">kterminal — keeta:agent</span>
                      </div>
                      <div className="p-5 font-mono text-[13px] leading-relaxed">
                        <div className="text-zinc-500">KTerminal v1.0 — keeta mainnet</div>
                        <div className="text-zinc-500">agent <span className="text-emerald-400">online</span> · wallet <span className={unlock.unlocked ? 'text-emerald-400' : 'text-amber-400'}>{unlock.unlocked ? 'unlocked' : 'locked'}</span> · model <span className="text-zinc-400">{cfg ? cfg.model : 'not configured'}</span></div>
                        <div className="mt-3 text-zinc-400">
                          <span className="text-purple-400">&gt;</span> <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse align-middle" />
                        </div>
                      </div>
                    </div>
                    <h1 className="mt-8 text-center text-3xl font-bold tracking-tight">What&apos;s on your mind?</h1>
                    <p className="mt-2 text-center text-sm text-zinc-500">
                      Check balances, list tokens, get quotes, or propose a trade on Keeta.
                    </p>
                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {['portfolio', 'list tokens', 'estimate 1 KTA to USDC', 'propose 0.1 KTA for USDC'].map((q) => (
                        <button
                          key={q}
                          onClick={() => setInput(q)}
                          className="font-mono text-[12px] px-4 py-2.5 rounded-lg bg-[#141416] border border-zinc-800 hover:border-purple-600 text-zinc-400 hover:text-zinc-200 text-left transition"
                        >
                          <span className="text-purple-400">&gt;</span> {q}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="max-w-4xl mx-auto px-3 sm:px-5 py-4 sm:py-6">
                  {/* terminal window chrome */}
                  <div className="bg-[#0d0d10] border border-zinc-800 rounded-lg overflow-hidden shadow-[0_0_60px_-20px_rgba(76,29,149,0.5)]">
                    <div className="flex items-center gap-2 px-4 py-2 bg-[#141416] border-b border-zinc-800">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                      <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                      <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                      <span className="ml-3 font-mono text-[11px] text-zinc-500">kterminal — keeta:agent</span>
                      <span className="ml-auto font-mono text-[11px] text-zinc-600">
                        {cap ? `cap ${cap.spentUsd.toFixed(2)}/${cap.capUsd}` : 'cap 0.00/100'}
                      </span>
                    </div>
                    <div className="p-4 font-mono text-[13px] leading-relaxed">
                      {messages.map((m) => (
                        <div key={m.id} className="mb-3">
                          {m.role === 'user' ? (
                            <div className="flex gap-2">
                              <span className="text-purple-400 select-none">&gt;</span>
                              <span className="text-[#F7F7F7] whitespace-pre-wrap break-words">{m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join(' ')}</span>
                            </div>
                          ) : (
                            <div>
                              {m.parts.map((part, i) => {
                                if (part.type === 'text') {
                                  const txt = (part as { text: string }).text;
                                  if (!txt.trim()) return null;
                                  return (
                                    <div key={i} className="flex gap-2">
                                      <span className="text-emerald-500 select-none">◆</span>
                                      <span className="text-zinc-200 whitespace-pre-wrap break-words">{txt}</span>
                                    </div>
                                  );
                                }
                                if (part.type.startsWith('tool-')) {
                                  const toolName = part.type.slice(5);
                                  const st = (part as { state?: string }).state;
                                  const inp = (part as { input?: unknown }).input;
                                  const out = (part as { output?: unknown }).output;
                                  return (
                                    <ToolCard
                                      key={i}
                                      name={toolName}
                                      state={st}
                                      input={inp}
                                      output={out}
                                      onConfirm={confirmTrade}
                                    />
                                  );
                                }
                                return null;
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                      {loading && (
                        <div className="flex gap-2">
                          <span className="text-emerald-500 select-none">◆</span>
                          <span className="text-zinc-500">
                            running<span className="animate-pulse">_</span>
                          </span>
                        </div>
                      )}
                      {!loading && (
                        <div className="flex gap-2">
                          <span className="text-purple-400 select-none">&gt;</span>
                          <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse align-middle" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-zinc-800/80 p-3 sm:p-4 bg-[#09090B] pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-4">
              <div className="max-w-4xl mx-auto">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!input.trim() || loading) return;
                    sendMessage({ text: input });
                    setInput('');
                  }}
                  className="flex gap-2 items-end bg-[#0d0d10] border border-zinc-800 rounded-lg px-4 py-3 focus-within:border-purple-600 transition font-mono"
                >
                  <span className="text-purple-400 select-none leading-6">&gt;</span>
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
                    className="flex-1 bg-transparent resize-none outline-none text-[13px] text-[#F7F7F7] placeholder-zinc-600 max-h-40"
                  />
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="px-3 py-1.5 rounded bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-40 text-[12px] font-medium text-white shrink-0"
                  >
                    send
                  </button>
                </form>
                <p className="font-mono text-[10px] text-zinc-700 mt-2 text-center">
                  {unlock.unlocked ? `wallet ${unlock.address?.slice(0, 12)}… unlocked` : 'wallet locked — unlock in sidebar to trade'}
                  {cfg ? ` · ${cfg.model}` : ' · no model configured'}
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

      <PwaRegister onInstallPrompt={setInstallEvent} />
    </div>
  );
}
