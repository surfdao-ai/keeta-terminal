import { NextResponse } from 'next/server';
import { guardRead, guardWrite, ownerOf } from '@/lib/auth/guard';
import { readPublicBalances } from '@/lib/keeta/public-reads';
import { newPendingTrade, savePending, listLaunches, appendLaunch } from '@/lib/agent/safety';

/**
 * The token directory for the Launchpad's Discover tab.
 *
 * Keeta has no public token-listing API of its own, so this proxies KeeSpecs'
 * free directory (code, name, address, decimals, supply, sends) plus the free
 * KTA price feed, and enriches each row with the wallet's own balance. The
 * whole payload is cached for a couple of minutes server-side: the directory
 * moves slowly and the app polls it on every view open.
 */

const KEESPECS_DIRECTORY = 'https://keespecs.xyz/api/directory';
const KEESPECS_PRICE = 'https://keespecs.xyz/api/price';

interface DirectoryRow {
  code: string;
  name: string;
  token: string;
  decimals: number;
  supply: string;
  sends: number;
}

interface DirectoryCache {
  at: number;
  rows: DirectoryRow[] | null;
  price: { priceUsd: number | null; change24hPct: number | null; asOf: string } | null;
}

const CACHE_TTL_MS = 2 * 60_000;
let cache: DirectoryCache | null = null;

async function fetchDirectory(): Promise<DirectoryRow[]> {
  const res = await fetch(KEESPECS_DIRECTORY, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`keespecs directory: ${res.status}`);
  const json = (await res.json()) as { tokens?: DirectoryRow[] };
  const rows = Array.isArray(json.tokens) ? json.tokens : [];
  return rows.filter((r) => r && typeof r.token === 'string' && typeof r.code === 'string');
}

async function fetchKtaPrice(): Promise<{ priceUsd: number | null; change24hPct: number | null; asOf: string }> {
  try {
    const res = await fetch(KEESPECS_PRICE, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`keespecs price: ${res.status}`);
    const json = (await res.json()) as { priceUsd?: number; change24hPct?: number; asOf?: string };
    return {
      priceUsd: typeof json.priceUsd === 'number' ? json.priceUsd : null,
      change24hPct: typeof json.change24hPct === 'number' ? json.change24hPct : null,
      asOf: json.asOf ?? new Date().toISOString(),
    };
  } catch {
    return { priceUsd: null, change24hPct: null, asOf: new Date().toISOString() };
  }
}

export async function GET(req: Request) {
  const { session, error } = await guardRead(req);
  if (error) return error;

  const now = Date.now();
  if (!cache || now - cache.at > CACHE_TTL_MS) {
    const [dir, price] = await Promise.all([fetchDirectory().catch(() => null), fetchKtaPrice()]);
    cache = { at: now, rows: dir, price };
  }

  const dir = cache?.rows ?? null;
  if (dir === null) {
    return NextResponse.json(
      { error: 'The token directory is unavailable right now. Try again shortly.' },
      { status: 502 },
    );
  }

  // The wallet's own balances, attached so the UI can dim quick-buy for tokens
  // the wallet holds a lot of (you usually sell those, not buy them).
  const balances = await readPublicBalances(session.address).catch(() => null);
  const balanceByToken = new Map<string, string>();
  for (const b of balances ?? []) {
    if (b.display !== '0' && b.decimals !== null) balanceByToken.set(b.token, b.display);
  }

  const rows = dir.map((r) => ({
    code: r.code,
    name: r.name,
    token: r.token,
    decimals: r.decimals,
    supply: r.supply,
    sends: r.sends ?? 0,
    balance: balanceByToken.get(r.token) ?? null,
  }));

  const launches = await listLaunches(ownerOf(session)).catch(() => []);

  // The wallet's USDC balance, so the page can pick the quick-buy source:
  // USDC when the wallet holds some, KTA otherwise. Resolved from the
  // directory itself (no hardcoded address).
  const usdcRow = dir.find((r) => r.code.toUpperCase() === 'USDC');
  const usdcBalance = usdcRow ? (balanceByToken.get(usdcRow.token) ?? null) : null;

  return NextResponse.json({
    asOf: cache?.price?.asOf ?? new Date().toISOString(),
    ktaPrice: cache?.price ?? null,
    usdcBalance,
    tokens: rows,
    launches,
  });
}

/**
 * POST — two launchpad actions that need no separate route:
 *
 *  { action: 'quickBuy', from, token, amount }
 *    Creates a pending swap of `amount` `from` → `token` and returns its id,
 *    the way propose_trade does. The page already picked the source and amount;
 *    the UI then prepares, confirms and signs it.
 *
 *  { action: 'recordLaunch', launch }
 *    Appends a token the wallet just launched to its per-owner history.
 */
export async function POST(req: Request) {
  const { session, error } = await guardWrite(req);
  if (error) return error;
  const owner = ownerOf(session);

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    from?: string;
    token?: string;
    amount?: string;
    launch?: { address: string; symbol: string; name: string; supply: string; decimals: number };
  };

  if (body.action === 'quickBuy') {
    if (!body.token || !body.from || !body.amount) {
      return NextResponse.json({ error: 'from, token and amount are required' }, { status: 400 });
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
    }
    // The page already picked the source (USDC, or KTA when the wallet has no
    // USDC) and the amount to send; here we only persist the proposal. The
    // prepare step resolves it to an address and the provider converts.
    const pending = newPendingTrade({
      kind: 'swap',
      fromToken: body.from,
      toToken: body.token,
      amount: body.amount,
      affinity: 'from',
    });
    await savePending(owner, pending);
    return NextResponse.json({ tradeId: pending.id, expiresAt: pending.expiresAt });
  }

  if (body.action === 'recordLaunch') {
    const l = body.launch;
    if (!l?.address || !l.address.startsWith('keeta_')) {
      return NextResponse.json({ error: 'a valid launch address is required' }, { status: 400 });
    }
    await appendLaunch(owner, {
      address: l.address,
      symbol: l.symbol ?? '?',
      name: l.name ?? l.symbol ?? '?',
      supply: l.supply ?? '0',
      decimals: Number.isInteger(l.decimals) ? l.decimals : 18,
      at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
