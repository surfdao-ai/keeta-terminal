/**
 * Automation runner — evaluates price alerts and executes due recurring swaps.
 *
 * Called by the scheduled function (every 15 min on Hobby) and by the client
 * tick while the app is open.
 */
import {
  listAutomations,
  saveAutomations,
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
  let changed = false;

  for (const a of list) {
    if (!a.enabled) continue;
    report.checked++;

    if (a.kind === 'alert') {
      const price = await getTokenPriceUsd(a.symbol).catch(() => null);
      a.lastCheckedAt = new Date().toISOString();
      if (price !== null) a.lastPriceUsd = price;
      changed = true;

      if (price === null) {
        report.skipped++;
        report.details.push(`alert ${a.name}: no price source`);
        continue;
      }

      const hit = a.op === 'gt' ? price > a.valueUsd : price < a.valueUsd;
      if (hit && !a.triggered) {
        a.triggered = true;
        a.triggeredAt = new Date().toISOString();
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
      a.lastRunAt = new Date().toISOString();
      a.lastStatus = 'skipped';
      a.lastMessage = 'no automation wallet';
      a.nextRunAt = nextRunAt(a.everyMinutes, now);
      report.skipped++;
      changed = true;
      continue;
    }

    const remaining = await capRemainingUsd();
    if (remaining <= 0) {
      a.lastRunAt = new Date().toISOString();
      a.lastStatus = 'skipped';
      a.lastMessage = 'daily cap reached';
      a.nextRunAt = nextRunAt(a.everyMinutes, now);
      report.skipped++;
      changed = true;
      continue;
    }

    const unlocked = await unlockAutomationWallet();
    if (!unlocked) {
      a.lastRunAt = new Date().toISOString();
      a.lastStatus = 'skipped';
      a.lastMessage = 'automation wallet unavailable';
      a.nextRunAt = nextRunAt(a.everyMinutes, now);
      report.skipped++;
      changed = true;
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

    a.lastRunAt = new Date().toISOString();
    a.nextRunAt = nextRunAt(a.everyMinutes, now);

    if (result.ok) {
      a.lastStatus = 'executed';
      a.lastMessage = `${a.amount} ${a.fromToken} -> ${result.convertedAmount} ${a.toToken}`;
      report.executed++;
      await recordSpend(Math.min(result.usdValue, MAX_AUTOMATION_USD));
      report.details.push(`recurring ${a.name}: executed (${a.lastMessage})`);
    } else {
      a.lastStatus = 'failed';
      a.lastMessage = result.error ?? 'swap failed';
      report.failed++;
      report.details.push(`recurring ${a.name}: failed (${a.lastMessage})`);
    }

    await appendLog({
      automationId: a.id,
      kind: 'recurring',
      status: result.ok ? 'executed' : 'failed',
      message: a.lastMessage,
    });
    changed = true;
  }

  if (changed) await saveAutomations(list);
  return report;
}

export function describeAutomation(a: Automation): string {
  if (a.kind === 'alert') {
    return `alert when ${a.symbol} ${a.op === 'gt' ? '>' : '<'} $${a.valueUsd}`;
  }
  return `every ${a.everyMinutes}m: ${a.amount} ${a.fromToken} -> ${a.toToken}`;
}
