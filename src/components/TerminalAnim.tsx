'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The start-screen background: a small terminal that "types out" what
 * KTerminal can do — a faded, out-of-the-way live log, purely cosmetic.
 *
 * It types one line at a time into a rolling log and stops (reduced motion).
 * Decorative only: pointer-events off, hidden from screen readers.
 */

const LINES = [
  '$ portfolio',
  '$ balance — keeta balances of the wallet',
  '$ trade 10 USDC → KTA (base anchor)',
  '$ automations — DCA, alerts, liquidity pings',
  '$ watchlist — track tokens, get price alerts',
  '$ chat — "quote KTA" or "any other cool things?"',
  '$ docs — the key docs behind every command',
];

const LINE_DELAY = 14; // ms per typed character
const LINE_PAUSE = 900; // ms a finished line stays before the next
const MAX_LINES = 7;

export default function TerminalAnim() {
  const [log, setLog] = useState<string[]>([]);
  const typingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setLog(LINES.slice(0, 5));
      return;
    }

    let idx = 0;
    let typing = false;

    const typeLine = () => {
      const line = LINES[idx++ % LINES.length];
      setLog((l) => [...l.slice(-(MAX_LINES - 2)), '']); // reserve the slot at the end
      let i = 0;
      const tick = () => {
        i += 1;
        setLog((l) => {
          const next = l.slice();
          next[next.length - 1] = line.slice(0, i);
          return next;
        });
        if (i < line.length) {
          typingRef.current = setTimeout(tick, LINE_DELAY);
        } else {
          typing = false;
          nextRef.current = setTimeout(typeLine, LINE_PAUSE);
        }
      };
      typing = true;
      typingRef.current = setTimeout(tick, LINE_DELAY);
    };

    // A bit of life right away, then a first line.
    typingRef.current = setTimeout(typeLine, 400);

    return () => {
      if (typingRef.current) clearTimeout(typingRef.current);
      if (nextRef.current) clearTimeout(nextRef.current);
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
      <div className="absolute bottom-3 left-3 right-[calc(50%+0.5rem)] h-44 sm:h-48 overflow-hidden rounded-xl border border-white/[0.04] bg-black/30 backdrop-blur-sm shadow-2xl shadow-black/30">
        <div
          className="h-full p-3 font-mono text-[9px] leading-snug text-zinc-400/85 [mask-image:linear-gradient(to_top,black_12%,transparent_95%)]"
        >
          {log.map((l, i) => (
            <div key={i + l} className="whitespace-nowrap">{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
