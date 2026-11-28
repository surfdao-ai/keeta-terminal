/**
 * Kterminal docs content for the chat agent.
 *
 * Condensed reference so the agent can answer "how do I..." questions about
 * Kterminal and the Keeta Network without a tool round-trip. Deeper queries
 * fall through to the read_docs tool.
 */

export const KTERMINAL_DOCS = `
KTERMINAL — AI trading terminal for the Keeta Network (mainnet, v1.1.0)

WHAT YOU CAN DO
- Swap any token pair a Keeta FX anchor is quoting right now.
- Launch a native Keeta token (no contract; issued on-chain). Manage it: mint, burn, send from treasury, update info (name/ticker, description, metadata/logo), grant or revoke admin rights on another account.
- Set price alerts (fire once, or repeat on every crossing).
- Schedule recurring swaps (DCA): they propose a pending trade; you approve and sign in your browser. Nothing auto-executes.
- Watch token prices with live updates; tap [alert] on a watch row to pre-fill a price alert.
- Read live Keeta data via KeeSpecs: balances, prices, blocks, permissions, providers, token directory, skills catalogue.

WALLET & KEYS
- The seed is generated in your browser and never reaches the server — not in a request body, not in a log, not in the database. The server stores only your public address.
- The vault is sealed on this device under a passkey (Face ID / Touch ID via WebAuthn PRF) or a passphrase (PBKDF2).
- Create: new seed generated locally, shown once, then sealed. Write it down.
- Import: paste an existing seed; address derived in the browser.
- Unlock: passkey where supported, otherwise your passphrase. Your written-down seed is only for recovery on a new device.
- Sign out: drops the session cookie and the seed from memory.
- The seed never leaves this device. What leaves it is a signature only — the sign-in proof, and the signed block of a trade you approved.

SIGN-IN
- Every visitor gets their own terminal tied to one wallet address. Cap, automations, chats, trades, watchlist all belong to that address.
- Flow: server issues a one-time nonce → browser signs it with your wallet key → server verifies against your public key → httpOnly secure SameSite=strict session cookie is set.
- Every /api route needs that session; without one they answer 401. Every mutating request echoes a CSRF token; each session gets its own rate limit.

CHAT (AGENT)
- Ask in plain language: "what is the KTA price?", "list tokens", "swap 5 USDC for KTA", "alert me when KTA goes above $1".
- Every trade is a proposal: the agent asks FX anchors for a binding quote, builds a swap intent, shows a confirm card (amount, route, estimated receive, fee, cap impact). You tap [sign and send]; your browser signs; only the signed block goes back.
- If no provider is quoting a pair, the agent shows an estimate and does NOT propose a trade — nothing fills without your explicit approval.
- The agent never signs anything on your behalf and never asks for your seed, passphrase, or private key.

LAUNCHPAD
- Discover tab: KeeSpecs token directory, every token with a Keeta FX anchor, sorted by supply (top) or sends (trending), with search.
- Buy: quick-buy amounts ($10/$25/$50/$100). The terminal picks the best source from what you hold — a live $K/$KB peg (1:1) when you hold it, otherwise USDC, otherwise KTA priced against the live feed. If no provider quotes the pair, the row says "no live venue".
- Launch tab: issue a native Keeta token (symbol 1–12 alphanumeric, name, description, supply, decimals). Your wallet becomes owner. Supply is minted to the token's own treasury (its on-chain address), not your wallet — move it out with a send if you want.

TRADE / SWAPS
- Trade view: enter an amount and tap [swap] for that pair. The confirm card shows send amount, receive amount (binding quote), route (base anchor or on-chain provider), fee, daily cap impact. Tap [sign and send] to sign in your browser.
- Live rails: Keeta has no DEX. The only executable venue right now is the base FX anchor, quoting same-currency stable pegs — KBUSD↔KUSD, KBEUR↔KEUR, KBJPY↔KJPY, KBMXN↔KMXN, KBCAD↔KCAD, KBAED↔KAED, KBGBP→KGBP — roughly 1:1 plus a small fee (~0.1%). KTA, USDC, EURC, cbBTC and community tokens have NO executable venue today; an estimate is a mark, not a trade.
- Cap: hard USD limit per UTC day, enforced in code before anything is signed. Only settled swaps count; a pending (accepted-but-not-settled) swap is not charged until it settles. Set the limit in Settings.

TOKEN DETAIL & MANAGEMENT
- Open from "Your tokens" (Wallet → your tokens) or tap a token's address. Shows full keeta_ address (copy button), symbol, name, description, decimals, decoded on-chain metadata (incl. logo), total supply, treasury balance, your balance, and the ACL control table.
- As the launcher you are automatically OWNER and can administer:
  - Mint: increase supply (lands in the treasury).
  - Burn: decrease supply from the treasury (cannot exceed treasury balance).
  - Send from treasury: pay tokens to any recipient address.
  - Update token info: overwrite name/ticker, description, metadata (logo URI, decimals).
  - Grant/revoke admin rights: give another account ADMIN, TOKEN_ADMIN_SUPPLY, UPDATE_INFO, SEND_ON_BEHALF or remove one. Only OWNER can do this.
- Each action is confirmed & signed; a small KTA network fee is paid per action. The daily cap does NOT apply to administration.

AUTOMATIONS
- Alert: fires when a price crosses a threshold (gt/lt). Read-only; never signs.
- Recurring (DCA): swaps X→Y every N minutes. Proposes a pending trade; you approve and sign.
- Liquidity: fires once when a pair starts quoting, then disarms.
- A Vercel schedule sweeps every 15 minutes; you can also run on demand with [run now].
- Approving: due swaps appear under "awaiting your signature". Review amount/route/fee, then tap [review and sign].
- Automation wallet: separate low-balance account for unattended swaps. Its seed is generated in your browser and sealed in your vault; the server only learns its address. Fund it with what you're willing to lose — that's the ceiling on what any automation can move. The daily cap applies to automation swaps too.

LIVE RAILS (WHAT TRADES RIGHT NOW)
- KBUSD↔KUSD · KBEUR↔KEUR · KBJPY↔KJPY · KBMXN↔KMXN · KBCAD↔KCAD · KBAED↔KAED · KBGBP→KGBP (~1:1 + ~0.1% fee).
- KTA, USDC, EURC, cbBTC, community tokens: no executable venue today.
- The agent checks live rails before proposing any trade and names the live pegs when your pair has no venue.

DAILY CAP
- Hard USD limit per UTC day, survives restarts. Only settled swaps count. Adjust in Settings.

MODELS
- Model setup is stored in your browser only; the key is sent per request, never kept server-side. Providers: Groq (free tier), Free/no key (Pollinations), Ollama Cloud, OpenRouter / Together / Groq (any OpenAI-compatible key), Vercel AI Gateway (needs a credit card on the Vercel account).

PWA (INSTALL)
- Safari: Share → Add to Home Screen. Chrome/Edge: install prompt in address bar.
- Keyboard doesn't resize/scroll the app (shell pinned to layout viewport). Saved chats survive a reload. Vault is per browser — sign in again on another device with the same seed.

TROUBLESHOOTING
- "sign in required" — session expired; sign in again.
- "CSRF check failed" — refresh and try again.
- "wallet locked" — seed not in memory after reload; unlock (passkey Face ID/Touch ID prompts automatically, or enter passphrase).
- "no live liquidity" — no provider quoting that pair; retry later or use Live rails.
- "wrong passphrase" — vault passphrase, not your seed.
- nothing happens — model not configured; open Model setup.
- no balances — wallet is new; fund it (KTA for network fees, plus what you want to trade).

WORKSPACE.BOT
- workspace.bot is an upcoming product. Details are not available yet — ask again after launch or check https://keeta.ai for announcements.
`;

export function readDocs(query: string): string {
  const q = query.toLowerCase();
  const sections: [string, string][] = [
    ['swap', 'To swap: ask "swap X [from] to Y [to]" in chat, or use the Trade view. The agent prepares a confirm card; you review and sign. Live pairs are the $K/$KB pegs only (KBUSD↔KUSD, etc.).'],
    ['launch', 'To launch a token: use the 🚀 Launchpad Launch tab — symbol (1–12 alphanumeric), name, description, supply, decimals. Your wallet becomes owner; supply mints to the token treasury.'],
    ['mint', 'To mint: open a token from "Your tokens", tap Manage → Mint, enter amount, confirm & sign. Requires OWNER rights.'],
    ['burn', 'To burn: Manage → Burn, enter amount (capped at treasury balance), confirm & sign. Requires OWNER/ADMIN/TOKEN_ADMIN_SUPPLY.'],
    ['send', 'To send from treasury: Manage → Send, enter recipient + amount, confirm & sign. Requires OWNER/ADMIN/SEND_ON_BEHALF.'],
    ['update info', 'To update token info: Manage → Update token info, edit name/ticker/description/metadata, confirm & sign. Requires OWNER/UPDATE_INFO.'],
    ['grant admin', 'To grant admin rights: Manage → Grant admin rights, pick account + right (ADMIN, TOKEN_ADMIN_SUPPLY, UPDATE_INFO, SEND_ON_BEHALF), confirm & sign. Requires OWNER.'],
    ['revoke', 'To revoke admin rights: Manage → Grant admin rights, toggle "revoke instead of grant", pick account + right, confirm & sign. Requires OWNER.'],
    ['alert', 'To set a price alert: Automations → new automation → alert, pick symbol, condition (above/below), USD value, optional repeat. Read-only; never signs.'],
    ['recurring', 'To schedule a swap: Automations → new automation → recurring, pick from/to token, amount, every N minutes (min 15). It proposes; you approve and sign.'],
    ['liquidity alert', 'To alert when a pair starts quoting: Automations → new automation → liquidity, pick from/to token. Fires once when live quotes appear, then disarms.'],
    ['watchlist', 'To watch a token: Automations → watchlist, add a ticker or address. Prices refresh every 15 min or on demand. Tap [alert] on a row to pre-fill an alert.'],
    ['cap', 'To set the daily cap: Settings → daily cap. Hard USD limit per UTC day; only settled swaps count.'],
    ['wallet', 'To create/import/unlock: sign in, then create a new seed (write it down), import an existing seed, or unlock the device vault (Face ID/Touch ID or passphrase).'],
    ['sign in', 'To sign in: prove control of your wallet by signing a server nonce. The server sets a session cookie; your seed stays in your browser.'],
    ['workspace.bot', 'workspace.bot is an upcoming product. Details are not available yet.'],
  ];
  for (const [key, text] of sections) {
    if (q.includes(key)) return text;
  }
  return 'Not found in the docs. Try asking about swap, launch, mint, burn, send, alert, recurring, watchlist, cap, wallet, or sign in.';
}
