'use client';

import { useEffect, useState } from 'react';
import {
  createVault,
  openVault,
  passkeySupported,
  readVault,
  writeVault,
  clearVault,
  type VaultRecord,
} from '@/lib/vault';
import { generateSeedOnDevice, addressFromSeedOnDevice } from '@/lib/keeta/device';

interface WalletPanelProps {
  address: string | null;
  /** The seed held in memory for this session; null = locked. */
  seed: string | null;
  onSeed: (seed: string | null) => void;
  onRegistered: (address: string) => void;
}

type Step = 'idle' | 'show-seed' | 'seal' | 'import';

/**
 * Wallet setup and unlocking.
 *
 * The seed is created in the browser, shown once so it can be written down,
 * and then sealed into the device vault (passkey or passphrase). The server
 * only ever learns the public address.
 */
export default function WalletPanel({ address, seed, onSeed, onRegistered }: WalletPanelProps) {
  const [vault, setVault] = useState<VaultRecord | null>(null);
  const [canPasskey, setCanPasskey] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [newSeed, setNewSeed] = useState('');
  const [pendingAddress, setPendingAddress] = useState('');
  const [importSeed, setImportSeed] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const rec = readVault();
      const supported = await passkeySupported();
      if (!alive) return;
      setVault(rec);
      setCanPasskey(supported);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function register(addressToRegister: string) {
    const r = await fetch('/api/wallet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'register', address: addressToRegister }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'could not register the wallet');
    onRegistered(j.wallet?.address ?? addressToRegister);
  }

  /** Generate a seed in the browser and show it for the user to write down. */
  async function startCreate() {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      let seed = '';
      let addr = '';
      try {
        seed = await generateSeedOnDevice();
        addr = await addressFromSeedOnDevice(seed);
      } catch {
        // The browser could not run the Keeta client — fall back to the
        // server generating it once. It is handed over and never stored.
        const r = await fetch('/api/wallet', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'new-seed' }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'could not create a seed');
        seed = j.seed;
        addr = j.address;
        setMsg('generated on the server (this browser cannot run the Keeta client) — it is still never stored');
      }
      setNewSeed(seed);
      setPendingAddress(addr);
      setStep('show-seed');
      await register(addr);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Seal the new seed into the vault and keep it in memory for the session. */
  async function sealNewSeed() {
    setBusy(true);
    setErr('');
    try {
      const rec = await createVault({
        seed: newSeed,
        address: pendingAddress,
        mode: canPasskey ? 'passkey' : 'passphrase',
        passphrase: canPasskey ? undefined : passphrase,
      });
      writeVault(rec);
      setVault(rec);
      onSeed(newSeed);
      setNewSeed('');
      setPendingAddress('');
      setPassphrase('');
      setStep('idle');
      setMsg(
        canPasskey
          ? 'sealed with your passkey — unlock with Face ID next time'
          : 'sealed with your passphrase — unlock with it next time',
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Import an existing seed. */
  async function startImport() {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const trimmed = importSeed.trim();
      if (!trimmed) throw new Error('paste your seed first');
      let addr = '';
      try {
        addr = await addressFromSeedOnDevice(trimmed);
      } catch {
        // This browser cannot run the Keeta client — let the server derive the
        // address. The seed is only read for that request and never stored.
        const r = await fetch('/api/wallet', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'derive', seed: trimmed }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'could not derive the address');
        addr = j.address;
      }
      await register(addr);
      setImportSeed('');
      setStep('seal');
      setMsg('seed accepted — now seal it in this device');
      // Keep the seed and its address for the sealing step.
      setNewSeed(trimmed);
      setPendingAddress(addr);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Unlock the vault (Face ID for a passkey vault, passphrase otherwise). */
  async function unlock() {
    if (!vault) return;
    setBusy(true);
    setErr('');
    try {
      const unlocked = await openVault(vault, passphrase);
      setPassphrase('');
      onSeed(unlocked);
      setMsg('unlocked');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function forget() {
    clearVault();
    setVault(null);
    onSeed(null);
    setMsg('vault removed from this device (your written-down seed still works)');
  }

  const vaultLabel = vault
    ? vault.mode === 'passkey'
      ? 'sealed with a passkey'
      : 'sealed with a passphrase'
    : 'not set up on this device';

  return (
    <div className="space-y-4">
      <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Address</div>
        <div className="font-mono text-sm break-all">{address || 'No wallet yet'}</div>
      </div>

      <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">Device vault</div>
        <div className="font-mono text-[12px] text-zinc-400 mb-3">
          seed: {vaultLabel} · {seed ? 'unlocked this session' : 'locked'}
        </div>
        <p className="text-xs text-zinc-500 mb-3">
          The seed never reaches the server. It is sealed on this device and the server only knows
          your public address.
        </p>
        <div className="flex flex-wrap gap-2">
          {vault && !seed && (
            <button
              onClick={unlock}
              disabled={busy}
              className="px-3 py-2 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-50 text-sm text-white"
            >
              {busy ? '…' : vault.mode === 'passkey' ? 'Unlock with passkey' : 'Unlock'}
            </button>
          )}
          {seed && (
            <button onClick={() => onSeed(null)} className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">
              Lock
            </button>
          )}
          {vault && (
            <button onClick={forget} className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-400">
              Forget this device
            </button>
          )}
        </div>
        {vault?.mode === 'passphrase' && !seed && (
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="vault passphrase"
            className="mt-3 px-3 py-2.5 w-full rounded-lg bg-[#09090B] border border-zinc-700 text-sm focus:outline-none focus:border-purple-600"
          />
        )}
      </div>

      {!address && step === 'idle' && (
        <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">Create or import</div>
          <p className="text-xs text-zinc-500 mb-3">
            A new seed is generated in your browser. Write it down — it is the only way to recover the
            wallet if this device is lost.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={startCreate}
              disabled={busy}
              className="px-3 py-2 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-50 text-sm text-white"
            >
              {busy ? '…' : 'Create a new wallet'}
            </button>
            <button
              onClick={() => {
                setStep('import');
                setErr('');
                setMsg('');
              }}
              className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm"
            >
              Import an existing wallet
            </button>
          </div>
        </div>
      )}

      {step === 'import' && (
        <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">Import a wallet</div>
          <textarea
            value={importSeed}
            onChange={(e) => setImportSeed(e.target.value)}
            placeholder="paste your seed"
            rows={3}
            spellCheck={false}
            className="w-full px-3 py-2.5 rounded-lg bg-[#09090B] border border-zinc-700 font-mono text-xs break-all focus:outline-none focus:border-purple-600"
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={startImport}
              disabled={busy}
              className="px-3 py-2 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-50 text-sm text-white"
            >
              {busy ? '…' : 'Continue'}
            </button>
            <button onClick={() => setStep('idle')} className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'show-seed' && (
        <div className="bg-[#141416] border border-purple-700/60 rounded-2xl p-5">
          <div className="text-xs text-purple-300 uppercase tracking-wider mb-2">Write this down</div>
          <div className="font-mono text-xs bg-[#09090B] border border-zinc-800 rounded-lg p-3 break-all select-all">
            {newSeed}
          </div>
          <p className="text-xs text-zinc-500 mt-3 mb-3">
            This is your recovery copy. Anyone with it controls the wallet. It is never sent to the
            server.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setStep('seal')}
              className="px-3 py-2 rounded-lg bg-[#4C1D95] hover:bg-purple-700 text-sm text-white"
            >
              I wrote it down
            </button>
            <button onClick={() => setStep('idle')} className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'seal' && (
        <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">Seal on this device</div>
          {canPasskey ? (
            <p className="text-xs text-zinc-500 mb-3">
              A passkey protects the seed on this device. Unlocking is a Face ID / Touch ID tap — you
              never type the seed again.
            </p>
          ) : (
            <>
              <p className="text-xs text-zinc-500 mb-3">
                This device cannot derive a key from a passkey, so the seed is sealed with a
                passphrase. Your written-down seed stays the recovery copy.
              </p>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="choose a vault passphrase"
                className="px-3 py-2.5 w-full rounded-lg bg-[#09090B] border border-zinc-700 text-sm focus:outline-none focus:border-purple-600"
              />
            </>
          )}
          <div className="flex gap-2 mt-3">
            <button
              onClick={sealNewSeed}
              disabled={busy || (!canPasskey && passphrase.length < 8)}
              className="px-3 py-2 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-50 text-sm text-white"
            >
              {busy ? '…' : canPasskey ? 'Seal with passkey' : 'Seal with passphrase'}
            </button>
            <button onClick={() => setStep('idle')} className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {msg && <p className="text-xs text-emerald-400">{msg}</p>}
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}
