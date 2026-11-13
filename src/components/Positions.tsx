'use client';

import { useCallback, useEffect, useState } from 'react';

interface Position {
  token: string;
  symbol?: string | null;
  amount: string;
  decimals?: number | null;
  priceUsd: number | null;
  valueUsd: number | null;
  avgCostUsd: number | null;
  costUsd: number | null;
  pnlUsd: number | null;
}

interface Result {
  positions: Position[];
  totalValueUsd: number;
  totalCostUsd: number;
  totalPnlUsd: number;
  realisedPnlUsd: number;
  trades: number;
  unpriced: string[];
}

const usd = (n: number | null | undefined, digits = 4): string =>
  n === null || n === undefined ? '—' : `$${n.toFixed(digits)}`;

/** Positions: what you hold, what it is worth, and the PnL against cost. */
export default function Positions({ seed }: { seed: string | null }) {
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!seed) {
      setData(null);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/positions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seed }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setData(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [seed]);

  useEffect(() => {
    // Deferred so the effect body itself does not set state synchronously.
    const first = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(first);
  }, [load]);

  if (!seed) {
    return (
      <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">positions</div>
        <p className="text-[11px] text-zinc-600">Unlock the wallet to see what you hold.</p>
      </div>
    );
  }

  return (
    <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-zinc-500 uppercase tracking-wider">positions</div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="font-mono text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40"
        >
          {loading ? '...' : 'refresh'}
        </button>
      </div>

      {err && <p className="text-[11px] text-red-400 mb-2">{err}</p>}

      {data && data.positions.length === 0 && (
        <p className="text-[11px] text-zinc-600">No balances yet.</p>
      )}

      {data && data.positions.length > 0 && (
        <>
          <div className="space-y-1.5">
            {data.positions.map((p) => (
              <div key={p.token} className="bg-[#09090B] rounded-lg px-3 py-2">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[13px] text-zinc-100 w-24 truncate">
                    {p.symbol || p.token.slice(0, 10)}
                  </span>
                  <span className="font-mono text-[13px] text-zinc-300">{p.amount}</span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {usd(p.priceUsd, 5)}
                  </span>
                  <span className="ml-auto font-mono text-[13px] text-emerald-300">
                    {usd(p.valueUsd, 2)}
                  </span>
                </div>
                <div className="flex items-baseline gap-3 mt-0.5">
                  <span className="font-mono text-[10px] text-zinc-600">
                    cost {p.costUsd !== null ? usd(p.costUsd, 2) : 'no basis'}
                  </span>
                  <span
                    className={`font-mono text-[11px] ${
                      p.pnlUsd === null
                        ? 'text-zinc-600'
                        : p.pnlUsd >= 0
                          ? 'text-emerald-400'
                          : 'text-red-400'
                    }`}
                  >
                    {p.pnlUsd === null ? 'pnl —' : `pnl ${p.pnlUsd >= 0 ? '+' : ''}${usd(p.pnlUsd, 2)}`}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 pt-3 border-t border-zinc-800/80 font-mono text-[11px] text-zinc-400 space-y-1">
            <div className="flex justify-between">
              <span>value</span>
              <span className="text-emerald-300">{usd(data.totalValueUsd, 2)}</span>
            </div>
            <div className="flex justify-between">
              <span>cost basis</span>
              <span>{usd(data.totalCostUsd, 2)}</span>
            </div>
            <div className="flex justify-between">
              <span>unrealised</span>
              <span className={data.totalPnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {data.totalPnlUsd >= 0 ? '+' : ''}
                {usd(data.totalPnlUsd, 2)}
              </span>
            </div>
            <div className="flex justify-between text-zinc-600">
              <span>realised · {data.trades} trades</span>
              <span>
                {data.realisedPnlUsd >= 0 ? '+' : ''}
                {usd(data.realisedPnlUsd, 2)}
              </span>
            </div>
          </div>

          {data.unpriced.length > 0 && (
            <p className="mt-2 text-[10px] text-zinc-600">
              no cost basis for {data.unpriced.length} token(s) — funded from another wallet
            </p>
          )}
        </>
      )}
    </div>
  );
}
