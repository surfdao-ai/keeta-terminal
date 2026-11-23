/**
 * The portfolio and positions cards, rendered.
 *
 * The card is presentational, so it is rendered in a DOM with fixture data and
 * checked that the numbers a person would read are actually on the screen —
 * per-token rows, the totals strip, and the "no cost basis" note.
 *
 * Usage: npx tsx scripts/card-test.mjs
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: window.navigator,
  configurable: true,
  writable: true,
});
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.localStorage = window.localStorage;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: ToolCard } = await import('../src/components/ToolCard.tsx');

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};
const settle = () => new Promise((r) => setTimeout(r, 40));
async function render(el) {
  await act(async () => {
    createRoot(document.getElementById('root')).render(el);
    await settle();
  });
}
const text = () => document.body.textContent ?? '';

console.log('== positions card ==');
await render(
  React.createElement(ToolCard, {
    name: 'get_positions',
    state: 'output-available',
    input: {},
    output: {
      positions: [
        { token: 'keeta_aaaaaabbbbbbcccccc', amount: '12.5', valueUsd: 50.5, costUsd: 40, pnlUsd: 10.5 },
        { token: 'keeta_dddddddeeeeee000000', amount: '3.0', valueUsd: 3.0, costUsd: null, pnlUsd: null },
      ],
      totalValueUsd: 53.5,
      totalCostUsd: 40,
      totalPnlUsd: 10.5,
      realisedPnlUsd: 2.25,
      trades: 4,
      noBasis: true,
    },
    onConfirm: () => undefined,
  }),
);
check('it labels the command', text().includes('positions'));
check('it shows a per-token row', text().includes('12.5'));
check('it shows the value', text().includes('$50.50'));
check('it shows unrealised PnL', text().includes('+$10.50'));
check('it shows the totals strip', text().includes('cost basis') && text().includes('realised'));
check('it flags the no-basis token', text().includes('no cost basis'));

console.log('== portfolio card ==');
document.getElementById('root').replaceChildren();
await render(
  React.createElement(ToolCard, {
    name: 'get_portfolio',
    state: 'output-available',
    input: {},
    output: {
      address: 'keeta_aab1234567890abcdefghijklmnop',
      balances: [
        { token: 'keeta_aaaaaabbbbbbcccccc', display: '12.5' },
        { token: 'keeta_dddddddeeeeee000000', display: '3.0' },
      ],
    },
    onConfirm: () => undefined,
  }),
);
check('it labels the command', text().includes('portfolio'));
check('it shows the balances', text().includes('12.5') && text().includes('3.0'));
check('it notes how many tokens', text().includes('2 token'));

console.log(`\n${failures === 0 ? 'ALL CARD CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
