import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Markdown from '../components/explorer/Markdown';
import { sanitizeMermaidSvg } from '../components/explorer/MermaidDiagram';

/** Mock mermaid so tests never run its layout engine (which needs a real browser). */
const mermaidInitialize = vi.fn();
const mermaidRender = vi.fn();
vi.mock('mermaid', () => ({
  default: {
    initialize: (...args: unknown[]) => mermaidInitialize(...args),
    render: (...args: unknown[]) => mermaidRender(...args),
  },
}));

const SHA = 'b'.repeat(40);
const context = { repo: 'website', commitSha: SHA, baseDir: 'docs' };

function renderMarkdown(source: string) {
  return render(
    <MemoryRouter>
      <Markdown source={source} name="README.md" context={context} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mermaidInitialize.mockReset();
  mermaidRender.mockReset();
  mermaidRender.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>', diagramType: 'flowchart' });
});

describe('Markdown rendering', () => {
  it('renders GFM headings with GitHub-style anchors', () => {
    const { container } = renderMarkdown('# Getting Started\n\n## API & Types\n');
    expect(container.querySelector('h1')?.id).toBe('getting-started');
    expect(container.querySelector('h2')?.id).toBe('api--types');
  });

  it('deduplicates repeated heading anchors like GitHub', () => {
    const { container } = renderMarkdown('# Intro\n\n## Intro\n');
    const ids = Array.from(container.querySelectorAll('h1, h2')).map((el) => el.id);
    expect(ids).toEqual(['intro', 'intro-1']);
  });

  it('renders tables, task lists (read-only), and fenced code', () => {
    const source = [
      '| Name | Value |',
      '| --- | --- |',
      '| a | 1 |',
      '',
      '- [x] done',
      '- [ ] todo',
      '',
      '```ts',
      'const answer: number = 42;',
      '```',
    ].join('\n');
    const { container } = renderMarkdown(source);
    expect(screen.getByRole('table')).toBeInTheDocument();
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    boxes.forEach((box) => expect(box).toBeDisabled());
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect(container.querySelector('pre')).not.toBeNull();
    expect(container.textContent).toContain('const answer');
  });

  it('never executes scripts, iframes, or event handlers from raw HTML', () => {
    const source = [
      'Hello <script>window.__pwned = true</script>',
      '',
      '<img src="x" onerror="window.__pwned = true">',
      '',
      '<iframe src="https://example.com"></iframe>',
      '',
      '<style>body { display: none; }</style>',
    ].join('\n');
    const { container } = renderMarkdown(source);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('style')).toBeNull();
    expect(container.querySelector('img[onerror]')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('renders the sanitized raw-HTML subset that GitHub allows', () => {
    const source = [
      '<div align="center">',
      '',
      '<img src="https://github.com/ankworks.png" alt="AnkWorks Logo" width="110" height="110"/>',
      '',
      '<table>',
      '<tr>',
      '<td width="33%" align="center">Cell content</td>',
      '</tr>',
      '</table>',
      '',
      '</div>',
    ].join('\n');
    const { container } = renderMarkdown(source);
    const div = container.querySelector('div[align="center"]');
    expect(div).not.toBeNull();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('width')).toBe('110');
    expect(img.getAttribute('height')).toBe('110');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(container.textContent).toContain('Cell content');
  });

  it('strips style attributes and unsafe URLs from raw HTML but keeps the text', () => {
    const { container } = renderMarkdown('<p style="color:red" onclick="window.__pwned = true">styled</p>\n\n<a href="javascript:alert(1)">click</a>');
    const paragraph = container.querySelector('p') as HTMLElement;
    expect(paragraph.getAttribute('style')).toBeNull();
    expect(paragraph.getAttribute('onclick')).toBeNull();
    expect(container.querySelectorAll('a[href^="javascript:"]')).toHaveLength(0);
    expect(container.textContent).toContain('styled');
    expect(container.textContent).toContain('click');
  });

  it('drops javascript: and data: link destinations but keeps the text', () => {
    const { container } = renderMarkdown('[click me](javascript:alert(1)) and [data](data:text/html,hi)');
    expect(container.querySelectorAll('a[href^="javascript:"], a[href^="data:"]')).toHaveLength(0);
    expect(container.textContent).toContain('click me');
  });

  it('adds noopener noreferrer to external links', () => {
    const { container } = renderMarkdown('[site](https://example.com/page)');
    const link = container.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://example.com/page');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('routes relative links inside the explorer, pinned to the commit SHA', () => {
    const { container } = renderMarkdown('See [the API](./api/index.md) and [src](../src/).');
    const links = Array.from(container.querySelectorAll('a'));
    expect(links[0].getAttribute('href')).toBe(`/repos/website/blob/${SHA}/docs/api/index.md`);
    expect(links[1].getAttribute('href')).toBe(`/repos/website/tree/${SHA}/src`);
  });

  it('resolves relative images to raw.githubusercontent.com at the same commit', () => {
    const { container } = renderMarkdown('![logo](./images/logo.png)');
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`https://raw.githubusercontent.com/ankworks/website/${SHA}/docs/images/logo.png`);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('shows external images only from allowlisted hosts and text otherwise', () => {
    const { container } = renderMarkdown('![ok](https://img.shields.io/badge/a-b-c.svg) ![bad](https://tracker.example.com/p.gif)');
    const images = Array.from(container.querySelectorAll('img'));
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('src')).toBe('https://img.shields.io/badge/a-b-c.svg');
    expect(container.textContent).toContain('bad');
  });

  it('highlights fenced code in a known language and falls back to plain text otherwise', async () => {
    const { container } = renderMarkdown('```unknownlang\nplain text here\n```');
    expect(within(container).getByText(/plain text here/)).toBeInTheDocument();
  });
});

describe('Mermaid diagrams', () => {
  it('renders a mermaid fence with strict security and no HTML labels', async () => {
    renderMarkdown('```mermaid\ngraph TD; A-->B\n```');
    await waitFor(() => expect(screen.getByTestId('mermaid-diagram')).toBeInTheDocument());
    expect(mermaidInitialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', htmlLabels: false, startOnLoad: false })
    );
    expect(mermaidRender).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('mermaid-diagram').querySelector('svg')).not.toBeNull());
  });

  it('falls back to showing the source when rendering fails', async () => {
    mermaidRender.mockRejectedValue(new Error('Parse error'));
    renderMarkdown('```mermaid\ngraph TD; A-->\n```');
    await waitFor(() => expect(screen.getByText(/could not be rendered/i)).toBeInTheDocument());
    expect(screen.getByTestId('mermaid-diagram').textContent).toContain('graph TD; A-->');
  });

  it('never executes diagram content as HTML in the fallback', async () => {
    mermaidRender.mockRejectedValue(new Error('nope'));
    const { container } = renderMarkdown('```mermaid\n<script>window.__pwned = true</script>\n```');
    await waitFor(() => expect(screen.getByText(/could not be rendered/i)).toBeInTheDocument());
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('does not touch the mermaid module for non-mermaid fences', () => {
    renderMarkdown('```ts\nconst x = 1;\n```');
    expect(mermaidRender).not.toHaveBeenCalled();
    expect(mermaidInitialize).not.toHaveBeenCalled();
  });
});

describe('sanitizeMermaidSvg', () => {
  it('removes active content, unwraps anchors, and drops event handlers', () => {
    const markup = [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<style>.node { fill: red; }</style>',
      '<script>window.__pwned = true</script>',
      '<foreignObject><div>html</div></foreignObject>',
      '<a href="https://example.com"><text>linked</text></a>',
      '<a href="javascript:alert(1)"><text>bad</text></a>',
      '<g onclick="alert(2)" data-ok="yes"><text>node</text></g>',
      '</svg>',
    ].join('');
    const { svg, css } = sanitizeMermaidSvg(markup);
    expect(svg).not.toBeNull();
    expect(svg!.querySelector('script, foreignObject, a')).toBeNull();
    expect(css).toContain('.node');
    expect(svg!.querySelector('style')).toBeNull();
    expect(svg!.querySelector('g')!.getAttribute('onclick')).toBeNull();
    expect(svg!.querySelector('g')!.getAttribute('data-ok')).toBe('yes');
    expect(svg!.textContent).toContain('linked');
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('captures inline styles for CSSOM re-application and rejects unsafe URLs', () => {
    const markup = '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill: #333" /><image href="javascript:x" /><image href="https://ok.example.com/a.png" /></svg>';
    const { svg, styled } = sanitizeMermaidSvg(markup);
    const rect = svg!.querySelector('rect')!;
    expect(rect.getAttribute('style')).toBeNull();
    expect(styled).toEqual([{ element: rect, cssText: 'fill: #333' }]);
    const images = Array.from(svg!.querySelectorAll('image'));
    expect(images[0].getAttribute('href')).toBeNull();
    expect(images[1].getAttribute('href')).toBe('https://ok.example.com/a.png');
  });

  it('returns a null svg when the markup contains no diagram', () => {
    expect(sanitizeMermaidSvg('<p>not a diagram</p>')).toEqual({ svg: null, css: '', styled: [] });
  });
});
