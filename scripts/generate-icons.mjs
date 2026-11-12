/**
 * Generates PWA icons from public/icon.svg.
 * Run: node scripts/generate-icons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(path.join(root, 'public/icon.svg'));

const targets = [
  { file: 'public/icon-192.png', size: 192, maskable: false },
  { file: 'public/icon-512.png', size: 512, maskable: false },
  { file: 'public/icon-maskable-512.png', size: 512, maskable: true },
  { file: 'public/apple-touch-icon.png', size: 180, maskable: false },
];

for (const t of targets) {
  let image = sharp(svg, { density: 384 }).resize(t.size, t.size);
  if (t.maskable) {
    // pad to safe zone (80% content) with background colour
    const inner = Math.round(t.size * 0.78);
    const bg = await sharp({
      create: { width: t.size, height: t.size, channels: 4, background: '#09090B' },
    })
      .png()
      .toBuffer();
    const fg = await image.resize(inner, inner).png().toBuffer();
    image = sharp(bg).composite([{ input: fg, top: Math.round((t.size - inner) / 2), left: Math.round((t.size - inner) / 2) }]);
  }
  const out = await image.png().toBuffer();
  writeFileSync(path.join(root, t.file), out);
  console.log('wrote', t.file, t.size);
}
