---
title: 'File Preview Markdown Rendering + Mermaid Diagrams'
category: 'Architecture & Design'
status: '🟢 Complete'
priority: 'High'
timebox: '1 week'
created: 2026-08-14
updated: 2026-08-14
owner: 'TBD'
tags:
  [
    'technical-spike',
    'architecture',
    'research',
    'codeman',
    'file-preview',
    'markdown',
    'mermaid',
    'marked',
    'dompurify',
  ]
---

# File Preview Markdown Rendering + Mermaid Diagrams

## Summary

**Spike Objective:** Decide how the file-preview popup should render `.md`/`.markdown` files — GFM markdown preview with **Mermaid diagram** rendering inside fenced ` ```mermaid ` blocks — and map exactly which code must change. Preview must be read-only rendered markdown; clicking Edit swaps to the existing Monaco editor; Cancel re-renders the markdown; Save re-fetches and re-renders the saved file.

**Why This Matters:** Today every text file (including `.md`) opens in a read-only Monaco editor showing raw markdown source. Users should see rendered docs with diagrams, while keeping the existing XSS posture (the popup is same-origin, injects via `innerHTML`, and markdown sources are untrusted file content). This touches the same file-preview paths that Monaco, resize, and edit-mode already own, so the right library choice must not break the no-bundler static-asset pipeline or the hardened sanitizer.

**Timebox:** 1 week (research + decision).

**Decision Deadline:** Before implementation begins on `code-editor`; nothing else in flight depends on it.

## Research Question(s)

**Primary Question:** Which library approach renders markdown + Mermaid in the file-preview popup with the least disruption to the existing frontend (plain-JS, no bundler, hardened DOMPurify allowlist)?

**Secondary Questions:**

- Should we reuse the existing vendored `marked` + `sanitizeMarkdownHtml` pipeline (`app.js:_renderMarkdown`), or add `markdown-it` / `remark`?
- How should Mermaid be loaded and rendered safely (lazy-load, `securityLevel`, SVG sanitization, error handling)?
- How do the existing edit/save/cancel flows already satisfy the "re-render after cancel/save" requirement, and what must change?
- What are the truncation, CSS, and build/vendor implications?

## Investigation Plan

### Research Tasks

- [x] Map the current file-preview frontend flow (`openFilePreview`, `enterFilePreviewEdit`, `cancelFilePreviewEdit`, `saveFilePreviewEdit`, `_createFilePreviewMonaco`, `copyFilePreviewContent`) in `src/web/public/panels-ui.js`
- [x] Inventory existing markdown/sanitization infrastructure (`vendor/marked.min.js` v15.0.7, `vendor/dompurify.min.js`, `app.js:_renderMarkdown`/`_sanitizeHtml`, `sanitize-html.js` hardened allowlist, `.rv-text` preview CSS)
- [x] Research markdown-rendering libraries (marked vs markdown-it vs remark; GitHub and VS Code preview approaches)
- [x] Research Mermaid.js current version, lazy-load patterns, security model, and sanitizer integration (incl. known XSS advisories)
- [ ] Create proof of concept/prototype — **not required** (per request; library choice is validated by existing vendored deps + documented real-world patterns)
- [x] Document findings and recommendations (this document)

### Success Criteria

**This spike is complete when:**

- [x] Recommendation documented with rationale
- [x] Exact code-touch list mapped (files, methods, CSS, build, vendor)
- [ ] Proof of concept completed — N/A (explicitly not needed)
- [x] Security approach for Mermaid SVG insertion specified

## Technical Context

**Related Components:**

- `src/web/public/panels-ui.js` — `openFilePreview()` (text branch → Monaco at :3475), `_monacoLanguageId()` (already maps `md`→`markdown` at :3267), edit-mode flow (:3558–:3724)
- `src/web/public/app.js` — `_renderMarkdown()` (:1934, used by response viewer), `_sanitizeHtml()` (:1829)
- `src/web/public/sanitize-html.js` — hardened DOMPurify allowlist; **FORBID_TAGS includes `svg`, `math`, `style`** (:124)
- `src/web/public/index.html` — file-preview overlay DOM (:475–:494); marked/dompurify loaded as global scripts (:42, :45)
- `src/web/public/styles.css` — file-preview styles (:9781–:9949), markdown preview styles scoped under `.rv-text` (:12065+)
- `scripts/build.mjs`, `scripts/build-monaco-bundle.mjs`, `scripts/monaco-entry.js` — vendor bundle build pattern (esbuild → `src/web/public/vendor/`, lazy ESM dynamic import)
- `src/web/routes/file-routes.ts` — `GET /api/sessions/:id/file-content` (:1026), `lines` default 500, cap 10000 (:1205–:1210), `editable` gate (:1217+), `edit=1` full-content variant (:1047)
- `sw.js` — `APP_SHELL` precache list (Monaco deliberately NOT precached)

**Dependencies:**

- Builds on the completed Monaco file-preview work on `code-editor` (merge of `feat/file-preview-resize` + `feat/file-preview-monaco`)
- Mermaid bundle build depends on adding `mermaid` as a devDependency; `src/web/public/vendor/` is gitignored, so generated files must be force-added on commit (same as Monaco)

**Constraints:**

- Web UI is plain JS with **no bundler at runtime**; vendor libs are committed under `src/web/public/vendor/` and served statically by `@fastify/static`
- Vendor dir is `.prettierignore`d; `check:frontend-syntax` only scans top-level public JS (not `vendor/`), so minified vendor bundles are safe
- Existing sanitizer strips `svg`/`math`/`style` — Mermaid SVG needs its own sanitization pass
- `resize: both` on the popup (`styles.css:9806`) — rendered content must reflow; Monaco uses `automaticLayout`, markdown is static HTML
- XSS posture: file content is untrusted (workspace files, agent attachments) and is inserted via `innerHTML` in the popup
- Content is currently fetched with `&lines=500` (:3443) → markdown previews can be silently truncated

## Research Findings

### Investigation Results

**Markdown libraries (2026 survey):**

| Library          | Weekly DL | Approach                  | Size (gzip) | Notes                                                                                         |
| ---------------- | --------- | ------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `marked`         | ~12–15M   | renderer, fastest         | ~23KB       | raw-HTML passthrough → **must** be paired with DOMPurify; **already vendored here (v15.0.7)** |
| `markdown-it`    | ~20M      | renderer, CommonMark 100% | ~32KB       | VS Code's markdown renderer; `html:false` default; large plugin ecosystem                     |
| `remark`/unified | ~8M       | AST pipeline              | 60–100KB+   | overkill for single-file client rendering; needs `remark-rehype` + `rehype-sanitize` chain    |

- **GitHub** renders `.md` server-side with `cmark-gfm`, then aggressively sanitizes (github/markup) and renders in a sandboxed iframe.
- **VS Code** uses `markdown-it` for its built-in markdown preview; **GitHub docs** uses unified/remark/rehype for build-time rendering.
- For a browser, plain-JS, single-file preview: `marked + DOMPurify` is the canonical, documented pattern and is already fully integrated and tested in this repo.

**Mermaid.js:**

- Current major is **v11** (11.16.0 as of 2026-06), **ESM-only** (since v10), MIT. Minified bundle ≈ 480KB (~150–200KB gzip) — acceptable only when **lazy-loaded**.
- `mermaid.render(id, src)` → `{ svg, bindFunctions }`; `mermaid.parse(src)` validates without rendering; `mermaid.initialize({ startOnLoad: false, ... })` must run before render.
- `securityLevel`: default **`strict`** encodes HTML in labels and disables click handlers — keep it. **`loose` is a known stored-XSS vector**: Open WebUI GHSA-v8qj-hxv7-mgvv was a confirmed stored XSS via mermaid in a markdown file preview rendered with `securityLevel: 'loose'` and unsanitized SVG `innerHTML`.
- Defense-in-depth pattern used by real projects (openclaw PR #49511, scribegate M6, piclaw): lazy `import()` of mermaid → `securityLevel:'strict'` + `suppressErrorRendering:true` → render → run the returned SVG through **DOMPurify with the SVG profile** (`USE_PROFILES: { svg: true, svgFilters: true }`, `ADD_TAGS: ['foreignObject']`) before `innerHTML`.
- Mermaid is not present anywhere in this repo today; `marked`'s documented pattern for mermaid is a custom code renderer or a post-render pass over `pre > code.language-mermaid` nodes.

### Prototype/Testing Notes

No prototype (not required). Findings are grounded in the existing repo infra (marked+DOMPurify already shipped and unit-tested via `sanitize-html.js`'s jsdom test) and documented production patterns above.

### External Resources

- https://github.com/github/markup (GitHub markup pipeline: cmark-gfm → sanitize → render)
- https://github.com/markdown-it/markdown-it (CommonMark renderer, used by VS Code)
- https://github.com/markedjs/marked (existing vendored parser)
- https://github.com/mermaid-js/mermaid/releases/tag/v11.0.0 (v11 breaking changes, ESM, bundle size)
- https://github.com/mermaid-js/mermaid/issues/6294 (v11 bundle/ELK discussion)
- https://mermaid.ai/open-source/config/usage.html (`securityLevel` semantics, `render`/`run`/`parse` API)
- https://github.com/open-webui/open-webui/security/advisories/GHSA-v8qj-hxv7-mgvv (stored XSS via loose mermaid in md preview)
- https://github.com/openclaw/openclaw/pull/49511 (real-world lazy mermaid + double-sanitize pattern in a markdown webchat)

## Decision

### Recommendation

**Reuse the existing `marked` + DOMPurify pipeline; add `mermaid` v11 (lazy ESM bundle, `securityLevel:'strict'` + independent SVG-profile sanitization). No new markdown library is needed.**

1. In `openFilePreview()`, branch `.md`/`.markdown` to a new `_renderFilePreviewMarkdown(content)` instead of Monaco.
2. `_renderFilePreviewMarkdown`: `marked.parse(src, { breaks: true, gfm: true })` → `window.sanitizeMarkdownHtml(...)` (existing hardened sanitizer) → post-process (wrap tables, then Mermaid fences) → insert into a container reusing the `.rv-text` CSS class (so the popup inherits all existing markdown styling) → lazy-load Mermaid and render any fenced diagrams.
3. Mermaid: dynamic `import('/vendor/mermaid/mermaid.js')` (cached promise, mirroring `_getMonaco()`), `initialize({ startOnLoad:false, securityLevel:'strict', suppressErrorRendering:true, theme:'dark' })`, `render(uuid, src)` per diagram, sanitize returned SVG with a dedicated DOMPurify SVG-profile pass, then `innerHTML`.
4. **Edit/save/cancel needs no new flow code**: `enterFilePreviewEdit()` already re-fetches `edit=1` and swaps the body to Monaco (`_monacoLanguageId('md') === 'markdown'`); `cancelFilePreviewEdit()` and `saveFilePreviewEdit()` both end in `openFilePreview(...)` re-fetch + re-render, which automatically re-renders markdown (Cancel → original, Save → saved) and re-renders Mermaid. Guard the async Mermaid pass with an "overlay still visible / node still connected" check so a closed popup or a fresh edit never renders into a stale node.

### Rationale

- **marked**: already vendored (v15.0.7), already loaded globally, already wired into the same hardened sanitizer that response-viewer markdown uses — zero new runtime cost and zero sanitizer-config drift. `markdown-it` (VS Code's choice) is a fine alternative but adds a ~32KB vendor file and a second sanitizer config for no functional gain here; `remark` is build-pipeline-oriented and overkill.
- **mermaid v11 lazy + strict**: matches the project's established Monaco pattern (esbuild bundle → `vendor/`, ESM dynamic import on first use, not in `sw.js` APP_SHELL). `strict` + an independent DOMPurify SVG pass directly addresses the documented XSS failure mode; the existing allowlist forbids `svg`/`style`, so skipping the second pass would silently strip every diagram.
- The rendered-markdown body flows through the existing edit/save/cancel lifecycle unchanged, satisfying the requirement with minimal surface area.

### Implementation Notes

**Code touch list (client):**

- `src/web/public/panels-ui.js`:
  - `openFilePreview()`: after the text branch resolves, route `md`/`markdown` to `_renderFilePreviewMarkdown` (still set `filePreviewContent` for copy; still show Edit when `data.editable`; footer shows lines/size as today). For `.md`, request `&lines=10000` instead of `500` to avoid truncated previews (or note truncation in the footer, as today).
  - New `_getMermaid()` lazy loader (mirror `_getMonaco()` at :3279).
  - New `_renderFilePreviewMarkdown(src)`: sanitize → table wrap → mermaid fence extraction (`pre > code.language-mermaid`, case-insensitive) → container with `class="rv-text markdown-preview"` → schedule mermaid renders.
  - New `_renderMermaidDiagrams(container)`: per-diagram `render` → `sanitizeMermaidSvg` → insert; errors replaced inline with the raw `<pre><code>` source + message; re-check `filePreviewOverlay.visible` and `node.isConnected` before each insertion.
  - New pure helpers (for vitest): `extractMermaidFences(html)` and `sanitizeMermaidSvg(svg, dompurify)` — keep them in `sanitize-html.js`-style testable modules.
- `src/web/public/styles.css`: `.file-preview-body .markdown-preview` (readable max-width, padding), `.file-preview-body .mermaid-preview` (overflow-x:auto, background `var(--bg-input)`, border, radius, `svg { max-width:100%; height:auto; }`). Watch the existing `.file-preview-body pre` rule (:9849 — `white-space:pre-wrap`) vs the `.rv-text pre` rules (later, so they win; verify visually).
- `index.html`: **no** script tag (Mermaid lazy, like Monaco).
- `sw.js`: do **not** precache the mermaid bundle (consistent with Monaco).

**Build/vendor:**

- `package.json`: add devDependency `mermaid@^11.16.0`; add `"build:mermaid": "node scripts/build-mermaid-bundle.mjs"`.
- New `scripts/mermaid-entry.js` (`export default mermaid`) + `scripts/build-mermaid-bundle.mjs` (esbuild, `format:'esm'`, `bundle:true`, `minify:true`, `target:'es2020'`, `outfile: src/web/public/vendor/mermaid/mermaid.js`). Mermaid v11 is ESM-only — no workers, one file.
- `scripts/build.mjs`: run the mermaid bundle step in `npm run build` (mirror `build:monaco`).
- Force-add `src/web/public/vendor/mermaid/` on commit (`vendor/` is gitignored, like Monaco).

**Tests:**

- Extend/extract pure helpers so vitest covers: md file routes to the markdown render path; mermaid fences are extracted case-insensitively; scripts inside `.md` content are still stripped; `sanitizeMermaidSvg` keeps `svg`/`path`/`g` but strips `<script>` and event handlers.
- Existing sanitizer unit test (`sanitize-html.js` jsdom test) must keep passing — the main allowlist is unchanged.

### Follow-up Actions

- [ ] Add `mermaid` devDependency + `build:mermaid` + wire into `npm run build`
- [ ] Implement `_getMermaid` / `_renderFilePreviewMarkdown` / `_renderMermaidDiagrams` in `panels-ui.js`
- [ ] Route `.md` in `openFilePreview` to the markdown renderer; bump `lines=10000` for md
- [ ] Add `.markdown-preview` / `.mermaid-preview` CSS
- [ ] Add pure-helper unit tests (fence extraction, SVG sanitization, XSS stripping)
- [ ] Build, run `npm run check:frontend-syntax`, `format:check`, targeted tests, and a browser smoke test (open `.md` with a mermaid fence → diagram renders; Edit → Monaco; Cancel → re-render; Save → re-render with changes)
- [ ] Update architecture documents (`docs/file-viewer-edit-plan.md` references) and create implementation tasks
- [ ] Create implementation tasks

## Status History

| Date       | Status         | Notes                                                                                                                                                       |
| ---------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-14 | 🟡 In Progress | Code review + library research (marked vs markdown-it vs remark; mermaid v11 security/lazy-load)                                                            |
| 2026-08-14 | 🟢 Complete    | Recommendation finalized: reuse marked+DOMPurify, add lazy mermaid v11 strict + SVG-profile sanitization; code-touch list documented; no PoC (not required) |

---

_Last updated: 2026-08-14 by TBD_
