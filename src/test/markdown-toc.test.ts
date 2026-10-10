import { describe, it, expect } from 'vitest';
import { extractHeadings, slugify, remarkHeadingIds } from '../shared/markdown-toc';

/** Minimal mdast heading node for the plugin tests. */
function heading(depth: number, text: string) {
  return { type: 'heading', depth, children: [{ type: 'text', value: text }] };
}

describe('slugify', () => {
  it('follows GitHub heading anchor rules', () => {
    expect(slugify('Getting Started')).toBe('getting-started');
    expect(slugify('API & Types')).toBe('api--types');
    expect(slugify('  Ünïcode Déjà Vu  ')).toBe('ünïcode-déjà-vu');
    expect(slugify('snake_case-name')).toBe('snake_case-name');
    expect(slugify('Version 1.2.3 (latest)')).toBe('version-123-latest');
  });
});

describe('extractHeadings', () => {
  it('collects ATX headings with depth, plain text, and slugs', () => {
    const headings = extractHeadings('# Title\n\n## Section **One**\n\n### A `code` heading\n');
    expect(headings).toEqual([
      { depth: 1, text: 'Title', slug: 'title' },
      { depth: 2, text: 'Section One', slug: 'section-one' },
      { depth: 3, text: 'A code heading', slug: 'a-code-heading' },
    ]);
  });

  it('deduplicates repeated headings like GitHub (-1, -2)', () => {
    const headings = extractHeadings('# Intro\n\n# Intro\n\n# Intro\n');
    expect(headings.map((h) => h.slug)).toEqual(['intro', 'intro-1', 'intro-2']);
  });

  it('ignores headings inside fenced code blocks', () => {
    const source = ['# Real\n', '```\n', '# not a heading\n', '```\n', '~~~md\n', '# also not\n', '~~~\n', '# Also Real\n'].join('');
    expect(extractHeadings(source).map((h) => h.text)).toEqual(['Real', 'Also Real']);
  });

  it('requires whitespace after the hash marks (not hashtags)', () => {
    expect(extractHeadings('#hashtag\n\n# real heading\n').map((h) => h.text)).toEqual(['real heading']);
  });

  it('strips closing hash sequences and inline links/images', () => {
    // Link text and image alt text become the outline text (GitHub keeps both).
    const headings = extractHeadings('## [Docs](https://example.com) ##\n\n## ![logo](./x.png) caption\n');
    expect(headings.map((h) => h.text)).toEqual(['Docs', 'logo caption']);
  });

  it('returns nothing for documents without headings', () => {
    expect(extractHeadings('just text\n\nmore text\n')).toEqual([]);
  });
});

describe('remarkHeadingIds', () => {
  it('assigns unique GitHub-style ids to heading nodes', () => {
    const tree = { type: 'root', children: [heading(1, 'Getting Started'), heading(2, 'Getting Started')] };
    remarkHeadingIds()(tree);
    const ids = (tree as { children: { data?: { hProperties?: { id?: string } } }[] }).children.map(
      (node) => node.data?.hProperties?.id
    );
    expect(ids).toEqual(['getting-started', 'getting-started-1']);
  });

  it('handles inline children like emphasis and inline code', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'heading',
          depth: 2,
          children: [
            { type: 'strong', children: [{ type: 'text', value: 'Bold' }] },
            { type: 'text', value: ' ' },
            { type: 'inlineCode', value: 'code' },
          ],
        },
      ],
    };
    remarkHeadingIds()(tree);
    const node = (tree as { children: { data?: { hProperties?: { id?: string } } }[] }).children[0];
    expect(node.data?.hProperties?.id).toBe('bold-code');
  });

  it('gives empty headings a unique fallback id', () => {
    const tree = { type: 'root', children: [heading(1, ''), heading(2, '')] };
    remarkHeadingIds()(tree);
    const ids = (tree as { children: { data?: { hProperties?: { id?: string } } }[] }).children.map(
      (node) => node.data?.hProperties?.id
    );
    expect(ids).toEqual(['heading-1', 'heading-2']);
  });
});
