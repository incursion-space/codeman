/**
 * @fileoverview File-preview CSV/TSV render path: `.csv`/`.tsv` content renders
 * as a GitHub-style interactive table (`_renderFilePreviewCsv` /
 * `_renderCsvTable`): header row, row numbers, click-to-sort columns, live
 * search filter, row cap, and a message+raw-source fallback on parse errors.
 *
 * Loaded via `vm` against a jsdom window (same harness family as
 * file-preview-markdown-render.test.ts). The real shipping parser
 * (csv-preview.js) is executed into the same context so `CsvParser` resolves
 * exactly as it does in the browser.
 *
 * Pinned here:
 *   1. the table renders header + data rows with a row-number column,
 *   2. cell values are inserted via textContent ONLY — an adversarial cell like
 *      `<img src=x onerror=...>` renders as literal text and never becomes an
 *      element or executes,
 *   3. header clicks toggle ascending/descending sort (numeric-aware),
 *   4. the search input filters rows live,
 *   5. malformed/empty input degrades to `.csv-fallback` (message + raw source),
 *   6. more than 500 data rows are capped with a "showing first N of M" note.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it } from 'vitest';

const PUBLIC = resolve(import.meta.dirname, '../src/web/public');
const panelsJs = readFileSync(resolve(PUBLIC, 'panels-ui.js'), 'utf8');
const csvPreviewJs = readFileSync(resolve(PUBLIC, 'csv-preview.js'), 'utf8');

function loadApp() {
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
      '<div id="filePreviewBody"></div>' +
      '<div id="filePreviewOverlay" class="visible"></div>' +
      '</body></html>',
    { url: 'http://localhost/' }
  );
  const window = dom.window as unknown as Record<string, unknown>;

  const CodemanApp = function CodemanApp(this: unknown) {} as unknown as new () => Record<string, unknown>;

  const context = vm.createContext({
    ...window,
    console: { ...console, warn: () => {}, error: () => {} },
    CodemanApp,
    escapeHtml: (s: string) => String(s),
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(csvPreviewJs, context, { filename: 'csv-preview.js' });
  vm.runInContext(panelsJs, context, { filename: 'panels-ui.js' });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = new CodemanApp() as Record<string, any>;
  const body = window.document.getElementById('filePreviewBody') as HTMLElement;
  app.$ = (id: string) => (id === 'filePreviewBody' ? body : null);
  return { app, body, window };
}

function bodyCells(body: HTMLElement, rowIndex: number): string[] {
  const tr = body.querySelectorAll('table.csv-table tbody tr')[rowIndex] as HTMLTableRowElement;
  return Array.from(tr.querySelectorAll('td'))
    .slice(1)
    .map((td) => td.textContent ?? '');
}

describe('file preview CSV render path', () => {
  let app: Record<string, any>;
  let body: HTMLElement;

  beforeEach(() => {
    ({ app, body } = loadApp());
  });

  it('renders a header row, data rows, and row numbers', () => {
    app._renderFilePreviewCsv('name,age\nAlice,30\nBob,25');

    const table = body.querySelector('table.csv-table') as HTMLElement;
    expect(table).not.toBeNull();
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headers.slice(1)).toEqual(['name', 'age']);

    const rows = table.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(bodyCells(body, 0)).toEqual(['Alice', '30']);
    expect(bodyCells(body, 1)).toEqual(['Bob', '25']);
    expect(table.querySelector('tbody tr td.csv-rownum')?.textContent).toBe('1');
  });

  it('renders an adversarial cell as literal text — no element, no execution', () => {
    const evil = '<img src=x onerror="window.__PWNED__=true">';
    app._renderFilePreviewCsv(`a,b\nsafe,${evil}`);

    const td = body.querySelector('table.csv-table tbody tr td:last-child') as HTMLElement;
    expect(td.textContent).toBe(evil);
    expect(body.querySelector('table.csv-table img')).toBeNull();
    expect(body.querySelectorAll('table.csv-table [onerror]').length).toBe(0);
  });

  it('sorts a column ascending then descending on header clicks', () => {
    app._renderFilePreviewCsv('name,age\nAlice,30\nBob,25\nCarol,10');

    const ths = body.querySelectorAll('table.csv-table thead th');
    const ageTh = ths[2] as HTMLElement;

    ageTh.click();
    expect(bodyCells(body, 0)).toEqual(['Carol', '10']);
    expect(bodyCells(body, 1)).toEqual(['Bob', '25']);
    expect(bodyCells(body, 2)).toEqual(['Alice', '30']);

    ageTh.click();
    expect(bodyCells(body, 0)).toEqual(['Alice', '30']);
    expect(bodyCells(body, 2)).toEqual(['Carol', '10']);
  });

  it('filters rows live through the search box', () => {
    const { app, body, window } = loadApp();
    app._renderFilePreviewCsv('name,age\nAlice,30\nBob,25\ncarol,10');

    const input = body.querySelector('.csv-search') as HTMLInputElement;
    input.value = 'bob';
    const EventCtor = window.Event as typeof Event;
    input.dispatchEvent(new EventCtor('input'));

    const rows = body.querySelectorAll('table.csv-table tbody tr');
    expect(rows.length).toBe(1);
    expect(bodyCells(body, 0)).toEqual(['Bob', '25']);
  });

  it('degrades to a message + raw source on unterminated quoting', () => {
    app._renderFilePreviewCsv('a,b\n1,"unterminated');

    const fallback = body.querySelector('.csv-fallback') as HTMLElement;
    expect(fallback).not.toBeNull();
    expect(fallback.querySelector('.csv-fallback-error')?.textContent).toContain('Unterminated quoted field');
    expect(fallback.querySelector('pre code')?.textContent).toContain('unterminated');
    expect(body.querySelector('table.csv-table')).toBeNull();
  });

  it('degrades to a message when the file is empty', () => {
    app._renderFilePreviewCsv('');
    const fallback = body.querySelector('.csv-fallback') as HTMLElement;
    expect(fallback).not.toBeNull();
    expect(fallback.querySelector('.csv-fallback-error')?.textContent).toContain('No rows to display');
  });

  it('caps rendered rows at 500 with a showing note', () => {
    const lines = ['col'];
    for (let i = 1; i <= 510; i++) lines.push(`row${i}`);
    app._renderFilePreviewCsv(lines.join('\n'));

    expect(body.querySelector('.csv-note')?.textContent).toBe('Showing first 500 of 510 rows');
    expect(body.querySelectorAll('table.csv-table tbody tr').length).toBe(500);
  });

  it('renders tab-separated files via delimiter auto-detection', () => {
    app._renderFilePreviewCsv('name\tage\nA\t1\nB\t2');
    expect(bodyCells(body, 0)).toEqual(['A', '1']);
    expect(bodyCells(body, 1)).toEqual(['B', '2']);
  });
});
