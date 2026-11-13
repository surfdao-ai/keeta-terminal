'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Skill {
  id: string;
  title: string;
  description: string;
}

export default function SkillsBrowser() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<{ id: string; content: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/skills');
      const j = await r.json();
      setSkills(j.skills ?? []);
      if (j.error) setErr(j.error);
    } catch {
      setErr('could not reach the Keeta skills');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so the effect body itself does not set state synchronously.
    const first = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(first);
  }, [load]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [skills, filter]);

  async function openSkill(id: string) {
    setBusy(true);
    try {
      const r = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const j = await r.json();
      setOpen({ id, content: j.content ?? j.error ?? '(empty)' });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-3xl mx-auto w-full">
      <h1 className="text-2xl font-bold mb-1">Skills</h1>
      <p className="text-sm text-zinc-500 mb-6">
        The Keeta skills — short instruction sheets for every read the network exposes. Read one here,
        or just ask the agent for it.
      </p>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="filter — price, status, balance, bridge…"
        className="w-full px-3 py-2.5 rounded-lg bg-[#141416] border border-zinc-700 font-mono text-[13px] text-[#F7F7F7] focus:outline-none focus:border-purple-600 mb-4"
      />

      {err && <p className="text-xs text-amber-400 mb-3">{err}</p>}
      {loading ? (
        <p className="font-mono text-[12px] text-zinc-600">loading skills…</p>
      ) : (
        <div className="space-y-1.5">
          {shown.map((s) => (
            <button
              key={s.id}
              onClick={() => openSkill(s.id)}
              disabled={busy}
              className="w-full text-left bg-[#141416] border border-zinc-800 rounded-lg px-3 py-2.5 hover:border-purple-700/70 transition disabled:opacity-50"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[13px] text-zinc-100">{s.title}</span>
                <span className="font-mono text-[10px] text-zinc-600">{s.id}</span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{s.description}</p>
            </button>
          ))}
          {!shown.length && <p className="font-mono text-[12px] text-zinc-600">no skills match</p>}
        </div>
      )}

      {open && (
        <div className="mt-6 bg-[#0d0d10] border border-zinc-800 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 bg-[#141416] border-b border-zinc-800">
            <span className="font-mono text-[12px] text-zinc-300">{open.id}</span>
            <button
              onClick={() => setOpen(null)}
              className="ml-auto font-mono text-[11px] text-zinc-500 hover:text-zinc-200"
            >
              close
            </button>
          </div>
          <pre className="p-4 font-mono text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap break-words">
            {open.content}
          </pre>
        </div>
      )}
    </div>
  );
}
