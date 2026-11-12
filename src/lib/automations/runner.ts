/**
 * Automation runner — evaluates price alerts and executes due recurring swaps.
 *
 * Called by the scheduled function (every 15 min on Hobby) and by the client
 * tick while the app is open.
 */
import {
  listAutomations,
  patchAutomations,
  appendLog,
  nextRunAt,
  capRemainingUsd,
  recordSpend,
  MAX_AUTOMATION_USD,
  type Automation,
} from './store';
import { getTokenPriceUsd } from './prices';
import { unlockAutomationWallet, getAutomationWallet } from './wallet';
import { executeSwap, type SwapResult } from '../keeta/swap';

export interface RunReport {
  checked: number;
  triggered: number;
  executed: number;
  failed: number;
  skipped: number;
  details: string[];
}

export async function runAutomations(opts: { allowSwaps: boolean }): Promise<RunReport> {
  const report: RunReport = {
    checked: 0,
    triggered: 0,
    executed: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  const list = await listAutomations();
  const now = Date.now();
  // Fields the runner owns; applied to the live list at the end so a
  // concurrent edit in the UI is never overwritten.
  const patches = new Map<string, Partial<Automation>>();
  const patch = (id: string, p: Partial<Automation>) => {
    patches.set(id, { ...(patches.get(id) ?? {}), ...p });
  };

  for (const a of list) {
    if (!a.enabled) continue;
    report.checked++;

    if (a.kind === 'alert') {
      const price = await getTokenPriceUsd(a.symbol).catch(() => null);
      patch(a.id, {
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
        patch(a.id, { triggered: true, triggeredAt: new Date().toISOString() });
        report.triggered++;
        report.details.push(`alert ${a.name}: ${a.symbol} ${price} ${a.op} ${a.valueUsd}`);
        await appendLog({
          automationId: a.id,
          kind: 'alert',
          status: 'triggered',
          message: `${a.symbol} at $${price} (${a.op} $${a.valueUsd})`,
        });
      }
      continue;
    }

    // recurring swap
    const due = new Date(a.nextRunAt).getTime() <= now;
    if (!due) {
      report.skipped++;
      continue;
    }
    if (!opts.allowSwaps) {
      report.skipped++;
      report.details.push(`recurring ${a.name}: not executed (swaps disabled for this run)`);
      continue;
    }

    const wallet = await getAutomationWallet();
    if (!wallet) {
      patch(a.id, {
        lastRunAt: new Date().toISOString(),
        lastStatus: 'skipped',
        lastMessage: 'no automation wallet',
        nextRunAt: nextRunAt(a.everyMinutes, now),
      });
      report.skipped++;
      continue;
    }

    const remaining = await capRemainingUsd();
    if (remaining <= 0) {
      patch(a.id, {
        lastRunAt: new Date().toISOString(),
        lastStatus: 'skipped',
        lastMessage: 'daily cap reached',
        nextRunAt: nextRunAt(a.everyMinutes, now),
      });
      report.skipped++;
      continue;
    }

    const unlocked = await unlockAutomationWallet();
    if (!unlocked) {
      patch(a.id, {
        lastRunAt: new Date().toISOString(),
        lastStatus: 'skipped',
        lastMessage: 'automation wallet unavailable',
        nextRunAt: nextRunAt(a.everyMinutes, now),
      });
      report.skipped++;
      continue;
    }

    let result: SwapResult;
    try {
      result = await executeSwap(unlocked.account, {
        from: a.fromToken,
        to: a.toToken,
        amount: a.amount,
        affinity: 'from',
      });
    } catch (e) {
      result = { ok: false, usdValue: 0, error: (e as Error).message };
    }

    const ranAt = new Date().toISOString();
    const nextAt = nextRunAt(a.everyMinutes, now);
    const message = result.ok
      ? `${a.amount} ${a.fromToken} -> ${result.convertedAmount} ${a.toToken}`
      : (result.error ?? 'swap failed');

    patch(a.id, {
      lastRunAt: ranAt,
      nextRunAt: nextAt,
      lastStatus: result.ok ? 'executed' : 'failed',
      lastMessage: message,
    });

    if (result.ok) {
      report.executed++;
      await recordSpend(Math.min(result.usdValue, MAX_AUTOMATION_USD));
      report.details.push(`recurring ${a.name}: executed (${message})`);
    } else {
      report.failed++;
      report.details.push(`recurring ${a.name}: failed (${message})`);
    }

    await appendLog({
      automationId: a.id,
      kind: 'recurring',
      status: result.ok ? 'executed' : 'failed',
      message,
    });
  }

  await patchAutomations(patches);
  return report;
}

export function describeAutomation(a: Automation): string {
  if (a.kind === 'alert') {
    return `alert when ${a.symbol} ${a.op === 'gt' ? '>' : '<'} $${a.valueUsd}`;
  }
  return `every ${a.everyMinutes}m: ${a.amount} ${a.fromToken} -> ${a.toToken}`;
}
