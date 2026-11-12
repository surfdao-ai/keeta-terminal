'use client';

import { useEffect, useState } from 'react';
import {
  createVault,
  openVault,
  prfSupport,
  PrfUnsupportedError,
  readVault,
  writeVault,
  clearVault,
  type PrfSupport,
  type VaultRecord,
} from '@/lib/vault';
import { generateSeedOnDevice, addressFromSeedOnDevice } from '@/lib/keeta/device';

/** Keeta addresses: 'keeta_' plus an encoded public key (alphanumeric). */
const ADDRESS_RE = /^keeta_[A-Za-z0-9]{32,}$/;

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
  const [prf, setPrf] = useState<PrfSupport>('unknown');
  const [sealMode, setSealMode] = useState<'passkey' | 'passphrase'>('passphrase');
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
      const support = await prfSupport();
      if (!alive) return;
      setVault(rec);
      setPrf(support);
      // Only default to the passkey when the browser says PRF works. Where it
      // is unknown (Safari) the passphrase is the safe default.
      setSealMode(support === 'yes' ? 'passkey' : 'passphrase');

      // Reconcile: a vault sealed on this device but not yet known to the
      // server registers itself now, so a failed registration heals itself.
      if (rec?.address && !address) {
        try {
          const r = await fetch('/api/wallet', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'register', address: rec.address }),
          });
          if (r.ok) {
            const j = await r.json();
            onRegistered(j.wallet?.address ?? rec.address);
          }
        } catch {
          /* the retry button in the address card is the fallback */
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Derive the address in the browser; null when the client cannot do it. */
  async function deriveLocally(seed: string): Promise<string | null> {
    try {
      const addr = await addressFromSeedOnDevice(seed);
      return ADDRESS_RE.test(addr) ? addr : null;
    } catch {
      return null;
    }
  }

  /** Derive the address server-side (the seed is read, never stored). */
  async function deriveOnServer(seed: string): Promise<string> {
    const r = await fetch('/api/wallet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'derive', seed }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'could not derive the address');
    if (!ADDRESS_RE.test(String(j.address ?? ''))) {
      throw new Error('The derived address was not a valid Keeta address.');
    }
    return j.address;
  }

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
        addr = (await deriveLocally(seed)) ?? (await deriveOnServer(seed));
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

      // Register the public address *before* showing the seed. If this fails
      // the wallet is not usable yet, so the flow stops here with the seed
      // kept for a retry instead of pretending it worked.
      await register(addr);
      setStep('show-seed');
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
        mode: sealMode,
        passphrase: sealMode === 'passphrase' ? passphrase : undefined,
      });
      writeVault(rec);
      setVault(rec);
      onSeed(newSeed);
      // Register again in case the earlier attempt did not land.
      await register(pendingAddress);
      setNewSeed('');
      setPendingAddress('');
      setPassphrase('');
      setStep('idle');
      setMsg(
        sealMode === 'passkey'
          ? 'sealed with your passkey — unlock with Face ID next time'
          : 'sealed with your passphrase — unlock with it next time',
      );
    } catch (e) {
      if (e instanceof PrfUnsupportedError) {
        setSealMode('passphrase');
        setErr(
          'This device cannot protect the seed with a passkey, so use a passphrase instead. ' +
            'Your written-down seed remains the recovery copy.',
        );
      } else {
        setErr((e as Error).message);
      }
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
      const addr = (await deriveLocally(trimmed)) ?? (await deriveOnServer(trimmed));
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
      if (e instanceof PrfUnsupportedError) {
        setErr(
          'This device cannot open a passkey vault. Restore the wallet from your written-down seed ' +
            '(Import an existing wallet) and seal it with a passphrase.',
        );
      } else {
        setErr((e as Error).message);
      }
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

  const shownAddress = address || vault?.address || '';
  const notRegistered = Boolean(vault?.address) && !address;

  const vaultLabel = vault
    ? vault.mode === 'passkey'
      ? 'sealed with a passkey'
      : 'sealed with a passphrase'
    : 'not set up on this device';

  return (
    <div className="space-y-4">
      {err && (
        <div className="rounded-2xl border border-red-800/70 bg-red-950/30 px-4 py-3 text-xs text-red-300">
          {err}
        </div>
      )}
      {msg && <div className="rounded-2xl border border-emerald-900/60 bg-emerald-950/20 px-4 py-3 text-xs text-emerald-300">{msg}</div>}

      <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Wallet address</div>
        <div className="font-mono text-sm break-all">{shownAddress || 'No wallet yet'}</div>
        {vault && !vault.address && (
          <div className="mt-3 text-xs text-amber-400">
            This vault has no address — import your written-down seed again to register it with the
            server.
          </div>
        )}
        {notRegistered && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-amber-400">
            <span>Sealed on this device but not registered with the server yet.</span>
            <button
              onClick={() => {
                if (vault?.address) void register(vault.address);
              }}
              disabled={busy}
              className="px-2 py-1 rounded border border-amber-700/70 hover:bg-amber-950/40 disabled:opacity-50"
            >
              retry
            </button>
          </div>
        )}
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

          <div className="flex gap-1 text-xs mb-3">
            <button
              type="button"
              onClick={() => setSealMode('passphrase')}
              className={`flex-1 py-1.5 rounded ${
                sealMode === 'passphrase' ? 'bg-[#4C1D95] text-white' : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              Passphrase
            </button>
            <button
              type="button"
              onClick={() => setSealMode('passkey')}
              disabled={prf === 'no'}
              className={`flex-1 py-1.5 rounded disabled:opacity-40 ${
                sealMode === 'passkey' ? 'bg-[#4C1D95] text-white' : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              Passkey (Face ID){prf === 'no' ? ' — unsupported here' : ''}
            </button>
          </div>

          {sealMode === 'passkey' ? (
            <p className="text-xs text-zinc-500 mb-3">
              A passkey protects the seed on this device. Unlocking is a Face ID / Touch ID tap — you
              never type the seed again.
              {prf === 'unknown' && ' If this device cannot derive a key from a passkey, switch to the passphrase.'}
            </p>
          ) : (
            <>
              <p className="text-xs text-zinc-500 mb-3">
                The seed is sealed with a passphrase on this device. It is not your seed — it only
                unlocks the copy stored here. Your written-down seed stays the recovery copy.
              </p>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="choose a vault passphrase"
                autoComplete="new-password"
                className="px-3 py-2.5 w-full rounded-lg bg-[#09090B] border border-zinc-700 text-sm focus:outline-none focus:border-purple-600"
              />
            </>
          )}

          <div className="flex gap-2 mt-3">
            <button
              onClick={sealNewSeed}
              disabled={busy || (sealMode === 'passphrase' && passphrase.length < 8)}
              className="px-3 py-2 rounded-lg bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-50 text-sm text-white"
            >
              {busy ? '…' : sealMode === 'passkey' ? 'Seal with passkey' : 'Seal with passphrase'}
            </button>
            <button onClick={() => setStep('idle')} className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
