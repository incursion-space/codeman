/**
 * @fileoverview CSV/TSV parsing + cell-comparison helpers for the file-preview
 * table renderer (panels-ui.js `_renderFilePreviewCsv`). Pure functions, no
 * DOM access, no runtime dependencies — unit-testable via CommonJS and exposed
 * on `window` for the classic-script page (index.html loads this before
 * panels-ui.js, mirroring sanitize-html.js).
 *
 * Delimiters are auto-detected (comma/tab/semicolon/pipe) so `.csv` and `.tsv`
 * both work; the parser handles RFC-4180 quoting, ""-escaped quotes, embedded
 * delimiters/newlines inside quotes, CRLF/LF line endings, and a UTF-8 BOM.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CsvParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Delimiters considered by detectDelimiter, in detection order. */
  const DELIMITERS = [',', '\t', ';', '|'];

  /**
   * Strip a UTF-8 BOM if present.
   * @param {string} text
   * @returns {string}
   */
  function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  /**
   * Pick the delimiter that appears most often outside quotes on the first
   * non-empty line. Defaults to comma when nothing matches (or on ties).
   * @param {string} text
   * @param {string[]} [candidates]
   * @returns {string}
   */
  function detectDelimiter(text, candidates) {
    const list = candidates || DELIMITERS;
    const firstLine = (stripBom(String(text || '')).split(/\r?\n/, 1)[0] || '').trim();
    let best = ',';
    let bestCount = 0;
    for (const delim of list) {
      let count = 0;
      let inQuotes = false;
      for (let i = 0; i < firstLine.length; i++) {
        const ch = firstLine[i];
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === delim && !inQuotes) count++;
      }
      if (count > bestCount) {
        bestCount = count;
        best = delim;
      }
    }
    return best;
  }

  /**
   * Parse CSV/TSV text into a header row + data rows.
   *
   * @param {string} text
   * @param {{ delimiter?: string }} [options]
   * @returns {{ delimiter: string, header: string[], rows: string[][], errors: string[] }}
   *   `header` is the first record (or `[]` when the input is empty); `rows`
   *   are the remaining records, short rows padded to the header width with ''
   *   and trailing empty rows dropped. `errors` lists parse problems (e.g. an
   *   unterminated quoted field) — callers should fall back to raw text.
   */
  function parseCsv(text, options) {
    const src = stripBom(String(text || ''));
    const opts = options || {};
    const delimiter = opts.delimiter || detectDelimiter(src);
    const rows = [];
    const errors = [];
    let row = [];
    let field = '';
    let fieldStarted = false;
    let inQuotes = false;
    let i = 0;
    const n = src.length;

    function endField() {
      row.push(field);
      field = '';
      fieldStarted = false;
    }

    function endRow() {
      endField();
      rows.push(row);
      row = [];
    }

    while (i < n) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }
      if (ch === '"' && field === '' && !fieldStarted) {
        inQuotes = true;
        fieldStarted = true;
        i++;
        continue;
      }
      if (ch === delimiter) {
        endField();
        i++;
        continue;
      }
      if (ch === '\r') {
        if (src[i + 1] === '\n') i++;
        endRow();
        i++;
        continue;
      }
      if (ch === '\n') {
        endRow();
        i++;
        continue;
      }
      field += ch;
      fieldStarted = true;
      i++;
    }

    if (inQuotes) errors.push('Unterminated quoted field');
    if (field !== '' || fieldStarted) endField();
    if (row.length) endRow();

    // Drop blank trailing records (a file ending in a newline yields one).
    while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
      rows.pop();
    }

    let header = [];
    if (rows.length) header = rows.shift();
    while (header.length && header[header.length - 1] === '') header.pop();

    const normalized = rows.map((r) => {
      const cells = r.slice();
      while (cells.length && cells[cells.length - 1] === '') cells.pop();
      while (cells.length < header.length) cells.push('');
      return cells;
    });

    return { delimiter, header, rows: normalized, errors };
  }

  /**
   * Numeric-aware comparator for table column sorting. Buckets: empty cells
   * sort last, numeric cells sort before text (both numerically), then text
   * compares lexicographically (locale-aware, numeric collation).
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
  function compareCells(a, b) {
    const aEmpty = String(a).trim() === '';
    const bEmpty = String(b).trim() === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    const an = Number(a);
    const bn = Number(b);
    const aNum = Number.isFinite(an);
    const bNum = Number.isFinite(bn);
    if (aNum && bNum) {
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    }
    if (aNum) return -1;
    if (bNum) return 1;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  return { DELIMITERS, stripBom, detectDelimiter, parseCsv, compareCells };
});
