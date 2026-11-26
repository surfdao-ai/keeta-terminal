'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/client/api';
import type { LaunchRecord } from '@/lib/keeta/trade-types';

/** One token in the KeeSpecs directory, enriched with the wallet's balance. */
interface TokenRow {
  code: string;
  name: string;
  token: string;
  decimals: number;
  supply: string;
  sends: number;
  balance: string | null;
}

interface KtaPrice {
  priceUsd: number | null;
  change24hPct: number | null;
  asOf: string;
}

interface TokensPayload {
  asOf: string;
  ktaPrice: KtaPrice | null;
  usdcBalance: string | null;
  tokens: TokenRow[];
  launches: LaunchRecord[];
}

type DiscoverTab = 'top' | 'trending';

const QUICK_BUY_USD = [10, 25, 50, 100];

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 10)}…${a.slice(-4)}` : a;
}

function fmtSupply(n: string): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return n;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

interface LaunchSpec {
  symbol: string;
  name: string;
  description: string;
  supply: string;
  decimals: number;
}

interface QuickBuy {
  /** The destination token's address. */
  token: string;
  /** The token address the wallet sends (the source). */
  from: string;
  /** How much of the source to send, in display units. */
  amount: number;
  /** USD value the user tapped (for the confirm label). */
  usd: number;
}

interface LaunchpadProps {
  unlocked: boolean;
  onQuickBuy: (buy: QuickBuy) => void;
  onLaunch: (spec: LaunchSpec) => Promise<void>;
}

/**
 * The 🚀 Launch view: discover and trade existing Keeta tokens, or launch a
 * new native one. Everything tradeable here is real — a token is only bought
 * through the normal propose → confirm → sign flow, so the daily cap still
 * applies and nothing signs without an explicit approval.
 */
export default function Launchpad({ unlocked, onQuickBuy, onLaunch }: LaunchpadProps) {
  const [tab, setTab] = useState<'discover' | 'launch'>('discover');
  const [data, setData] = useState<TokensPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [discoverTab, setDiscoverTab] = useState<DiscoverTab>('top');
  const [query, setQuery] = useState('');
  const [buyingToken, setBuyingToken] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      const r = await apiFetch('/api/tokens');
      const j = (await r.json()) as Partial<TokensPayload> & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `directory unavailable (${r.status})`);
      setData(j as TokensPayload);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tokens = data?.tokens ?? [];

  function filtered(): TokenRow[] {
    const q = query.trim().toLowerCase();
    let rows = tokens;
    if (q) {
      rows = rows.filter(
        (t) =>
          t.code.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.token.includes(q),
      );
    }
    if (discoverTab === 'trending') {
      rows = [...rows].sort((a, b) => b.sends - a.sends);
    } else {
      // "Top" = largest by circulating supply (a market-cap proxy; only KTA has
      // a live price, so a dollar cap is not meaningful for most rows).
      rows = [...rows].sort(
        (a, b) => Math.abs(Number(b.supply)) - Math.abs(Number(a.supply)),
      );
    }
    return rows;
  }

  // Quick-buy source, per the agreed rule: USDC when the wallet holds some
  // (the stable to buy with); otherwise KTA priced at the live feed so the
  // $X button is still a dollar amount. If neither USDC nor a KTA price is
  // available, fall back to USDC (the honest dollar buy — the confirm card
  // shows the exact swap and an unfunded wallet simply won't sign).
  const usdcBal = data?.usdcBalance != null ? Number(data.usdcBalance) : 0;
  const ktaBal = Number(tokens.find((t) => t.code.toUpperCase() === 'KTA')?.balance ?? 0) || 0;
  const ktaPrice = data?.ktaPrice?.priceUsd ?? null;
  const useKta = usdcBal <= 0 && ktaBal > 0 && ktaPrice != null && ktaPrice > 0;
  const buySource = useKta ? 'KTA' : 'USDC';

  function buildBuy(token: TokenRow, usd: number): QuickBuy {
    if (useKta) {
      const ktaAmount = ktaPrice ? usd / ktaPrice : usd;
      return { token: token.token, from: '$KTA', amount: Number(ktaAmount.toFixed(6)), usd };
    }
    return { token: token.token, from: '$USDC', amount: usd, usd };
  }

  async function quickBuy(token: TokenRow, usd: number) {
    setBuyingToken(token.token);
    try {
      await onQuickBuy(buildBuy(token, usd));
    } finally {
      setBuyingToken(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 w-full">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end justify-between mb-1">
          <h1 className="text-2xl font-bold">Launchpad</h1>
          {data?.ktaPrice?.priceUsd != null && (
            <span className="font-mono text-[11px] text-zinc-500">
              KTA ${data.ktaPrice.priceUsd.toFixed(4)}
              {data.ktaPrice.change24hPct != null && (
                <span className={data.ktaPrice.change24hPct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {' '}
                  {data.ktaPrice.change24hPct >= 0 ? '+' : ''}
                  {data.ktaPrice.change24hPct.toFixed(1)}%
                </span>
              )}
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-500 mb-5">
          Launch a native Keeta token, discover live tokens, and quick-buy them — every buy goes
          through the usual confirm-and-sign step.
        </p>

        {/* tab bar */}
        <div className="flex gap-1.5 mb-5">
          {(['discover', 'launch'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg font-mono text-[13px] capitalize transition ${
                tab === t
                  ? 'bg-[#4C1D95] text-white'
                  : 'bg-[#141416] border border-zinc-800 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'discover' && (
          <Discover
            loading={loading}
            error={loadError}
            rows={filtered()}
            count={tokens.length}
            discoverTab={discoverTab}
            setDiscoverTab={setDiscoverTab}
            query={query}
            setQuery={setQuery}
            buyingToken={buyingToken}
            onBuy={quickBuy}
            buySource={buySource}
            onRefresh={() => void load()}
          />
        )}

        {tab === 'launch' && (
          <Launch
            unlocked={unlocked}
            ktaBalance={tokens.find((t) => t.code.toUpperCase() === 'KTA')?.balance ?? null}
            launches={data?.launches ?? []}
            listedTokens={tokens}
            onLaunch={onLaunch}
            onRefresh={() => void load()}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Discover({
  loading,
  error,
  rows,
  count,
  discoverTab,
  setDiscoverTab,
  query,
  setQuery,
  buyingToken,
  onBuy,
  buySource,
  onRefresh,
}: {
  loading: boolean;
  error: string;
  rows: TokenRow[];
  count: number;
  discoverTab: DiscoverTab;
  setDiscoverTab: (t: DiscoverTab) => void;
  query: string;
  setQuery: (q: string) => void;
  buyingToken: string | null;
  onBuy: (token: TokenRow, usd: number) => void;
  buySource: string;
  onRefresh: () => void;
}) {
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
        <div className="flex gap-1">
          {(['top', 'trending'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setDiscoverTab(t)}
              className={`px-3 py-1.5 rounded-md font-mono text-[12px] capitalize transition ${
                discoverTab === t
                  ? 'bg-[#1c1c21] text-zinc-100 border border-zinc-700'
                  : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter by symbol, name or address"
          className="flex-1 px-3 py-1.5 rounded-lg bg-[#09090B] border border-zinc-800 font-mono text-[12px] text-zinc-200 focus:outline-none focus:border-purple-600"
        />
        <button
          onClick={onRefresh}
          className="px-3 py-1.5 rounded-lg bg-[#141416] border border-zinc-800 font-mono text-[12px] text-zinc-400 hover:border-zinc-600"
        >
          ↻ refresh
        </button>
      </div>

      {loading && <div className="font-mono text-[12px] text-zinc-500 animate-pulse">loading directory…</div>}
      {error && !loading && (
        <div className="font-mono text-[12px] text-red-400 mb-4">{error}</div>
      )}

      {!loading && !error && (
        <>
          <div className="flex items-center justify-between text-[11px] text-zinc-600 font-mono mb-2 px-1">
            <span>
              {rows.length} of {count} tokens · sorted by {discoverTab === 'top' ? 'supply' : 'activity (sends)'}
            </span>
            <span>buy with {buySource}</span>
          </div>
          <div className="space-y-2">
            {rows.map((t) => (
              <TokenRowCard key={t.token} t={t} busy={buyingToken === t.token} onBuy={onBuy} />
            ))}
            {rows.length === 0 && (
              <div className="font-mono text-[12px] text-zinc-600 px-1">no tokens match that filter</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TokenRowCard({
  t,
  busy,
  onBuy,
}: {
  t: TokenRow;
  busy: boolean;
  onBuy: (token: TokenRow, usd: number) => void;
}) {
  return (
    <div className="bg-[#141416] border border-zinc-800 rounded-xl p-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-700/40 to-indigo-800/40 border border-purple-900/40 flex items-center justify-center font-mono text-[13px] font-semibold text-purple-200 shrink-0">
          {t.code.slice(0, 4)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-[14px] text-zinc-100 truncate">{t.code}</span>
            <span className="text-[12px] text-zinc-500 truncate">{t.name}</span>
            {t.balance && (
              <span className="ml-auto shrink-0 font-mono text-[10px] text-emerald-400">
                you hold {t.balance}
              </span>
            )}
          </div>
          <div className="font-mono text-[11px] text-zinc-600 truncate" title={t.token}>
            {shortAddr(t.token)} · supply {fmtSupply(t.supply)} · {t.sends} sends
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        {QUICK_BUY_USD.map((usd) => (
          <button
            key={usd}
            disabled={busy}
            onClick={() => onBuy(t, usd)}
            className="px-2.5 py-1 rounded-md bg-[#09090B] border border-zinc-700 hover:border-purple-600 hover:text-purple-200 font-mono text-[12px] text-zinc-300 disabled:opacity-40 transition"
          >
            ${usd}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] text-zinc-600">buy → confirm → sign</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Launch({
  unlocked,
  ktaBalance,
  launches,
  listedTokens,
  onLaunch,
  onRefresh,
}: {
  unlocked: boolean;
  ktaBalance: string | null;
  launches: LaunchRecord[];
  listedTokens: TokenRow[];
  onLaunch: (spec: LaunchSpec) => Promise<void>;
  onRefresh: () => void;
}) {
  const listed = new Set(listedTokens.map((t) => t.token));
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [supply, setSupply] = useState('1000000');
  const [decimals, setDecimals] = useState(18);
  const [launching, setLaunching] = useState(false);
  const [err, setErr] = useState('');

  // The page owns the seed, so it signs the launch (CREATE_IDENTIFIER + mint +
  // metadata in one signed block). This component just validates and reports.
  async function launch() {
    setErr('');
    if (!unlocked) {
      setErr('Unlock your wallet to launch.');
      return;
    }
    const spec: LaunchSpec = {
      symbol: symbol.trim(),
      name: name.trim(),
      description: description.trim(),
      supply,
      decimals,
    };
    const invalid = validate(spec);
    if (invalid) {
      setErr(invalid);
      return;
    }
    setLaunching(true);
    try {
      await onLaunch(spec);
      setSymbol('');
      setName('');
      setDescription('');
      onRefresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLaunching(false);
    }
  }

  function validate(spec: { symbol: string; name: string; supply: string; decimals: number }): string | null {
    if (!/^[A-Za-z0-9]{1,12}$/.test(spec.symbol)) return 'symbol must be 1-12 alphanumeric characters';
    if (!spec.name || spec.name.length > 64) return 'name must be 1-64 characters';
    if (!Number.isInteger(spec.decimals) || spec.decimals < 0 || spec.decimals > 18)
      return 'decimals must be an integer between 0 and 18';
    const s = Number(spec.supply);
    if (!Number.isFinite(s) || s <= 0) return 'supply must be a positive number';
    return null;
  }

  return (
    <div>
      <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">Launch a new token</div>

        {!unlocked && (
          <p className="text-[12px] text-amber-400 font-mono mb-3">
            Unlock your wallet to launch — the token is signed and published from this browser.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">Symbol</span>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="DOGE"
              maxLength={12}
              className="px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-sm focus:outline-none focus:border-purple-600"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">Decimals</span>
            <input
              type="number"
              min={0}
              max={18}
              value={decimals}
              onChange={(e) => setDecimals(Number(e.target.value))}
              className="px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-sm focus:outline-none focus:border-purple-600"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Doge"
              maxLength={64}
              className="px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 text-sm focus:outline-none focus:border-purple-600"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="optional"
              className="px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 text-sm focus:outline-none focus:border-purple-600"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">Total supply</span>
            <input
              type="number"
              min={1}
              value={supply}
              onChange={(e) => setSupply(e.target.value)}
              className="px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-sm focus:outline-none focus:border-purple-600"
            />
          </label>
        </div>

        {ktaBalance !== null && (
          <p className="text-[11px] text-zinc-500 font-mono mt-3">
            network fee is paid in KTA · you hold {ktaBalance} KTA
          </p>
        )}
        {err && <p className="text-[11px] text-red-400 font-mono mt-3">{err}</p>}

        <button
          onClick={() => void launch()}
          disabled={launching}
          className="mt-4 w-full px-4 py-2.5 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-60 text-sm font-medium text-white transition"
        >
          {launching ? 'launching…' : 'launch token'}
        </button>
        <p className="text-[11px] text-zinc-600 mt-2">
          Minted to your wallet on the Keeta ledger. It is tradeable once an FX anchor provider
          quotes it — until then it shows as “not quoted yet”.
        </p>
      </div>

      {/* your tokens */}
      <div className="mt-6">
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">Your tokens</div>
        {launches.length === 0 && (
          <p className="text-[12px] text-zinc-600 font-mono">You haven’t launched a token yet.</p>
        )}
        {launches.length > 0 && (
          <div className="space-y-2">
            {launches.map((l) => (
              <div key={l.address} className="bg-[#141416] border border-zinc-800 rounded-xl p-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[14px] text-zinc-100">{l.symbol}</span>
                  <span className="text-[12px] text-zinc-500 truncate">{l.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">
                    {new Date(l.at).toLocaleDateString()}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-zinc-600 truncate" title={l.address}>
                  {shortAddr(l.address)} · supply {fmtSupply(l.supply)} · {l.decimals} dp
                </div>
                <div className="mt-2">
                  {listed.has(l.address) ? (
                    <span className="inline-block px-2 py-0.5 rounded-md bg-emerald-900/30 border border-emerald-800/50 font-mono text-[10px] text-emerald-300">
                      live in the directory
                    </span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded-md bg-amber-900/30 border border-amber-800/50 font-mono text-[10px] text-amber-300">
                      not quoted by a provider yet
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
