'use client';

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { UIMessage } from 'ai';
import PwaRegister, { type BeforeInstallPromptEvent } from '@/components/PwaRegister';
import ViewportLock from '@/components/ViewportLock';
import Automations from '@/components/Automations';
import ChatPanel from '@/components/ChatPanel';
import WalletPanel from '@/components/WalletPanel';
import SkillsBrowser from '@/components/SkillsBrowser';
import Positions from '@/components/Positions';
import { readVault } from '@/lib/vault';

type ProviderConfig = {
  type: 'gateway' | 'openai-compatible';
  model: string;
  baseUrl?: string;
  apiKey?: string;
  name?: string;
};

const PRESETS: { id: string; label: string; type: ProviderConfig['type']; baseUrl?: string; name?: string; defaultModel: string }[] = [
  { id: 'groq', label: 'Groq (free tier)', type: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', name: 'groq', defaultModel: 'llama-3.3-70b-versatile' },
  { id: 'free', label: 'Free, no key (Pollinations)', type: 'openai-compatible', baseUrl: 'https://text.pollinations.ai/openai', name: 'pollinations', defaultModel: 'openai-fast' },
  { id: 'vercel', label: 'Vercel AI Gateway', type: 'gateway', defaultModel: 'anthropic/claude-sonnet-4.5' },
  { id: 'vercel-key', label: 'Vercel AI Gateway (your key)', type: 'openai-compatible', baseUrl: 'https://ai-gateway.vercel.sh/v1', name: 'vercel', defaultModel: 'anthropic/claude-sonnet-4.5' },
  { id: 'openrouter', label: 'OpenRouter', type: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', name: 'openrouter', defaultModel: 'openai/gpt-4o-mini' },
  { id: 'together', label: 'Together', type: 'openai-compatible', baseUrl: 'https://api.together.xyz/v1', name: 'together', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { id: 'ollama-cloud', label: 'Ollama Cloud', type: 'openai-compatible', baseUrl: 'https://ollama.com/v1', name: 'ollama-cloud', defaultModel: 'glm-5.3' },
  { id: 'ollama', label: 'Ollama (local)', type: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', name: 'ollama', defaultModel: 'llama3.1' },
  { id: 'lmstudio', label: 'LM Studio (local)', type: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', name: 'lmstudio', defaultModel: 'local-model' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', type: 'openai-compatible', defaultModel: 'gpt-4o-mini' },
];

const STORAGE_KEY = 'keeta-terminal-provider';
const CFG_EVENT = 'kt-provider-config';

/**
 * The provider config lives in localStorage. It is read through
 * useSyncExternalStore so the server render (no localStorage) and the client
 * render agree — reading it into useState inside an effect would flash the
 * "Model setup" dialog on every reload.
 */
let cfgCache: ProviderConfig | null | undefined;

function loadCfg(): ProviderConfig | null {
  if (cfgCache !== undefined) return cfgCache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cfgCache = raw ? (JSON.parse(raw) as ProviderConfig) : null;
  } catch {
    cfgCache = null;
  }
  return cfgCache;
}

function saveCfg(c: ProviderConfig | null): void {
  if (c) localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  else localStorage.removeItem(STORAGE_KEY);
  cfgCache = undefined;
  window.dispatchEvent(new Event(CFG_EVENT));
}

function subscribeCfg(onStoreChange: () => void): () => void {
  const on = () => {
    cfgCache = undefined;
    onStoreChange();
  };
  window.addEventListener('storage', on);
  window.addEventListener(CFG_EVENT, on);
  return () => {
    window.removeEventListener('storage', on);
    window.removeEventListener(CFG_EVENT, on);
  };
}

type View = 'chat' | 'wallet' | 'trade' | 'automations' | 'skills' | 'settings';

/** Small trash can used by the saved-chat list. */
function TrashIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2.5 4.2h11" />
      <path d="M6.4 4.2V3a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v1.2" />
      <path d="M3.8 4.2l.6 8.4a1.2 1.2 0 0 0 1.2 1.1h4.8a1.2 1.2 0 0 0 1.2-1.1l.6-8.4" />
      <path d="M6.6 6.6v4.6M9.4 6.6v4.6" />
    </svg>
  );
}

const NAV: { id: View; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'wallet', label: 'Wallet', icon: '👛' },
  { id: 'trade', label: 'Trade', icon: '⇄' },
  { id: 'automations', label: 'Automations', icon: '⚡' },
  { id: 'skills', label: 'Skills', icon: '📖' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export default function Home() {
  const cfg = useSyncExternalStore(subscribeCfg, loadCfg, () => null);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [setupRequested, setSetupRequested] = useState(false);
  // The dialog opens by itself until the user dismisses it, and can always be
  // reopened from the "Model setup" button.
  const setupOpen = setupRequested || (!cfg && !setupDismissed);
  const [presetId, setPresetId] = useState('groq');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('llama-3.3-70b-versatile');
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');

  const [view, setView] = useState<View>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  const [unlock, setUnlock] = useState({ hasWallet: false, address: null as string | null, unlocked: false });
  /**
   * The wallet seed lives in memory for this session only. It is sent with the
   * requests that need a signature and is never stored on the server.
   */
  const [seed, setSeed] = useState<string | null>(null);
  const [state, setState] = useState<{ balances: { token: string; display: string }[]; cap: { spentUsd: number; capUsd: number } } | null>(null);
  const [capDraft, setCapDraft] = useState<string | null>(null);
  // The input follows the stored cap until the user edits it.
  const capInput = capDraft ?? (state?.cap?.capUsd !== undefined ? String(state.cap.capUsd) : '100');
  const [capSaving, setCapSaving] = useState(false);
  const [capMsg, setCapMsg] = useState('');
  const [notice, setNotice] = useState('');
  const [chats, setChats] = useState<{ id: string; title: string; updatedAt: string }[]>([]);
  const [activeChatId, setActiveChatId] = useState('');
  const [activeMessages, setActiveMessages] = useState<UIMessage[]>([]);


  const refresh = useCallback(async () => {
    const r = await fetch('/api/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed }),
    });
    const j = await r.json();
    setUnlock({ hasWallet: j.hasWallet, address: j.address, unlocked: Boolean(j.unlocked) });
    setState(j);
  }, [seed]);

  async function loadChats() {
    const r = await fetch('/api/chats');
    const j = await r.json();
    setChats(j.chats ?? []);
    return j.chats ?? [];
  }

  async function openChat(id: string) {
    const r = await fetch(`/api/chats?id=${encodeURIComponent(id)}`);
    const j = await r.json();
    setActiveChatId(id);
    setActiveMessages(j.chat?.messages ?? []);
    setView('chat');
    setNavOpen(false);
  }

  /**
   * Start a new chat. It is only written to the server once it has messages,
   * so the sidebar does not fill up with empty "new chat" entries.
   */
  async function newChat() {
    const id = crypto.randomUUID();
    setActiveChatId(id);
    setActiveMessages([]);
    setView('chat');
    setNavOpen(false);
  }

  async function removeChat(id: string) {
    await fetch('/api/chats', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (id === activeChatId) {
      const list = await loadChats();
      if (list.length) {
        await openChat(list[0].id);
      } else {
        await newChat();
      }
    } else {
      await loadChats();
    }
  }

  function handleChatSaved(chat: { id: string; title: string; updatedAt: string }) {
    setChats((prev) => {
      const rest = prev.filter((c) => c.id !== chat.id);
      return [chat, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  // A wallet sealed on this device must be known to the server. If a
  // registration was lost, re-send it on load.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rec = readVault();
      if (!rec?.address) return;
      try {
        const r = await fetch('/api/wallet', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'register', address: rec.address }),
        });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        setUnlock((u) => ({ ...u, address: j.wallet?.address ?? rec.address, hasWallet: true }));
      } catch {
        /* the wallet view offers a retry */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadChats();
      if (cancelled) return;
      if (list.length) {
        const r = await fetch(`/api/chats?id=${encodeURIComponent(list[0].id)}`);
        const j = await r.json();
        if (cancelled) return;
        setActiveChatId(list[0].id);
        setActiveMessages(j.chat?.messages ?? []);
      } else {
        await newChat();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    // The first poll is deferred so the effect body itself does not set
    // state synchronously; the interval keeps the view fresh.
    const first = setTimeout(() => {
      void refresh();
    }, 0);
    const t = setInterval(() => {
      void refresh();
    }, 15000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  async function saveCap(e: React.FormEvent) {
    e.preventDefault();
    setCapSaving(true);
    setCapMsg('');
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dailyCapUsd: Number(capInput), seed }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setCapMsg('ok  cap updated');
      setCapDraft(null);
      await refresh();
    } catch (err) {
      setCapMsg(`err  ${(err as Error).message}`);
    } finally {
      setCapSaving(false);
    }
  }

  // While the app is open, evaluate automations more often than the 15m schedule.
  useEffect(() => {
    if (!unlock.unlocked) return;
    const tick = () => {
      fetch('/api/automations/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seed }),
      }).catch(() => undefined);
    };
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [unlock.unlocked, seed]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  /** Ask the provider which models it serves and offer them in a dropdown. */
  async function loadModels(overrides?: { baseUrl?: string; apiKey?: string; presetId?: string }) {
    const pid = overrides?.presetId ?? presetId;
    const p = PRESETS.find((x) => x.id === pid);
    if (!p || p.type !== 'openai-compatible') {
      setModelOptions([]);
      setModelsError('model listing needs an OpenAI-compatible provider');
      return;
    }
    const url = (overrides?.baseUrl ?? baseUrl).trim() || p.baseUrl || '';
    const key = (overrides?.apiKey ?? apiKey).trim();
    if (!url) {
      setModelsError('base URL required');
      return;
    }
    setModelsLoading(true);
    setModelsError('');
    try {
      const r = await fetch('/api/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseUrl: url, apiKey: key }),
      });
      const j = await r.json();
      if (j.error) {
        setModelOptions([]);
        const needsKey = /401|unauthor|api key/i.test(String(j.error));
        setModelsError(
          needsKey && !key
            ? 'This provider needs an API key — paste it above, then press "load models".'
            : String(j.error),
        );
        return;
      }
      const list: string[] = Array.isArray(j.models) ? j.models : [];
      setModelOptions(list);
      if (list.length === 0) setModelsError('provider returned no models');
    } catch (e) {
      setModelsError((e as Error).message);
    } finally {
      setModelsLoading(false);
    }
  }

  function openSetup() {
    const c = cfg;
    let p = PRESETS[0];
    let b = '';
    let k = '';
    let m = p.defaultModel;
    if (c) {
      p = PRESETS.find((x) => x.baseUrl === c.baseUrl || (c.type === 'gateway' && x.id === 'vercel')) || PRESETS[0];
      b = c.baseUrl || p.baseUrl || '';
      k = c.apiKey || '';
      m = c.model;
    } else {
      b = p.baseUrl || '';
    }
    setPresetId(p.id);
    setBaseUrl(b);
    setApiKey(k);
    setModel(m);
    setModelOptions([]);
    setModelsError('');
    setSetupRequested(true);
    setSetupDismissed(false);
    if (p.type === 'openai-compatible') {
      void loadModels({ baseUrl: b, apiKey: k, presetId: p.id });
    }
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
    saveCfg(c);
    setSetupRequested(false);
    setSetupDismissed(true);
  }

  function clearSetup() {
    saveCfg(null);
    setSetupRequested(true);
    setSetupDismissed(false);
  }


  async function confirmTrade(tradeId: string, setter: (r: unknown) => void) {
    const r = await fetch('/api/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tradeId, seed }),
    });
    const j = await r.json();
    setter(j);
    await refresh();
  }

  const preset = PRESETS.find((x) => x.id === presetId)!;
  const cap = state?.cap;

  return (
    <div className="flex h-full bg-[#09090B] text-[#F7F7F7]">
      {/* mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-50 h-[var(--kt-header-h)] flex items-center gap-3 px-3 bg-[#101012] backdrop-blur border-b border-zinc-700/80 pt-[env(safe-area-inset-top,0px)] shadow-[0_2px_12px_rgba(0,0,0,0.65)]">
        <button
          onClick={() => setNavOpen(!navOpen)}
          aria-label="Toggle navigation"
          className="w-10 h-10 flex items-center justify-center rounded-lg border border-zinc-600 bg-[#1c1c21] text-[17px] text-zinc-100 active:bg-zinc-700 shrink-0"
        >
          ☰
        </button>
        <span className="font-mono text-[14px] font-semibold text-zinc-100">kterminal</span>
        <span className="ml-auto font-mono text-[11px] text-zinc-400 truncate max-w-[45%]">
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
        className={`${sidebarOpen ? 'md:w-[250px]' : 'md:w-16'} w-[250px] shrink-0 border-r border-zinc-800/80 bg-[#141416] flex flex-col transition-all duration-200 fixed md:static inset-y-0 left-0 z-40 md:z-auto pt-[var(--kt-header-h)] md:pt-0 ${navOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        <div className="h-14 flex items-center px-4 border-b border-zinc-800/80 gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-800 flex items-center justify-center font-bold text-white text-sm shrink-0">K</div>
          {sidebarOpen && <span className="font-mono text-[13px] font-semibold tracking-tight">kterminal</span>}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="ml-auto font-mono text-[11px] text-zinc-600 hover:text-white">
            {sidebarOpen ? '[–]' : '[+]'}
          </button>
        </div>

        <button
          onClick={() => { newChat(); }}
          className="mx-3 mt-3 px-3 py-2 rounded-lg bg-purple-900/40 border border-purple-700/60 font-mono text-[13px] text-purple-200 hover:bg-purple-900/60 flex items-center gap-2"
        >
          <span className="text-purple-400">+</span>
          {sidebarOpen && <span>new chat</span>}
        </button>

        {sidebarOpen && (
          <div className="px-3 mt-4">
            <div className="px-2 pb-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-700">chats</div>
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {chats.length === 0 && <div className="px-2 text-[11px] text-zinc-700">no saved chats</div>}
              {chats.map((c) => (
                <div key={c.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => openChat(c.id)}
                    className={`flex-1 text-left px-2 py-1.5 rounded font-mono text-[11px] truncate transition ${
                      c.id === activeChatId
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300'
                    }`}
                    title={c.title}
                  >
                    {c.title}
                  </button>
                  <button
                    onClick={() => removeChat(c.id)}
                    aria-label={`delete chat ${c.title}`}
                    title="delete chat"
                    className="shrink-0 p-1.5 rounded text-zinc-600 hover:text-red-400 hover:bg-red-950/40 active:text-red-400 transition"
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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
              <Link href="/docs" className="block hover:text-zinc-300">docs</Link>
              <a href="https://github.com/surfdao-ai/keeta-terminal" target="_blank" rel="noreferrer" className="block hover:text-zinc-300">github</a>
              <div className="pt-1 text-zinc-700">v1.0.0 · keeta mainnet</div>
            </>
          )}
        </div>
      </aside>

      {/* main */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#09090B] pt-[var(--kt-header-h)] md:pt-0">
        {view === 'chat' && (
          <ChatPanel
            key={activeChatId}
            chatId={activeChatId}
            initialMessages={activeMessages}
            providerConfig={cfg}
            seed={seed}
            cap={cap ?? null}
            unlocked={unlock.unlocked}
            address={unlock.address}
            modelLabel={cfg ? cfg.model : ''}
            onSaved={handleChatSaved}
            onConfirm={confirmTrade}
          />
        )}

        {view === 'wallet' && (
          <div className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full">
            <h1 className="text-2xl font-bold mb-6">Wallet</h1>
            <WalletPanel
              address={unlock.address}
              seed={seed}
              onSeed={setSeed}
              onRegistered={(address) => {
                setUnlock((u) => ({ ...u, address, hasWallet: true }));
                void refresh();
              }}
            />
            {unlock.unlocked && (
              <div className="mt-4">
                <Positions seed={seed} />
              </div>
            )}

            {unlock.unlocked && (
              <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5 mt-4">
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
            )}
          </div>
        )}

        {view === 'skills' && <SkillsBrowser />}

        {view === 'trade' && (
          <div className="flex-1 overflow-y-auto p-8 max-w-2xl mx-auto w-full">
            <h1 className="text-2xl font-bold mb-6">Trade</h1>
            <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5 mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-zinc-500 uppercase tracking-wider">Daily cap</div>
                <button onClick={() => setView('settings')} className="text-[11px] font-mono text-purple-300 hover:text-purple-200">adjust →</button>
              </div>
              <div className="text-2xl font-bold">${cap ? cap.spentUsd.toFixed(2) : '0.00'} <span className="text-sm text-zinc-500 font-normal">/ ${cap ? cap.capUsd : 100}</span></div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-3">
                <div className="h-full bg-gradient-to-r from-purple-600 to-indigo-500 transition-all" style={{ width: `${cap ? Math.min(100, (cap.spentUsd / cap.capUsd) * 100) : 0}%` }} />
              </div>
              <form onSubmit={saveCap} className="mt-4 pt-4 border-t border-zinc-800/80 flex gap-2">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={capInput}
                  onChange={(e) => setCapDraft(e.target.value)}
                  className="w-28 px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-sm focus:outline-none focus:border-purple-600"
                />
                <button disabled={capSaving} className="px-3 py-2 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-50 text-sm text-white">
                  {capSaving ? '...' : 'set cap'}
                </button>
                {capMsg && <span className={`font-mono text-[11px] self-center ${capMsg.startsWith('ok') ? 'text-emerald-400' : 'text-red-400'}`}>{capMsg}</span>}
              </form>
            </div>
            <p className="text-sm text-zinc-400">Use the chat to propose trades. Every trade requires confirmation before execution.</p>
          </div>
        )}

        {view === 'automations' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-8 w-full">
            <h1 className="text-2xl font-bold mb-1">Automations</h1>
            <p className="text-sm text-zinc-500 mb-6">
              Scheduled swaps and price alerts. Keeta has no on-chain scheduler, so these run on a Vercel schedule
              (every 15m) and while the app is open.
            </p>
            <Automations unlocked={unlock.unlocked} seed={seed} onNotice={(m) => setNotice(m)} />
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
                  <div className="text-xs text-zinc-500">
                    ${cap ? cap.spentUsd.toFixed(2) : '0.00'} spent of ${cap ? cap.capUsd : 100} today
                  </div>
                </div>
              </div>
              <form onSubmit={saveCap} className="pt-3 border-t border-zinc-800/80 flex flex-col gap-2">
                <label className="text-xs text-zinc-400">Daily spend cap (USD)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={capInput}
                    onChange={(e) => setCapDraft(e.target.value)}
                    className="flex-1 px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-sm focus:outline-none focus:border-purple-600"
                  />
                  <button
                    disabled={capSaving}
                    className="px-4 py-2 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-50 text-sm font-medium text-white"
                  >
                    {capSaving ? '...' : 'Save'}
                  </button>
                </div>
                {capMsg && <p className={`font-mono text-[11px] ${capMsg.startsWith('ok') ? 'text-emerald-400' : 'text-red-400'}`}>{capMsg}</p>}
                <p className="text-[11px] text-zinc-600">
                  Enforced in code before any swap is signed. Raise it with care — every trade still needs manual confirmation.
                </p>
              </form>
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
                    const sameProvider = baseUrl.trim() === (p.baseUrl || '');
                    setPresetId(p.id);
                    setBaseUrl(p.baseUrl || '');
                    setModel(p.defaultModel);
                    setModelOptions([]);
                    setModelsError('');
                    if (p.type === 'openai-compatible') {
                      void loadModels({
                        baseUrl: p.baseUrl || '',
                        apiKey: sameProvider ? apiKey : '',
                        presetId: p.id,
                      });
                    }
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

            <div className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-400">Model</span>
                {preset.type === 'openai-compatible' && (
                  <button
                    type="button"
                    onClick={() => void loadModels()}
                    disabled={modelsLoading}
                    className="font-mono text-[11px] px-2.5 py-1 rounded border border-zinc-700 text-zinc-300 hover:border-purple-600 hover:text-white disabled:opacity-50"
                  >
                    {modelsLoading ? 'loading…' : 'load models'}
                  </button>
                )}
              </div>

              {modelOptions.length > 0 && (
                <select
                  value={modelOptions.includes(model) ? model : ''}
                  onChange={(e) => setModel(e.target.value)}
                  className="px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 focus:outline-none focus:border-purple-600"
                >
                  <option value="">select a model…</option>
                  {modelOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}

              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="model id (e.g. anthropic/claude-sonnet-4.5)"
                className="px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 focus:outline-none focus:border-purple-600 font-mono text-[13px]"
              />

              {modelsError && <p className="text-[11px] text-amber-400 font-mono">{modelsError}</p>}
              {modelOptions.length > 0 && (
                <p className="text-[11px] text-zinc-600 font-mono">{modelOptions.length} models available</p>
              )}
            </div>
            <div className="flex gap-2 justify-end pt-2">
              {cfg && <button type="button" onClick={() => { clearSetup(); }} className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">Clear</button>}
              <button type="button" onClick={() => { setSetupRequested(false); setSetupDismissed(true); }} className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#4C1D95] hover:bg-purple-700 text-sm font-medium text-white">Save & close</button>
            </div>
          </form>
        </div>
      )}

      {notice && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-[#141416] border border-zinc-700 font-mono text-[12px] text-zinc-200 shadow-xl max-w-[90vw]">
          {notice}
        </div>
      )}

      <PwaRegister onInstallPrompt={setInstallEvent} />
      <ViewportLock />
    </div>
  );
}
