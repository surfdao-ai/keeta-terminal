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
import { probePairLiquidity } from '../keeta/liquidity';
import { tokenSymbol } from '../keeta/currencies';

export interface RunReport {
  checked: number;
  triggered: number;
  proposed: number;
  executed: number;
  failed: number;
  skipped: number;
  details: string[];
}

/**
 * Evaluate automations. With no owner it sweeps every automation owner — the
 * 15-minute schedule's job. A signed-in caller passes its address so the
 * in-app tick only evaluates *its* automations (a per-open-client sweep of the
 * whole network would not scale).
 */
export async function runAutomations(owner?: string): Promise<RunReport> {
  const report: RunReport = {
    checked: 0,
    triggered: 0,
    proposed: 0,
    executed: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  const owners = owner ? [owner] : await listAutomationOwners();

  // A run evaluates many owners' alerts against the SAME symbols. Fetching a
  // price once per symbol per run keeps the sweep from multiplying a network
  // call by the number of owners (at 500+ owners that difference is the
  // function timeout). The null result is cached too: if the source is down
  // for one owner, every other owner sees the same "no price" and we make
  // one failing request, not five hundred.
  const priceCache = new Map<string, number | null>();

  // Isolation: a single owner (a database hiccup, a failing FX read) must
  // not kill the whole sweep — the other owners still get their chance.
  for (const owner of owners) {
    try {
      await evaluateOwner(owner, report, priceCache);
    } catch (e) {
      console.error(`automations: sweep of ${owner} failed:`, e);
      report.failed++;
      report.details.push(`sweep ${owner}: ${(e as Error).message}`);
    }
  }

/**
 * Evaluate one owner's automations. Anything thrown propagates to the sweep
 * loop, which records the failure and still reaches the other owners.
 */
async function evaluateOwner(
  owner: string,
  report: RunReport,
  priceCache: Map<string, number | null>,
): Promise<void> {
  const list = await listAutomations(owner);
  const now = Date.now();
  const patches = new Map<string, Partial<Automation>>();

  for (const a of list) {
    if (!a.enabled) continue;
    report.checked++;

    if (a.kind === 'alert') {
      // One lookup per symbol per run — the cache holds the result, null
      // included, so a down source costs one failing request, not one per
      // owner.
      let price: number | null;
      if (priceCache.has(a.symbol)) {
        price = priceCache.get(a.symbol) ?? null;
      } else {
        price = await getTokenPriceUsd(a.symbol).catch(() => null);
        priceCache.set(a.symbol, price);
      }
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
      // One-shot: fire the first time the line is crossed, then stay armed
      // (triggered=true) until the user deletes it.
      // Repeat: fire on the crossing IN, re-arm the moment the price crosses
      // back out, so it notifies on every excursion — not every cycle.
      if (a.repeat && !hit && a.triggered) {
        patches.set(a.id, {
          ...(patches.get(a.id) ?? {}),
          triggered: false,
        });
      } else if (hit && !a.triggered) {
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

    if (a.kind === 'liquidity') {
      const probe = await probePairLiquidity(a.fromToken, a.toToken, '1').catch(
        () => null,
      );
      const at = new Date().toISOString();
      const pair = await pairLabel(a.fromToken, a.toToken);
      patches.set(a.id, {
        ...(patches.get(a.id) ?? {}),
        lastCheckedAt: at,
        lastState: probe?.state ?? 'unknown',
      });

      if (probe?.state === 'quoted' && (a.armed ?? true)) {
        patches.set(a.id, {
          ...(patches.get(a.id) ?? {}),
          armed: false,
          lastFiredAt: at,
        });
        report.triggered++;
        report.details.push(`liquidity ${a.name}: ${pair} now has live quotes`);
        await appendLog(owner, {
          automationId: a.id,
          kind: 'liquidity',
          status: 'triggered',
          message: `${pair} now has live liquidity`,
        });
      }
      continue;
    }

    // Recurring swap. The pair's live liquidity is refreshed every run so
    // the card always says the truth, not the last run's news.
    const probe = await probePairLiquidity(a.fromToken, a.toToken, a.amount).catch(
      () => null,
    );
    if (probe) {
      patches.set(a.id, {
        ...(patches.get(a.id) ?? {}),
        liquidity: { state: probe.state, at: new Date().toISOString(), ...(probe.estimate ? { estimate: probe.estimate } : {}) },
      });
    }

    const due = new Date(a.nextRunAt).getTime() <= now;
    if (!due) {
      report.skipped++;
      continue;
    }

    const remaining = await capRemainingUsd(owner);
    if (remaining <= 0) {
      patches.set(a.id, {
        ...(patches.get(a.id) ?? {}),
        lastRunAt: new Date().toISOString(),
        lastStatus: 'skipped',
        lastMessage: 'daily cap reached',
        nextRunAt: nextRunAt(a.everyMinutes, now),
      });
      report.skipped++;
      continue;
    }

    // No executable quote: nothing to sign. Skip this cycle and say why —
    // do not leave a pending card that can never be approved.
    if (probe?.state !== 'quoted') {
      const pair = await pairLabel(a.fromToken, a.toToken);
      const est = probe?.estimate ? ` · est ≈ ${probe.estimate}` : '';
      patches.set(a.id, {
        ...(patches.get(a.id) ?? {}),
        lastRunAt: new Date().toISOString(),
        lastStatus: 'skipped',
        lastMessage: `no live liquidity for ${pair}${est} — retrying`,
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
      ...(patches.get(a.id) ?? {}),
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

/** "KTA→USDC" in words, from either symbols or token addresses. */
async function pairLabel(from: string, to: string): Promise<string> {
  const [f, t] = await Promise.all([
    tokenSymbol(from).catch(() => from.slice(0, 10) + '…'),
    tokenSymbol(to).catch(() => to.slice(0, 10) + '…'),
  ]);
  return `${f}→${t}`;
}

export function describeAutomation(a: Automation): string {
  if (a.kind === 'alert') {
    const repeat = a.repeat ? ' (repeat)' : '';
    return `alert when ${a.symbol} ${a.op === 'gt' ? '>' : '<'} $${a.valueUsd}${repeat}`;
  }
  if (a.kind === 'liquidity') {
    return `alert when ${a.fromToken} -> ${a.toToken} has live liquidity`;
  }
  return `every ${a.everyMinutes}m: ${a.amount} ${a.fromToken} -> ${a.toToken}`;
}
