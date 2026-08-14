#!/usr/bin/env node
/**
 * @fileoverview Build the Mermaid diagram bundle for the file-preview markdown
 * renderer into `src/web/public/vendor/mermaid/`.
 *
 * Mermaid v11 is ESM-only and ships as many shared chunks under
 * node_modules/mermaid/dist; the web UI ships as plain JS with no bundler, so
 * it is bundled here (esbuild) into one committed ESM file (`mermaid.js`) that
 * the client dynamic-imports on first use — the same pattern as the Monaco
 * bundle (scripts/build-monaco-bundle.mjs). `src/web/public/vendor/` is
 * gitignored, so the generated file is force-added on commit.
 *
 * `npm run build` also runs this so a production build always reflects the
 * current source.
 *
 * Usage: node scripts/build-mermaid-bundle.mjs
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src/web/public/vendor/mermaid');

mkdirSync(OUT_DIR, { recursive: true });

await build({
  bundle: true,
  minify: true,
  logLevel: 'info',
  target: 'es2020',
  entryPoints: [join(ROOT, 'scripts/mermaid-entry.js')],
  format: 'esm',
  outfile: join(OUT_DIR, 'mermaid.js'),
});

console.log(`\n[mermaid] bundle built → ${OUT_DIR}`);
