/**
 * Positions and PnL.
 *
 * Built from two free sources: the live balances (a signed read) and our own
 * trade log. Cost basis is tracked with a weighted average per token, so the
 * PnL is only reported for tokens whose history we actually know — a token
 * funded from another wallet has no cost basis here and is marked as such
 * rather than guessed at.
 */
import { readBalances, getTokenInfo } from './network';
import type { KeetaAccount } from './network';
import { listTrades } from '../agent/safety';
import { getTokenPrice } from '../automations/prices';

export interface Position {
  token: string;
  amount: string;
  decimals: number | null;
  priceUsd: number | null;
  valueUsd: number | null;
  /** Average USD cost per whole unit, from the trade history. */
  avgCostUsd: number | null;
  /** USD still held at that average cost. */
  costUsd: number | null;
  /** Unrealised PnL for the part we have a cost basis for. */
  pnlUsd: number | null;
}

export interface PositionsResult {
  positions: Position[];
  totalValueUsd: number;
  totalCostUsd: number;
  totalPnlUsd: number;
  realisedPnlUsd: number;
  trades: number;
  /** Tokens we hold but have no cost basis for (funded elsewhere). */
  unpriced: string[];
}

const num = (v: string | number | undefined | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function computePositions(account: KeetaAccount): Promise<PositionsResult> {
  const balances = await readBalances(account);
  const trades = (await listTrades(300)).filter((t) => t.status === 'executed').reverse();

  // Average-cost tracker over the trade history.
  const qty = new Map<string, number>();
  const avgCost = new Map<string, number>();
  let realisedPnlUsd = 0;

  for (const t of trades) {
    if (t.kind !== 'swap') continue;
    const sold = num(t.amount);
    const received = num(t.convertedAmount);
    const usd = num(t.capSpentUsd);
    if (sold <= 0 && received <= 0) continue;

    // Selling: release the average cost of what we sold.
    const fromAvg = avgCost.get(t.fromToken) ?? 0;
    const held = qty.get(t.fromToken) ?? 0;
    if (held > 0 && fromAvg > 0) {
      const soldQty = Math.min(sold, held);
      const costReleased = soldQty * fromAvg;
      realisedPnlUsd += usd - costReleased;
      qty.set(t.fromToken, held - soldQty);
    } else if (sold > 0) {
      qty.set(t.fromToken, (held || 0) - sold);
    }

    // Receiving: fold the trade's USD value into the average cost.
    const toHeld = qty.get(t.toToken) ?? 0;
    const toAvg = avgCost.get(t.toToken) ?? 0;
    const newQty = toHeld + received;
    if (newQty > 0) {
      avgCost.set(t.toToken, (toHeld * toAvg + usd) / newQty);
    }
    qty.set(t.toToken, newQty);
  }

  const positions: Position[] = [];
  let totalValueUsd = 0;
  let totalCostUsd = 0;
  let totalPnlUsd = 0;
  const unpriced: string[] = [];

  for (const b of balances) {
    const amount = num(b.display);
    const price = await getTokenPrice(b.token).catch(() => null);
    const priceUsd = price?.priceUsd ?? null;
    const valueUsd = priceUsd !== null ? amount * priceUsd : null;

    const covered = Math.min(amount, qty.get(b.token) ?? 0);
    const avg = avgCost.get(b.token) ?? null;
    const costUsd = avg !== null && covered > 0 ? covered * avg : null;
    const pnlUsd = valueUsd !== null && costUsd !== null ? valueUsd - costUsd : null;

    if (valueUsd !== null) totalValueUsd += valueUsd;
    if (costUsd !== null) totalCostUsd += costUsd;
    if (pnlUsd !== null) totalPnlUsd += pnlUsd;
    if (costUsd === null) unpriced.push(b.token);

    positions.push({
      token: b.token,
      amount: b.display,
      decimals: b.decimals,
      priceUsd,
      valueUsd,
      avgCostUsd: avg,
      costUsd,
      pnlUsd,
    });
  }

  positions.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

  return {
    positions,
    totalValueUsd,
    totalCostUsd,
    totalPnlUsd,
    realisedPnlUsd,
    trades: trades.length,
    unpriced,
  };
}

/** Metadata for a token (name, symbol) — used to label positions. */
export async function tokenLabel(address: string): Promise<{ name: string; symbol: string } | null> {
  try {
    const info = await getTokenInfo(address);
    return { name: info.name, symbol: info.symbol };
  } catch {
    return null;
  }
}
