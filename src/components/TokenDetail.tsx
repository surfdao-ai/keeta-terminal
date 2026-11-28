'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/client/api';
import type { TokenAdminOp } from '@/lib/keeta/browser-signer';

interface AclRow {
  principal: string;
  flags: string[];
  raw: [string, string];
}

interface Detail {
  address: string;
  symbol: string;
  description: string;
  decimals: number | null;
  metadata: Record<string, unknown> | null;
  supplyRaw: string | null;
  supply: string | null;
  treasuryRaw: string | null;
  treasury: string | null;
  holderBalance: string | null;
  holder: string | null;
  acl: AclRow[];
  defaultPermission: string[];
  headHeight: string | null;
  headBlock: string | null;
  asOf: string;
}

interface TokenDetailProps {
  address: string;
  holder: string | null;
  unlocked: boolean;
  onManage: (op: TokenAdminOp) => Promise<void>;
  onBack: () => void;
}

/** base64 of a UTF-8 string — TextEncoder, because Buffer is not in the browser. */
function toBase64(text: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Copy an address to the clipboard, with a short "copied" tick. */
function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable (non-secure context) — ignore */
    }
  }, []);
  return { copied, copy };
}

function Addr({ value }: { value: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      onClick={() => void copy(value)}
      title="click to copy"
      className="group inline-flex items-center gap-1.5 font-mono text-[11px] text-zinc-400 hover:text-purple-300"
    >
      <span className="break-all text-left">{value}</span>
      <span className="text-[10px] text-zinc-600 group-hover:text-purple-400 shrink-0">
        {copied ? 'copied ✓' : 'copy'}
      </span>
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-zinc-800/60 last:border-0">
      <span className="text-[12px] text-zinc-500 shrink-0">{label}</span>
      <span className="text-right min-w-0">{children}</span>
    </div>
  );
}

/** A single management action: a labelled form that, when run, calls onManage. */
function AdminAction({
  title,
  hint,
  disabled,
  disabledReason,
  onRun,
  children,
}: {
  title: string;
  hint: string;
  disabled: boolean;
  disabledReason?: string;
  onRun: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  async function run() {
    setErr('');
    setOk('');
    setBusy(true);
    try {
      await onRun();
      setOk('signed & published — refreshing');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-zinc-800 rounded-lg bg-[#0d0d10]">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left disabled:opacity-50"
      >
        <span className="text-[13px] text-zinc-200">{title}</span>
        <span className="text-[11px] font-mono text-zinc-600">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <p className="text-[11px] text-zinc-500 mb-2">{hint}</p>
          {disabled && disabledReason && (
            <p className="text-[11px] text-amber-400 font-mono mb-2">{disabledReason}</p>
          )}
          {!disabled && children}
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => void run()}
              disabled={busy}
              className="px-3 py-1.5 font-mono text-[12px] rounded-md bg-[#4C1D95] hover:bg-purple-700 disabled:opacity-50 text-white"
            >
              {busy ? 'signing…' : 'confirm & sign'}
            </button>
            {ok && <span className="text-[11px] font-mono text-emerald-400">{ok}</span>}
          </div>
          {err && <p className="text-[11px] font-mono text-red-400 mt-2">{err}</p>}
        </div>
      )}
    </div>
  );
}

function Amount({
  value,
  set,
  placeholder,
  suffix,
  max,
}: {
  value: string;
  set: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  max?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-[12px] text-zinc-400">
      <span>amount{max ? ` (max ${max})` : ''}</span>
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        inputMode="decimal"
        className="px-2.5 py-1.5 rounded-md bg-[#09090B] border border-zinc-700 font-mono text-[13px] text-zinc-100 focus:outline-none focus:border-purple-600"
      />
      {suffix && <span className="text-[10px] text-zinc-600">{suffix}</span>}
    </label>
  );
}

function Text({
  value,
  set,
  placeholder,
}: {
  value: string;
  set: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => set(e.target.value)}
      placeholder={placeholder}
      className="w-full px-2.5 py-1.5 rounded-md bg-[#09090B] border border-zinc-700 font-mono text-[13px] text-zinc-100 focus:outline-none focus:border-purple-600"
    />
  );
}

export default function TokenDetail({ address, holder, unlocked, onManage, onBack }: TokenDetailProps) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Bumping this re-runs the load (used after a management op changes state).
  const [reload, setReload] = useState(0);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await apiFetch(`/api/tokens/detail?token=${encodeURIComponent(address)}`);
      const j = (await r.json()) as Partial<Detail> & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `could not read token (${r.status})`);
      setDetail(j as Detail);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function reloadDetail() {
    setReload((n) => n + 1);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch mirrors Launchpad.load()
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, reload]);

  // --- management form state (per action) ---
  const [mintAmt, setMintAmt] = useState('');
  const [burnAmt, setBurnAmt] = useState('');
  const [sendTo, setSendTo] = useState('');
  const [sendAmt, setSendAmt] = useState('');
  const [infoName, setInfoName] = useState('');
  const [infoDesc, setInfoDesc] = useState('');
  const [grantAddr, setGrantAddr] = useState('');
  const [grantFlag, setGrantFlag] = useState<'ADMIN' | 'TOKEN_ADMIN_SUPPLY' | 'UPDATE_INFO' | 'SEND_ON_BEHALF'>('ADMIN');
  const [grantRemove, setGrantRemove] = useState(false);

  // Seed the info form from the loaded detail (once per token).
  // Seed the info form once the detail arrives (initial-value sync).
  useEffect(() => {
    if (detail) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInfoName(detail.symbol);
      setInfoDesc(detail.description);
    }
  }, [detail]);

  async function manage(op: TokenAdminOp) {
    await onManage(op);
    reloadDetail();
  }

  if (loading) return <p className="text-[13px] text-zinc-500 animate-pulse">reading the ledger…</p>;
  if (error) return <p className="text-[13px] text-red-400 font-mono">{error}</p>;
  if (!detail) return null;

  const decimals = detail.decimals ?? 6;
  const myRow = detail.acl.find(
    (r) => holder && r.principal.toLowerCase() === holder.toLowerCase(),
  );
  const myFlags = new Set(myRow?.flags ?? []);
  const isOwner = myFlags.has('OWNER');
  const canSupply = isOwner || myFlags.has('TOKEN_ADMIN_SUPPLY');
  const canInfo = isOwner || myFlags.has('UPDATE_INFO');
  const canSend = isOwner || myFlags.has('ADMIN') || myFlags.has('SEND_ON_BEHALF');
  const canGrant = isOwner;
  const baseDisabled = !unlocked;
  const noRights = !myRow;

  const dec = (v: string | null) => (v === null ? '—' : v);

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-[12px] font-mono text-purple-300 hover:text-purple-200">
        ← back to your tokens
      </button>

      {/* identity */}
      <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          {detail.metadata && typeof detail.metadata.logoURI === 'string' ? (
            <>{/* eslint-disable-next-line @next/next/no-img-element -- external asset URL from on-chain metadata; next/image can't whitelist arbitrary metadata hosts. */}
              <img
                src={detail.metadata.logoURI as string}
                alt=""
                className="w-10 h-10 rounded-lg shrink-0 border border-zinc-800"
                referrerPolicy="no-referrer"
              />
            </>
          ) : (
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-700/40 to-indigo-800/40 border border-purple-900/40 flex items-center justify-center font-mono text-[13px] font-semibold text-purple-200 shrink-0">
              {detail.symbol.slice(0, 4)}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-lg font-bold">{detail.symbol}</div>
            {detail.description && (
              <div className="text-[12px] text-zinc-400 mt-0.5">{detail.description}</div>
            )}
          </div>
        </div>

        <div className="mt-4">
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Token address</div>
          <Addr value={detail.address} />
        </div>
      </div>

      {/* details */}
      <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
        <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Details</div>
        <Row label="Total supply">
          <span className="font-mono text-[13px] text-zinc-100">{dec(detail.supply)} {detail.symbol}</span>
          {detail.supplyRaw !== null && (
            <span className="block font-mono text-[10px] text-zinc-600">{detail.supplyRaw} base</span>
          )}
        </Row>
        <Row label="Treasury (token's own balance)">
          <span className="font-mono text-[13px] text-zinc-100">{dec(detail.treasury)} {detail.symbol}</span>
          {detail.treasuryRaw !== null && (
            <span className="block font-mono text-[10px] text-zinc-600">{detail.treasuryRaw} base</span>
          )}
        </Row>
        <Row label="Your balance">
          <span className="font-mono text-[13px] text-zinc-100">
            {dec(detail.holderBalance)} {detail.symbol}
          </span>
        </Row>
        <Row label="Decimals">
          <span className="font-mono text-[13px] text-zinc-100">{detail.decimals ?? '—'}</span>
        </Row>
        <Row label="Default permission">
          <span className="font-mono text-[12px] text-zinc-300">{detail.defaultPermission.join(', ')}</span>
        </Row>
        {detail.metadata && (
          <Row label="Metadata">
            <span className="font-mono text-[10px] text-zinc-500 break-all max-w-[220px]">
              {JSON.stringify(detail.metadata)}
            </span>
          </Row>
        )}
        <Row label="Head block">
          <span className="font-mono text-[11px] text-zinc-400">
            {detail.headHeight ?? '—'} {detail.headBlock ? `· ${detail.headBlock.slice(0, 12)}…` : ''}
          </span>
        </Row>
      </div>

      {/* control / ACL */}
      <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
        <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Who controls this token</div>
        {detail.acl.length === 0 && <p className="text-[12px] text-zinc-600 font-mono">no ACL rows returned</p>}
        <div className="space-y-2">
          {detail.acl.map((r) => (
            <div key={r.principal} className="border border-zinc-800 rounded-lg bg-[#0d0d10] px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                {r.principal.toLowerCase() === (holder ?? '').toLowerCase() && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300">
                    you
                  </span>
                )}
                <span className="text-[10px] font-mono text-zinc-500">
                  {r.flags.join(', ') || '—'}
                </span>
              </div>
              <Addr value={r.principal} />
            </div>
          ))}
        </div>
        {noRights && (
          <p className="text-[11px] text-zinc-600 font-mono mt-2">
            Your wallet holds no admin rights on this token — you can read it but not administer it.
          </p>
        )}
      </div>

      {/* management */}
      <div className="bg-[#141416] border border-zinc-800 rounded-2xl p-5">
        <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Manage</div>
        <p className="text-[11px] text-zinc-600 mb-3">
          Each action is signed by your wallet in this browser and published to the network. The
          daily spend cap does not apply to administration; a small KTA fee is paid per action.
        </p>
        <div className="space-y-2">
          <AdminAction
            title="Mint (increase supply)"
            hint="Mints new tokens into the token's treasury."
            disabled={baseDisabled || !canSupply}
            disabledReason={!unlocked ? 'unlock your wallet' : !canSupply ? 'requires OWNER, ADMIN or TOKEN_ADMIN_SUPPLY' : undefined}
            onRun={() =>
              manage({ token: detail.address, decimals, kind: 'mint', amount: mintAmt })
            }
          >
            <div className="grid grid-cols-1 gap-2">
              <Amount value={mintAmt} set={setMintAmt} suffix={detail.symbol} />
            </div>
          </AdminAction>

          <AdminAction
            title="Burn (decrease supply)"
            hint="Burns tokens from the treasury. Cannot exceed the treasury balance."
            disabled={baseDisabled || !canSupply}
            disabledReason={!unlocked ? 'unlock your wallet' : !canSupply ? 'requires OWNER, ADMIN or TOKEN_ADMIN_SUPPLY' : undefined}
            onRun={() =>
              manage({ token: detail.address, decimals, kind: 'burn', amount: burnAmt })
            }
          >
            <div className="grid grid-cols-1 gap-2">
              <Amount
                value={burnAmt}
                set={setBurnAmt}
                suffix={detail.symbol}
                max={detail.treasury ?? undefined}
              />
            </div>
          </AdminAction>

          <AdminAction
            title="Send from treasury"
            hint="Pays tokens out of the treasury to a recipient address."
            disabled={baseDisabled || !canSend}
            disabledReason={!unlocked ? 'unlock your wallet' : !canSend ? 'requires OWNER, ADMIN or SEND_ON_BEHALF' : undefined}
            onRun={() =>
              manage({
                token: detail.address,
                decimals,
                kind: 'send',
                to: sendTo,
                amount: sendAmt,
              })
            }
          >
            <div className="grid grid-cols-1 gap-2">
              <label className="flex flex-col gap-1 text-[12px] text-zinc-400">
                <span>recipient</span>
                <Text value={sendTo} set={setSendTo} placeholder="keeta_…" />
              </label>
              <Amount
                value={sendAmt}
                set={setSendAmt}
                suffix={detail.symbol}
                max={detail.treasury ?? undefined}
              />
            </div>
          </AdminAction>

          <AdminAction
            title="Update token info"
            hint="Overwrites the on-chain name, description and metadata. The name is what clients show as the ticker — changing it changes how the token appears everywhere."
            disabled={baseDisabled || !canInfo}
            disabledReason={!unlocked ? 'unlock your wallet' : !canInfo ? 'requires OWNER or UPDATE_INFO' : undefined}
            onRun={() =>
              manage({
                token: detail.address,
                decimals,
                kind: 'updateInfo',
                name: infoName,
                description: infoDesc,
                metadata: detail.metadata ? toBase64(JSON.stringify(detail.metadata)) : undefined,
                defaultFlags: detail.defaultPermission,
              })
            }
          >
            <div className="grid grid-cols-1 gap-2">
              <label className="flex flex-col gap-1 text-[12px] text-zinc-400">
                <span>name (ticker)</span>
                <Text value={infoName} set={setInfoName} />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-zinc-400">
                <span>description</span>
                <Text value={infoDesc} set={setInfoDesc} />
              </label>
            </div>
          </AdminAction>

          <AdminAction
            title={grantRemove ? 'Revoke admin rights' : 'Grant admin rights'}
            hint={
              grantRemove
                ? 'Removes the selected right from an account.'
                : 'Grants an account a right to act on this token (e.g. let another wallet mint).'
            }
            disabled={baseDisabled || !canGrant}
            disabledReason={!unlocked ? 'unlock your wallet' : !canGrant ? 'requires OWNER' : undefined}
            onRun={() =>
              manage({
                token: detail.address,
                decimals,
                kind: 'grant',
                principal: grantAddr,
                flags: [grantFlag],
                method: grantRemove ? 'remove' : 'add',
              })
            }
          >
            <div className="grid grid-cols-1 gap-2">
              <label className="flex flex-col gap-1 text-[12px] text-zinc-400">
                <span>account</span>
                <Text value={grantAddr} set={setGrantAddr} placeholder="keeta_…" />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-zinc-400">
                <span>right</span>
                <select
                  value={grantFlag}
                  onChange={(e) => setGrantFlag(e.target.value as never)}
                  className="px-2.5 py-1.5 rounded-md bg-[#09090B] border border-zinc-700 font-mono text-[12px] text-zinc-100 focus:outline-none focus:border-purple-600"
                >
                  <option value="ADMIN">ADMIN (broad admin)</option>
                  <option value="TOKEN_ADMIN_SUPPLY">TOKEN_ADMIN_SUPPLY (mint / burn)</option>
                  <option value="UPDATE_INFO">UPDATE_INFO (edit info)</option>
                  <option value="SEND_ON_BEHALF">SEND_ON_BEHALF (send from treasury)</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-[12px] text-zinc-400">
                <input
                  type="checkbox"
                  checked={grantRemove}
                  onChange={(e) => setGrantRemove(e.target.checked)}
                />
                revoke instead of grant
              </label>
            </div>
          </AdminAction>
        </div>
      </div>

      <p className="text-[11px] text-zinc-600">read at {new Date(detail.asOf).toLocaleTimeString()}</p>
    </div>
  );
}
