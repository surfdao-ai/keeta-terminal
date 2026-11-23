'use client';

import { useState } from 'react';

interface ToolCardProps {
  name: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  onConfirm: (tradeId: string, setter: (r: unknown) => void) => void;
}

const PRETTY: Record<string, string> = {
  get_portfolio: 'portfolio',
  get_positions: 'positions',
  list_tokens: 'tokens',
  get_token_info: 'token',
  get_estimate: 'estimate',
  get_binding_quote: 'quote',
  check_liquidity: 'liquidity',
  propose_trade: 'propose',
  propose_token_launch: 'launch token',
  get_trade_history: 'history',
  get_cap_status: 'cap',
};

const usd = (n: number | null | undefined, digits = 2): string =>
  n === null || n === undefined ? '—' : `$${n.toFixed(digits)}`;

/** Portfolio card: what you hold. */
function PortfolioCard({ output }: { output: Record<string, unknown> }) {
  const balances = (output.balances as { token?: string; display?: string }[] | undefined) ?? [];
  const address = typeof output.address === 'string' ? output.address : '';
  const short = (t: string) => (t.length > 14 ? `${t.slice(0, 8)}…${t.slice(-4)}` : t);
  return (
    <div className="font-mono text-[12px] space-y-0.5">
      {address && (
        <div className="text-zinc-600">
          {address.slice(0, 14)}… · {balances.length} token{balances.length === 1 ? '' : 's'}
        </div>
      )}
      {balances.length === 0 && <div className="text-zinc-500">no balances</div>}
      {balances.map((b, i) => (
        <div key={i} className="flex justify-between gap-3">
          <span className="text-zinc-500 truncate">{short(b.token ?? '')}</span>
          <span className="text-zinc-100">{b.display}</span>
        </div>
      ))}
    </div>
  );
}

/** Positions card: value, cost basis and PnL, with a totals strip. */
function PositionsCard({ output }: { output: Record<string, unknown> }) {
  const rows = (output.positions as {
    token?: string;
    amount?: string;
    valueUsd?: number | null;
    costUsd?: number | null;
    pnlUsd?: number | null;
  }[] | undefined) ?? [];
  const totalValue = output.totalValueUsd as number | null | undefined;
  const totalCost = output.totalCostUsd as number | null | undefined;
  const totalPnl = output.totalPnlUsd as number | null | undefined;
  const realised = output.realisedPnlUsd as number | null | undefined;
  const trades = output.trades as number | null | undefined;
  const short = (t: string) => (t.length > 14 ? `${t.slice(0, 8)}…${t.slice(-4)}` : t);
  const pnlClass = (n: number | null | undefined) =>
    n === null || n === undefined ? 'text-zinc-600' : n >= 0 ? 'text-emerald-400' : 'text-red-400';
  return (
    <div className="font-mono text-[12px]">
      {rows.length === 0 && <div className="text-zinc-500">no positions yet</div>}
      <div className="space-y-0.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-baseline gap-3">
            <span className="text-zinc-500 w-24 truncate">{short(r.token ?? '')}</span>
            <span className="text-zinc-300 w-28 truncate">{r.amount}</span>
            <span className="text-zinc-200 ml-auto">{usd(r.valueUsd)}</span>
            <span className={`w-24 text-right ${pnlClass(r.pnlUsd)}`}>
              {r.pnlUsd === null || r.pnlUsd === undefined
                ? '—'
                : `${r.pnlUsd >= 0 ? '+' : ''}${usd(r.pnlUsd)}`}
            </span>
          </div>
        ))}
      </div>
      {rows.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-800 space-y-0.5 text-zinc-400">
          <div className="flex justify-between">
            <span>value</span>
            <span className="text-emerald-300">{usd(totalValue)}</span>
          </div>
          <div className="flex justify-between">
            <span>cost basis</span>
            <span>{usd(totalCost)}</span>
          </div>
          <div className="flex justify-between">
            <span>unrealised</span>
            <span className={pnlClass(totalPnl)}>{totalPnl === null || totalPnl === undefined ? '—' : `${totalPnl >= 0 ? '+' : ''}${usd(totalPnl)}`}</span>
          </div>
          <div className="flex justify-between text-zinc-600">
            <span>realised · {trades ?? 0} trades</span>
            <span>{realised === null || realised === undefined ? '—' : `${realised >= 0 ? '+' : ''}${usd(realised)}`}</span>
          </div>
        </div>
      )}
      {Boolean(output.noBasis) && (
        <div className="mt-1 text-[10px] text-zinc-600">
          no cost basis for some tokens — funded from another wallet
        </div>
      )}
    </div>
  );
}

/** Render a value as aligned terminal rows. */
function Rows({ data, prefix = '' }: { data: Record<string, unknown>; prefix?: string }) {
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined);
  const width = Math.max(...entries.map(([k]) => k.length), 0);
  return (
    <>
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="text-zinc-500 shrink-0" style={{ width: `${width}ch` }}>
            {prefix}
            {k}
          </span>
          <span className="text-zinc-200 break-all">
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </span>
        </div>
      ))}
    </>
  );
}

/**
 * One line describing a tool result. Tool output is for the agent — the
 * terminal only shows a summary, with the raw payload behind a toggle.
 */
function summarize(output: unknown): string {
  if (output === null || output === undefined) return '';
  if (typeof output === 'string') return output.slice(0, 120);
  if (Array.isArray(output)) return `${output.length} rows`;

  const o = output as Record<string, unknown>;

  // MCP tools return { resultType, content: [{ type: 'text', text }] }
  const content = o.content;
  if (Array.isArray(content) && content.length) {
    const first = content[0] as { text?: string };
    const text = String(first?.text ?? '').replace(/\s+/g, ' ').trim();
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  }

  if (typeof o.error === 'string') return o.error;

  if (Array.isArray(o.lines)) return `${o.lines.length} rows`;
  if (typeof o.count === 'number') {
    const scope = typeof o.scope === 'string' ? o.scope : '';
    return scope ? `${o.count} ${scope}` : `${o.count} items`;
  }
  if (typeof o.tradable === 'boolean') {
    return o.tradable ? 'tradable now' : 'no binding liquidity';
  }
  if (typeof o.address === 'string') return o.address;
  if (typeof o.status === 'string') return o.status;

  const keys = Object.keys(o).filter((k) => o[k] !== null && o[k] !== undefined);
  if (!keys.length) return 'ok';
  if (keys.length === 1) {
    const v = o[keys[0]];
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  }
  return keys.slice(0, 4).join(' · ');
}

export default function ToolCard({ name, state, input, output, onConfirm }: ToolCardProps) {
  const [confirmResult, setConfirmResult] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const running = state !== 'output-available';
  const out = output as { tradeId?: string; tokenLaunchId?: string } | null;
  const actionId = out?.tradeId || out?.tokenLaunchId;
  const label = PRETTY[name] || name.replace(/^ks_/, '');

  async function handleConfirm() {
    if (!actionId) return;
    setConfirming(true);
    onConfirm(actionId, (r) => {
      setConfirmResult(r);
      setConfirming(false);
    });
  }

  const isError = output && typeof output === 'object' && 'error' in (output as object);
  const summary = running ? '' : summarize(output);

  return (
    <div className="my-1">
      {/* command line */}
      <div className="flex gap-2 items-center">
        <span className="text-purple-400 select-none">&gt;</span>
        <span className="text-zinc-400">exec {label}</span>
        {input !== undefined && input !== null && Object.keys(input as object).length > 0 && (
          <span className="text-zinc-600 truncate">
            {Object.entries(input as Record<string, unknown>)
              .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
              .join(' ')}
          </span>
        )}
        <span className={`ml-auto text-[11px] ${running ? 'text-amber-400' : isError ? 'text-red-400' : 'text-emerald-500'}`}>
          {running ? 'running...' : isError ? 'err' : 'ok'}
        </span>
      </div>

      {/* result — one line, or a rich card for portfolio/positions, raw behind a toggle */}
      {name === 'get_portfolio' && !running && (
        <div className="ml-4 pl-3 border-l border-zinc-800">
          <PortfolioCard output={output as Record<string, unknown>} />
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="text-[10px] text-zinc-600 hover:text-zinc-400"
            >
              {showRaw ? 'hide raw' : 'raw'}
            </button>
          </div>
          {showRaw && (
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px] text-zinc-500">
              {JSON.stringify(output, null, 1)}
            </pre>
          )}
        </div>
      )}
      {name === 'get_positions' && !running && (
        <div className="ml-4 pl-3 border-l border-zinc-800">
          <PositionsCard output={output as Record<string, unknown>} />
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="text-[10px] text-zinc-600 hover:text-zinc-400"
            >
              {showRaw ? 'hide raw' : 'raw'}
            </button>
          </div>
          {showRaw && (
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px] text-zinc-500">
              {JSON.stringify(output, null, 1)}
            </pre>
          )}
        </div>
      )}
      {summary && name !== 'get_portfolio' && name !== 'get_positions' && (
        <div className="ml-4 pl-3 border-l border-zinc-800 text-zinc-400">
          <div className="flex items-start gap-2">
            <span className="break-words">{summary}</span>
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="ml-auto shrink-0 text-[10px] text-zinc-600 hover:text-zinc-400"
            >
              {showRaw ? 'hide' : 'raw'}
            </button>
          </div>
          {showRaw && (
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px] text-zinc-500">
              {JSON.stringify(output, null, 1)}
            </pre>
          )}
        </div>
      )}

      {/* confirm action */}
      {(name === 'propose_trade' || name === 'propose_token_launch') && actionId && !confirmResult && (
        <div className="ml-4 mt-1 flex items-center gap-3">
          <button
            disabled={confirming}
            onClick={handleConfirm}
            className="px-3 py-1 font-mono text-[12px] rounded bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-50 text-white"
          >
            {confirming ? 'confirming...' : '[ confirm ]'}
          </button>
          <span className="text-[11px] text-zinc-600">expires ~60s</span>
        </div>
      )}

      {confirmResult !== null && (
        <div className="ml-4 mt-1 border-l border-emerald-900 pl-3">
          <div className="text-emerald-500">ok exec completed</div>
          <div className="text-zinc-400">
            {typeof confirmResult === 'object' && confirmResult ? (
              <Rows data={confirmResult as Record<string, unknown>} />
            ) : (
              <pre className="whitespace-pre-wrap break-all text-zinc-300">{JSON.stringify(confirmResult, null, 2)}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
