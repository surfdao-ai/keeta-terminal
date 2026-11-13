/**
 * Register the `@/` alias resolver.
 *
 * Usage: node --import ./scripts/alias-register.mjs <script>
 */
import { register } from 'node:module';

register('./alias-hooks.mjs', import.meta.url);
