'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createWallet,
  importWallet,
  unlockWallet,
  signInWithWallet,
  passphraseProblem,
  type SealMode,
} from '@/lib/client/signin';
import { prfSupport, readVault, type PrfSupport, type VaultRecord } from '@/lib/vault';

interface SignInGateProps {
  /** Called once the visitor is signed in. The seeds stay in the browser. */
  onSignedIn: (address: string, seed: string, automationSeed?: string) => void;
}

type Step = 'choose' | 'create' | 'backup' | 'import' | 'unlock';

/**
 * Sign-in.
 *
 * The wallet is created (or imported) in the browser, the seed is sealed in
 * the device vault behind a passphrase or a passkey, and the browser proves
 * control of the wallet by signing a one-time nonce. The server never sees
 * the seed.
 */
export default function SignInGate({ onSignedIn }: SignInGateProps) {
  const [step, setStep] = useState<Step>('choose');
  const [vault, setVault] = useState<VaultRecord | null>(null);
  const [prf, setPrf] = useState<PrfSupport>('unknown');
  const [sealMode, setSealMode] = useState<SealMode>('passphrase');

  const [passphrase, setPassphrase] = useState('');
  const [importSeed, setImportSeed] = useState('');
  /** The seed of a wallet that was just created — shown once, to be written down. */
  const [newSeed, setNewSeed] = useState('');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Deferred so the effect body itself does not set state synchronously.
    const first = setTimeout(() => {
      const rec = readVault();
      setVault(rec);
      if (rec) setStep('unlock');
      void prfSupport().then((support) => {
        setPrf(support);
        // Only default to the passkey when the browser says PRF works. Where it
        // is unknown (Safari) the passphrase is the safe default.
        setSealMode(support === 'yes' ? 'passkey' : 'passphrase');
      });
    }, 0);
    return () => clearTimeout(first);
  }, []);

  /** Sign in with a seed we already have in hand. */
  const finish = useCallback(
    async (seed: string, address: string, automationSeed?: string) => {
      const signedInAs = await signInWithWallet(seed, address);
      onSignedIn(signedInAs, seed, automationSeed);
    },
    [onSignedIn],
  );

  /**
   * Create a wallet: generate the seed in this browser, seal it into the
   * vault, and show it once so it can be written down.
   */
  async function create() {
    setBusy(true);
    setErr('');
    try {
      const setup = await createWallet({
        mode: sealMode,
        passphrase: sealMode === 'passphrase' ? passphrase : undefined,
      });
      setVault(setup.vault);
      setNewSeed(setup.seed);
      setPassphrase('');
      setStep('backup');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** The user has written the seed down: sign in with it. */
  async function confirmBackup() {
    setBusy(true);
    setErr('');
    try {
      await finish(newSeed, vault?.address ?? '');
      setNewSeed('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Import an existing seed and seal it in one step. */
  async function doImport() {
    setBusy(true);
    setErr('');
    try {
      const setup = await importWallet(importSeed, {
        mode: sealMode,
        passphrase: sealMode === 'passphrase' ? passphrase : undefined,
      });
      setVault(setup.vault);
      setImportSeed('');
      setPassphrase('');
      await finish(setup.seed, setup.address);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Unlock the wallet this device already holds. */
  async function unlock() {
    setBusy(true);
    setErr('');
    try {
      const opened = await unlockWallet(
        vault?.mode === 'passkey' ? undefined : passphrase,
      );
      setPassphrase('');
      await finish(opened.seed, opened.address, opened.automation?.seed);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const passphraseHint = passphraseProblem(passphrase);
  const canSubmit = sealMode === 'passkey' || !passphraseHint;

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
          {step === 'choose' && (
            <>
              <p className="text-sm text-zinc-400">
                Every visitor gets their own terminal: your own wallet, cap, automations and chats.
                Your seed never leaves this browser.
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    setErr('');
                    setStep('create');
                  }}
                  className="w-full px-3 py-2.5 rounded-lg bg-[#4C1D95] hover:bg-purple-700 text-sm font-medium text-white"
                >
                  Create a new wallet
                </button>
                <button
                  onClick={() => {
                    setErr('');
                    setStep('import');
                  }}
                  className="w-full px-3 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300"
                >
                  Import an existing wallet
                </button>
                {vault && (
                  <button
                    onClick={() => {
                      setErr('');
                      setStep('unlock');
                    }}
                    className="w-full px-3 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300"
                  >
                    Unlock the wallet on this device
                  </button>
                )}
              </div>
            </>
          )}

          {step === 'create' && (
            <>
              <p className="text-sm text-zinc-400">
                A new seed is generated in this browser and sealed into this device. Write it down —
                it is the only way to recover the wallet.
              </p>

              <SealModePicker
                mode={sealMode}
                prf={prf}
                onChange={(m) => {
                  setSealMode(m);
                  setErr('');
                }}
              />

              {sealMode === 'passphrase' && (
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="choose a passphrase (8+ characters)"
                  autoComplete="new-password"
                  className="w-full px-3 py-2.5 rounded-lg bg-[#09090B] border-zinc-700 text-sm focus:outline-none focus:border-purple-600"
                />
              )}

              {passphraseHint && sealMode === 'passphrase' && (
                <p className="font-mono text-[11px] text-zinc-600">{passphraseHint}</p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={create}
                  disabled={busy || !canSubmit}
                  className="flex-1 px-3 py-2.5 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-40 text-sm text-white"
                >
                  {busy ? '...' : sealMode === 'passkey' ? 'Create with passkey' : 'Generate my seed'}
                </button>
                <button
                  onClick={() => {
                    setErr('');
                    setStep('choose');
                  }}
                  className="px-3 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-400"
                >
                  Back
                </button>
              </div>
            </>
          )}

          {step === 'backup' && (
            <>
              <div className="font-mono text-[11px] text-purple-300 uppercase tracking-wider">
                write this down
              </div>
              <p className="text-sm text-zinc-400">
                This seed is the only way back into this wallet. Copy it somewhere safe before you
                continue.
              </p>
              <div className="font-mono text-xs bg-[#09090B] border border-zinc-800 rounded-lg p-3 break-all select-all">
                {newSeed}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    await navigator.clipboard?.writeText(newSeed).catch(() => undefined);
                    setCopied(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300"
                >
                  {copied ? 'copied' : 'copy seed'}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={confirmBackup}
                  disabled={busy}
                  className="flex-1 px-3 py-2.5 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-40 text-sm text-white"
                >
                  {busy ? '...' : "I've written it down — sign in"}
                </button>
              </div>
            </>
          )}

          {step === 'import' && (
            <>
              <p className="text-sm text-zinc-400">Paste the seed of the wallet you want to use.</p>
              <textarea
                value={importSeed}
                onChange={(e) => setImportSeed(e.target.value)}
                placeholder="paste your seed"
                rows={3}
                spellCheck={false}
                className="w-full px-3 py-2.5 rounded-lg bg-[#09090B] border-zinc-700 font-mono text-xs break-all focus:outline-none focus:border-purple-600"
              />

              <SealModePicker
                mode={sealMode}
                prf={prf}
                onChange={(m) => {
                  setSealMode(m);
                  setErr('');
                }}
              />

              {sealMode === 'passphrase' && (
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="choose a passphrase (8+ characters)"
                  autoComplete="new-password"
                  className="w-full px-3 py-2.5 rounded-lg bg-[#09090B] border-zinc-700 text-sm focus:outline-none focus:border-purple-600"
                />
              )}

              <div className="flex gap-2">
                <button
                  onClick={doImport}
                  disabled={busy || !importSeed.trim() || !canSubmit}
                  className="flex-1 px-3 py-2.5 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-40 text-sm text-white"
                >
                  {busy ? '...' : 'Import and sign in'}
                </button>
                <button
                  onClick={() => {
                    setErr('');
                    setStep('choose');
                  }}
                  className="px-3 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-400"
                >
                  Back
                </button>
              </div>
            </>
          )}

          {step === 'unlock' && vault && (
            <>
              <p className="text-sm text-zinc-400">
                This device holds a sealed wallet. Unlock it to sign in.
              </p>
              <div className="font-mono text-[11px] text-zinc-600 break-all">{vault.address}</div>

              {vault.mode === 'passkey' ? (
                <button
                  onClick={unlock}
                  disabled={busy}
                  className="w-full px-3 py-2.5 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-40 text-sm text-white"
                >
                  {busy ? '...' : 'Unlock with your passkey'}
                </button>
              ) : (
                <>
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="vault passphrase"
                    autoComplete="current-password"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void unlock();
                    }}
                    className="w-full px-3 py-2.5 rounded-lg bg-[#09090B] border-zinc-700 text-sm focus:outline-none focus:border-purple-600"
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
                      onClick={() => {
                        setErr('');
                        setStep('choose');
                      }}
                      className="px-3 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-400"
                    >
                      Use another wallet
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {err && <p className="text-xs text-red-400 whitespace-pre-wrap">{err}</p>}
        </div>

        <p className="mt-4 font-mono text-[11px] text-zinc-600 leading-relaxed">
          The seed is generated here, sealed on this device and never sent. The server only learns
          your public address.
        </p>
      </div>
    </div>
  );
}

/**
 * Passkey or passphrase.
 *
 * The passkey is only offered where the browser can actually derive a key
 * from it (WebAuthn PRF); everywhere else the passphrase is the default.
 */
function SealModePicker({
  mode,
  prf,
  onChange,
}: {
  mode: SealMode;
  prf: PrfSupport;
  onChange: (mode: SealMode) => void;
}) {
  if (prf === 'no') return null;

  return (
    <div className="flex gap-2">
      <button
        onClick={() => onChange('passphrase')}
        disabled={prf === 'unknown'}
        className={`flex-1 px-3 py-1.5 rounded-lg text-[12px] font-mono ${
          mode === 'passphrase'
            ? 'bg-[#4C1D95] text-white'
            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 disabled:opacity-40'
        }`}
      >
        passphrase
      </button>
      <button
        onClick={() => onChange('passkey')}
        disabled={prf !== 'yes'}
        className={`flex-1 px-3 py-1.5 rounded-lg text-[12px] font-mono ${
          mode === 'passkey'
            ? 'bg-[#4C1D95] text-white'
            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 disabled:opacity-40'
        }`}
      >
        passkey{prf === 'unknown' ? ' (unknown)' : ''}
      </button>
    </div>
  );
}
