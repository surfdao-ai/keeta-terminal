'use client';

import { useState } from 'react';
import { clearVault } from '@/lib/vault';
import { apiFetch } from '@/lib/client/api';

/**
 * The wallet panel.
 *
 * The seed lives in the browser's vault (sealed behind your passphrase) and
 * is unlocked by the sign-in screen. This panel shows the public address the
 * server knows about, and lets you sign out or delete the wallet.
 */
interface WalletPanelProps {
  /** The registered wallet address (the signed-in one). */
  address: string | null;
  /** Sign out and return to the sign-in screen. */
  onSignOut: () => void;
}

export default function WalletPanel({ address, onSignOut }: WalletPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  /**
   * Delete the wallet: erase what the server stores for it, wipe the sealed
   * vault from this device, and sign out. After this the only thing left is
   * the written-down seed.
   */
  async function deleteWallet() {
    setBusy(true);
    setErr('');
    try {
      await apiFetch('/api/wallet', { method: 'POST', json: { action: 'delete' } });
      clearVault();
      onSignOut();
    } catch (e) {
      setErr(`Could not delete: ${(e as Error).message}. The wallet is still registered — try again.`);
    } finally {
      setBusy(false);
    }
  }

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

      <div className="bg-[#141416] border border-red-900/50 rounded-2xl p-5">
        <div className="text-xs text-red-400/80 uppercase tracking-wider mb-2">Danger zone</div>
        {!confirming ? (
          <>
            <p className="text-sm text-zinc-400">
              Delete this wallet. The server forgets it entirely — chats, trades, settings, cap and
              automations — and the sealed copy on this device is wiped.
            </p>
            <button
              onClick={() => setConfirming(true)}
              className="mt-3 px-3 py-1.5 rounded-lg bg-red-950/60 border border-red-900/60 hover:bg-red-900/50 text-sm text-red-300"
            >
              delete wallet
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-300">
              This cannot be undone. Your written-down seed is the only way back into this wallet —
              without it, its balance is unreachable.
            </p>
            {err && <p className="mt-2 font-mono text-[11px] text-red-400 whitespace-pre-wrap">{err}</p>}
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void deleteWallet()}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-red-900/80 hover:bg-red-800 disabled:opacity-50 text-sm font-medium text-white"
              >
                {busy ? 'deleting…' : 'yes, delete it and sign out'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300"
              >
                keep it
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
