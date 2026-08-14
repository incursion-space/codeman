---
title: 'File Preview CSV/TSV Table Rendering (GitHub-style)'
category: 'Architecture & Design'
status: '🟢 Complete'
priority: 'High'
timebox: '1 week'
created: 2026-08-14
updated: 2026-08-14
owner: 'TBD'
tags: ['technical-spike', 'architecture', 'research', 'codeman', 'file-preview', 'csv', 'tsv', 'table']
---

# File Preview CSV/TSV Table Rendering (GitHub-style)

## Summary

**Spike Objective:** Decide how the file-preview popup should render `.csv`/`.tsv` files — a GitHub-style interactive table (first row as header, row numbering, click-to-sort columns, search/filter, truncation handling) with an edit-mode fallback to the existing Monaco editor — and map exactly which code must change. Preview must be read-only; clicking Edit swaps to Monaco editing the raw source; Cancel/Save re-fetch and re-render the table.

**Why This Matters:** Today `.csv`/`.tsv` files open in a read-only Monaco editor as raw text (same as every text file). Tabular data is far more useful as a table, and users expect the GitHub blob-view experience. CSV content is untrusted file data inserted into a same-origin popup, so the rendering approach must preserve the existing XSS posture. This extends the same file-preview paths that markdown, Monaco, and edit-mode already own.

**Timebox:** 1 week (research + decision).

**Decision Deadline:** Before implementation begins on `feat/file-preview-markdown-mermaid`; nothing else in flight depends on it.

## Research Question(s)

**Primary Question:** Which approach renders `.csv`/`.tsv` as an interactive table with the least disruption to the existing frontend (plain-JS, no bundler, existing hardened pipeline)?

**Secondary Questions:**

- Should we vendor a CSV library (PapaParse) or write a small RFC-4180 parser?
- Which delimiters must we support (GitHub officially supports only comma + tab), and how should we auto-detect them?
- How do we render cell content safely (the markdown path needed DOMPurify; does CSV need sanitization at all)?
- What row/truncation limits and error fallbacks are appropriate (GitHub renders up to ~512KB and falls back to raw text with a message)?
- How do the existing edit/save/cancel flows already satisfy the re-render requirement, and what must change?

## Investigation Plan

### Research Tasks

- [x] Map the current file-preview frontend flow (`openFilePreview`, markdown branch, edit-mode lifecycle, `_monacoLanguageId`) in `src/web/public/panels-ui.js`
- [x] Inventory the text/editable pipeline (`file-routes.ts` `lines`/`MAX_LINES_LIMIT`/`editable`, `file-editing.ts` allowlist — `csv`/`tsv` already editable)
- [x] Research GitHub's CSV/TSV preview behavior (docs + community) and the PapaParse vs hand-rolled trade-off
- [ ] Create proof of concept/prototype — **not required** (approach validated by GitHub's documented behavior + small, testable parser)
- [x] Document findings and recommendations (this document)

### Success Criteria

**This spike is complete when:**

- [x] Recommendation documented with rationale
- [x] Exact code-touch list mapped (files, methods, CSS, build)
- [x] Security approach for cell insertion specified
- [x] Row-limit/truncation and error-fallback behavior specified
- [ ] Proof of concept completed — N/A (explicitly not needed)

## Technical Context

**Related Components:**

- `src/web/public/panels-ui.js` — `openFilePreview()` (:3494; markdown branch at :3617, text branch at :3630), `_monacoLanguageId()` (:3245), edit-mode flow (re-fetch `edit=1` → Monaco; Cancel/Save end in `openFilePreview` re-fetch + re-render)
- `src/web/routes/file-routes.ts` — `GET /api/sessions/:id/file-content` (:1026), `lines` default 500, cap 10000 (:1205), `editable` gate (:1217)
- `src/config/file-editing.ts` — `csv`/`tsv` already in `EDITABLE_EXTENSIONS` (:87–:88), so `data.editable` will be true → Edit button shows automatically
- `src/web/public/index.html` — file-preview overlay DOM; defer script ordering (:3195–:3205; `sanitize-html.js` at :3203)
- `src/web/public/styles.css` — file-preview styles (:9842–:9894), `.rv-text` table styles (:12410+)
- `src/web/public/sanitize-html.js` — established pattern for a pure helper module exposed on `window` + CommonJS (model for a new parser module)

**Dependencies:**

- Builds on the completed markdown + Mermaid file-preview work on `feat/file-preview-markdown-mermaid` (markdown branch, `lines=10000` routing, edit-mode lifecycle, `.markdown-preview`/`.mermaid-preview` CSS, vm-harness test pattern)

**Constraints:**

- Web UI is plain JS with **no bundler at runtime**; vendor libs are committed under `src/web/public/vendor/` (gitignored, force-added). A hand-rolled parser avoids this entirely.
- Popup is same-origin and injects rendered content via `innerHTML` for markdown/images — CSV cells must NOT follow that path; untrusted cell values must be inserted via `textContent` only.
- `csv`/`tsv` are already text-editable (Edit button works with zero changes).
- Content is fetched via `lines=`; a CSV "row" can span multiple physical lines (quoted embedded newlines), so a 500-line window would silently truncate tables — fetch `lines=10000` like markdown.
- The file-content endpoint caps at 10k lines and `editable` requires ≤512KB; GitHub renders CSV only up to ~512KB.

## Research Findings

### Investigation Results

**GitHub's CSV/TSV preview (official docs + community):**

- `.csv` (comma) and `.tsv` (tab) are rendered automatically as an **interactive table**: first row is assumed to be the header, rows are numbered, header columns sort on click, and a search bar filters rows live.
- GitHub officially supports only comma and tab separators; semicolon is listed as an unsupported delimiter that can break parsing.
- Rendering only works for files up to **~512KB**; larger files fall back to raw text.
- On parse failure GitHub shows a message **above the raw text** (e.g. "No commas found in this CSV file in line 0.") rather than a broken table. Common errors: mismatched column counts (must have the same separator count per row, even for blank cells), file too large, unsupported delimiter.

**Library trade-off:**

| Option      | Size (gzip) | Notes                                                                                                    |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| PapaParse   | ~16KB       | Battle-tested RFC-4180 parser, stream/worker modes, error reporting                                      |
| Hand-rolled | ~1–2KB      | RFC-4180 subset (quotes, `""` escapes, embedded newlines, CRLF, BOM); fully unit-testable; zero new deps |

- For a read-only preview of ≤10k-line files with quoted-field support, a small hand-rolled RFC-4180 parser is sufficient and matches the repo's zero-runtime-dependency pattern (the markdown spike reused vendored `marked` rather than adding a library; there is no vendored CSV parser to reuse).
- Delimiter auto-detection (comma/tab/semicolon/pipe — count outside quotes on the first non-empty line) is a standard, small extension beyond GitHub's comma+tab; it makes `.tsv` work for free and is lenient for semicolon/pipe files.

**Security:**

- The markdown path required DOMPurify because `marked` emits raw HTML that is injected via `innerHTML`. CSV has no such intermediate: cells are **data**, not markup. Rendering every cell with `textContent` (and building header cells via `textContent` too) means an `<img onerror=…>` cell value is displayed literally and can never execute — **no sanitizer needed, no new sanitizer config**. This is strictly safer than any `innerHTML`-based table builder.
- CSV-injection / formula injection (`=SUM(A1)`, `+cmd`, `@import`) is only dangerous when a file is _opened in a spreadsheet_; a read-only web preview never executes formulas, so it is not a concern here.

**Truncation:**

- Server returns at most 10k physical lines. A table should additionally cap **rendered data rows** (GitHub-parity order of magnitude: 500 rows) and show a "showing first N of M rows" note, keeping the DOM bounded. Row count for the note is the parsed row count (not physical lines).

### Prototype/Testing Notes

No prototype (not required). Approach is grounded in GitHub's documented preview behavior, the existing editable-file pipeline (`csv`/`tsv` already editable), and the established pure-helper-module pattern (`sanitize-html.js`) + vm-harness test pattern (`test/file-preview-markdown-render.test.ts`).

### External Resources

- https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files#rendering-csv-and-tsv-data (official GitHub CSV/TSV rendering docs: header row, row numbers, search, 512KB limit, error fallback)
- https://saraford.net/2017/02/25/how-to-render-a-csv-and-tsv-file-as-an-interactive-table-on-github-056/ (interactive-table behavior: sort, filter, row linking)
- https://stackoverflow.com/questions/65074799/trouble-rendering-csv-data-as-an-interactive-table-in-github (delimiter rules: comma/tab supported, semicolon not)
- https://github.com/mholt/PapaParse (PapaParse — the main alternative dependency considered)
- https://www.rfc-editor.org/rfc/rfc4180 (RFC 4180 CSV format: quoting, CRLF, `""` escapes)

## Decision

### Recommendation

**Write a small hand-rolled RFC-4180 CSV/TSV parser + render the table with `textContent`-only cell insertion (no sanitizer, no new dependency). Reuse the existing editable-file lifecycle so Edit/Cancel/Save work unchanged.**

1. New pure module `src/web/public/csv-preview.js` (mirror `sanitize-html.js`: `window.CsvParser` global + CommonJS export) exposing:
   - `detectDelimiter(text)` — auto-detect `,` / `\t` / `;` / `|` by counting separators outside quotes on the first non-empty line (default comma).
   - `parseCsv(text, opts)` — RFC-4180: quoted fields, `""` escapes, embedded delimiters/newlines inside quotes, CRLF/LF, BOM strip; returns `{ header, rows, errors, delimiter }`; ragged rows padded to header width; trailing blank rows dropped.
   - `compareCells(a, b)` — numeric-aware comparator for column sort.
2. In `openFilePreview()`, add `isCsv = ext === 'csv' || ext === 'tsv'`; fetch `lines=10000` (like markdown); new `else if (isCsv)` branch (before the text branch) calling `_renderFilePreviewCsv(data.content)`; footer shows lines/size/truncation as today; Edit button shows via the existing `data.editable` path (no change needed — `csv`/`tsv` are already in the allowlist).
3. `_renderFilePreviewCsv(src)`: parse; on parse errors / empty file, render a GitHub-style fallback (message above escaped raw `<pre><code>`). Otherwise build `.csv-preview-wrap` containing a search input + `<table class="csv-table">` (row-number column, `<thead>` header row, `<tbody>`). Cap rendered data rows at 500 with a note. All header/cell text inserted via `textContent`.
4. `_renderCsvTable()`: rebuild `<tbody>` (and header sort indicators) from `this._csvPreviewState` (rows, `sortCol`, `sortDir`, `query`). Header click toggles asc/desc (numeric-aware via `compareCells`); search input filters rows (case-insensitive substring across any cell).
5. **Edit/save/cancel needs no new flow code**: `enterFilePreviewEdit()` re-fetches `edit=1` and swaps to Monaco; `_monacoLanguageId` maps `csv`/`tsv` → `csv` (Monaco basic-language) for highlighting; `cancelFilePreviewEdit()` / `saveFilePreviewEdit()` both end in `openFilePreview(...)` re-fetch + re-render, which re-parses and re-renders the table.

### Rationale

- **Hand-rolled parser**: ~1–2KB, zero new runtime dependency, fully unit-testable; PapaParse's streaming/worker features are irrelevant at ≤10k-line scale. Matches the repo's dependency posture (markdown reused vendored `marked`; nothing to reuse here).
- **`textContent`-only rendering**: eliminates the XSS surface entirely — no DOMPurify config, no allowlist drift, no SVG-profile concerns. An adversarial cell like `<img src=x onerror=…>` is displayed verbatim.
- **Reuse of editable lifecycle + auto-detected delimiter**: `.tsv` works with no extra code, and Edit/Cancel/Save "just work" because `csv`/`tsv` are already editable and the lifecycle re-fetches/re-renders.
- **GitHub-parity interactions** (sort + search + row numbers) are cheap client-side operations on ≤500 rendered rows.

### Implementation Notes

**Code touch list (client):**

- New `src/web/public/csv-preview.js` (pure: `detectDelimiter`, `parseCsv`, `compareCells`; `window.CsvParser` + `module.exports`).
- `src/web/public/index.html`: add `<script defer src="csv-preview.js"></script>` after `sanitize-html.js` (:3203).
- `src/web/public/panels-ui.js`:
  - `openFilePreview()`: `isCsv = ext === 'csv' || ext === 'tsv'`; `lines` becomes `isMarkdown || isCsv ? 10000 : 500`; new `else if (isCsv)` branch (set `filePreviewContent`, call `_renderFilePreviewCsv`, footer lines/size/truncation, Edit button when `data.editable`).
  - `_monacoLanguageId()`: add `csv: 'csv', tsv: 'csv'` (Monaco ships a `csv` basic-language; verify in smoke test).
  - New `_renderFilePreviewCsv(src)` and `_renderCsvTable()` + `_csvPreviewState`; search input wired via `input` event; sort wired via `thead` click (row-number column excluded). Fallback: `.csv-fallback` with `.csv-fallback-error` + escaped raw source.
- `src/web/public/styles.css`: `.file-preview-body .csv-preview-wrap` (padding, overflow-x auto), `.csv-note`, `.csv-search`, `.csv-table` (borders, sticky thead, sortable `th` with cursor + `aria-sort` + arrow, `.csv-rownum` column, zebra + hover rows), `.csv-fallback`, `.csv-fallback-error` (uses `var(--danger)`).

**Build/vendor:**

- **No new devDependency, no bundle step** (`build.mjs`/`package.json` unchanged; `csv-preview.js` is a top-level public JS file, scanned by `check:frontend-syntax`, committed normally).

**Tests:**

- New `test/csv-preview.test.ts` (pure): quoting, `""` escapes, embedded delimiter/newline, CRLF, delimiter auto-detect (comma/tab/semicolon/pipe), BOM strip, ragged padding, trailing blank row drop, unterminated-quote error, `compareCells` numeric-vs-string.
- New `test/file-preview-csv-render.test.ts` (vm+jsdom harness, modeled on `test/file-preview-markdown-render.test.ts`): table renders header + rows; XSS cell value renders as literal `textContent` (no element, no script exec); header click sorts asc/desc; search filters rows; malformed input renders `.csv-fallback` with message + raw source.
- Existing file-preview and sanitizer tests must keep passing (no changes to sanitizers).

### Follow-up Actions

- [ ] Create `src/web/public/csv-preview.js` (parser + compare) and add to `index.html`
- [ ] Implement `_renderFilePreviewCsv` / `_renderCsvTable` + `isCsv` routing in `panels-ui.js`; add `csv`/`tsv` Monaco language mapping
- [ ] Add CSV table CSS (wrap/search/table/sort/fallback)
- [ ] Add unit + render-path tests
- [ ] Build, `npm run check:frontend-syntax`, `format:check`, targeted tests, browser smoke test (open `.csv` with quotes/multiline cells → table renders; sort + search work; malicious cell executes nothing; Edit → Monaco; Cancel/Save → re-render)
- [ ] Update architecture documents and create implementation tasks

## Status History

| Date       | Status      | Notes                                                                                                                                                                              |
| ---------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-14 | 🟢 Complete | Decision finalized: hand-rolled RFC-4180 parser + `textContent`-only table, GitHub-style interactions, reuse editable lifecycle; code-touch list documented; no PoC (not required) |

---

_Last updated: 2026-08-14 by TBD_
