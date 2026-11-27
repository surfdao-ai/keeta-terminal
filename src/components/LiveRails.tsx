'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client/api';

interface Direction {
  from: string;
  to: string;
  fromAddress: string;
  toAddress: string;
  live: boolean;
  rate: string | null;
  fee: string | null;
}

interface Rails {
  asOf: string;
  provider: string;
  directions: Direction[];
  fromFallback: boolean;
}

interface LiveRailsProps {
  /** Fire the normal quickBuy → prepare → confirm → sign flow for a direction. */
  onTrade: (from: string, to: string, amount: number) => void;
}

/**
 * "Live rails": the pairs a provider is actually quoting right now. Keeta has
 * no DEX, so this is the honest view of what is tradeable. A live row is
 * one-tap into the normal propose → confirm → sign flow — no new signing path.
 */
export default function LiveRails({ onTrade }: LiveRailsProps) {
  const [rails, setRails] = useState<Rails | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('10');
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await apiFetch('/api/rails');
      if (r.ok) setRails((await r.json()) as Rails);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live = (rails?.directions ?? []).filter((d) => d.live);
  const quietCount = (rails?.directions ?? []).length - live.length;

  async function trade(d: Direction) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    setBusy(`${d.from}>${d.to}`);
    try {
      onTrade(d.from, d.to, n);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5 mb-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs text-zinc-500 uppercase tracking-wider">Live rails</div>
        <button onClick={() => void load()} className="text-[11px] font-mono text-purple-300 hover:text-purple-200">
          ↻ refresh
        </button>
      </div>
      <div className="text-sm text-zinc-400">
        {loading ? (
          <span className="animate-pulse">checking the anchor…</span>
        ) : live.length > 0 ? (
          <>
            {live.length} direction{live.length === 1 ? '' : 's'} a provider is quoting right now
            {quietCount > 0 && <span className="text-zinc-600"> · {quietCount} quiet</span>}
          </>
        ) : (
          <span className="text-amber-400">no pair has a live quote right now — nothing is executable</span>
        )}
      </div>

      {!loading && live.length > 0 && (
        <div className="mt-4 space-y-2">
          {live.map((d) => (
            <div
              key={`${d.from}>${d.to}`}
              className="flex items-center gap-3 bg-[#0d0d10] border border-zinc-800 rounded-lg px-3 py-2"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" title="live binding quote" />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[13px] text-zinc-100">
                  {d.from} <span className="text-zinc-600">→</span> {d.to}
                </div>
                <div className="font-mono text-[10px] text-zinc-500">
                  {d.rate ? `${d.rate} ${d.to}/1 ${d.from}` : ''}
                  {d.fee ? ` · fee ${d.fee} ${d.from}` : ''}
                </div>
              </div>
              <input
                type="number"
                min="0"
                step="0.5"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-label={`amount in ${d.from}`}
                className="w-20 px-2 py-1 rounded-md bg-[#09090B] border border-zinc-700 font-mono text-[12px] text-right focus:outline-none focus:border-purple-600"
              />
              <button
                disabled={busy === `${d.from}>${d.to}`}
                onClick={() => void trade(d)}
                className="px-2.5 py-1 font-mono text-[12px] rounded-md bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-50 text-white"
              >
                {busy === `${d.from}>${d.to}` ? '…' : 'trade'}
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <p className="mt-3 text-[11px] text-zinc-600">
          Keeta has no DEX — only these have a live binding quote. Tapping trade runs the usual
          confirm-and-sign step, so the daily cap still applies.
        </p>
      )}
    </div>
  );
}
