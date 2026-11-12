'use client';

import { useState } from 'react';

interface ToolCardProps {
  name: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  onConfirm: (tradeId: string, setter: (r: unknown) => void) => void;
}

const COLORS: Record<string, string> = {
  get_portfolio: 'text-emerald-300',
  list_tokens: 'text-cyan-300',
  get_token_info: 'text-cyan-300',
  get_estimate: 'text-amber-300',
  get_binding_quote: 'text-amber-300',
  propose_trade: 'text-rose-300',
  get_trade_history: 'text-zinc-300',
  get_cap_status: 'text-zinc-300',
};

export default function ToolCard({ name, state, input, output, onConfirm }: ToolCardProps) {
  const [confirmResult, setConfirmResult] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);

  const isPending = state !== 'output-available';
  const tradeId = (output as { tradeId?: string } | null)?.tradeId;

  async function handleConfirm() {
    if (!tradeId) return;
    setConfirming(true);
    onConfirm(tradeId, (r) => {
      setConfirmResult(r);
      setConfirming(false);
    });
  }

  return (
    <div className="mt-2 rounded-xl border border-zinc-700/80 bg-zinc-950/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-900/80 border-b border-zinc-800">
        <span className={`font-mono text-xs font-semibold ${COLORS[name] || 'text-zinc-300'}`}>
          {name}
        </span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${isPending ? 'bg-amber-900/40 text-amber-300' : 'bg-emerald-900/40 text-emerald-300'}`}>
          {isPending ? 'running' : 'done'}
        </span>
      </div>
      <div className="p-3 space-y-2">
        {input !== undefined && input !== null && (
          <details>
            <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-300">input</summary>
            <pre className="whitespace-pre-wrap break-all text-[11px] text-zinc-300 mt-1 bg-zinc-900 rounded p-2">{JSON.stringify(input, null, 2)}</pre>
          </details>
        )}
        {output !== undefined && output !== null && (
          <div>
            <div className="text-[11px] text-zinc-500 mb-1">output</div>
            <pre className="whitespace-pre-wrap break-all text-[11px] text-zinc-200 bg-zinc-900 rounded p-2 max-h-60 overflow-auto">{JSON.stringify(output, null, 2)}</pre>
          </div>
        )}
        {name === 'propose_trade' && tradeId && !confirmResult && (
          <div className="pt-2 flex items-center gap-3">
            <button
              disabled={confirming}
              onClick={handleConfirm}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium"
            >
              {confirming ? 'Confirming…' : '✓ Confirm trade'}
            </button>
            <span className="text-[11px] text-zinc-500">expires in ~60s</span>
          </div>
        )}
        {confirmResult !== null && (
          <div className="pt-2 rounded-lg border border-emerald-800 bg-emerald-900/20 p-2">
            <div className="text-[11px] text-emerald-300 mb-1">execution result</div>
            <pre className="whitespace-pre-wrap break-all text-[11px] text-emerald-100">{JSON.stringify(confirmResult, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
