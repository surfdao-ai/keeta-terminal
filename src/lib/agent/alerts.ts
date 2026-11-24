/**
 * Alert-surfacing helpers. Pure, so they can be unit-tested without a DOM.
 */

export interface AlertLogEntry {
  id: string;
  at: string;
  kind: string;
  status: string;
  message: string;
}

/**
 * The newest *notifiable* log entry that fired after the watermark. On a
 * fresh load the watermark is unset, so this returns the most recent fired
 * entry — the user is told once about it — and that timestamp becomes the
 * watermark, so later polls only chime when something *newer* fires.
 *
 * Notifiable kinds: price alerts and liquidity ("is back") alerts. Proposals
 * and skips are not surfaced — they have a dedicated home in the Automations
 * view.
 */
export function latestNewAlert(
  log: AlertLogEntry[],
  watermark: string | null,
): AlertLogEntry | null {
  let newest: AlertLogEntry | null = null;
  for (const e of log) {
    if ((e.kind !== 'alert' && e.kind !== 'liquidity') || e.status !== 'triggered') continue;
    if (watermark !== null && e.at <= watermark) continue;
    if (!newest || e.at > newest.at) newest = e;
  }
  return newest;
}
