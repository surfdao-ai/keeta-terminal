import { NextResponse } from 'next/server';
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { userClient, loadFXClient, decimalsFromMetadata, toDisplay, fromDisplay, getTokenInfo } from '@/lib/keeta/network';
import { getSession } from '@/lib/agent/session';
import { loadPending, removePending, appendTrade, capSpent, addCapSpend, dailyCapUsd, isExpired } from '@/lib/agent/safety';
import { unlockWallet } from '@/lib/keeta/wallet';
import { launchToken } from '@/lib/keeta/tokens';


export async function POST(req: Request) {
  const body = (await req.json()) as { tradeId?: string };
  const cookie = req.headers.get('cookie') ?? '';
  const sid = cookie.match(/kt_sid=([^;]+)/)?.[1];
  const session = getSession(sid);
  if (!session) return NextResponse.json({ error: 'Wallet locked.' }, { status: 401 });

  const tradeId = body.tradeId;
  if (!tradeId) return NextResponse.json({ error: 'tradeId required' }, { status: 400 });

  const pending = await loadPending(tradeId);
  if (!pending) return NextResponse.json({ error: 'Trade not found or already used.' }, { status: 404 });
  if (isExpired(pending)) {
    await removePending(tradeId);
    return NextResponse.json({ error: 'Trade proposal expired. Ask the agent to propose again.' }, { status: 410 });
  }

  try {
    const { account, address } = await unlockWallet(session.passphrase);
    const { fromToken: from, toToken: to, amount, affinity } = pending;

    // ---- token launch path (native tokenization, no contract) ----
    if (pending.kind === 'token') {
      if (!pending.token) {
        await removePending(tradeId);
        return NextResponse.json({ error: 'Invalid token launch request.' }, { status: 400 });
      }
      const result = await launchToken(account, pending.token);
      await removePending(tradeId);
      await appendTrade({
        id: tradeId,
        kind: 'token',
        fromToken: '',
        toToken: result.address,
        amount: pending.token.supply,
        affinity: 'from',
        convertedAmount: '0',
        provider: 'native-tokenization',
        exchangeId: null,
        createdAt: new Date().toISOString(),
        status: 'executed',
        capSpentUsd: 0,
        token: {
          address: result.address,
          symbol: result.symbol,
          supply: result.supply,
          decimals: result.decimals,
        },
      });
      return NextResponse.json({ ok: true, kind: 'token', token: result });
    }

    // Cap check: estimate USD value of the from side
    const fromInfo = await getTokenInfo(from).catch(() => ({ decimals: null }));
    const toInfo = await getTokenInfo(to).catch(() => ({ decimals: null }));
    const rawAmount = fromDisplay(amount, fromInfo.decimals);
    await using client = userClient(account);
    const fx = await loadFXClient(client);

    // try binding quote first
    const quotes = await fx.getQuotes({ from, to, amount: rawAmount, affinity } as unknown as Parameters<typeof fx.getQuotes>[0]);
    if (!quotes || quotes.length === 0) {
      await removePending(tradeId);
      await appendTrade({
        id: tradeId,
        kind: 'swap',
        fromToken: from,
        toToken: to,
        amount,
        affinity,
        convertedAmount: '0',
        provider: '',
        exchangeId: null,
        createdAt: new Date().toISOString(),
        status: 'failed',
        error: 'No binding quotes available right now (estimates only).',
        capSpentUsd: 0,
      });
      return NextResponse.json({ error: 'No binding quotes available right now. Try again later.' }, { status: 409 });
    }

    const provider = quotes[0];
    const q = provider.quote;
    // USD estimate via convertedAmount if `to` is a USD stablecoin; else conservative 0 (skip cap) — better: use price
    const convertedDisplay = toDisplay(q.convertedAmount, toInfo.decimals);
    // crude USD value: if to token symbol contains USD, use converted amount; else fall back to raw amount heuristic
    const toSym = (toInfo as { symbol?: string }).symbol ?? '';
    let usdValue = 0;
    if (/USD/i.test(toSym)) usdValue = Number(convertedDisplay);
    else if (/USD/i.test((fromInfo as { symbol?: string }).symbol ?? '')) usdValue = Number(amount);

    const spent = await capSpent();
    const cap = dailyCapUsd();
    if (usdValue > 0 && spent + usdValue > cap) {
      await removePending(tradeId);
      return NextResponse.json({ error: `Daily cap exceeded: ${spent.toFixed(2)} + ${usdValue.toFixed(2)} > ${cap}` }, { status: 403 });
    }

    // execute
    const exchange = await (provider as { createExchange: (i: unknown) => Promise<unknown> }).createExchange({ quote: q });
    const exchangeId = (exchange as { exchange?: { id?: string } })?.exchange?.id ?? null;

    await removePending(tradeId);
    if (usdValue > 0) await addCapSpend(usdValue);
    await appendTrade({
      id: tradeId,
      kind: 'swap',
      fromToken: from,
      toToken: to,
      amount,
      affinity,
      convertedAmount: convertedDisplay,
      provider: String(provider.provider?.providerID ?? 'unknown'),
      exchangeId,
      createdAt: new Date().toISOString(),
      status: 'executed',
      capSpentUsd: usdValue,
    });

    return NextResponse.json({
      ok: true,
      convertedAmount: convertedDisplay,
      provider: String(provider.provider?.providerID ?? 'unknown'),
      exchangeId,
      capSpentUsd: usdValue,
      newCapSpent: await capSpent(),
    });
  } catch (e) {
    await removePending(tradeId).catch(() => {});
    await appendTrade({
      id: tradeId,
      kind: 'swap',
      fromToken: pending.fromToken,
      toToken: pending.toToken,
      amount: pending.amount,
      affinity: pending.affinity,
      convertedAmount: '0',
      provider: '',
      exchangeId: null,
      createdAt: new Date().toISOString(),
      status: 'failed',
      error: (e as Error).message,
      capSpentUsd: 0,
    }).catch(() => {});
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
