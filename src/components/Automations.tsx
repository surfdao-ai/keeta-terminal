'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { generateSeedOnDevice, addressFromSeedOnDevice } from '@/lib/keeta/device';
import { readVault, withAutomationWallet } from '@/lib/vault';

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

interface PendingProposal {
  id: string;
  kind: string;
  fromToken: string;
  toToken: string;
  amount: string;
  expiresAt: number;
}

interface WalletInfo {
  address: string | null;
  createdAt?: string;
}

interface Props {
  unlocked: boolean;
  onNotice: (msg: string) => void;
  /** Approve and sign a proposal in the browser. */
  onSignProposal: (tradeId: string) => Promise<void>;
  /** A new automation wallet was created in this browser. */
  onAutomationWallet?: (seed: string, address: string) => void;
}

export default function Automations({
  unlocked,
  onNotice,
  onSignProposal,
  onAutomationWallet,
}: Props) {
  const [list, setList] = useState<Automation[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [wallet, setWallet] = useState<WalletInfo>({ address: null });
  const [minEvery, setMinEvery] = useState(15);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  const [watch, setWatch] = useState<WatchEntry[]>([]);
  const [pending, setPending] = useState<PendingProposal[]>([]);
  /** The seed of the automation wallet just created — shown once to back up. */
  const [newAutomationSeed, setNewAutomationSeed] = useState('');
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
    const r = await apiFetch('/api/automations');
    if (!r.ok) return;
    const j = await r.json();
    setList(j.automations ?? []);
    setPending(j.pending ?? []);
    setLog(j.log ?? []);
    setWallet(j.wallet ?? { address: null });
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
      const r = await apiFetch('/api/automations', {
        method: 'POST',
        json: payload,
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
    const r = await apiFetch('/api/automations', {
      method: 'POST',
      json: { action: 'toggle', id },
    });
    const j = await r.json();
    if (!r.ok) return onNotice(`err  ${j.error}`);
    await load();
  }

  async function remove(id: string) {
    const r = await apiFetch('/api/automations', {
      method: 'POST',
      json: { action: 'delete', id },
    });
    const j = await r.json();
    if (!r.ok) return onNotice(`err  ${j.error}`);
    await load();
  }

  async function watchAction(action: 'add' | 'remove' | 'refresh', extra: Record<string, string> = {}) {
    setWatchBusy(true);
    try {
      const r = await apiFetch('/api/watchlist', {
        method: 'POST',
        json: { action, ...extra },
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
      const r = await apiFetch('/api/automations/run', { method: 'POST' });
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

  /**
   * Create the low-balance automation wallet.
   *
   * The seed is generated in this browser and sealed into the device vault —
   * the server only learns the address, so it can never move those funds.
   */
  /** Ask for the vault passphrase so we can seal/unseal the automation key. */
  async function askPassphrase(): Promise<string | null> {
    const passphrase = window.prompt('Vault passphrase (it seals the automation key on this device)');
    return passphrase && passphrase.length >= 8 ? passphrase : null;
  }

  async function createWallet() {
    try {
      const seed = await generateSeedOnDevice();
      const address = await addressFromSeedOnDevice(seed);
      const rec = readVault();
      if (!rec) {
        onNotice('err  unlock your wallet first (the automation key is sealed with it)');
        return;
      }
      const passphrase = await askPassphrase();
      if (passphrase === null) return;
      await withAutomationWallet(rec, passphrase, seed, address);

      const r = await apiFetch('/api/automations/wallet', {
        method: 'POST',
        json: { action: 'register', address },
      });
      const j = await r.json();
      if (!r.ok) return onNotice(`err  ${j.error}`);
      setNewAutomationSeed(seed);
      onAutomationWallet?.(seed, address);
      await load();
      onNotice('ok  automation wallet created — fund it to enable swaps');
    } catch (e) {
      onNotice(`err  ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* proposals waiting for a signature */}
      {pending.length > 0 && (
        <div className="bg-[#141416] border border-purple-800/70 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-mono text-[13px] font-semibold text-purple-300">awaiting your signature</h2>
            <span className="font-mono text-[10px] text-zinc-600">{pending.length}</span>
          </div>
          <div className="space-y-2">
            {pending.map((pr) => (
              <div key={pr.id} className="bg-[#09090B] rounded-lg px-3 py-2">
                <div className="font-mono text-[12px] text-zinc-200">
                  {pr.amount} {pr.fromToken.slice(0, 10)}… → {pr.toToken.slice(0, 10)}…
                </div>
                <div className="text-[10px] text-zinc-600 mt-0.5">
                  proposed by an automation · signs in your browser
                </div>
                <button
                  onClick={() => onSignProposal(pr.id)}
                  className="mt-2 px-2.5 py-1 font-mono text-[11px] rounded bg-[#4C1D95] hover:bg-purple-700 text-white"
                >
                  [ review and sign ]
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
          <span className="font-mono text-[10px] text-zinc-600">browser-held key</span>
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
              A separate account for scheduled swaps. Its seed is generated in this browser and sealed in your vault —
              the server never holds it, so it cannot move those funds on its own.
            </p>
            <button
              onClick={createWallet}
              disabled={!unlocked}
              className="shrink-0 px-3 py-1.5 font-mono text-[12px] rounded bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-40 text-white"
            >
              create
            </button>
          </div>
        )}

        {newAutomationSeed && (
          <div className="mt-3 border border-amber-800/60 bg-[#1a1408] rounded-lg p-3">
            <div className="font-mono text-[11px] text-amber-300 uppercase tracking-wider mb-1">
              write this down
            </div>
            <div className="font-mono text-[11px] text-zinc-300 break-all select-all">{newAutomationSeed}</div>
            <p className="text-[11px] text-zinc-600 mt-1">
              It is sealed in your vault on this device. Keep a copy — without it the automation wallet cannot be
              recovered.
            </p>
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
