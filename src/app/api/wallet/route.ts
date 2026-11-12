import { NextResponse } from 'next/server';
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { getWallet, registerWallet, addressFromSeed } from '@/lib/keeta/wallet';

/**
 * Wallet registry.
 *
 * The server only ever learns the *public address* of a wallet. The seed
 * stays on the device (see src/lib/vault.ts).
 *
 *   GET                      -> the registered address
 *   POST { action: 'register', address }  -> register a public address
 *   POST { action: 'derive', seed }       -> derive the address of a seed
 *                                             (nothing is stored; fallback
 *                                              for browsers that cannot run
 *                                              the Keeta client locally)
 *   POST { action: 'new-seed' }           -> the server generates a seed and
 *                                             hands it over once, for the
 *                                             same fallback. Never stored.
 */
export async function GET() {
  const wallet = await getWallet();
  return NextResponse.json({
    address: wallet?.address ?? null,
    createdAt: wallet?.createdAt ?? null,
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    address?: string;
    seed?: string;
  };

  try {
    if (body.action === 'register') {
      const wallet = await registerWallet(String(body.address ?? ''));
      return NextResponse.json({ ok: true, wallet });
    }

    if (body.action === 'derive') {
      const seed = String(body.seed ?? '').trim();
      if (!seed) return NextResponse.json({ error: 'seed required' }, { status: 400 });
      return NextResponse.json({ ok: true, address: addressFromSeed(seed) });
    }

    if (body.action === 'new-seed') {
      const seed = KeetaNet.lib.Account.generateRandomSeed({ asString: true });
      return NextResponse.json({ ok: true, seed, address: addressFromSeed(seed) });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
