'use client';

import type { TradeIntent } from '@/lib/keeta/trade-types';

interface TradeConfirmProps {
  intent: TradeIntent;
  signing: boolean;
  onSign: () => void;
  onCancel: () => void;
}

/**
 * The trade confirmation, rendered at page level so it is visible from *any*
 * view — a quick-buy from the Launchpad must reach the same "sign and send"
 * step as a trade proposed in chat. Nothing is signed until the user taps it.
 */
export default function TradeConfirm({ intent, signing, onSign, onCancel }: TradeConfirmProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-2xl border border-purple-800/70 bg-[#120d1c] rounded-2xl p-4 shadow-2xl">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-purple-400 select-none text-[15px] leading-none">⇄</span>
          <div className="font-mono text-[11px] text-purple-300 uppercase tracking-wider">
            confirm this trade
          </div>
        </div>
        <div className="font-mono text-[13px] text-zinc-300 space-y-1">
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">send</span>
            <span className="min-w-0 break-all text-right">{intent.summary.amount} {intent.summary.from}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-zinc-500">recv</span>
            <span className="min-w-0 break-all text-right text-emerald-300">{intent.summary.receive} {intent.summary.to}</span>
          </div>
          <div className="flex justify-between gap-3 text-[12px] text-zinc-500 pt-1 border-t border-zinc-800/80">
            <span>
              route <span className="text-purple-300">{intent.summary.route ?? 'on-chain'}</span>
            </span>
            <span>fee ~${intent.summary.costUsd.toFixed(2)}</span>
          </div>
        </div>
        <p className="text-[11px] text-zinc-500 mt-2">
          Signed in this browser and sent to the provider. Nothing is signed until you approve.
        </p>
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={onSign}
            disabled={signing}
            className="flex-1 px-4 py-2 rounded-full bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-60 text-[13px] font-medium text-white transition"
          >
            {signing ? 'signing…' : 'sign and send'}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-full border border-zinc-700 hover:bg-zinc-800/60 text-[13px] text-zinc-400 hover:text-zinc-200 transition"
          >
            cancel
          </button>
        </div>
      </div>
    </div>
  );
}
