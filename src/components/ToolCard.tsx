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

      {/* result — one line, raw payload behind a toggle */}
      {summary && (
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
