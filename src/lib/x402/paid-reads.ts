/**
 * x402 paid reads on Keeta.
 *
 * KeeSpecs sells some market reads for 0.01–0.02 USDC per call. A paid read
 * answers HTTP 402 with its payment requirement; the buyer (this wallet) signs
 * one plain Keeta send block — USDC to the merchant's treasury — and retries
 * the same URL with a PAYMENT-SIGNATURE header. The merchant's facilitator
 * verifies the block on the ledger, settles it and pays the network fee. The
 * buyer never talks to the facilitator.
 *
 * PAYMENT-SIGNATURE is standard base64 of JSON: { block: "<base64 signed
 * block>" } — confirmed against the live endpoint (it rejects any other
 * encoding with "must be standard base64 JSON").
 *
 * Safety: the payee must be the known KeeSpecs treasury (never a fresh
 * address arriving in a 402 body), the asset must be mainnet USDC, and the
 * price is capped per read. Spend is tracked against the owner's daily data
 * cap (separate from the trade cap).
 */
import { dbRead, dbUpdate } from '../db';
import { reserveDataCap, dataCapSpent, dataCapUsd } from '../agent/safety';

/** Mainnet USDC (the Circle-bridged stable; 6 decimals). */
export const USDC_MAINNET =
  'keeta_amnkge74xitii5dsobstldatv3irmyimujfjotftx7plaaaseam4bntb7wnna';

/** The Keeta mainnet CAIP-2 id in x402 requirement form. */
const KEETA_MAINNET = 'keeta:21378';

/**
 * Payees this wallet is allowed to send data payments to. A 402 body is
 * untrusted input — a forged or confused endpoint could name any address, so
 * only this allowlist is ever funded.
 */
const KNOWN_PAYEES = new Set([
  // KeeSpecs treasury (the payTo on every keespecs.xyz 402, as observed).
  'keeta_aabz6zxbs2n4r7iiobclndobrnowxdf4pjrb5lwe6bvpeo564bot6krjbrsbbvy',
]);

/** Hard ceiling for a single read, in USDC. Anything pricier is refused. */
const MAX_PRICE_USDC = 0.05;

/**
 * The only host we are willing to fetch with a payment attached. The payUrl
 * comes from a model tool call, which is untrusted input — a prompt injection
 * could name any URL. Only KeeSpecs' own API is ever paid.
 */
const ALLOWED_PAY_HOSTS = new Set(['keespecs.xyz', 'www.keespecs.xyz']);

/** Why a payUrl must not be fetched with a payment attached, or null when ok. */
export function validatePayUrl(payUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(payUrl);
  } catch {
    return 'not a valid URL';
  }
  if (url.protocol !== 'https:') return 'payment URL must be https';
  if (!ALLOWED_PAY_HOSTS.has(url.hostname)) {
    return `payments are only made to ${[...ALLOWED_PAY_HOSTS].join(' / ')} — refusing ${url.hostname}`;
  }
  if (!url.pathname.startsWith('/api/')) return 'payment URL must be a keespecs /api/ read';
  return null;
}

const USDC_DECIMALS = 6;

export interface PaymentRequirement {
  scheme: string;
  network: string;
  /** Ledger base units of the asset. */
  amount: string;
  asset: string;
  payTo: string;
}

export interface PendingDataPayment {
  id: string;
  /** The paid URL the block is for (retried with PAYMENT-SIGNATURE). */
  payUrl: string;
  /** What the read is, in words, for the confirm card. */
  label: string;
  requirement: PaymentRequirement;
  priceUsd: number;
  createdAt: number;
  expiresAt: number;
}

export interface DataReadRecord {
  id: string;
  label: string;
  payUrl: string;
  priceUsd: number;
  /** The settled payment's block hash, when the merchant reported one. */
  txHash: string | null;
  at: string;
  /** The read's JSON response (truncated to keep the store small). */
  response: string;
}

const PAYMENT_TTL_MS = 120_000;

export async function saveDataPayment(
  owner: string,
  p: PendingDataPayment,
): Promise<void> {
  await dbUpdate<PendingDataPayment[]>('dataPayments', (current) => {
    const all = Array.isArray(current) ? current : [];
    return [p, ...all].slice(0, 20);
  }, { owner });
}

export async function loadDataPayment(
  owner: string,
  id: string,
): Promise<PendingDataPayment | null> {
  const raw = await dbRead<PendingDataPayment[]>('dataPayments', owner);
  const all = Array.isArray(raw) ? raw : [];
  const p = all.find((x) => x.id === id) ?? null;
  if (p && Date.now() > p.expiresAt) return null;
  return p;
}

export async function removeDataPayment(owner: string, id: string): Promise<void> {
  await dbUpdate<PendingDataPayment[]>('dataPayments', (current) => {
    const all = Array.isArray(current) ? current : [];
    return all.filter((x) => x.id !== id);
  }, { owner });
}

/**
 * Parse a payment requirement out of a 402 answer — either the JSON body or
 * the base64 PAYMENT-REQUIRED header value.
 */
export function parsePaymentRequirement(input: {
  body?: unknown;
  headerB64?: string;
}): PaymentRequirement | null {
  let json: unknown = input.body;
  if (json === undefined && input.headerB64) {
    try {
      json = JSON.parse(Buffer.from(input.headerB64, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }
  if (!json || typeof json !== 'object') return null;
  const o = json as { accepts?: unknown };
  const accepts = Array.isArray(o.accepts) ? o.accepts : [];
  const first = accepts[0] as
    | { scheme?: unknown; network?: unknown; amount?: unknown; asset?: unknown; payTo?: unknown }
    | undefined;
  if (
    !first ||
    first.scheme !== 'exact' ||
    typeof first.network !== 'string' ||
    typeof first.amount !== 'string' ||
    typeof first.asset !== 'string' ||
    typeof first.payTo !== 'string'
  ) {
    return null;
  }
  return {
    scheme: first.scheme,
    network: first.network,
    amount: first.amount,
    asset: first.asset,
    payTo: first.payTo,
  };
}

/** Why a requirement must not be paid, or null when it is safe. */
export function validateRequirement(req: PaymentRequirement): string | null {
  if (req.scheme !== 'exact') return `unsupported scheme "${req.scheme}"`;
  if (req.network !== KEETA_MAINNET) return `unsupported network "${req.network}"`;
  if (req.asset !== USDC_MAINNET) return 'payment asset is not mainnet USDC';
  if (!KNOWN_PAYEES.has(req.payTo)) {
    return 'payee is not a known data provider — refusing';
  }
  let base: bigint;
  try {
    base = BigInt(req.amount);
  } catch {
    return 'bad payment amount';
  }
  if (base <= 0n) return 'bad payment amount';
  const usdc = Number(base) / 10 ** USDC_DECIMALS;
  if (!Number.isFinite(usdc) || usdc <= 0) return 'bad payment amount';
  if (usdc > MAX_PRICE_USDC) {
    return `price $${usdc.toFixed(2)} exceeds the $${MAX_PRICE_USDC} per-read limit`;
  }
  return null;
}

export function priceUsdOf(req: PaymentRequirement): number {
  try {
    return Number(BigInt(req.amount)) / 10 ** USDC_DECIMALS;
  } catch {
    return NaN;
  }
}

/**
 * Run a paid GET with a browser-signed payment block.
 *
 * The block is what the browser built (USDC → payTo). We attach it as
 * PAYMENT-SIGNATURE and fetch the same URL the 402 came from.
 */
export async function executePaidGet(
  payUrl: string,
  signedBlockB64: string,
): Promise<{ ok: boolean; status: number; body: string; txHash: string | null; error?: string }> {
  const header = Buffer.from(
    JSON.stringify({ block: signedBlockB64 }),
    'utf8',
  ).toString('base64');

  let res: Response;
  try {
    res = await fetch(payUrl, {
      headers: { 'PAYMENT-SIGNATURE': header, accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { ok: false, status: 0, body: '', txHash: null, error: (e as Error).message };
  }

  const body = await res.text();
  const txHash =
    (res.headers.get('PAYMENT-RESPONSE') &&
      parseTxHash(res.headers.get('PAYMENT-RESPONSE')!)) ??
    parseTxHashFromJson(body);

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      body: body.slice(0, 300),
      txHash,
      error: `the merchant answered ${res.status}: ${body.slice(0, 200)}`,
    };
  }
  return { ok: true, status: res.status, body, txHash };
}

function parseTxHash(b64: string): string | null {
  try {
    const j = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as {
      transaction?: string;
      txHash?: string;
    };
    return j.transaction ?? j.txHash ?? null;
  } catch {
    return null;
  }
}

function parseTxHashFromJson(body: string): string | null {
  try {
    const j = JSON.parse(body) as { payment?: { transaction?: string } };
    return j.payment?.transaction ?? null;
  } catch {
    return null;
  }
}

const MAX_RESPONSE_BYTES = 100_000;

export async function saveDataRead(
  owner: string,
  rec: DataReadRecord,
): Promise<void> {
  const rec2 = {
    ...rec,
    response: rec.response.length > MAX_RESPONSE_BYTES
      ? rec.response.slice(0, MAX_RESPONSE_BYTES)
      : rec.response,
  };
  await dbUpdate<DataReadRecord[]>('dataReads', (current) => {
    const all = Array.isArray(current) ? current : [];
    return [rec2, ...all].slice(0, 50);
  }, { owner });
}

export async function latestDataRead(owner: string): Promise<DataReadRecord | null> {
  const raw = await dbRead<DataReadRecord[]>('dataReads', owner);
  return Array.isArray(raw) && raw.length > 0 ? raw[0] : null;
}

export async function dataCapState(owner: string): Promise<{
  capUsd: number;
  spentUsd: number;
  remainingUsd: number;
}> {
  const [capUsd, spentUsd] = await Promise.all([dataCapUsd(owner), dataCapSpent(owner)]);
  return { capUsd, spentUsd, remainingUsd: Math.max(0, capUsd - spentUsd) };
}

/** Re-exported so the submit route has one import site for the cap logic. */
export { reserveDataCap };
