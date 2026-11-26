/**
 * The daily-cap warning decision, as a pure function.
 *
 * The page calls this on every cap read (the 15s /api/state poll, and right
 * after each settle) and stores the returned flag for the next call. Keeping
 * the hysteresis + per-day logic in one place makes it unit-testable without
 * a browser.
 *
 * Rule: fire exactly once when spend crosses FIRE_AT of the cap. Re-arm only
 * once spend drops below REARM_AT (hysteresis) or the calendar day changes,
 * so it fires once per crossing and again on a new day — never on every poll.
 */

export const FIRE_AT = 0.8;
export const REARM_AT = 0.75;

export interface CapAlertState {
  /** Whether the alert is armed (may fire on the next crossing). */
  armed: boolean;
  /** The calendar day (ISO) the armed flag is bound to; '' on first run. */
  day: string;
}

export interface CapAlertInput {
  spentUsd: number;
  capUsd: number;
}

export interface CapAlertDecision {
  /** The new armed flag to store for the next call. */
  armed: boolean;
  /** The day the armed flag is now bound to. */
  day: string;
  /** True exactly on the call that crosses the threshold — raise the banner. */
  fire: boolean;
  /** The banner line, when `fire` is true. */
  line?: string;
}

export function capAlertDecision(
  state: CapAlertState,
  input: CapAlertInput,
  now = new Date(),
): CapAlertDecision {
  const day = now.toISOString().slice(0, 10);
  const cap = input.capUsd;
  const pct = cap > 0 ? input.spentUsd / cap : 0;

  // A fresh day (or the first read) re-binds to today. If we're already past
  // the line — e.g. the app reopened mid-day near the cap — warn right away;
  // otherwise just arm for the next crossing.
  if (state.day !== day) {
    if (pct >= FIRE_AT) {
      return { armed: false, day, fire: true, line: capAlertLine(input.spentUsd, cap, pct) };
    }
    return { armed: true, day, fire: false };
  }

  if (cap <= 0) return { armed: state.armed, day, fire: false };

  // Well below the line: arm for the next crossing.
  if (pct < REARM_AT) return { armed: true, day, fire: false };

  // Between the re-arm floor and the fire line: keep the current arming.
  if (pct < FIRE_AT) return { armed: state.armed, day, fire: false };

  // At or past the fire line.
  if (state.armed) {
    return { armed: false, day, fire: true, line: capAlertLine(input.spentUsd, cap, pct) };
  }
  // Already fired and still up here — stay disarmed.
  return { armed: false, day, fire: false };
}

/** The banner text for a cap crossing. */
export function capAlertLine(spentUsd: number, capUsd: number, pct = 0): string {
  const p = pct > 0 ? Math.round(pct * 100) : Math.round((spentUsd / capUsd) * 100);
  return `Daily cap: $${spentUsd.toFixed(2)} of $${capUsd} used — ${p}%`;
}
