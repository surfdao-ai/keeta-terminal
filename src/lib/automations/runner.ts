/**
 * Automation runner — evaluates price alerts and *proposes* recurring swaps.
 *
 * The server holds no keys, so it can never move funds: a due recurring
 * automation produces a pending action that the user approves and signs in
 * their browser. Alerts are read-only and fire on their own.
 */
import {
  listAutomations,
  listAutomationOwners,
  patchAutomations,
  appendLog,
  type Automation,
} from './store';
import { getTokenPriceUsd } from './prices';
import { refreshWatchlist } from './watchlist';
import { newPendingTrade, savePending } from '../agent/safety';
import { capRemainingUsd } from './store';

export interface RunReport {
  checked: number;
  triggered: number;
  proposed: number;
  executed: number;
  failed: number;
  skipped: number;
  details: string[];
}

export async function runAutomations(): Promise<RunReport> {
  const report: RunReport = {
    checked: 0,
    triggered: 0,
    proposed: 0,
    executed: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  const owners = await listAutomationOwners();

  for (const owner of owners) {
    const list = await listAutomations(owner);
    const now = Date.now();
    const patches = new Map<string, Partial<Automation>>();

    for (const a of list) {
      if (!a.enabled) continue;
      report.checked++;

      if (a.kind === 'alert') {
        const price = await getTokenPriceUsd(a.symbol).catch(() => null);
        patches.set(a.id, {
          lastCheckedAt: new Date().toISOString(),
          ...(price !== null ? { lastPriceUsd: price } : {}),
        });

        if (price === null) {
          report.skipped++;
          report.details.push(`alert ${a.name}: no price source`);
          continue;
        }

        const hit = a.op === 'gt' ? price > a.valueUsd : price < a.valueUsd;
        if (hit && !a.triggered) {
          patches.set(a.id, {
            ...(patches.get(a.id) ?? {}),
            triggered: true,
            triggeredAt: new Date().toISOString(),
          });
          report.triggered++;
          report.details.push(`alert ${a.name}: ${a.symbol} ${price} ${a.op} ${a.valueUsd}`);
          await appendLog(owner, {
            automationId: a.id,
            kind: 'alert',
            status: 'triggered',
            message: `${a.symbol} at $${price} (${a.op} $${a.valueUsd})`,
          });
        }
        continue;
      }

      // Recurring swap: propose it. The user signs it in their browser.
      const due = new Date(a.nextRunAt).getTime() <= now;
      if (!due) {
        report.skipped++;
        continue;
      }

      const remaining = await capRemainingUsd(owner);
      if (remaining <= 0) {
        patches.set(a.id, {
          lastRunAt: new Date().toISOString(),
          lastStatus: 'skipped',
          lastMessage: 'daily cap reached',
          nextRunAt: nextRunAt(a.everyMinutes, now),
        });
        report.skipped++;
        continue;
      }

      const proposal = newPendingTrade({
        kind: 'swap',
        fromToken: a.fromToken,
        toToken: a.toToken,
        amount: a.amount,
        affinity: 'from',
      });
      await savePending(owner, proposal);

      patches.set(a.id, {
        lastRunAt: new Date().toISOString(),
        lastStatus: 'proposed',
        lastMessage: 'waiting for your approval in the app',
        nextRunAt: nextRunAt(a.everyMinutes, now),
      });
      report.proposed++;
      report.details.push(`recurring ${a.name}: proposed ${a.amount} ${a.fromToken} -> ${a.toToken} — approve it in the app`);
      await appendLog(owner, {
        automationId: a.id,
        kind: 'recurring',
        status: 'proposed',
        message: `${a.amount} ${a.fromToken} -> ${a.toToken} — waiting for approval`,
      });
    }

    await patchAutomations(owner, patches);
  }

  // Keep the watchlist prices fresh even when nobody has the UI open.
  for (const owner of owners) {
    try {
      await refreshWatchlist(owner);
    } catch {
      /* a price read failing must not fail the run */
    }
  }

  return report;
}

function nextRunAt(everyMinutes: number, from = Date.now()): string {
  return new Date(from + everyMinutes * 60_000).toISOString();
}

export function describeAutomation(a: Automation): string {
  if (a.kind === 'alert') {
    return `alert when ${a.symbol} ${a.op === 'gt' ? '>' : '<'} $${a.valueUsd}`;
  }
  return `every ${a.everyMinutes}m: ${a.amount} ${a.fromToken} -> ${a.toToken}`;
}
