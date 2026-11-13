'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { signNonce } from '@/lib/keeta/browser-signer';
import {
  createVault,
  openVaultFull,
  readVault,
  writeVault,
  type VaultRecord,
} from '@/lib/vault';
import { generateSeedOnDevice, addressFromSeedOnDevice } from '@/lib/keeta/device';

interface SignInGateProps {
  /** Called once the visitor is signed in. The seeds stay in the browser. */
  onSignedIn: (address: string, seed: string, automationSeed?: string) => void;
}

/**
 * Sign-in.
 *
 * The wallet is created (or imported) in the browser, the seed is sealed in
 * the device vault behind a passphrase, and the browser proves control of the
 * wallet by signing a one-time nonce. The server never sees the seed.
 */
export default function SignInGate({ onSignedIn }: SignInGateProps) {
  const [vault, setVault] = useState<VaultRecord | null>(null);
  const [mode, setMode] = useState<'choose' | 'create' | 'import' | 'unlock'>('choose');
  const [passphrase, setPassphrase] = useState('');
  const [importSeed, setImportSeed] = useState('');
  const [newSeed, setNewSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    // Deferred so the effect body itself does not set state synchronously.
    const first = setTimeout(() => {
      const rec = readVault();
      setVault(rec);
      if (rec) setMode('unlock');
    }, 0);
    return () => clearTimeout(first);
  }, []);

  /** Prove control of the wallet and open a session. */
  const signIn = useCallback(
    async (seed: string, address: string, automationSeed?: string) => {
      const nonceRes = await apiFetch('/api/auth/nonce', { method: 'POST' });
      const nonceJson = await nonceRes.json();
      if (!nonceRes.ok) throw new Error(nonceJson.error ?? 'could not start sign-in');
      if (nonceJson.error) throw new Error(nonceJson.error);

      const signature = await signNonce(seed, nonceJson.nonce);
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        json: { address, signature, nonce: nonceJson.nonce },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'sign-in failed');
      // Register the public address so the server knows which wallet this is.
      await apiFetch('/api/wallet', {
        method: 'POST',
        json: { action: 'register', address },
      }).catch(() => undefined);
      onSignedIn(j.address, seed, automationSeed);
    },
    [onSignedIn],
  );

  async function create() {
    setBusy(true);
    setErr('');
    try {
      const seed = await generateSeedOnDevice();
      const address = await addressFromSeedOnDevice(seed);
      if (passphrase.length < 8) throw new Error('Choose a passphrase of at least 8 characters.');
      const rec = await createVault({ seed, address, mode: 'passphrase', passphrase });
      writeVault(rec);
      setVault(rec);
      setNewSeed(seed);
      setPassphrase('');
      setMode('import'); // reuse the import step to show the seed
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    setBusy(true);
    setErr('');
    try {
      const seed = importSeed.trim();
      if (!seed) throw new Error('Paste your seed first.');
      if (passphrase.length < 8) throw new Error('Choose a passphrase of at least 8 characters.');
      const address = await addressFromSeedOnDevice(seed);
      const rec = await createVault({ seed, address, mode: 'passphrase', passphrase });
      writeVault(rec);
      setVault(rec);
      setImportSeed('');
      setPassphrase('');
      await signIn(seed, address);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    if (!vault) return;
    setBusy(true);
    setErr('');
    try {
      const { seed, automation } = await openVaultFull(vault, passphrase);
      setPassphrase('');
      await signIn(seed, vault.address, automation?.seed);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full bg-[#09090B] text-[#F7F7F7] flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-800 flex items-center justify-center font-bold text-white">
            K
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">KTerminal</h1>
            <p className="font-mono text-[11px] text-zinc-500">sign in with your wallet</p>
          </div>
        </div>

        <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-6 space-y-4">
          {mode === 'choose' && (
            <>
              <p className="text-sm text-zinc-400">
                Every visitor gets their own terminal: your own wallet, cap, automations and chats.
                Your seed never leaves this browser.
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => setMode('create')}
                  className="w-full px-3 py-2.5 rounded-lg bg-[#4C1D95] hover:bg-purple-700 text-sm font-medium text-white"
                >
                  Create a new wallet
                </button>
                <button
                  onClick={() => setMode('import')}
                  className="w-full px-3 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300"
                >
                  Import an existing wallet
                </button>
              </div>
            </>
          )}

          {mode === 'create' && (
            <>
              <p className="text-sm text-zinc-400">
                A new seed is generated in this browser. Write it down — it is the only way to
                recover the wallet.
              </p>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="choose a passphrase (8+ characters)"
                autoComplete="new-password"
                className="w-full px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 text-sm focus:outline-none focus:border-purple-600"
              />
              <div className="flex gap-2">
                <button
                  onClick={create}
                  disabled={busy || passphrase.length < 8}
                  className="flex-1 px-3 py-2.5 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-40 text-sm text-white"
                >
                  {busy ? '...' : 'Generate my seed'}
                </button>
                <button
                  onClick={() => setMode('choose')}
                  className="px-3 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-400"
                >
                  Back
                </button>
              </div>
            </>
          )}

          {mode === 'import' && (
            <>
              <p className="text-sm text-zinc-400">
                {newSeed
                  ? 'Write this seed down. It is your recovery copy.'
                  : 'Paste the seed of the wallet you want to use.'}
              </p>
              {newSeed ? (
                <div className="font-mono text-xs bg-[#09090B] border border-zinc-800 rounded-lg p-3 break-all select-all">
                  {newSeed}
                </div>
              ) : (
                <textarea
                  value={importSeed}
                  onChange={(e) => setImportSeed(e.target.value)}
                  placeholder="paste your seed"
                  rows={3}
                  spellCheck={false}
                  className="w-full px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-xs break-all focus:outline-none focus:border-purple-600"
                />
              )}
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="choose a passphrase (8+ characters)"
                autoComplete="new-password"
                className="w-full px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 text-sm focus:outline-none focus:border-purple-600"
              />
              <div className="flex gap-2">
                <button
                  onClick={doImport}
                  disabled={busy || passphrase.length < 8}
                  className="flex-1 px-3 py-2.5 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-40 text-sm text-white"
                >
                  {busy ? '...' : newSeed ? 'Save and sign in' : 'Import and sign in'}
                </button>
                <button
                  onClick={() => setMode('choose')}
                  className="px-3 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-400"
                >
                  Back
                </button>
              </div>
            </>
          )}

          {mode === 'unlock' && vault && (
            <>
              <p className="text-sm text-zinc-400">
                This device holds a sealed wallet. Enter its passphrase to unlock and sign in.
              </p>
              <div className="font-mono text-[11px] text-zinc-600 break-all">
                {vault.address}
              </div>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="vault passphrase"
                autoComplete="current-password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void unlock();
                }}
                className="w-full px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 text-sm focus:outline-none focus:border-purple-600"
              />
              <div className="flex gap-2">
                <button
                  onClick={unlock}
                  disabled={busy}
                  className="flex-1 px-3 py-2.5 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-40 text-sm text-white"
                >
                  {busy ? '...' : 'Unlock and sign in'}
                </button>
                <button
                  onClick={() => setMode('import')}
                  className="px-3 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-400"
                >
                  Use another wallet
                </button>
              </div>
            </>
          )}

          {err && <p className="text-xs text-red-400">{err}</p>}
        </div>

        <p className="mt-4 font-mono text-[11px] text-zinc-600 leading-relaxed">
          The seed is generated here, sealed with your passphrase and never sent. The server only
          learns your public address.
        </p>
      </div>
    </div>
  );
}
