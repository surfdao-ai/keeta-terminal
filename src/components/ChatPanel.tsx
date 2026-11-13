'use client';

import { useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import ToolCard from '@/components/ToolCard';

export interface PanelProviderConfig {
  type: 'gateway' | 'openai-compatible';
  model: string;
  baseUrl?: string;
  apiKey?: string;
  name?: string;
}

interface ChatPanelProps {
  chatId: string;
  initialMessages: UIMessage[];
  providerConfig: PanelProviderConfig | null;
  /** The wallet seed, sent with the request that needs a signature. */
  seed: string | null;
  cap: { spentUsd: number; capUsd: number } | null;
  unlocked: boolean;
  address: string | null;
  modelLabel: string;
  onSaved: (chat: { id: string; title: string; updatedAt: string }) => void;
  onConfirm: (tradeId: string, setter: (r: unknown) => void) => void;
}

export default function ChatPanel({
  chatId,
  initialMessages,
  providerConfig,
  seed,
  cap,
  unlocked,
  address,
  modelLabel,
  onSaved,
  onConfirm,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = new DefaultChatTransport({
    api: '/api/chat',
    prepareSendMessagesRequest: ({ messages }) => ({
      body: {
        messages,
        providerConfig: providerConfig ?? undefined,
        seed: seed ?? undefined,
      },
    }),
  });

  const { messages, sendMessage, status, error } = useChat({
    transport,
    messages: initialMessages,
    onFinish: ({ messages: finished }) => {
      fetch('/api/chats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: chatId, messages: finished }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j?.chat) onSaved(j.chat);
        })
        .catch(() => undefined);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status]);

  const loading = status === 'streaming' || status === 'submitted';

  return (
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
                  <div className="text-zinc-500">
                    agent <span className="text-emerald-400">online</span> · wallet{' '}
                    <span className={unlocked ? 'text-emerald-400' : 'text-amber-400'}>
                      {unlocked ? 'unlocked' : 'locked'}
                    </span>{' '}
                    · model <span className="text-zinc-400">{modelLabel}</span>
                  </div>
                  <div className="mt-3 text-zinc-400">
                    <span className="text-purple-400">&gt;</span>{' '}
                    <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse align-middle" />
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
            <div className="bg-[#0d0d10] border border-zinc-800 rounded-lg overflow-hidden shadow-[0_0_60px_-20px_rgba(76,29,149,0.5)]">
              <div className="p-4 font-mono text-[13px] leading-relaxed">
                {messages.map((m) => (
                  <div key={m.id} className="mb-3">
                    {m.role === 'user' ? (
                      <div className="flex gap-2">
                        <span className="text-purple-400 select-none">&gt;</span>
                        <span className="text-[#F7F7F7] whitespace-pre-wrap break-words">
                          {m.parts
                            .filter((p) => p.type === 'text')
                            .map((p) => (p as { text: string }).text)
                            .join(' ')}
                        </span>
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
                                onConfirm={onConfirm}
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
                {!loading && !error && (
                  <div className="flex gap-2">
                    <span className="text-purple-400 select-none">&gt;</span>
                    <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse align-middle" />
                  </div>
                )}
                {error && (
                  <div className="flex gap-2">
                    <span className="text-red-500 select-none">!</span>
                    <span className="text-red-400 whitespace-pre-wrap break-words">
                      {error.message}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-zinc-800/80 p-3 sm:p-4 bg-[#09090B] pb-[calc(0.75rem+env(safe-area-inset-bottom,0px)+var(--kb,0px))] sm:pb-[calc(1rem+env(safe-area-inset-bottom,0px)+var(--kb,0px))]">
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
            {unlocked ? `wallet ${address?.slice(0, 12)}… unlocked` : 'wallet locked — unlock in sidebar to trade'}
            {modelLabel ? ` · ${modelLabel}` : ' · no model configured'}
            {cap ? ` · cap ${cap.spentUsd.toFixed(2)}/${cap.capUsd}` : ''}
          </p>
        </div>
      </div>
    </>
  );
}
