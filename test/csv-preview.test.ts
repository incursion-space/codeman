/**
 * @fileoverview CSV/TSV parser + cell-comparison helpers for the file-preview
 * table renderer (`src/web/public/csv-preview.js`). Loads the exact shipping
 * artifact the way the browser does: the file is a classic script exposing
 * `window.CsvParser` and a CommonJS export; we evaluate it with a dummy
 * module/exports object to obtain the export (same pattern as
 * markdown-sanitizer.test.ts loading sanitize-html.js).
 *
 * Pinned here:
 *   1. RFC-4180 quoting — quoted fields, ""-escaped quotes, embedded
 *      delimiters/newlines inside quotes,
 *   2. line endings (LF / CRLF) and trailing blank-record dropping,
 *   3. delimiter auto-detection (comma/tab/semicolon/pipe) + BOM strip,
 *   4. ragged-row padding to header width,
 *   5. parse-error reporting (unterminated quoted field),
 *   6. numeric-aware cell comparison for column sort.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const publicDir = join(process.cwd(), 'src/web/public');

interface CsvParserApi {
  detectDelimiter: (text: string, candidates?: string[]) => string;
  parseCsv: (
    text: string,
    opts?: { delimiter?: string }
  ) => {
    delimiter: string;
    header: string[];
    rows: string[][];
    errors: string[];
  };
  compareCells: (a: string, b: string) => number;
}

function loadCsvParser(): CsvParserApi {
  const src = readFileSync(join(publicDir, 'csv-preview.js'), 'utf8');
  const mod: { exports: unknown } = { exports: {} };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('module', 'exports', src)(mod, mod.exports);
  const api = mod.exports as CsvParserApi;
  if (typeof api.parseCsv !== 'function' || typeof api.detectDelimiter !== 'function') {
    throw new Error('CsvParser not exported');
  }
  return api;
}

const { detectDelimiter, parseCsv, compareCells } = loadCsvParser();

describe('parseCsv — RFC-4180', () => {
  it('parses a simple comma file with a header row', () => {
    const out = parseCsv('name,age\nAlice,30\nBob,25');
    expect(out.delimiter).toBe(',');
    expect(out.header).toEqual(['name', 'age']);
    expect(out.rows).toEqual([
      ['Alice', '30'],
      ['Bob', '25'],
    ]);
    expect(out.errors).toEqual([]);
  });

  it('handles quoted fields containing the delimiter', () => {
    const out = parseCsv('id,note\n1,"Smith, John"');
    expect(out.rows).toEqual([['1', 'Smith, John']]);
  });

  it('unquotes ""-escaped quotes inside quoted fields', () => {
    const out = parseCsv('quote\n"he said ""hi"""');
    expect(out.rows).toEqual([['he said "hi"']]);
  });

  it('keeps embedded newlines inside quoted fields', () => {
    const out = parseCsv('a,b,c\n1,"line1\nline2",x');
    expect(out.rows).toEqual([['1', 'line1\nline2', 'x']]);
  });

  it('handles CRLF line endings and drops the trailing blank record', () => {
    const out = parseCsv('a,b\r\n1,2\r\n');
    expect(out.header).toEqual(['a', 'b']);
    expect(out.rows).toEqual([['1', '2']]);
  });

  it('drops trailing blank lines', () => {
    expect(parseCsv('a,b\n1,2\n\n').rows).toEqual([['1', '2']]);
    expect(parseCsv('a,b\n\n').rows).toEqual([]);
  });

  it('strips a UTF-8 BOM from the header', () => {
    const out = parseCsv('\uFEFFname,age\nAlice,30');
    expect(out.header[0]).toBe('name');
  });

  it('pads ragged rows to the header width with empty strings', () => {
    const out = parseCsv('a,b,c\n1,2\nx,y,z');
    expect(out.rows).toEqual([
      ['1', '2', ''],
      ['x', 'y', 'z'],
    ]);
  });

  it('returns no rows/header for empty input without errors', () => {
    const out = parseCsv('');
    expect(out.header).toEqual([]);
    expect(out.rows).toEqual([]);
    expect(out.errors).toEqual([]);
  });

  it('reports an unterminated quoted field as a parse error', () => {
    const out = parseCsv('a,b\n1,"unterminated');
    expect(out.errors).toContain('Unterminated quoted field');
  });

  it('respects an explicitly supplied delimiter', () => {
    const out = parseCsv('a;b\n1;2', { delimiter: ';' });
    expect(out.header).toEqual(['a', 'b']);
    expect(out.rows).toEqual([['1', '2']]);
  });
});

describe('detectDelimiter', () => {
  it('detects tab-separated files', () => {
    expect(detectDelimiter('name\tage\nA\t1')).toBe('\t');
  });

  it('detects semicolon-separated files', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
  });

  it('detects pipe-separated files', () => {
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|');
  });

  it('defaults to comma when no delimiter dominates', () => {
    expect(detectDelimiter('just a plain header')).toBe(',');
  });

  it('ignores delimiters inside quoted fields', () => {
    expect(detectDelimiter('"a,b";c;d')).toBe(';');
  });
});

describe('compareCells', () => {
  it('compares numeric cells numerically', () => {
    expect(compareCells('10', '9')).toBeGreaterThan(0);
    expect(compareCells('2', '3')).toBeLessThan(0);
    expect(compareCells('5', '5')).toBe(0);
  });

  it('falls back to locale-aware string comparison for text', () => {
    expect(compareCells('apple', 'banana')).toBeLessThan(0);
    expect(compareCells('banana', 'apple')).toBeGreaterThan(0);
  });

  it('sorts empty values last', () => {
    expect(compareCells('', 'x')).toBeGreaterThan(0);
    expect(compareCells('x', '')).toBeLessThan(0);
    expect(compareCells('', '')).toBe(0);
  });

  it('sorts numeric cells before text cells in mixed columns', () => {
    expect(compareCells('10', 'apple')).toBeLessThan(0);
    expect(compareCells('apple', '10')).toBeGreaterThan(0);
    const values = ['30', 'apple', '25', '<img onerror=x>', '10', 'banana'];
    const sorted = values.slice().sort(compareCells);
    expect(sorted.slice(0, 3).slice().sort()).toEqual(['10', '25', '30']);
    expect(sorted.slice(3).slice().sort()).toEqual(['<img onerror=x>', 'apple', 'banana']);
  });
});
