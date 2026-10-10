import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Markdown from '../components/explorer/Markdown';

const SHA = 'b'.repeat(40);
const context = { repo: 'website', commitSha: SHA, baseDir: 'docs' };

function renderMarkdown(source: string) {
  return render(
    <MemoryRouter>
      <Markdown source={source} name="README.md" context={context} />
    </MemoryRouter>
  );
}

describe('Markdown rendering', () => {
  it('renders GFM headings with GitHub-style anchors', () => {
    const { container } = renderMarkdown('# Getting Started\n\n## API & Types\n');
    expect(container.querySelector('h1')?.id).toBe('getting-started');
    expect(container.querySelector('h2')?.id).toBe('api--types');
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

  it('never renders raw HTML from the README as elements', () => {
    const source = [
      'Hello <script>window.__pwned = true</script>',
      '',
      '<img src="x" onerror="window.__pwned = true">',
      '',
      '<iframe src="https://example.com"></iframe>',
    ].join('\n');
    const { container } = renderMarkdown(source);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('img[onerror]')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
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
