'use client';

import { useEffect, useState } from 'react';

interface Launch {
  address: string;
  symbol: string;
  name: string;
  supply: string;
  decimals: number;
  at: string;
}

/**
 * Horizontal ticker that scrolls recent token launches.
 *
 * Simple, performant: duplicates its rows so the scroll can loop seamlessly,
 * and auto-scrolls left at a gentle pace. Hover pauses the scroll.
 */
export default function TokenTicker() {
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/tokens', {
          headers: { accept: 'application/json' },
        });
        if (!r.ok) throw new Error('launches unavailable');
        const j = (await r.json()) as { launches?: Launch[] };
        if (!cancelled) setLaunches(j.launches ?? []);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return null;
  if (!launches.length) return null;

  // Show newest first, cap at 12 so the ticker stays short.
  const items = [...launches].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  ).slice(0, 12);

  // Duplicate rows so the marquee can loop without a visible gap.
  const all = [...items, ...items];

  return (
    <div className="border-t border-zinc-800/60 bg-[#09090B] px-4 py-2 overflow-hidden">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
          new token launches
        </span>
      </div>
      <div
        className="flex items-center gap-4 whitespace-nowrap animate-[marquee_20s_linear_infinite]"
        style={{ animationDuration: `${Math.max(20, items.length * 2)}s` }}
        onMouseEnter={(e) => {
          e.currentTarget.style.animationPlayState = 'paused';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.animationPlayState = 'running';
        }}
      >
        {all.map((l) => (
          <div
            key={`${l.address}-${l.at}`}
            className="flex items-center gap-2 px-2 py-1 rounded-lg bg-[#0d0d10] border border-zinc-800/80 shrink-0"
          >
            <span className="w-7 h-7 rounded bg-gradient-to-br from-purple-700/30 to-indigo-800/30 border border-purple-900/40 flex items-center justify-center font-mono text-[11px] font-bold text-purple-200 shrink-0">
              {l.symbol.slice(0, 3)}
            </span>
            <span className="font-mono text-[11px] text-zinc-200 truncate min-w-[70px]">
              {l.symbol}
            </span>
            <span className="font-mono text-[9px] text-zinc-500">
              {new Date(l.at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
