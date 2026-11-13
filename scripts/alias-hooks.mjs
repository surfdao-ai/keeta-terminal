/**
 * A resolver hook so Node understands the `@/` path alias the app uses.
 *
 * The scripts import the app's own TypeScript modules directly (Node strips
 * the types), so they need the same `@/...` -> `src/...` mapping the bundler
 * does. Loaded with: node --import ./scripts/alias-register.mjs
 */
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(process.cwd(), 'src');

/** Find the file a specifier points at: `x.ts`, `x/index.ts` … */
function resolveFile(base) {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const file = resolveFile(path.join(SRC, specifier.slice(2)));
    if (file) return nextResolve(pathToFileURL(file).href, context);
  }
  return nextResolve(specifier, context);
}
