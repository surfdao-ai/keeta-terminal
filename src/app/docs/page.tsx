'use client';

import Link from 'next/link';

const SECTIONS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: 'commands',
    title: 'commands',
    body: (
      <>
        <p>Type these (or ask in your own words) in the chat.</p>
        <pre>{`portfolio                      your balances
list tokens                    every token with an FX anchor
estimate 1 KTA to USDC         a non-binding price
propose 0.1 KTA to USDC        creates a trade you confirm in the UI
liquidity KTA USDC             is this pair tradable right now
trade history                  what executed, what failed
cap                           spend vs the daily limit
skills                        the Keeta skills catalogue
read skill <id>               one skill's instructions
providers                     which anchors are live
usdc price                    the current price`}</pre>
        <p className="text-zinc-600">
          Every trade goes through a proposal you approve with{' '}
          <span className="text-purple-300">[ sign and send ]</span>. The agent never signs anything
          on its own: the server builds the swap, your browser signs it, and only the signed block is
          sent back.
        </p>
      </>
    ),
  },
  {
    id: 'wallet',
    title: 'wallet & keys',
    body: (
      <>
        <p>
          The seed is generated in your browser and never reaches the server — not in a request body,
          not in a log, not in the database. The server stores only your public address.
        </p>
        <pre>{`vault (this device)   seed sealed under a passkey (Face ID) or a passphrase
server (Postgres)     { address, createdAt, updatedAt } — nothing else
recovery copy         the seed you wrote down — restores a vault on a new device`}</pre>
        <ul>
          <li>
            <span className="text-zinc-400">Create</span> — a new seed is generated locally, shown once,
            then sealed. Write it down.
          </li>
          <li>
            <span className="text-zinc-400">Import</span> — paste an existing seed; the address is derived
            in the browser.
          </li>
          <li>
            <span className="text-zinc-400">Unlock</span> — Face ID where the browser supports WebAuthn
            PRF, otherwise the passphrase you chose. The seed you wrote down is only for recovery.
          </li>
          <li>
            <span className="text-zinc-400">Sign out</span> — drops the session cookie and the seed from
            memory.
          </li>
        </ul>
        <p className="text-zinc-600">
          The seed never leaves this device. What leaves it is a signature: the sign-in proof, and the
          signed block of a trade you approved.
        </p>
      </>
    ),
  },
  {
    id: 'signin',
    title: 'sign-in',
    body: (
      <>
        <p>
          Every visitor gets their own terminal. You sign in by proving control of your wallet, and
          everything after that — your cap, your automations, your chats, your trades — belongs to that
          one address and to nobody else.
        </p>
        <pre>{`1  the server issues a one-time nonce
2  the browser signs it with your wallet key (here, not on the server)
3  the server verifies the signature against your public key
4  the server sets an httpOnly, secure, SameSite=strict cookie`}</pre>
        <p className="text-zinc-600">
          Every <span className="text-zinc-300">/api</span> route needs that session; without one they
          answer 401 with no data. Every mutating request also has to echo the CSRF token from the
          cookie, and each session gets its own rate limit.
        </p>
        <p className="text-zinc-600">
          Because the session names your wallet, signing in from another browser with another wallet
          gives you a completely separate terminal — not a shared one.
        </p>
      </>
    ),
  },
  {
    id: 'watchlist',
    title: 'watchlist',
    body: (
      <>
        <p>
          Tokens you keep an eye on, with a live price and the 24-hour change. Prices come from the
          free Keeta reads and refresh every 15 minutes (or on demand).
        </p>
        <pre>{`Automations -> watchlist    add a ticker or a token address
[refresh prices]             re-read them now
[alert] on a row              pre-fills an alert for that token`}</pre>
        <p className="text-zinc-600">
          A watch entry is only a price. The alert on it is a separate automation that fires when the
          price crosses your threshold.
        </p>
      </>
    ),
  },
  {
    id: 'positions',
    title: 'positions & pnl',
    body: (
      <>
        <p>
          What you hold, what it is worth, and the PnL against what you paid. Cost basis is tracked
          from your own trade history with a weighted average per token.
        </p>
        <pre>{`Wallet -> positions      value · cost basis · unrealised · realised
                           tokens funded from another wallet have no cost basis here`}</pre>
      </>
    ),
  },
  {
    id: 'skills',
    title: 'keeta skills',
    body: (
      <>
        <p>
          The Skills view lists all 31 Keeta skills — short instruction sheets for every read the
          network exposes. Read one inline, or ask the agent for it.
        </p>
        <pre>{`read-status      the ledger, settlement tail, price sources
read-prices      the KTA price on Base vs Keeta's own anchor
read-joins       Desk / Network / Convert Check
read-anchors     anchor movement
read-permissions who may act on an account`}</pre>
      </>
    ),
  },
  {
    id: 'automations',
    title: 'automations',
    body: (
      <>
        <p>Two kinds, both stored server-side and evaluated every 15 minutes by a Vercel schedule.</p>
        <pre>{`alert      fires when a price crosses a threshold — read-only, never signs
recurring  a DCA: swap X -> Y every N minutes — proposes, you approve`}</pre>
        <p>
          The server holds no hot key, so a recurring swap can only <span className="text-zinc-300">propose</span>.
          When it comes due it queues an action that waits for you under Automations; you review it
          and sign it in your browser like any other trade.
        </p>
        <p>
          If you want a swap to run without you there, create the separate low-balance automation
          wallet under Automations. Its seed is generated in this browser and sealed in your vault —
          the server only learns its address, so it can never move that money by itself. What it
          holds is the blast radius: park only what you are willing to lose. The daily cap applies
          to it too.
        </p>
        <p className="text-amber-300/80">
          Keeta-native liquidity is thin. A recurring swap only fills when a provider issues a{' '}
          <span className="text-zinc-300">binding</span> quote at that moment — otherwise the run is
          recorded as &quot;no binding quotes&quot; and nothing is traded. Ask{' '}
          <span className="text-zinc-300">liquidity KTA USDC</span> to see the current state.
        </p>
      </>
    ),
  },
  {
    id: 'cap',
    title: 'daily cap',
    body: (
      <>
        <p>
          A hard USD limit on how much can be spent per UTC day. It is enforced in code before
          anything is signed, and it survives restarts.
        </p>
        <pre>{`Settings -> daily cap        set the limit (default from DAILY_SPEND_CAP_USD)
Trade / Wallet view            remaining budget`}</pre>
        <p className="text-zinc-600">
          Only settled swaps count. A swap that a provider accepted but has not settled is not charged
          until it settles.
        </p>
      </>
    ),
  },
  {
    id: 'models',
    title: 'models',
    body: (
      <>
        <p>
          Model setup is stored in your browser only — the key is sent per request and never kept
          server-side. The dropdown lists the models the provider actually serves.
        </p>
        <pre>{`Groq (free tier)        default — console.groq.com
Free, no key           Pollinations, works with no account at all
Ollama Cloud           ollama.com/settings/keys
OpenRouter / Together / Groq   any OpenAI-compatible key
Vercel AI Gateway      needs a credit card on the Vercel account`}</pre>
      </>
    ),
  },
  {
    id: 'data',
    title: 'keeta data',
    body: (
      <>
        <p>
          The agent reads live Keeta data through the KeeSpecs MCP. Every free read is wired up —
          price, balances, blocks, permissions, providers, the token directory and the skills
          catalogue. The paid x402 reads are deliberately not enabled.
        </p>
        <pre>{`ks_get_price        ks_get_portfolio     ks_get_account
ks_list_skills      ks_read_skill        ks_search_tokens
ks_get_providers    ks_get_fx_reference  ks_get_stablecoins ...`}</pre>
      </>
    ),
  },
  {
    id: 'pwa',
    title: 'PWA',
    body: (
      <>
        <p>
          Install from Safari: Share → Add to Home Screen. The shell is pinned to the layout viewport,
          so opening the keyboard no longer resizes or scrolls the app.
        </p>
        <p className="text-zinc-600">
          Saved chats live in the store, not in the browser tab, so they survive a reload — but the
          vault (your seed) is per browser. Sign in again on another device with the same seed and
          you get the same terminal back.
        </p>
      </>
    ),
  },
  {
    id: 'trouble',
    title: 'troubleshooting',
    body: (
      <pre>{`"sign in required"       your session expired or was never created
"CSRF check failed"      the browser could not echo the session token
"wallet locked"          the seed is not in memory — unlock it
"no binding quotes"     no provider is quoting that pair right now
"wrong passphrase"      the vault passphrase, not your seed
nothing happens         the model is not configured — open Model setup
no balances             the wallet is new — fund it from another wallet`}</pre>
    ),
  },
];

export default function DocsPage() {
  return (
    <div className="h-full overflow-y-auto bg-[#09090B] text-[#F7F7F7]">
      <div className="max-w-3xl mx-auto px-5 py-10 pb-20">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-800 flex items-center justify-center font-bold text-white text-sm">
            K
          </div>
          <h1 className="text-2xl font-bold tracking-tight">KTerminal</h1>
          <span className="font-mono text-[11px] text-zinc-600">docs</span>
        </div>
        <p className="text-zinc-400 mb-8 max-w-prose">
          An AI trading terminal for the Keeta Network. This page is the reference: what the agent
          can do, what it needs from you, and how the keys and the money are handled.
        </p>

        <nav className="flex flex-wrap gap-2 mb-10">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="font-mono text-[12px] px-2.5 py-1 rounded border border-zinc-800 text-zinc-400 hover:border-purple-700 hover:text-zinc-200"
            >
              {s.title}
            </a>
          ))}
        </nav>

        <div className="space-y-10">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <h2 className="font-mono text-[13px] text-purple-300 uppercase tracking-wider mb-3">
                {s.title}
              </h2>
              <div className="space-y-3 text-sm text-zinc-300 leading-relaxed [&_pre]:font-mono [&_pre]:text-[12px] [&_pre]:leading-relaxed [&_pre]:bg-[#0d0d10] [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:text-zinc-300 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mb-1">
                {s.body}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 pt-6 border-t border-zinc-800/80 flex gap-4 font-mono text-[12px]">
          <Link href="/" className="text-purple-300 hover:text-purple-200">
            ← back to the terminal
          </Link>
          <a
            href="https://github.com/surfdao-ai/keeta-terminal"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-500 hover:text-zinc-300"
          >
            github
          </a>
          <a
            href="https://docs.keeta.com"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-500 hover:text-zinc-300"
          >
            keeta docs ↗
          </a>
        </div>
      </div>
    </div>
  );
}
