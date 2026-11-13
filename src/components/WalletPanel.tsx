'use client';

/**
 * The wallet panel.
 *
 * The seed lives in the browser's vault (sealed behind your passphrase) and
 * is unlocked by the sign-in screen. This panel shows the public address the
 * server knows about, and lets you sign out.
 */
interface WalletPanelProps {
  /** The registered wallet address (the signed-in one). */
  address: string | null;
  /** Sign out and return to the sign-in screen. */
  onSignOut: () => void;
}

export default function WalletPanel({ address, onSignOut }: WalletPanelProps) {
  return (
    <div className="space-y-4">
      <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Wallet address</div>
        <div className="font-mono text-sm break-all">{address ?? '—'}</div>
        <p className="text-[11px] text-zinc-600 mt-3">
          Your seed is generated in this browser, sealed behind your passphrase, and never sent to
          the server. This address is all the server stores.
        </p>
        <button
          onClick={onSignOut}
          className="mt-3 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300"
        >
          sign out
        </button>
      </div>
    </div>
  );
}
