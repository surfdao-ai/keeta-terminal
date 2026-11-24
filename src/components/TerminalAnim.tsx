'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The start-screen background: a terminal that "types out" what KTerminal
 * can do.
 *
 * It fills the sign-in screen as a faded backdrop — lines scroll upward from
 * the bottom — and is purely cosmetic. Decorative only: pointer-events off,
 * hidden from screen readers, static under reduced motion.
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
const MAX_LINES = 8;

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
    const typeLine = () => {
      const line = LINES[idx++ % LINES.length];
      setLog((l) => [...l.slice(-(MAX_LINES - 2)), '']);
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
          nextRef.current = setTimeout(typeLine, LINE_PAUSE);
        }
      };
      typingRef.current = setTimeout(tick, LINE_DELAY);
    };

    typingRef.current = setTimeout(typeLine, 400);

    return () => {
      if (typingRef.current) clearTimeout(typingRef.current);
      if (nextRef.current) clearTimeout(nextRef.current);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden [mask-image:radial-gradient(ellipse_at_center,black_25%,transparent_78%)]"
    >
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#09090B]/60 to-[#09090B]/90" />
      <div
        className="absolute inset-x-0 bottom-0 p-4 sm:p-6 font-mono text-[10px] sm:text-[11px] leading-snug whitespace-nowrap text-zinc-500/70"
      >
        {log.map((l, i) => (
          <div key={i + l}>{l}</div>
        ))}
      </div>
    </div>
  );
}
