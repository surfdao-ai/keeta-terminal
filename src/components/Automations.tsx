'use client';

import { useCallback, useEffect, useState } from 'react';

interface Automation {
  id: string;
  kind: 'alert' | 'recurring';
  name: string;
  enabled: boolean;
  createdAt: string;
  symbol?: string;
  op?: 'gt' | 'lt';
  valueUsd?: number;
  lastCheckedAt?: string;
  lastPriceUsd?: number;
  triggeredAt?: string;
  triggered?: boolean;
  fromToken?: string;
  toToken?: string;
  amount?: string;
  everyMinutes?: number;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: string;
  lastMessage?: string;
}

interface LogEntry {
  id: string;
  at: string;
  kind: string;
  status: string;
  message: string;
}

/** Small trash can used by the watchlist. */
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

interface WatchEntry {
  id: string;
  symbol: string;
  address?: string;
  label?: string;
  lastPriceUsd?: number;
  lastChange24hPct?: number | null;
  lastCheckedAt?: string;
  createdAt: string;
}

interface WalletInfo {
  address: string | null;
  createdAt?: string;
}

interface Props {
  unlocked: boolean;
  /** The wallet seed, sent with the requests that authorise spending. */
  seed: string | null;
  onNotice: (msg: string) => void;
}

export default function Automations({ unlocked, seed, onNotice }: Props) {
  const [list, setList] = useState<Automation[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [wallet, setWallet] = useState<WalletInfo>({ address: null });
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [minEvery, setMinEvery] = useState(15);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  const [watch, setWatch] = useState<WatchEntry[]>([]);
  const [watchSymbol, setWatchSymbol] = useState('KTA');
  const [watchBusy, setWatchBusy] = useState(false);

  const [kind, setKind] = useState<'alert' | 'recurring'>('alert');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('KTA');
  const [op, setOp] = useState<'gt' | 'lt'>('gt');
  const [valueUsd, setValueUsd] = useState('1');
  const [fromToken, setFromToken] = useState('USDC');
  const [toToken, setToToken] = useState('KTA');
  const [amount, setAmount] = useState('5');
  const [everyMinutes, setEveryMinutes] = useState('60');

  const load = useCallback(async () => {
    const r = await fetch('/api/automations');
    if (!r.ok) return;
    const j = await r.json();
    setList(j.automations ?? []);
    setLog(j.log ?? []);
    setWallet(j.wallet ?? { address: null });
    setKeyConfigured(Boolean(j.automationKeyConfigured));
    setMinEvery(j.minEveryMinutes ?? 15);

    const w = await fetch('/api/watchlist');
    if (w.ok) {
      const wj = await w.json();
      setWatch(wj.watchlist ?? []);
    }
  }, []);

  useEffect(() => {
    // Deferred so the effect body itself does not set state synchronously.
    const first = setTimeout(() => {
      void load();
    }, 0);
    const t = setInterval(() => {
      void load();
    }, 20000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload =
        kind === 'alert'
          ? { kind, name, symbol, op, valueUsd: Number(valueUsd) }
          : { kind, name, fromToken, toToken, amount, everyMinutes: Number(everyMinutes) };
      const r = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, seed }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setName('');
      await load();
      onNotice(`ok  created ${kind}`);
    } catch (err) {
      onNotice(`err  ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string) {
    const r = await fetch('/api/automations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'toggle', id, seed }),
    });
    const j = await r.json();
    if (!r.ok) return onNotice(`err  ${j.error}`);
    await load();
  }

  async function remove(id: string) {
    const r = await fetch('/api/automations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id, seed }),
    });
    const j = await r.json();
    if (!r.ok) return onNotice(`err  ${j.error}`);
    await load();
  }

  async function watchAction(action: 'add' | 'remove' | 'refresh', extra: Record<string, string> = {}) {
    setWatchBusy(true);
    try {
      const r = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      if (j.watchlist) setWatch(j.watchlist);
      else await load();
      return true;
    } catch (err) {
      onNotice(`err  ${(err as Error).message}`);
      return false;
    } finally {
      setWatchBusy(false);
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const r = await fetch('/api/automations/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed }),
    });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      onNotice(`ok  checked ${j.checked} · triggered ${j.triggered} · executed ${j.executed} · failed ${j.failed}`);
      await load();
    } catch (err) {
      onNotice(`err  ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  async function createWallet() {
    const r = await fetch('/api/automations/wallet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed }),
    });
    const j = await r.json();
    if (!r.ok) return onNotice(`err  ${j.error}`);
    await load();
    onNotice('ok  automation wallet created — fund it to enable swaps');
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* watchlist */}
      <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-mono text-[13px] font-semibold">watchlist</h2>
          <button
            onClick={() => watchAction('refresh')}
            disabled={watchBusy || !watch.length}
            className="font-mono text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40"
          >
            {watchBusy ? '...' : 'refresh prices'}
          </button>
        </div>

        {watch.length === 0 ? (
          <p className="text-[11px] text-zinc-600">
            Nothing watched yet. Add a ticker (KTA, USDC) or a token address — prices come from the free
            Keeta reads.
          </p>
        ) : (
          <div className="space-y-1.5">
            {watch.map((w) => (
              <div key={w.id} className="flex items-center gap-3 bg-[#09090B] rounded-lg px-3 py-2">
                <span className="font-mono text-[13px] text-zinc-200 w-20 truncate">{w.symbol}</span>
                <span className="font-mono text-[13px] text-emerald-300">
                  {w.lastPriceUsd !== undefined ? `$${w.lastPriceUsd.toFixed(5)}` : '—'}
                </span>
                <span
                  className={`font-mono text-[11px] ${
                    (w.lastChange24hPct ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-400'
                  }`}
                >
                  {w.lastChange24hPct !== undefined && w.lastChange24hPct !== null
                    ? `${w.lastChange24hPct >= 0 ? '+' : ''}${w.lastChange24hPct.toFixed(2)}%`
                    : ''}
                </span>
                <span className="ml-auto font-mono text-[10px] text-zinc-600">
                  {w.lastCheckedAt ? new Date(w.lastCheckedAt).toISOString().slice(11, 16) : ''}
                </span>
                <button
                  onClick={() => {
                    setKind('alert');
                    setSymbol(w.symbol);
                    setName(`${w.symbol} alert`);
                    document.getElementById('new-automation')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="shrink-0 font-mono text-[10px] px-1.5 py-1 rounded border border-zinc-800 text-zinc-500 hover:border-purple-700 hover:text-purple-300"
                >
                  alert
                </button>
                <button
                  onClick={() => watchAction('remove', { id: w.id })}
                  aria-label={`stop watching ${w.symbol}`}
                  className="shrink-0 p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-950/40"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        )}

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await watchAction('add', { symbol: watchSymbol })) setWatchSymbol('');
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={watchSymbol}
            onChange={(e) => setWatchSymbol(e.target.value)}
            placeholder="KTA, USDC or a token address"
            className="flex-1 px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-[13px] text-[#F7F7F7] focus:outline-none focus:border-purple-600"
          />
          <button
            disabled={watchBusy || !watchSymbol.trim()}
            className="shrink-0 px-3 py-2 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-40 text-[13px] text-white"
          >
            watch
          </button>
        </form>
      </div>

      {/* automation wallet */}
      <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-mono text-[13px] font-semibold">automation wallet</h2>
          <span className="font-mono text-[10px] text-zinc-600">
            {keyConfigured ? 'key configured' : 'AUTOMATION_KEY missing'}
          </span>
        </div>
        {wallet.address ? (
          <div className="space-y-2">
            <div className="font-mono text-[11px] text-zinc-400 break-all">{wallet.address}</div>
            <p className="text-[11px] text-zinc-600">
              Unattended swaps run from this wallet only. Fund it with a small amount — that balance is the hard
              ceiling on what any automation can move.
            </p>
            <button
              onClick={() => navigator.clipboard?.writeText(wallet.address!)}
              className="px-2 py-1 font-mono text-[11px] rounded bg-zinc-800 hover:bg-zinc-700"
            >
              copy address
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-zinc-600">
              A separate account for scheduled swaps. Its seed is encrypted with the server key; your main wallet is
              never used for unattended execution.
            </p>
            <button
              onClick={createWallet}
              disabled={!keyConfigured}
              className="shrink-0 px-3 py-1.5 font-mono text-[12px] rounded bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-40 text-white"
            >
              create
            </button>
          </div>
        )}
      </div>

      {/* create */}
      <div id="new-automation" className="bg-[#141416] border border-zinc-800 rounded-2xl p-5 scroll-mt-24">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-mono text-[13px] font-semibold">new automation</h2>
          <button
            onClick={runNow}
            disabled={running}
            className="font-mono text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
          >
            {running ? 'running...' : 'run now'}
          </button>
        </div>

        <form onSubmit={create} className="space-y-3">
          <div className="flex gap-1">
            {(['alert', 'recurring'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`px-3 py-1.5 rounded font-mono text-[12px] ${
                  kind === k ? 'bg-[#4C1D95] text-white' : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
            name (optional)
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === 'alert' ? 'KTA above $1' : 'weekly DCA'}
              className="px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-sm text-[#F7F7F7] focus:outline-none focus:border-purple-600"
            />
          </label>

          {kind === 'alert' ? (
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
                token
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-sm focus:outline-none focus:border-purple-600"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
                condition
                <select
                  value={op}
                  onChange={(e) => setOp(e.target.value as 'gt' | 'lt')}
                  className="px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-sm"
                >
                  <option value="gt">above</option>
                  <option value="lt">below</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
                usd
                <input
                  value={valueUsd}
                  onChange={(e) => setValueUsd(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-sm focus:outline-none focus:border-purple-600"
                />
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
                from
                <input
                  value={fromToken}
                  onChange={(e) => setFromToken(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-sm focus:outline-none focus:border-purple-600"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
                to
                <input
                  value={toToken}
                  onChange={(e) => setToToken(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-sm focus:outline-none focus:border-purple-600"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
                amount
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-sm focus:outline-none focus:border-purple-600"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
                every (min)
                <input
                  type="number"
                  min={minEvery}
                  value={everyMinutes}
                  onChange={(e) => setEveryMinutes(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-sm focus:outline-none focus:border-purple-600"
                />
              </label>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              disabled={busy || !unlocked}
              className="px-4 py-2 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-40 text-sm font-medium text-white"
            >
              {busy ? '...' : 'create automation'}
            </button>
            {!unlocked && <span className="font-mono text-[11px] text-amber-400">unlock the wallet first</span>}
          </div>
        </form>
      </div>

      {/* list */}
      <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
        <h2 className="font-mono text-[13px] font-semibold mb-3">automations</h2>
        {list.length === 0 && <p className="text-[12px] text-zinc-600">none yet</p>}
        <div className="space-y-2">
          {list.map((a) => (
            <div key={a.id} className="border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${a.enabled ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                  aria-hidden
                />
                <span className="font-mono text-[12px] text-zinc-200 truncate">{a.name}</span>
                <span className="font-mono text-[10px] text-zinc-600">
                  {a.kind === 'alert'
                    ? `${a.symbol} ${a.op === 'gt' ? '>' : '<'} $${a.valueUsd}`
                    : `${a.amount} ${String(a.fromToken).slice(0, 10)}… → ${String(a.toToken).slice(0, 10)}… every ${a.everyMinutes}m`}
                </span>
                <button
                  onClick={() => toggle(a.id)}
                  className="ml-auto font-mono text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700"
                >
                  {a.enabled ? 'pause' : 'resume'}
                </button>
                <button
                  onClick={() => remove(a.id)}
                  className="font-mono text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-red-900/60"
                >
                  del
                </button>
              </div>
              <div className="mt-1.5 font-mono text-[10px] text-zinc-600 space-y-0.5">
                {a.kind === 'alert' && (
                  <>
                    <div>last price: {a.lastPriceUsd !== undefined ? `$${a.lastPriceUsd}` : '—'}</div>
                    <div>checked: {a.lastCheckedAt ? new Date(a.lastCheckedAt).toLocaleString() : '—'}</div>
                    {a.triggered && (
                      <div className="text-amber-400">triggered: {a.triggeredAt ? new Date(a.triggeredAt).toLocaleString() : ''}</div>
                    )}
                  </>
                )}
                {a.kind === 'recurring' && (
                  <>
                    <div>next: {a.nextRunAt ? new Date(a.nextRunAt).toLocaleString() : '—'}</div>
                    <div>
                      last: {a.lastStatus ?? '—'}
                      {a.lastMessage ? ` · ${a.lastMessage}` : ''}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* log */}
      <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
        <h2 className="font-mono text-[13px] font-semibold mb-3">activity</h2>
        {log.length === 0 && <p className="text-[12px] text-zinc-600">no runs yet</p>}
        <div className="space-y-1 font-mono text-[11px]">
          {log.map((l) => (
            <div key={l.id} className="flex gap-2">
              <span className="text-zinc-600 shrink-0">{new Date(l.at).toLocaleTimeString()}</span>
              <span
                className={
                  l.status === 'executed' || l.status === 'triggered'
                    ? 'text-emerald-400'
                    : l.status === 'failed'
                      ? 'text-red-400'
                      : 'text-zinc-400'
                }
              >
                {l.status}
              </span>
              <span className="text-zinc-400 truncate">{l.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
