/**
 * @fileoverview File-preview markdown render path: `.md` files render as GFM
 * markdown (`_renderFilePreviewMarkdown`) with Mermaid fences swapped for
 * rendered SVG (`_renderMermaidDiagrams`), while scripts are left to the real
 * sanitizer (covered in markdown-sanitizer.test.ts).
 *
 * Loaded via `vm` against a jsdom window so `document.createElement('template')`
 * and querySelectorAll work — same harness family as file-preview-media.test.ts,
 * but with a real DOM instead of element stubs.
 *
 * Pinned here:
 *   1. markdown content lands in a `.rv-text.markdown-preview` container,
 *   2. ` ```mermaid ` fences (case-insensitive language) become
 *      `.mermaid-preview` hosts carrying the diagram source, not code blocks,
 *   3. the rendered SVG replaces the host (and the host marker is dropped so a
 *      re-entry does not re-render),
 *   4. a render/parse failure degrades to a `.mermaid-fallback` showing the raw
 *      fence source,
 *   5. a closed overlay / detached host aborts the async render (no insert).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const PUBLIC = resolve(import.meta.dirname, '../src/web/public');
const panelsJs = readFileSync(resolve(PUBLIC, 'panels-ui.js'), 'utf8');

interface FakeMermaid {
  initialize: ReturnType<typeof vi.fn>;
  parse: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
}

function flush(): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}

function loadApp(options: { mermaid?: FakeMermaid; markdownHtml?: string; overlayVisible?: boolean }) {
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
      '<div id="filePreviewBody"></div>' +
      `<div id="filePreviewOverlay" class="${options.overlayVisible !== false ? 'visible' : ''}"></div>` +
      '</body></html>',
    { url: 'http://localhost/' }
  );
  const window = dom.window as unknown as Record<string, unknown>;

  const CodemanApp = function CodemanApp(this: unknown) {} as unknown as new () => Record<string, unknown>;
  const marked = {
    parse: vi.fn(() => options.markdownHtml ?? ''),
  };
  const sanitizeMarkdownHtml = vi.fn((h: string) => h);
  const sanitizeMermaidSvg = vi.fn((s: string) => s);

  const context = vm.createContext({
    ...window,
    console: { ...console, warn: vi.fn(), error: vi.fn() },
    CodemanApp,
    marked,
    sanitizeMarkdownHtml,
    sanitizeMermaidSvg,
    escapeHtml: (s: string) => String(s),
    crypto: { randomUUID: () => 'test-uuid' },
    setTimeout,
    clearTimeout,
    confirm: () => true,
    fetch: () => {
      throw new Error('fetch not stubbed');
    },
  });
  vm.runInContext(panelsJs, context, { filename: 'panels-ui.js' });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = new CodemanApp() as Record<string, any>;
  const body = window.document.getElementById('filePreviewBody') as HTMLElement;
  const overlay = window.document.getElementById('filePreviewOverlay') as HTMLElement;
  app.$ = (id: string) => (id === 'filePreviewBody' ? body : id === 'filePreviewOverlay' ? overlay : null);
  app._sanitizeHtml = (h: string) => sanitizeMarkdownHtml(h);
  app._getMermaid = async () => options.mermaid ?? defaultMermaid();
  return { app, body, overlay, context, marked, sanitizeMermaidSvg };
}

function defaultMermaid(): FakeMermaid {
  return {
    initialize: vi.fn(),
    parse: vi.fn(() => true),
    render: vi.fn(async (_id: string, src: string) => ({ svg: `<svg><g>${src}</g></svg>` })),
  };
}

describe('file preview markdown render path', () => {
  let app: Record<string, any>;
  let body: HTMLElement;

  beforeEach(() => {
    app = loadApp({}).app;
    body = loadApp({}).body;
  });

  it('renders markdown into a .markdown-preview container and keeps normal code blocks', () => {
    const { app, body, marked } = loadApp({
      markdownHtml:
        '<h1>Title</h1>' +
        '<pre><code class="language-js">const x = 1;</code></pre>' +
        '<pre><code class="language-mermaid">flowchart TD\nA --> B</code></pre>',
    });
    app._renderFilePreviewMarkdown('# Title');

    const container = body.querySelector('.markdown-preview') as HTMLElement;
    expect(container).not.toBeNull();
    expect(container.className).toContain('rv-text');
    expect(container.querySelector('h1')?.textContent).toBe('Title');
    expect(marked.parse).toHaveBeenCalledWith('# Title', expect.anything());

    // normal code block survives; mermaid fence became a host
    expect(container.querySelector('code.language-js')?.textContent).toContain('const x = 1');
    const host = container.querySelector('.mermaid-preview') as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.dataset.mermaid).toContain('flowchart TD');
  });

  it('extracts mermaid fences case-insensitively', () => {
    const { app, body } = loadApp({
      markdownHtml: '<pre><code class="language-Mermaid">graph LR\nA --- B</code></pre>',
    });
    app._renderFilePreviewMarkdown('x');
    const host = body.querySelector('.mermaid-preview') as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.dataset.mermaid).toContain('graph LR');
  });

  it('renders the diagram SVG into the host and drops the marker', async () => {
    const { app, body } = loadApp({
      markdownHtml: '<pre><code class="language-mermaid">flowchart TD\nA --> B</code></pre>',
    });
    app._renderFilePreviewMarkdown('x');
    await flush();

    const host = body.querySelector('.mermaid-preview') as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.querySelector('svg')).not.toBeNull();
    expect(host.hasAttribute('data-mermaid')).toBe(false);
  });

  it('degrades to a source fallback when the diagram fails to parse', async () => {
    const mermaid = defaultMermaid();
    mermaid.parse.mockReturnValue(false);
    const { app, body } = loadApp({
      markdownHtml: '<pre><code class="language-mermaid">broken [[ syntax</code></pre>',
      mermaid,
    });
    app._renderFilePreviewMarkdown('x');
    await flush();

    const fallback = body.querySelector('.mermaid-fallback') as HTMLElement;
    expect(fallback).not.toBeNull();
    expect(fallback.textContent).toContain('broken [[ syntax');
    expect(body.querySelector('.mermaid-preview')).toBeNull();
  });

  it('aborts insertion when the overlay is no longer visible', async () => {
    const { app, body, overlay } = loadApp({
      markdownHtml: '<pre><code class="language-mermaid">flowchart TD\nA --> B</code></pre>',
      overlayVisible: false,
    });
    app._renderFilePreviewMarkdown('x');
    await flush();

    const host = body.querySelector('.mermaid-preview') as HTMLElement;
    expect(host).not.toBeNull();
    // still a pending placeholder (no svg, still marked)
    expect(host.querySelector('svg')).toBeNull();
    expect(host.hasAttribute('data-mermaid')).toBe(true);
    expect(overlay.classList.contains('visible')).toBe(false);
  });
});
