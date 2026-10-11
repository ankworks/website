import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Markdown from '../components/explorer/Markdown';
import IssueMarkdown from '../components/collaboration/IssueMarkdown';
import { parseAlertMarker } from '../shared/markdown-alerts';
import { expandEmojiShortcodes } from '../shared/emoji';

/**
 * GitHub-quality Markdown rendering (V3 Markdown milestone).
 *
 * Covers the five alert types, nested Markdown inside alerts, tables, task
 * lists, emoji, code blocks, relative links and images, and — most importantly —
 * that XSS payloads are still stripped after all of these were added.
 */

const SHA = 'b'.repeat(40);
const context = { repo: 'website', commitSha: SHA, baseDir: 'docs' };

function renderReadme(source: string) {
  return render(
    <MemoryRouter>
      <Markdown source={source} name="README.md" context={context} />
    </MemoryRouter>
  );
}

function renderComment(source: string) {
  return render(<IssueMarkdown source={source} label="Comment" />);
}

describe('GitHub alerts', () => {
  it('renders all five alert types with a title and no raw marker', () => {
    const source = ['> [!NOTE]', '> Note body.', '', '> [!TIP]', '> Tip body.', '', '> [!IMPORTANT]', '> Important body.', '', '> [!WARNING]', '> Warning body.', '', '> [!CAUTION]', '> Caution body.'].join('\n');
    const { container } = renderReadme(source);

    for (const type of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
      const alert = container.querySelector(`[data-alert="${type}"]`);
      expect(alert, `alert ${type} should exist`).not.toBeNull();
      expect(alert?.querySelector('[data-alert-title]')?.textContent?.toLowerCase()).toContain(
        type.toLowerCase()
      );
    }
    // The marker itself is never shown.
    expect(container.textContent).not.toContain('[!NOTE]');
    expect(container.textContent).not.toContain('[!CAUTION]');
  });

  it('keeps nested Markdown inside an alert', () => {
    const source = ['> [!IMPORTANT]', '> Read this.', '>', '> - first item', '> - **second** item', '>', '> `inline code`'].join('\n');
    const { container } = renderReadme(source);
    const alert = container.querySelector('[data-alert="IMPORTANT"]');
    expect(alert).not.toBeNull();
    expect(alert?.querySelectorAll('li')).toHaveLength(2);
    expect(alert?.querySelector('li strong')?.textContent).toBe('second');
    expect(alert?.querySelector('code')?.textContent).toBe('inline code');
  });

  it('leaves a blockquote alone when the marker is not at the start', () => {
    const source = '> See the [!NOTE] marker above.\n';
    const { container } = renderReadme(source);
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect(container.querySelector('blockquote')).not.toBeNull();
    expect(container.textContent).toContain('[!NOTE]');
  });

  it('leaves an unknown marker as a blockquote', () => {
    const source = '> [!DANGER]\n> Not a GitHub alert.\n';
    const { container } = renderReadme(source);
    expect(container.querySelector('[data-alert]')).toBeNull();
  });

  it('renders an alert in issue comments too', () => {
    const { container } = renderComment('> [!WARNING]\n> This is deprecated.\n');
    expect(container.querySelector('[data-alert="WARNING"]')).not.toBeNull();
    expect(container.textContent).not.toContain('[!WARNING]');
  });

  it('parses the marker and strips the blank line GitHub allows', () => {
    expect(parseAlertMarker('[!NOTE]\n\nUseful information.')).toEqual({ type: 'NOTE', rest: 'Useful information.' });
    // GitHub requires the marker on its own line; text after it is not an alert.
    expect(parseAlertMarker('[!tip] Hot tip')).toBeNull();
    expect(parseAlertMarker('[!TIP]\n\nHot tip')).toEqual({ type: 'TIP', rest: 'Hot tip' });
    expect(parseAlertMarker('Not an alert')).toBeNull();
  });
});

describe('tables', () => {
  it('renders an accessible table with alignment and a scroll wrapper', () => {
    const source = ['| Feature | Status | Notes |', '| :--- | :---: | ---: |', '| Alerts | done | shipped |', '| Tables | done | shipped |'].join('\n');
    const { container } = renderReadme(source);
    const table = container.querySelector('table.markdown-table');
    expect(table).not.toBeNull();
    expect(container.querySelector('.markdown-table-wrap')).not.toBeNull();
    // Header cells are real column headers.
    expect(container.querySelectorAll('th[scope="col"]')).toHaveLength(3);
    // GFM alignment is preserved.
    const firstRow = container.querySelectorAll('tbody tr')[0];
    const cells = firstRow?.querySelectorAll('td');
    expect((cells?.[1] as HTMLElement | undefined)?.style.textAlign).toBe('center');
    expect((cells?.[2] as HTMLElement | undefined)?.style.textAlign).toBe('right');
  });
});

describe('task lists', () => {
  it('renders inert checkboxes that cannot trigger a write', () => {
    const source = '- [x] completed task\n- [ ] uncompleted task\n';
    const { container } = renderReadme(source);
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.checked).toBe(true);
    expect(boxes[1]?.checked).toBe(false);
    // Inert: no click handler can turn a rendered document into a GitHub write.
    for (const box of boxes) {
      expect(box.disabled).toBe(true);
      expect(box.readOnly).toBe(true);
    }
    expect(container.querySelectorAll('li.markdown-task-item')).toHaveLength(2);
  });
});

describe('emoji', () => {
  it('expands GitHub shortcodes and passes Unicode emoji through', () => {
    const { container } = renderReadme('Shipped :rocket: 🎉\n');
    expect(container.textContent).toContain('🚀');
    expect(container.textContent).toContain('🎉');
    expect(container.textContent).not.toContain(':rocket:');
  });

  it('leaves shortcodes inside code untouched', () => {
    const { container } = renderReadme('Use `:tada:` in your docs.\n');
    expect(container.querySelector('code')?.textContent).toBe(':tada:');
  });

  it('leaves unknown shortcodes alone', () => {
    expect(expandEmojiShortcodes(':definitely_not_an_emoji:')).toBe(':definitely_not_an_emoji:');
  });
});

describe('code blocks', () => {
  it('shows a language label, a copy button, and a wrap toggle', () => {
    const { container } = renderReadme('```ts\nexport const value = 1;\n```\n');
    const block = container.querySelector('.markdown-code-block');
    expect(block).not.toBeNull();
    expect(block?.querySelector('figcaption')?.textContent).toContain('TypeScript');
    expect(screen.getByLabelText('Copy code to clipboard')).toBeTruthy();
    expect(container.querySelector('[data-testid="code-wrap-toggle"]')).not.toBeNull();
    // The pre carries the language and the default (off) wrap state.
    const pre = container.querySelector('pre.markdown-pre');
    expect(pre?.getAttribute('data-language')).toBe('ts');
    expect(pre?.getAttribute('data-wrap')).toBe('off');
  });

  it('never executes repository code', () => {
    const { container } = renderReadme('```js\nwindow.__pwned = true;\n```\n');
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });
});

describe('links and images', () => {
  it('resolves repository-relative links to the pinned commit', () => {
    const { container } = renderReadme('[guide](./guide.md)\n');
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toContain(encodeURIComponent(SHA));
    expect(link?.getAttribute('href')).toContain('docs/guide.md');
  });

  it('resolves relative images to raw.githubusercontent at the commit', () => {
    const { container } = renderReadme('![logo](./assets/logo.png)\n');
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toContain('raw.githubusercontent.com');
    expect(img?.getAttribute('src')).toContain(SHA);
  });

  it('blocks unsafe protocols', () => {
    const { container } = renderReadme('[x](javascript:alert(1)) ![y](javascript:alert(2))\n');
    // An unsafe destination drops the element entirely: no href and no image.
    const link = container.querySelector('a');
    expect(link?.getAttribute('href') ?? null).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toMatch(/javascript:/i);
  });
});

describe('security: sanitization survives every new feature', () => {
  it('strips scripts, event handlers, iframes, and inline SVG payloads', () => {
    const payload = [
      '<script>window.__xss = true;</script>',
      '<img src=x onerror="window.__xss = true">',
      '<iframe src="https://evil.example"></iframe>',
      '<svg><script>window.__xss = true;</script></svg>',
      '<a href="javascript:alert(1)">click</a>',
      '<div onclick="window.__xss = true">styled</div>',
    ].join('\n\n');
    const { container } = renderReadme(payload);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.innerHTML).not.toMatch(/onerror|onclick/i);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href') ?? null).toBeNull();
    for (const div of container.querySelectorAll('div')) {
      expect(div.getAttribute('onclick')).toBeNull();
      expect(div.getAttribute('class')).toBeNull();
      expect(div.getAttribute('style')).toBeNull();
    }
    expect(container.innerHTML).not.toMatch(/javascript:/i);
    expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined();
  });

  it('keeps alert data attributes but rejects a forged alert class', () => {
    const { container } = renderReadme('<div data-alert="CAUTION" class="evil-class" style="position:fixed">forged</div>');
    const div = container.querySelector('div[data-alert]');
    expect(div).not.toBeNull();
    // `class` and `style` are not in the sanitizer schema.
    expect(div?.className).toBe('');
    expect(div?.getAttribute('style')).toBeNull();
  });

  it('does not render raw HTML in comments', () => {
    const { container } = renderComment('<b>bold?</b> and <script>alert(1)</script>');
    // Raw HTML is never parsed in comments: the tags go, the text stays.
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('bold?');
    expect(container.innerHTML).not.toContain('<b>');
  });
});

describe('existing Markdown surfaces keep working', () => {
  it('renders headings with GitHub-style anchors', () => {
    const { container } = renderReadme('# Getting Started\n\n## API & Types\n');
    expect(container.querySelector('h1')?.id).toBe('getting-started');
    expect(container.querySelector('h2')?.id).toBe('api--types');
    // Headings expose a permalink anchor for shareable links.
    expect(container.querySelector('h1 .markdown-heading-anchor')?.getAttribute('href')).toBe('#getting-started');
  });

  it('renders strikethrough and autolinks from GFM', () => {
    const { container } = renderReadme('~~gone~~ and https://works.ankb.qzz.io\n');
    expect(container.querySelector('del')?.textContent).toBe('gone');
    const link = Array.from(container.querySelectorAll('a')).find((entry) => entry.getAttribute('href') === 'https://works.ankb.qzz.io');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('rel')).toContain('noopener');
  });
});

describe('dark and light themes', () => {
  // Vitest runs from the repository root, so the stylesheet is addressable
  // without ESM URL tricks (import.meta.url is not a file: URL under jsdom).
  const css = readFileSync(path.resolve(process.cwd(), 'src/styles/index.css'), 'utf8');

  it('defines every alert colour as a token for BOTH themes', () => {
    for (const name of ['note', 'tip', 'important', 'warning', 'caution']) {
      const token = `--forge-alert-${name}:`;
      const darkBlock = css.slice(css.indexOf(':root {'), css.indexOf(":root[data-theme='light']"));
      const lightBlock = css.slice(css.indexOf(":root[data-theme='light']"));
      expect(darkBlock, `dark theme should define ${token}`).toContain(token);
      expect(lightBlock, `light theme should define ${token}`).toContain(token);
    }
  });

  it('styles alerts and tables from tokens, never from hardcoded colours', () => {
    const alertRules = css.slice(css.indexOf('[data-alert]'), css.indexOf('Task lists'));
    // Every colour in the alert/table/heading rules comes from a CSS variable
    // or a Tailwind token, so it adapts when the theme flips.
    expect(alertRules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(alertRules).not.toMatch(/\brgba?\(\s*\d/);
  });

  it('renders the same alert markup in either theme', () => {
    const source = '> [!CAUTION]\n> Destructive.\n';
    const dark = renderReadme(source);
    document.documentElement.dataset.theme = 'light';
    const light = renderReadme(source);
    expect(light.container.querySelector('[data-alert="CAUTION"]')?.textContent).toBe(
      dark.container.querySelector('[data-alert="CAUTION"]')?.textContent
    );
    delete document.documentElement.dataset.theme;
  });
});
