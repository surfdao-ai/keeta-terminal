# Keeta Terminal

An AI chat trading terminal for the Keeta Network — a bnkr.bot-style agent, but for Keeta.

## Features

- Streaming AI chat (any provider) with Keeta-specific tools
- Non-custodial wallet: passphrase-encrypted seed, AES-256-GCM, stored server-side
- Atomic swaps via Keeta FX anchors (propose → confirm on every trade)
- **Token launches** — create new native Keeta tokens from chat (no contract; supply minted to creator)
- Hard daily spend cap enforced in code before any block is signed
- Read-only Keeta market data via KeeSpecs MCP (prices, providers, tokens)
- Trade history log
- **PWA** — installable, offline shell, mobile-first layout

## Requirements

- Node.js 22+
- A Vercel AI Gateway API key (`AI_GATEWAY_API_KEY`) — or paste a provider key in the UI
- A durable store (see [Storage](#storage)) — required on Vercel

## Storage

The terminal keeps every piece of state in one key/value store: the encrypted
wallet seed, the trade log, the daily spend cap, the automations and the saved
chats. Three backends, picked automatically:

| Backend | Selected when | Notes |
|---|---|---|
| Postgres | `DATABASE_URL` is set | `kt_store` key/value table, created on first use. **Neon free tier** (no credit card). |
| Vercel Blob | `BLOB_STORE_ID` is set | one private JSON object per key, OIDC or read-write token |
| Local file | neither is set | `.data/terminal.json` — **development only** |

On Vercel the bundle filesystem is read-only (`/var/task`), so the file backend
cannot work there — writes fail with `ENOENT` and every function instance would
see a different store. Set `KV_BACKEND=postgres|blob|file` to pin one explicitly.

Because Blob objects are served through a CDN, reads use `useCache: false` —
otherwise a freshly written value is invisible for a short while.

Writes are compare-and-set: a writer states the revision it read and the write
only lands if nothing changed in between, so `dbUpdate()` retries instead of
silently dropping a concurrent change. That is what keeps the daily spend cap
and the automation list honest when the cron tick and the UI write at the same
time.

```bash
vercel install neon --billing-plan free_v3 -e production -e preview
```

Neon's free plan needs no credit card. It scales to zero when idle, so the
first query after a pause can take a moment.

`node scripts/blob-dump.mjs [storeId]` prints every key in a Blob store;
`node scripts/migrate-blob-to-postgres.mjs` copies a Blob store into Postgres.

## Run locally

```bash
cp .env.example .env.local
# edit .env.local: set AI_GATEWAY_API_KEY (optional — users can paste their own key in the UI)
npm install
npm run dev
```

## Model setup (any provider)

On first load the terminal shows a **Model setup** dialog. Pick a provider and paste your key:

- Vercel AI Gateway (uses server key / OIDC, or your own key) — *needs a credit card on the Vercel account*
- **Groq (free tier)** — the default; key from console.groq.com
- **Free, no key (Pollinations)** — works immediately, no account, no card
- OpenRouter
- Together
- Ollama Cloud (`https://ollama.com/v1`, key from ollama.com/settings/keys)
- Ollama (local)
- LM Studio (local)
- Custom OpenAI-compatible endpoint

Pick a provider and the dialog loads the models that endpoint actually serves
(`GET {baseUrl}/models`, proxied through `/api/models`) and offers them in a
dropdown — type a model id by hand if it is not listed. The list is fetched
server-side, so provider CORS rules do not matter and the key stays in the
browser.

The key is stored only in your browser (localStorage) and sent per request — never persisted server-side. You can reopen setup anytime via the "Model setup" button.

Open http://localhost:3000, create a wallet with a strong passphrase, then ask:

- "what's my portfolio?"
- "list tradable tokens"
- "estimate 1 KTA to USDC"
- "propose trading 0.1 KTA for USDC"

Confirm trades in the UI. The daily cap defaults to $100 and is enforced before signing.

## Notes

- Keeta has no smart contracts / no AMM or DEX. Liquidity comes from FX anchor providers; if no provider issues a binding quote for a pair, the terminal refuses to execute rather than fake it.
- Mainnet by default. Start with dust amounts.
- The unlock cookie is a passphrase sealed with a server key (AES-256-GCM), so the
  session survives instance changes and the passphrase is never stored at rest on
  the server. "Lock" drops the cookie in the browser — a copy taken before
  locking stays valid until it expires (8 hours).
- The Keeta skills come from the KeeSpecs MCP (`ks_list_skills`, `ks_read_skill`,
  plus the `ks_*` data tools). The agent reaches them as soon as a provider and
  a wallet are configured.
- x402 paid reads (KeeSpecs deep analytics) are not wired in v1 — only free reads are exposed to the agent.
- The Vercel AI Gateway needs a credit card on the account before it will serve
  requests (`vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card`).
  Without one, use the "Model setup" dialog: Groq's free tier is the default,
  and "Free, no key" needs no account at all — neither touches the Vercel gateway.
- Automations run from the Vercel schedule every 15 minutes (`vercel.json` →
  `schedules.automations-run`). The schedule authenticates with
  `Authorization: Bearer $CRON_SECRET`; unauthenticated callers may still
  evaluate alerts but never sign a swap.

## Token launches

Keeta tokens are created natively on the ledger (CREATE_IDENTIFIER) with attributes, metadata and rules — there is no contract to deploy. From chat:

```
launch a token called KTW, ticker KTW, supply 1000000, 18 decimals
```

The agent proposes it, you confirm, and the terminal creates the token, mints the full supply to your wallet, and writes `decimalPlaces` metadata so every client renders balances correctly. Creating a token needs KTA in the wallet for network fees.

Regenerate PWA icons after changing `public/icon.svg`:

```bash
node scripts/generate-icons.mjs
```

## PWA

- `public/manifest.webmanifest` — installable, standalone, maskable icon
- `public/sw.js` — app-shell caching (API requests are never cached)
- iOS: Share → Add to Home Screen
- The shell is pinned to the layout viewport (`body` is fixed, `overscroll-behavior: none`),
  so opening the keyboard no longer resizes or scrolls the app. The keyboard's height is
  published as `--kb` by `<ViewportLock />` and the composer is lifted above it.

## Stack

Next.js 16 (App Router) · AI SDK 7 · Vercel AI Gateway / any OpenAI-compatible provider · @keetanetwork/keetanet-client · @keetanetwork/anchor · KeeSpecs MCP · Postgres (optional)
