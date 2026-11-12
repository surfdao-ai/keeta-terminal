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
  propose_trade: 'propose',
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

export default function ToolCard({ name, state, input, output, onConfirm }: ToolCardProps) {
  const [confirmResult, setConfirmResult] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);

  const running = state !== 'output-available';
  const tradeId = (output as { tradeId?: string } | null)?.tradeId;
  const label = PRETTY[name] || name;

  async function handleConfirm() {
    if (!tradeId) return;
    setConfirming(true);
    onConfirm(tradeId, (r) => {
      setConfirmResult(r);
      setConfirming(false);
    });
  }

  const isError = output && typeof output === 'object' && 'error' in (output as object);

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

      {/* result */}
      {output !== undefined && output !== null && !running && (
        <div className="ml-4 pl-3 border-l border-zinc-800 text-zinc-400">
          {typeof output === 'object' && !Array.isArray(output) ? (
            <Rows data={output as Record<string, unknown>} />
          ) : (
            <pre className="whitespace-pre-wrap break-all text-zinc-300">{JSON.stringify(output, null, 2)}</pre>
          )}
        </div>
      )}

      {/* confirm action */}
      {name === 'propose_trade' && tradeId && !confirmResult && (
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
