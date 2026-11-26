# Keeta Terminal

An AI chat trading terminal for the Keeta Network — a bnkr.bot-style agent, but for Keeta.

## Features

- Streaming AI chat (any provider) with Keeta-specific tools
- **Sign-in with a wallet signature** — one-time nonce, browser-side signature, httpOnly session cookie
- **One terminal per visitor** — every record is scoped to the signed-in address
- Non-custodial wallet: the seed is held by the device (passkey or passphrase sealed), the server stores only the public address
- **The seed never leaves the browser** — trades are proposed by the server, signed in the browser, and only the signed block is sent back
- Atomic swaps via Keeta FX anchors (propose → confirm → sign in the browser on every trade)
- **Launchpad** — a dedicated 🚀 view to launch native Keeta tokens, browse the live token directory (Top / Trending / search), and quick-buy ($10/$25/$50/$100) — every buy runs the normal propose → confirm → sign flow
- **Token launches** — create new native Keeta tokens from chat or the Launchpad (no contract; supply minted to creator)
- **Automations** — price alerts (one-shot or repeat), "liquidity is back" alerts, and recurring (DCA) swaps that propose on schedule and fill when you sign; a fired alert raises a banner + chime in the app
- Hard daily spend cap enforced in code before any block is signed, plus a separate smaller daily cap for paid data reads
- Read-only Keeta market data via KeeSpecs MCP (prices, providers, tokens, username resolution)
- **Paid data reads (x402)** — the paid KeeSpecs reads (ledger status, KTA price comparison, throughput, …) work through the same propose → confirm → sign flow: the agent quotes the price for free, you approve, the browser signs one USDC send, and the merchant settles it
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

Eleven scripts drive the app the way a browser would — they sign in with a
wallet key they keep to themselves and never put a seed on the wire:

```bash
npm run build && npx next start -p 3111
BASE=http://localhost:3111 npm run test:security
BASE=http://localhost:3111 npm run test:trade
BASE=http://localhost:3111 npm run test:route
BASE=http://localhost:3111 npm run test:wallet
BASE=http://localhost:3111 npm run test:screen
BASE=http://localhost:3111 npm run test:csrf
BASE=http://localhost:3111 npm run test:delete
BASE=http://localhost:3111 npm run test:automations
npm run test:alerts
npm run test:vault
npm run test:card
# x402 paid data reads: validation units, data-cap CAS units, and the
# endpoint e2e (state/settings/401/409 paths) — no funded wallet needed
npm run test:x402
npm run test:datacap
BASE=http://localhost:3111 npm run test:data-pay
# balance gate: seed PHASE with the server stopped, submit PHASE with it up
# (server down → `npx tsx scripts/data-pay-balance-test.mjs`; server up →
# `BASE=http://localhost:3111 PHASE=submit npx tsx scripts/data-pay-balance-test.mjs`)
```

`test:security` checks that every protected route answers 401 without a
session, that two wallets each see only their own state, that a POST without
the CSRF token is refused, and that a body carrying a seed is ignored and never
stored.

`test:trade` walks the whole trade: the agent proposes it, the server
prepares a binding quote (without a key), the browser signs the swap block, and
the server forwards only the signed block to the FX provider.

`test:route` checks the routing policy: the quote picker (best outcome,
on-chain within tolerance as the tie-break — unit-tested without a network),
that a live fill names its route ("base anchor" / "on-chain"), and that a pair
with no live liquidity answers gracefully with the estimate instead of a hard
error.

`test:card` renders the portfolio and positions cards with fixture data and
checks the numbers a person would read are on screen.

`test:automations` drives the automation engine with a throwaway wallet: a
price alert that should fire (and one that must not) against the live KTA
price, a one-shot liquidity alert (fires the first time a pair starts quoting;
a dry pair stays armed), a repeating price alert (fires on the crossing, not
on every cycle), and a recurring (DCA) swap — forced past its due time on the
local file store — which must *propose* a pending trade to sign when the pair
is quoting and *skip with a reason* when it is dry (never auto-executes; the
key stays in the browser). On a Postgres/Blob backend the force-due step is
skipped and it instead checks a not-yet-due swap is left alone.

`test:alerts` unit-tests the alert-surfacing helper — which fired alert is
"new" relative to a watermark — so the app's banner and chime fire exactly
once per alert, not on every poll and not for alerts that fired before the app
opened.

`test:wallet` walks the wallet flow — create, import, unlock, sign in — against
the real server, with the browser bits (localStorage, cookies) simulated.

`test:screen` renders the sign-in screen in a DOM and clicks through it: create
a wallet, write the seed down, sign in, come back later and unlock, and try the
wrong passphrase. It is the test that catches a broken step in the flow.

`test:csrf` drives the real screens — sign in, then prompt the terminal, save
the chat, open a skill — and checks that every mutating request that leaves the
browser carries the session's CSRF token. It is the regression for the
"CSRF check failed" prompts: the AI SDK's chat transport builds its own
request and had to be taught to send the header too.

`test:delete` walks the delete-wallet flow end to end: save a chat and raise
the cap, delete the wallet from the Wallet panel, and check that the sealed
vault is wiped from the device, the server no longer knows the address, the
cap reverts to the default, the chat is gone, and a delete without the CSRF
token is refused.

`test:vault` exercises the vault on its own: seal, store, open, and the
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

### Find free providers

At the top of Model setup there is a **"Find free providers"** button. It runs a live probe of a curated list of free-inference providers and ranks the results in two groups:

- **works now — no key** — probed with a real minimal chat request, so a hit genuinely answers right now with no account.
- **free key required** — reachable, but needs a free account key (a future key can't be verified ahead of time, and the UI says so).

Dead providers are listed collapsed at the bottom with the reason. Tapping **use** on a result fills in the base URL and model so it saves like any other preset.

The result is session-only (nothing is cached server-side), and the scan is rate-limited to a few runs per minute. The candidate list lives in **`src/lib/providers/scan.ts`** — that is the single file to edit when a provider appears, dies, or changes its free tier (it decays monthly; the probe is what keeps the UI honest about it).

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

## Paid data reads (x402)

Some KeeSpecs market reads are sold per call (0.01–0.02 USDC): ledger status,
the KTA price comparison, throughput, settlement time, market regime, and the
desk/network/convert-check bundles. They use the x402 payment protocol on
Keeta: the paid URL answers `402 Payment Required` with its payment
requirement, and the buyer retries the same URL with a `PAYMENT-SIGNATURE`
header — standard base64 of `{ "block": "<base64 signed block>" }`, where the
block is a plain Keeta USDC send to the merchant. The merchant's facilitator
verifies the block on the ledger, settles it (about 400 ms) and pays the
network fee; the buyer never talks to the facilitator.

The terminal runs the same rule as for trades:

```
1  quote     the agent calls the free ks_quote_* MCP tool, which returns the
             402 requirement (price, payee, asset) instead of the data
2  propose   the agent calls propose_data_payment; the server re-validates the
             requirement and stores it (2-minute expiry)
3  approve   a pay card appears in the chat: exact price, payee, and how much
             of your daily data cap is left — nothing is paid without the tap
4  sign      the browser reads the stored requirement back from the server,
             signs one USDC send block locally (the seed stays in the browser)
             and posts only the block
5  settle    the server reserves the data cap, retries the paid URL with the
             block, stores the response, and shows it in the chat with the
             receipt (settled block hash)
```

Safety, because the 402 body and the `payUrl` both arrive from the model
(untrusted input):

- the **payee must be the known KeeSpecs treasury** — a forged or injected 402
  naming any other address is refused server-side;
- the **asset must be mainnet USDC** and the **network `keeta:21378`**;
- the **price is capped at 0.05 USDC per read**;
- the **payUrl must be an https `keespecs.xyz` `/api/` read** — payments are
  never sent to any other host;
- spend is tracked against a **separate daily data cap** (default **$1**,
  set in Settings, independent of the trade cap), reserved atomically before
  anything is sent and refunded if the payment fails without settling.

If the wallet holds no USDC the server fails closed with a readable reason
before touching the cap; if the merchant rejects the payment the cap charge is
given back unless the USDC demonstrably left the wallet (settled but response
lost), in which case the card tells you not to pay again. A real settle needs
a funded wallet, exactly like a real trade.

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

### The 🚀 Launchpad

The **Launchpad** view (sidebar, between Trade and Automations) makes launching and trading first-class, with no fake liquidity — a token is only tradable once a Keeta FX anchor provider quotes it, and the UI says exactly that.

- **Discover** — the live token directory (Top by supply, Trending by network activity, plus a search box). Data comes from KeeSpecs' free directory + KTA price feed, proxied through `/api/tokens` with a 2-minute server-side cache and each row enriched with the wallet's own balance.
- **Quick-buy** — every token gets **$10 / $25 / $50 / $100** buttons. They do not sign anything: the button picks the source (USDC if the wallet holds some, otherwise KTA priced at the live feed), creates a pending swap, and runs the normal **prepare → confirm → sign** flow. The daily cap still applies and nothing signs without approval. A pair with no live liquidity shows the honest *"No live liquidity … est 10 USDC ≈ 225.09 KTA — try later"* state instead of a trade card.
- **Launch** — a validated form (symbol, name, description, supply, decimals) that signs and publishes the `CREATE_IDENTIFIER` + mint + metadata from the browser (the seed never leaves the page), with a KTA fee-balance note. "Your tokens" lists what this wallet launched and survives reloads, showing whether each is live in the directory yet.

The trade confirm card lives at the page level, so a quick-buy from the Launchpad reaches the same *sign and send* step as a trade proposed in chat.

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
