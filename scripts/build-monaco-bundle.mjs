#!/usr/bin/env node
/**
 * @fileoverview Build the Monaco editor bundle for the file-preview popup into
 * `src/web/public/vendor/monaco/`.
 *
 * The web UI ships as plain JS with no bundler, so the ESM build of
 * monaco-editor is bundled here (esbuild) into a single committed ESM file
 * (`monaco.js`) plus its web workers (the language workers are ES-module
 * workers, the generic editor worker a classic IIFE — both served same-origin)
 * and the combined editor stylesheet. `src/web/public/vendor/` is gitignored,
 * so the generated files are force-added on commit, matching the existing
 * vendored-lib pattern (`marked.min.js`, `dompurify.min.js`, ...).
 *
 * `npm run build` also runs this so a production build always reflects the
 * current source — same pattern as scripts/build-gesture-bundle.mjs.
 *
 * Usage: node scripts/build-monaco-bundle.mjs
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MONACO = join(ROOT, 'node_modules/monaco-editor');
const OUT_DIR = join(ROOT, 'src/web/public/vendor/monaco');

mkdirSync(OUT_DIR, { recursive: true });

const baseOptions = {
  bundle: true,
  minify: true,
  logLevel: 'info',
  target: 'es2020',
  loader: {
    // Monaco's codicon icon font is referenced from codicon.css; copy it out
    // as an asset so the icons render.
    '.ttf': 'file',
  },
  assetNames: 'monaco/[name]',
};

// Main editor bundle — ESM, loaded lazily via dynamic import(). The entry
// imports 'monaco-editor' (the full editor + all languages), which pulls in
// the per-component CSS; esbuild emits that as a sibling monaco.css, the exact
// combined stylesheet the client injects on first use.
await build({
  ...baseOptions,
  entryPoints: [join(ROOT, 'scripts/monaco-entry.js')],
  format: 'esm',
  outfile: join(OUT_DIR, 'monaco.js'),
});

// Web workers. Monaco 0.56+ creates the language workers (ts/json/css/html) as
// ES-module workers via `new Worker(new URL("x.worker.js", import.meta.url),
// { type: "module" })` — relative to monaco.js, so they must be built as ESM
// with those exact filenames. The generic editor worker is created as a classic
// script from MonacoEnvironment.getWorkerUrl, so it stays an IIFE bundle.
const workers = {
  'ts.worker.js': { entry: join(MONACO, 'esm/vs/language/typescript/ts.worker.js'), format: 'esm' },
  'json.worker.js': { entry: join(MONACO, 'esm/vs/language/json/json.worker.js'), format: 'esm' },
  'css.worker.js': { entry: join(MONACO, 'esm/vs/language/css/css.worker.js'), format: 'esm' },
  'html.worker.js': { entry: join(MONACO, 'esm/vs/language/html/html.worker.js'), format: 'esm' },
  'editor.worker.js': { entry: join(MONACO, 'esm/vs/editor/editor.worker.js'), format: 'iife' },
};
for (const [name, { entry, format }] of Object.entries(workers)) {
  await build({
    ...baseOptions,
    entryPoints: [entry],
    format,
    outfile: join(OUT_DIR, name),
  });
}

console.log(`\n[monaco] bundle built → ${OUT_DIR}`);
