'use client';

import { useState } from 'react';

interface ToolCardProps {
  name: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  onConfirm: (tradeId: string, setter: (r: unknown) => void) => void;
}

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
    <div className="mt-2 rounded border border-zinc-700 bg-zinc-900/60 p-3 text-xs font-mono">
      <div className="flex items-center justify-between mb-2">
        <span className="text-emerald-300">{name}</span>
        <span className="text-zinc-500">{isPending ? 'running…' : 'done'}</span>
      </div>
      {input !== undefined && input !== null && (
        <details className="mb-2">
          <summary className="cursor-pointer text-zinc-400">input</summary>
          <pre className="whitespace-pre-wrap break-all text-zinc-300 mt-1">{JSON.stringify(input, null, 2)}</pre>
        </details>
      )}
      {output !== undefined && output !== null && (
        <div>
          <div className="text-zinc-400 mb-1">output</div>
          <pre className="whitespace-pre-wrap break-all text-zinc-200">{JSON.stringify(output, null, 2)}</pre>
        </div>
      )}
      {name === 'propose_trade' && tradeId && !confirmResult && (
        <div className="mt-3 flex gap-2">
          <button
            disabled={confirming}
            onClick={handleConfirm}
            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white"
          >
            {confirming ? 'Confirming…' : 'Confirm trade'}
          </button>
          <span className="text-zinc-500 self-center">expires in ~60s</span>
        </div>
      )}
      {confirmResult !== null && (
        <div className="mt-3 rounded border border-emerald-800 bg-emerald-900/30 p-2">
          <div className="text-emerald-300 mb-1">execution result</div>
          <pre className="whitespace-pre-wrap break-all text-emerald-100">{JSON.stringify(confirmResult, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
