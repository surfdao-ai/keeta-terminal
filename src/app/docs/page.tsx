'use client';

import Link from 'next/link';

const SECTIONS: { id: string; title: string; intro?: string; blocks: DocBlock[] }[] = [
  {
    id: 'overview',
    title: 'Overview',
    intro:
      'KTerminal is an AI trading terminal for the Keeta Network. You talk to it in plain language — "swap 5 USDC for KTA", "alert me when KTA goes above $1", "launch a token called FOO" — and the agent either answers from live Keeta reads or proposes an action that you review and sign in your own browser.',
    blocks: [
      {
        label: 'What you can do',
        items: [
          'Swap any token pair that a Keeta FX anchor is quoting right now.',
          'Launch a native Keeta token (no contract — issued on-chain) and manage it: mint, burn, send from treasury, update info, grant admin rights.',
          'Set price alerts (fire once or repeat on every crossing).',
          'Schedule recurring swaps (DCA) — they propose, you approve and sign.',
          'Watch token prices with live updates.',
          'Read live Keeta data: balances, prices, blocks, providers, token directory, skills catalogue.',
        ],
      },
      {
        label: 'What the agent never does',
        items: [
          'Sign anything on your behalf. Every trade, mint, burn, send, or permission change is proposed to you and signed in your browser.',
          'See or store your seed. It lives in your browser vault only.',
          'Move your funds without you. The automation wallet is a separate low-balance account you fund; its key never reaches the server.',
        ],
      },
    ],
  },
  {
    id: 'getting-started',
    title: 'Getting started',
    blocks: [
      {
        label: '1. Sign in',
        items: [
          'Open https://kterminal.vercel.app (or your local dev URL).',
          'Create a new wallet — a seed is generated in your browser and shown once; write it down — or import an existing seed.',
          'Unlock it (Face ID / Touch ID if your browser supports WebAuthn PRF, otherwise your vault passphrase).',
          'The server only learns your public address. The seed never leaves your device.',
        ],
      },
      {
        label: '2. Fund the wallet',
        items: [
          'The terminal needs KTA to pay network fees for swaps, token launches, and administration.',
          'Send KTA (or any token you want to trade) to the address shown in Wallet.',
          'You can copy the address with the copy button on each token card.',
        ],
      },
      {
        label: '3. First action',
        items: [
          'Open the chat and ask: "what is the KTA price?" or "list tokens".',
          'Then try a real action: "swap 1 USDC for KTA" — the agent prepares a trade card you review and sign.',
        ],
      },
    ],
  },
  {
    id: 'wallet',
    title: 'Wallet & keys',
    blocks: [
      {
        label: 'How keys are handled',
        items: [
          'The seed is generated in your browser, never sent in a request body, never logged, never stored server-side.',
          'The server stores only { address, createdAt, updatedAt } for your wallet.',
          'The vault is sealed on this device under a passkey (Face ID / Touch ID via WebAuthn PRF) or a passphrase (PBKDF2).',
        ],
      },
      {
        label: 'Actions',
        items: [
          '<b>Create</b> — a new seed is generated locally, shown once, then sealed. Write it down.',
          '<b>Import</b> — paste an existing seed; its address is derived in the browser.',
          '<b>Unlock</b> — passkey where supported, otherwise the passphrase you chose. Your written-down seed is only for recovery on a new device.',
          '<b>Sign out</b> — drops the session cookie and the seed from memory.',
        ],
      },
      {
        label: 'Security summary',
        items: [
          'The seed never leaves this device.',
          'What leaves it is a signature only: the sign-in proof, and the signed block of a trade you approved.',
          'Every /api route needs your session; without one they answer 401 with no data.',
          'Every mutating request also echoes a CSRF token from your cookie, and each session gets its own rate limit.',
        ],
      },
    ],
  },
  {
    id: 'sign-in',
    title: 'Sign-in flow',
    blocks: [
      {
        label: 'Step by step',
        items: [
          '1. The server issues a one-time nonce.',
          '2. The browser signs it with your wallet key (here, not on the server).',
          '3. The server verifies the signature against your public key.',
          '4. The server sets an httpOnly, secure, SameSite=strict session cookie.',
        ],
      },
      {
        label: 'What this means',
        items: [
          'Signing in from another browser with another wallet gives you a completely separate terminal — not a shared one.',
          'Your cap, automations, chats, trades, and watchlist all belong to that one address.',
          'If your session expires you are asked to unlock again; your vault (seed) is per browser, so sign in on another device with your written-down seed to get the same terminal back.',
        ],
      },
    ],
  },
  {
    id: 'chat',
    title: 'Chat with the agent',
    blocks: [
      {
        label: 'What to ask',
        items: [
          '<b>Balances & portfolio</b> — "what do I hold?", "my portfolio".',
          '<b>Prices</b> — "KTA price", "USDC price".',
          '<b>Tokens</b> — "list tokens", "token info KUSD".',
          '<b>Quotes</b> — "estimate 1 KTA to USDC" (non-binding price preview).',
          '<b>Trades</b> — "swap 5 USDC for KTA" (creates a trade card you confirm and sign).',
          '<b>Liquidity</b> — "liquidity KTA USDC" (is this pair tradable right now?).',
          '<b>History</b> — "trade history" (what executed, what failed).',
          '<b>Cap</b> — "cap" (spend vs daily limit).',
          '<b>Skills</b> — "skills" (Keeta skills catalogue), "read skill read-price".',
        ],
      },
      {
        label: 'Every trade is a proposal',
        items: [
          'The agent never executes a swap itself.',
          'It asks the FX anchors for a binding quote, builds a swap intent, and shows you a confirm card: amount, route, estimated receive, fee, and the daily cap impact.',
          'You tap [ sign and send ], your browser signs the block, and only the signed block goes back to the server.',
          'If no provider is quoting the pair, the agent shows an estimate and does not propose a trade — nothing fills without your explicit approval.',
        ],
      },
    ],
  },
  {
    id: 'launchpad',
    title: 'Launchpad — discover & launch tokens',
    blocks: [
      {
        label: 'Discover tab',
        items: [
          'Browses the KeeSpecs token directory: every token with a Keeta FX anchor, with supply and activity.',
          'Sorted by supply (top) or sends (trending).',
          'A search box filters by symbol, name, or address.',
        ],
      },
      {
        label: 'Buy a token',
        items: [
          'Each row shows quick-buy amounts ($10, $25, $50, $100).',
          'The terminal picks the best source from what you hold: a live $K/$KB peg (1:1) when you hold it, otherwise USDC, otherwise KTA priced against the live feed.',
          'If no provider is quoting a pair for that token, the row says "no live venue" instead of promising a swap that cannot fill.',
          'Tapping an amount creates a trade card you confirm and sign in the normal flow.',
        ],
      },
      {
        label: 'Launch tab',
        items: [
          'Issue a native Keeta token — no contract, no gas for deployment beyond the normal network fee (paid in KTA).',
          'Fill in: symbol (1–12 alphanumeric), name, description, total supply, decimals.',
          'Your wallet becomes the token owner. The supply is minted to the token\'s own treasury (its on-chain address), not to your wallet — you move it out with a send if you want.',
          'The token shows in "Your tokens" immediately and can be managed from there.',
        ],
      },
    ],
  },
  {
    id: 'trade',
    title: 'Trade / swaps',
    blocks: [
      {
        label: 'Trade view',
        items: [
          'Enter an amount and tap [swap] to create a trade card for that exact pair.',
          'The confirm card shows: what you send, what you receive (binding quote), the route (base anchor or on-chain provider), the fee, and how much of your daily cap it uses.',
          'Tap [ sign and send ] to sign the block in your browser — nothing is sent until you do.',
        ],
      },
      {
        label: 'Live rails (what trades right now)',
        items: [
          'Keeta has no DEX. The only executable venue right now is the base FX anchor, which quotes same-currency stable pegs: KBUSD↔KUSD, KBEUR↔KEUR, KBJPY↔KJPY, KBMXN↔KMXN, KBCAD↔KCAD, KBAED↔KAED, KBGBP→KGBP (1:1 plus a small fee).',
          'The Trade view shows which of these are quoting right now, each row with the exact rate and fee, and a one-tap trade button.',
          'KTA, USDC, and community tokens have no executable venue today — an estimate is a mark, not a trade. The agent will tell you plainly if you ask for a pair with no venue.',
          'AlpacaDEX (a community exchange) is watched when it has 24-hour volume; the terminal will surface it when pools appear.',
        ],
      },
      {
        label: 'Cap protection',
        items: [
          'Every swap is checked against your daily cap before it is signed.',
          'Only settled swaps count against the cap; a pending (accepted-but-not-settled) swap is not charged until it settles.',
          'You can adjust the cap in Settings (default from DAILY_SPEND_CAP_USD).',
        ],
      },
    ],
  },
  {
    id: 'token-detail',
    title: 'Token detail & management',
    blocks: [
      {
        label: 'Open it',
        items: [
          'Tap any token in "Your tokens" (Wallet → your tokens) or click its address to open the full detail page.',
          'The page shows the full keeta_ address with a copy button, symbol, name, description, decimals, decoded on-chain metadata (including logo if set), total supply, the token\'s treasury balance, and your balance of it.',
        ],
      },
      {
        label: 'Who controls it',
        items: [
          'The ACL table lists every principal with rights on the token and their flags — OWNER, ADMIN, UPDATE_INFO, SEND_ON_BEHALF, TOKEN_ADMIN_SUPPLY, TOKEN_ADMIN_MODIFY_BALANCE, etc.',
          'Your wallet is marked "you" if it holds a right.',
          'As the launcher you are automatically OWNER, so you can administer the token yourself.',
        ],
      },
      {
        label: 'Manage (each action is confirmed & signed)',
        items: [
          '<b>Mint</b> — increase supply. New tokens land in the token\'s treasury.',
          '<b>Burn</b> — decrease supply from the treasury (cannot exceed the treasury balance).',
          '<b>Send from treasury</b> — pay tokens out to any recipient address.',
          '<b>Update token info</b> — overwrite the on-chain name (the ticker clients show), description, and metadata (logo URI, decimal places).',
          '<b>Grant / revoke admin rights</b> — give another account a right (ADMIN, TOKEN_ADMIN_SUPPLY, UPDATE_INFO, SEND_ON_BEHALF) or remove one. Only OWNER can do this.',
        ],
      },
      {
        label: 'Limits',
        items: [
          'A small KTA network fee is paid per administration action.',
          'Your wallet must hold a relevant right on the token (OWNER / ADMIN / the specific flag) — otherwise the action is disabled with the required right shown.',
          'The daily cap does not apply to administration.',
        ],
      },
    ],
  },
  {
    id: 'automations',
    title: 'Automations',
    blocks: [
      {
        label: 'Three kinds',
        items: [
          '<b>Alert</b> — fires when a price crosses a threshold (gt or lt). Read-only: it never signs anything.',
          '<b>Recurring</b> (DCA) — swaps X → Y every N minutes. Proposes a pending trade; you approve and sign it in your browser.',
          '<b>Liquidity</b> — fires the first time a pair starts quoting on an anchor, then disarms.',
        ],
      },
      {
        label: 'How runs work',
        items: [
          'A Vercel schedule sweeps every 15 minutes (the Hobby plan limit).',
          'You can also run all due automations on demand with [run now].',
          'Each run checks prices (cached per symbol per run so the network is not hammered), checks due times, checks the daily cap, and checks live liquidity before proposing.',
          'A due recurring swap with no live quote is skipped with a reason, never left as an unfillable proposal.',
        ],
      },
      {
        label: 'Approving a proposal',
        items: [
          'When a recurring swap comes due, it appears under "awaiting your signature" in Automations and as a trade card in the Trade view.',
          'Review the amount, route, and fee, then tap [ review and sign ] / [ sign and send ].',
          'Nothing is auto-executed — the server holds no key.',
        ],
      },
      {
        label: 'Automation wallet (unattended)',
        items: [
          'If you want swaps to run without you, create the separate low-balance automation wallet under Automations.',
          'Its seed is generated in this browser and sealed in your vault; the server only learns its address, so it can never move that money by itself.',
          'Fund it with what you are willing to lose — that balance is the hard ceiling on what any automation can move.',
          'The daily cap applies to automation swaps too.',
        ],
      },
    ],
  },
  {
    id: 'live-rails',
    title: 'Live rails — trading pairs',
    blocks: [
      {
        label: 'What trades right now',
        items: [
          'Keeta has no DEX. The base FX anchor quotes same-currency stable pegs only:',
          'KBUSD↔KUSD · KBEUR↔KEUR · KBJPY↔KJPY · KBMXN↔KMXN · KBCAD↔KCAD · KBAED↔KAED · KBGBP→KGBP',
          'Each is roughly 1:1 plus a small fee (about 0.1%).',
          'KTA, USDC, EURC, cbBTC, and community tokens are not in any anchor pair — they have no executable venue today.',
        ],
      },
      {
        label: 'Where to see it',
        items: [
          'Trade view → Live rails panel: live/quiet badge, exact rate, fee, one-tap trade.',
          'Launchpad → buy buttons pick a live source when your wallet holds one of the pegs.',
          'The agent checks `get_live_rails` before proposing any trade and names the live pegs when your pair has no venue.',
        ],
      },
    ],
  },
  {
    id: 'watchlist',
    title: 'Watchlist',
    blocks: [
      {
        label: 'What it is',
        items: [
          'Tokens you keep an eye on, with a live price and 24-hour change from the free Keeta reads.',
          'Prices refresh every 15 minutes or on demand with [refresh prices].',
          'Tap [alert] on a row to pre-fill a price alert for that token.',
        ],
      },
      {
        label: 'Actions',
        items: [
          'Add a ticker (KTA, USDC) or a token address.',
          'Remove an entry.',
          'Refresh prices now.',
        ],
      },
    ],
  },
  {
    id: 'positions',
    title: 'Positions & PnL',
    blocks: [
      {
        label: 'What it shows',
        items: [
          'What you hold, what it is worth, cost basis, and unrealised / realised PnL per token.',
          'Cost basis is tracked from your own trade history with a weighted average per token.',
          'Tokens funded from another wallet (not traded through the terminal) have no cost basis here.',
        ],
      },
    ],
  },
  {
    id: 'cap',
    title: 'Daily cap',
    blocks: [
      {
        label: 'How it works',
        items: [
          'A hard USD limit on how much can be spent per UTC day.',
          'Enforced in code before anything is signed; survives restarts.',
          'Only settled swaps count — a pending (accepted but not settled) swap is not charged until it settles.',
          'Set the limit in Settings (default from DAILY_SPEND_CAP_USD).',
        ],
      },
    ],
  },
  {
    id: 'skills',
    title: 'Keeta skills',
    blocks: [
      {
        label: 'What they are',
        items: [
          'The Skills view lists all Keeta skills — short instruction sheets for every read the network exposes.',
          'Read one inline, or ask the agent for it by name.',
        ],
      },
      {
        label: 'Common skills',
        items: [
          'read-status — the ledger, settlement tail, price sources.',
          'read-prices — the KTA price on Base vs Keeta\'s own anchor.',
          'read-joins — Desk / Network / Convert Check.',
          'read-anchors — anchor movement.',
          'read-permissions — who may act on an account.',
          'read-token — token metadata, decimals, supply.',
          'read-providers — which anchors are live.',
          'read-token-rules — who controls a token (owner, who can mint/burn).',
        ],
      },
    ],
  },
  {
    id: 'data-reads',
    title: 'Keeta data & paid reads',
    blocks: [
      {
        label: 'Free reads',
        items: [
          'The agent reads live Keeta data through KeeSpecs: price, balances, blocks, permissions, providers, the token directory, and the skills catalogue.',
          'These are free and never require payment.',
        ],
      },
      {
        label: 'Paid reads (x402)',
        items: [
          'Some KeeSpecs market reads cost 0.01–0.02 USDC per call.',
          'The agent shows you a payment card instead of silently charging: amount, payee, and a [confirm] button.',
          'Nothing is paid without your tap. You can decline and ask again.',
          'Paid reads are deliberately opt-in — the terminal never enables them by default.',
        ],
      },
    ],
  },
  {
    id: 'models',
    title: 'Models',
    blocks: [
      {
        label: 'Setup',
        items: [
          'Model setup is stored in your browser only — the key is sent per request and never kept server-side.',
          'Open Model setup from the app and pick a provider: Groq (free tier), Free/no key (Pollinations), Ollama Cloud, OpenRouter / Together / Groq (any OpenAI-compatible key), or Vercel AI Gateway (needs a credit card on the Vercel account).',
          'The dropdown lists the models the provider actually serves.',
        ],
      },
    ],
  },
  {
    id: 'pwa',
    title: 'PWA (install)',
    blocks: [
      {
        label: 'Install',
        items: [
          'Safari: Share → Add to Home Screen.',
          'Chrome/Edge: the install prompt appears in the address bar.',
        ],
      },
      {
        label: 'Behavior',
        items: [
          'The shell is pinned to the layout viewport, so opening the keyboard no longer resizes or scrolls the app.',
          'Saved chats live in the store, not the browser tab, so they survive a reload.',
          'The vault (your seed) is per browser — sign in again on another device with the same seed to get the same terminal back.',
        ],
      },
    ],
  },
  {
    id: 'trouble',
    title: 'Troubleshooting',
    blocks: [
      {
        label: 'Messages',
        items: [
          '"sign in required" — your session expired or was never created. Sign in again.',
          '"CSRF check failed" — the browser could not echo the session token. Refresh and try again.',
          '"wallet locked" — the seed is not in memory (after a reload). Unlock it: passkey Face ID/Touch ID prompts automatically, or enter your passphrase.',
          '"no live liquidity" — no provider is quoting that pair right now. The estimate is shown and no trade is proposed; retry later, or use the Live rails panel to see what trades.',
          '"wrong passphrase" — the vault passphrase, not your seed.',
          'nothing happens — the model is not configured. Open Model setup.',
          'no balances — the wallet is new. Fund it from another wallet (KTA for network fees, plus whatever you want to trade).',
        ],
      },
    ],
  },
];

interface DocBlock {
  label: string;
  items: string[];
}

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
          can do, how each feature works, and how keys and money are handled.{' '}
          <span className="text-zinc-600">Keeta mainnet · v1.1.0</span>
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
              {s.intro && (
                <p className="text-sm text-zinc-300 leading-relaxed mb-4">{s.intro}</p>
              )}
              {s.blocks.map((b, i) => (
                <div key={i} className="space-y-2">
                  <div className="font-mono text-[12px] text-purple-400/70 uppercase tracking-wider mb-1">
                    {b.label}
                  </div>
                  <ul className="list-disc pl-6 space-y-1 text-sm text-zinc-300 leading-relaxed">
                    {b.items.map((item, j) => (
                      <li key={j} className="relative">
                        <span dangerouslySetInnerHTML={{ __html: item }} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
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
