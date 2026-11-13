# Keeta Terminal

An AI chat trading terminal for the Keeta Network — a bnkr.bot-style agent, but for Keeta.

## Features

- Streaming AI chat (any provider) with Keeta-specific tools
- **Sign-in with a wallet signature** — one-time nonce, browser-side signature, httpOnly session cookie
- **One terminal per visitor** — every record is scoped to the signed-in address
- Non-custodial wallet: the seed is held by the device (passkey or passphrase sealed), the server stores only the public address
- **The seed never leaves the browser** — trades are proposed by the server, signed in the browser, and only the signed block is sent back
- Atomic swaps via Keeta FX anchors (propose → confirm → sign in the browser on every trade)
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

The terminal keeps every piece of state in one key/value store: the trade log,
the daily spend cap, the automations, the saved chats and the public wallet
address. Every key is scoped to the signed-in wallet address
(`u:<address>:<key>`), so one visitor can never read or overwrite another's
state. Three backends, picked automatically:

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

## Tests

Two acceptance scripts drive the app over HTTP the way a browser would — they
sign in with a wallet key they keep to themselves and never put a seed on the
wire:

```bash
npm run build && npx next start -p 3111
BASE=http://localhost:3111 node scripts/security-test.mjs
BASE=http://localhost:3111 node scripts/trade-test.mjs
```

`security-test.mjs` checks that every protected route answers 401 without a
session, that two wallets each see only their own state, that a POST without
the CSRF token is refused, and that a body carrying a seed is ignored and never
stored.

`trade-test.mjs` walks the whole trade: the agent proposes it, the server
prepares a binding quote (without a key), the browser signs the swap block, and
the server forwards only the signed block to the FX provider.

`npm run test:vault` exercises the vault on its own: seal, store, open, and the
failure modes (wrong passphrase, tampered ciphertext, short passphrase).

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

Open http://localhost:3000, create or import a wallet (the seed is generated in your browser — write it down), unlock it, and sign in. Then ask:

- "what's my portfolio?"
- "list tradable tokens"
- "estimate 1 KTA to USDC"
- "propose trading 0.1 KTA for USDC"

Confirm trades in the UI — the browser signs them. The daily cap defaults to $100 and is enforced in the browser before signing and again on the server.

## Keys and the wallet

**The seed never lives on the server.** The server's wallet record is the public
address and two timestamps — nothing that could sign.

```
server (Postgres)   wallet → { address, createdAt, updatedAt }
device (browser)    vault  → { seed sealed with a device key }
```

How the device holds it (`src/lib/vault.ts`):

| Vault | Key source | Daily unlock |
|---|---|---|
| **passkey** | WebAuthn PRF — derived inside the authenticator from a non-exportable, device-bound credential | Face ID / Touch ID tap |
| **passphrase** | PBKDF2-SHA256 (310k iterations) over a passphrase you choose | type the passphrase |

The passkey path needs the browser to support the WebAuthn **PRF** extension.
Chrome and Edge expose `PublicKeyCredential.getClientCapabilities()`, so the app
knows up front and offers the passkey first. Safari does not expose that API —
and on iOS the PRF output is not always available — so the app defaults to the
**passphrase** there and only switches to a passkey if the device can actually
derive a key. If a passkey attempt fails, the vault falls back to the
passphrase instead of erroring out.

Without PRF a passkey can only *authenticate*, never derive a key, so it cannot
protect a locally stored seed any better than a passphrase can. The passkey is a
convenience win (no typing); the passphrase is the security boundary on devices
without PRF. In both cases the written-down seed is the recovery copy.

`npm run test:vault` exercises the vault: seal, store, open, and the failure
modes (wrong passphrase, tampered ciphertext, short passphrase).

**Create:** the browser generates the seed with the Keeta client (its browser
build), shows it once so you can write it down, then seals it into the vault.
Only the public address is registered with the server.

**Import:** paste an existing seed — the address is derived in the browser and
registered. Nothing secret is sent.

**Daily use:** unlock with Face ID (or the passphrase) and sign in. The seed is
used **in the browser** and never travels: what leaves the browser is a
signature, never the key. The session cookie carries no key material at all, so
a stolen cookie is worthless and a database dump is worthless.

The written-down seed is the **recovery** copy: it restores the vault on a new
device. It is never typed in normal use.

## Sign-in

Every visitor gets their own terminal, and the session is what proves whose it is:

```
1  POST /api/auth/nonce     the server issues a one-time nonce
2  the browser signs it      with the wallet key, in the browser
3  POST /api/auth/login      the server verifies the signature against the public key
4  the server sets           kt_session (httpOnly, secure, SameSite=strict)
                             kt_csrf    (readable — echoed in the x-kt-csrf header)
```

The session token is stateless and HMAC-signed (`SESSION_SECRET`, falling back
to `AUTOMATION_KEY`), and it names the wallet address. Everything that belongs
to a visitor — wallet address, spend cap, automations, watchlist, chats, trade
history — is stored under that address, so two browsers with two wallets see two
different terminals.

Every `/api` route except `nonce` and `login` answers **401** without a valid
session. Every mutating request must also echo the CSRF token (otherwise
**403**), and each session gets its own rate limit.

## Signing a trade

The server never holds a key, so it cannot sign. A trade therefore travels in
three steps:

```
1  prepare   the server asks the FX providers for a binding quote and returns
             an intent: amount, token, recipient, fee, provider
2  approve   the browser shows the intent and asks you to confirm it
3  sign      the browser builds the swap block locally, signs it with your key
             and posts back only the signed block
```

The server forwards that signed block to the provider's `createExchange`
endpoint and records the result. It never sees a seed, a private key, or an
unsigned transaction it could turn into a signed one.

**Automations** follow the same rule. The server holds no hot key, so a due
recurring swap can only *propose*: it queues an action that waits for you under
Automations, where you review it and sign it in your browser. For a swap that
should run unattended, you create a separate low-balance automation wallet in
the browser — its seed is sealed in your vault and the server only learns its
address, so it cannot move that money by itself. What that wallet holds is the
blast radius: park only what you are willing to lose. The daily cap is checked
in the browser before signing and again on the server.

## Notes

- Keeta has no smart contracts / no AMM or DEX. Liquidity comes from FX anchor providers; if no provider issues a binding quote for a pair, the terminal refuses to execute rather than fake it.
- Mainnet by default. Start with dust amounts.
- The Keeta skills come from the KeeSpecs MCP (`ks_list_skills`, `ks_read_skill`,
  plus the `ks_*` data tools). The agent reaches them as soon as a provider and
  a wallet are configured.- x402 paid reads (KeeSpecs deep analytics) are not wired in v1 — only free reads are exposed to the agent.
- The Vercel AI Gateway needs a credit card on the account before it will serve
  requests (`vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card`).
  Without one, use the "Model setup" dialog: Groq's free tier is the default,
  and "Free, no key" needs no account at all — neither touches the Vercel gateway.
- Automations run from the Vercel schedule every 15 minutes (`vercel.json` →
  `schedules.automations-run`). The schedule authenticates with
  `Authorization: Bearer $CRON_SECRET`; it evaluates alerts and proposes
  recurring swaps, but it never signs anything.
- The server keeps one throwaway account (`src/lib/keeta/ephemeral.ts`) purely
  because the Keeta FX client insists on a signing account when you ask it for
  a price. It holds a random key that is unrelated to any user wallet, is never
  sent anywhere and is never stored.

## Token launches

Keeta tokens are created natively on the ledger (CREATE_IDENTIFIER) with attributes, metadata and rules — there is no contract to deploy. From chat:

```
launch a token called KTW, ticker KTW, supply 1000000, 18 decimals
```

The agent proposes it, you confirm, and the browser signs the launch block and publishes it — the server never holds the key. The full supply is minted to your wallet, and `decimalPlaces` metadata is written so every client renders balances correctly. Creating a token needs KTA in the wallet for network fees.

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

## Deploying

The project is linked to this repository, so a push is a release:

```
git push origin main        -> a production deployment -> https://kterminal.vercel.app
```

`main` is the production branch. Every push to it builds and replaces the
production deployment; a pull request gets a preview URL instead. The
environment variables (`DATABASE_URL`, `SESSION_SECRET`, `CRON_SECRET`,
`DAILY_SPEND_CAP_USD`) live in the Vercel project, not in the repository.

To deploy by hand instead:

```bash
vercel --prod
```

## Stack

Next.js 16 (App Router) · AI SDK 7 · Vercel AI Gateway / any OpenAI-compatible provider · @keetanetwork/keetanet-client · @keetanetwork/anchor · KeeSpecs MCP · Postgres (optional)
