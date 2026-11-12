# Keeta Terminal

An AI chat trading terminal for the Keeta Network — a bnkr.bot-style agent, but for Keeta.

## Features

- Streaming AI chat (Vercel AI Gateway) with Keeta-specific tools
- Non-custodial wallet: passphrase-encrypted seed, AES-256-GCM, stored server-side
- Atomic swaps via Keeta FX anchors (propose → confirm on every trade)
- Hard daily spend cap enforced in code before any block is signed
- Read-only Keeta market data via KeeSpecs MCP (prices, providers, tokens)
- Trade history log

## Requirements

- Node.js 22+
- A Vercel AI Gateway API key (`AI_GATEWAY_API_KEY`)
- Optional: Postgres connection string (`DATABASE_URL`) — otherwise a local `.data/` file store is used

## Run locally

```bash
cp .env.example .env.local
# edit .env.local: set AI_GATEWAY_API_KEY (optional — users can paste their own key in the UI)
npm install
npm run dev
```

## Model setup (any provider)

On first load the terminal shows a **Model setup** dialog. Pick a provider and paste your key:

- Vercel AI Gateway (uses server key / OIDC, or your own key)
- OpenRouter
- Groq
- Together
- Ollama (local)
- LM Studio (local)
- Custom OpenAI-compatible endpoint

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
- The agent wallet lives in server memory while unlocked; on a cold start (new serverless instance) you must unlock again.
- x402 paid reads (KeeSpecs deep analytics) are not wired in v1 — only free reads are exposed to the agent.

## Stack

Next.js 16 (App Router) · AI SDK 7 · Vercel AI Gateway · @keetanetwork/keetanet-client · @keetanetwork/anchor · KeeSpecs MCP · Postgres (optional)
