import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isValidRepoName,
  isValidRef,
  isCommitSha,
  normalizeRepoPath,
  encodePathSegments,
  parsePositiveInt,
} from '../shared/validation';
import { blobPath, commitsPath, treePath, repoPath, parentPath, fileName, encodeRef, decodeRouteRef, githubRepoLink } from '../shared/routes';
import { resolveMarkdownImage, resolveMarkdownLink, IMAGE_HOSTS, type LinkContext } from '../shared/markdown-links';
import { detectLanguage, grammarForFenceTag } from '../shared/languages';
import { EXPLORER_LIMITS } from '../shared/limits';
import { filterRepos, listLanguages, DEFAULT_REPO_FILTERS } from '../lib/repo-filter';
import { formatBytes, formatCount, shortSha, countLines } from '../lib/format';
import { describeError } from '../lib/errors';
import { ExplorerApiError } from '../api/explorer';
import type { Repository } from '../types';

const SHA = 'a'.repeat(40);
const ctx: LinkContext = { repo: 'website', commitSha: SHA, baseDir: 'docs/guide' };

describe('repository and ref validation', () => {
  it('accepts only the GitHub repository name alphabet', () => {
    expect(isValidRepoName('website')).toBe(true);
    expect(isValidRepoName('aurelia.js')).toBe(true);
    expect(isValidRepoName('my_repo-2')).toBe(true);
    for (const bad of ['', '.', '..', '../etc', 'a/b', 'a b', 'a?b', 'a%2Fb', 'x'.repeat(101), 'bad\u0000']) {
      expect(isValidRepoName(bad), bad).toBe(false);
    }
  });

  it('accepts git refs with slashes but rejects traversal, whitespace and control characters', () => {
    expect(isValidRef('main')).toBe(true);
    expect(isValidRef('feature/login')).toBe(true);
    expect(isValidRef('v1.2.3')).toBe(true);
    for (const bad of ['', '../main', 'a..b', 'a b', 'refs/heads/x y', 'a\\b', '/leading', 'trailing/', 'a\u0007b', '@{-1}']) {
      expect(isValidRef(bad), bad).toBe(false);
    }
  });

  it('recognizes full commit SHAs only', () => {
    expect(isCommitSha(SHA)).toBe(true);
    expect(isCommitSha('A'.repeat(40))).toBe(false);
    expect(isCommitSha('a'.repeat(39))).toBe(false);
  });
});

describe('path normalization', () => {
  it('normalizes slashes and rejects traversal, empty segments, and control characters', () => {
    expect(normalizeRepoPath('')).toBe('');
    expect(normalizeRepoPath('/src/app/')).toBe('src/app');
    expect(normalizeRepoPath('src/app.ts')).toBe('src/app.ts');
    expect(normalizeRepoPath('src//app')).toBeNull();
    expect(normalizeRepoPath('../etc/passwd')).toBeNull();
    expect(normalizeRepoPath('src/./app')).toBeNull();
    expect(normalizeRepoPath('src/../../secret')).toBeNull();
    expect(normalizeRepoPath('a\\b')).toBeNull();
    expect(normalizeRepoPath('a\u0000b')).toBeNull();
    expect(normalizeRepoPath('a'.repeat(1025))).toBeNull();
    expect(normalizeRepoPath(`${'a'.repeat(256)}/b`)).toBeNull();
  });

  it('encodes each segment while keeping separators', () => {
    expect(encodePathSegments('docs/my file#1.md')).toBe('docs/my%20file%231.md');
  });

  it('parses positive page numbers with a cap', () => {
    expect(parsePositiveInt(null, 1, 100)).toBe(1);
    expect(parsePositiveInt('3', 1, 100)).toBe(3);
    expect(parsePositiveInt('999', 1, 100)).toBe(100);
    expect(parsePositiveInt('0', 1, 100)).toBeNull();
    expect(parsePositiveInt('-1', 1, 100)).toBeNull();
    expect(parsePositiveInt('2x', 1, 100)).toBeNull();
    expect(parsePositiveInt('1e3', 1, 100)).toBeNull();
  });
});

describe('route builders', () => {
  it('encodes the ref twice so a "/" in a branch name survives the static-asset layer', () => {
    expect(repoPath('website')).toBe('/repos/website');
    expect(treePath('website', 'feature/login')).toBe('/repos/website/tree/feature%252Flogin');
    expect(treePath('website', 'feature/login', 'src/components')).toBe('/repos/website/tree/feature%252Flogin/src/components');
    expect(blobPath('website', 'feature/login', 'src/a b.ts')).toBe('/repos/website/blob/feature%252Flogin/src/a%20b.ts');
    expect(encodeRef('main')).toBe('main');
    expect(commitsPath('website', 'main')).toBe('/repos/website/commits/main');
    expect(commitsPath('website', 'main', 3)).toBe('/repos/website/commits/main?page=3');
  });

  it('round-trips any valid ref through the router decode and decodeRouteRef', () => {
    for (const ref of ['main', 'feature/login', 'release/1.2.3', 'a%2Fb', 'v1.0+build', '100%']) {
      const routerDecoded = decodeURIComponent(encodeRef(ref)); // what useParams() returns
      expect(decodeRouteRef(routerDecoded), ref).toBe(ref);
    }
  });

  it('accepts already-decoded or single-encoded refs and rejects malformed escapes', () => {
    expect(decodeRouteRef('feature/login')).toBe('feature/login');
    expect(decodeRouteRef('feature%2Flogin')).toBe('feature/login');
    expect(decodeRouteRef('%E0%A4%A')).toBeNull();
  });

  it('builds GitHub links with real slashes in branch names and encoded segments', () => {
    expect(githubRepoLink('website', 'tree', 'feature/login', 'src/a b.ts')).toBe(
      'https://github.com/ankworks/website/tree/feature/login/src/a%20b.ts'
    );
    expect(githubRepoLink('website', 'commit', SHA)).toBe(`https://github.com/ankworks/website/commit/${SHA}`);
  });

  it('computes parent paths and file names', () => {
    expect(parentPath('a/b/c.ts')).toBe('a/b');
    expect(parentPath('c.ts')).toBe('');
    expect(fileName('a/b/c.ts')).toBe('c.ts');
  });
});

describe('Markdown link resolution', () => {
  it('keeps safe external links and drops dangerous schemes', () => {
    expect(resolveMarkdownLink('https://example.com/a', ctx)).toEqual({ kind: 'external', href: 'https://example.com/a' });
    expect(resolveMarkdownLink('mailto:team@example.com', ctx)).toEqual({ kind: 'external', href: 'mailto:team@example.com' });
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'vbscript:x', 'ftp://example.com']) {
      expect(resolveMarkdownLink(bad, ctx), bad).toEqual({ kind: 'none' });
    }
  });

  it('treats protocol-relative links as https', () => {
    expect(resolveMarkdownLink('//example.com/x', ctx)).toEqual({ kind: 'external', href: 'https://example.com/x' });
  });

  it('keeps in-page anchors on the same page', () => {
    expect(resolveMarkdownLink('#install', ctx)).toEqual({ kind: 'anchor', href: '#install' });
  });

  it('resolves relative links against the README directory and pins them to the commit SHA', () => {
    expect(resolveMarkdownLink('../api.md', ctx)).toEqual({ kind: 'internal', to: `/repos/website/blob/${SHA}/docs/api.md` });
    expect(resolveMarkdownLink('./setup.md?plain=1#top', ctx)).toEqual({
      kind: 'internal',
      to: `/repos/website/blob/${SHA}/docs/guide/setup.md`,
    });
    expect(resolveMarkdownLink('src/', ctx)).toEqual({ kind: 'internal', to: `/repos/website/tree/${SHA}/docs/guide/src` });
    expect(resolveMarkdownLink('./', ctx)).toEqual({ kind: 'internal', to: `/repos/website/tree/${SHA}/docs/guide` });
  });

  it('refuses relative links that escape the repository root', () => {
    expect(resolveMarkdownLink('../../../../etc/passwd', ctx)).toEqual({ kind: 'none' });
    expect(resolveMarkdownLink('/../../x', { ...ctx, baseDir: '' })).toEqual({ kind: 'none' });
  });

  it('handles empty and missing destinations', () => {
    expect(resolveMarkdownLink(undefined, ctx)).toEqual({ kind: 'none' });
    expect(resolveMarkdownLink('  ', ctx)).toEqual({ kind: 'none' });
  });
});

describe('Markdown image resolution', () => {
  it('resolves relative images to raw.githubusercontent.com at the same commit', () => {
    expect(resolveMarkdownImage('images/logo.png', ctx)).toBe(
      `https://raw.githubusercontent.com/ankworks/website/${SHA}/docs/guide/images/logo.png`
    );
  });

  it('allows external images only from the allowlisted hosts', () => {
    expect(resolveMarkdownImage('https://img.shields.io/badge/a-b-c.svg', ctx)).toBe('https://img.shields.io/badge/a-b-c.svg');
    expect(resolveMarkdownImage('https://tracker.example.com/pixel.gif', ctx)).toBeNull();
    expect(resolveMarkdownImage('http://github.com/a.png', ctx)).toBeNull();
    expect(resolveMarkdownImage('data:image/svg+xml;base64,PHN2Zy8+', ctx)).toBeNull();
    expect(resolveMarkdownImage('javascript:alert(1)', ctx)).toBeNull();
    expect(resolveMarkdownImage('../../../../secret.png', ctx)).toBeNull();
  });

  it('loads no third-party styles, fonts, or scripts (everything is served from the AnkWorks domain)', () => {
    const headers = readFileSync(resolve(__dirname, '../../public/_headers'), 'utf8');
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    const csp = headers.split('\n').find((line) => line.includes('Content-Security-Policy')) ?? '';
    expect(csp).not.toContain('googleapis');
    expect(csp).not.toContain('gstatic');
    expect(csp).not.toContain("'unsafe-inline'");
    expect(html).not.toMatch(/https?:\/\/fonts\.(googleapis|gstatic)\.com/);
  });

  it('keeps the image allowlist in sync with the Content-Security-Policy img-src directive', () => {
    const headers = readFileSync(resolve(__dirname, '../../public/_headers'), 'utf8');
    const csp = headers.split('\n').find((line) => line.includes('Content-Security-Policy')) ?? '';
    const imgSrc = /img-src ([^;]+);/.exec(csp)?.[1] ?? '';
    const cspHosts = imgSrc
      .split(/\s+/)
      .filter((token) => token.startsWith('https://'))
      .map((token) => token.replace('https://', ''))
      .sort();
    expect(cspHosts).toEqual([...IMAGE_HOSTS].sort());
  });
});

describe('language detection and fences', () => {
  it('detects languages by file name and extension', () => {
    expect(detectLanguage('src/App.tsx')).toEqual({ label: expect.any(String), grammar: expect.any(String) });
    expect(detectLanguage('README')).toMatchObject({ grammar: null });
    expect(detectLanguage('notes.unknownext')).toMatchObject({ grammar: null });
    expect(detectLanguage('.gitignore')).toBeDefined();
  });

  it('maps fence tags to registered grammars and ignores unknown tags', () => {
    expect(grammarForFenceTag('ts')).not.toBeNull();
    expect(grammarForFenceTag('TypeScript')).not.toBeNull();
    expect(grammarForFenceTag('definitely-not-a-language')).toBeNull();
    expect(grammarForFenceTag(undefined)).toBeNull();
  });
});

describe('shared limits', () => {
  it('keeps the highlight threshold below the viewer limit and the raw limit above both', () => {
    expect(EXPLORER_LIMITS.HIGHLIGHT_MAX_BYTES).toBeLessThan(EXPLORER_LIMITS.VIEW_MAX_BYTES);
    expect(EXPLORER_LIMITS.VIEW_MAX_BYTES).toBeLessThan(EXPLORER_LIMITS.RAW_MAX_BYTES);
  });
});

const repo = (overrides: Partial<Repository>): Repository => ({
  id: 1,
  name: 'alpha',
  full_name: 'ankworks/alpha',
  description: 'First project',
  html_url: 'https://github.com/ankworks/alpha',
  language: 'TypeScript',
  stargazers_count: 5,
  forks_count: 1,
  updated_at: '2026-01-01T00:00:00Z',
  created_at: '2025-01-01T00:00:00Z',
  archived: false,
  fork: false,
  size: 1,
  open_issues_count: 0,
  topics: ['web'],
  default_branch: 'main',
  ...overrides,
});

describe('repository filtering', () => {
  const repos = [
    repo({ id: 1, name: 'alpha', stargazers_count: 5 }),
    repo({ id: 2, name: 'beta', language: 'JavaScript', stargazers_count: 50, fork: true, description: null, topics: [] }),
    repo({ id: 3, name: 'gamma', language: null, archived: true, stargazers_count: 1, topics: ['cli'] }),
  ];

  it('filters by name, topic, and language case-insensitively', () => {
    expect(filterRepos(repos, { ...DEFAULT_REPO_FILTERS, query: 'ALP' }).map((r) => r.name)).toEqual(['alpha']);
    expect(filterRepos(repos, { ...DEFAULT_REPO_FILTERS, query: 'cli' }).map((r) => r.name)).toEqual(['gamma']);
    expect(filterRepos(repos, { ...DEFAULT_REPO_FILTERS, language: 'JavaScript' }).map((r) => r.name)).toEqual(['beta']);
  });

  it('hides forks and archived repositories when asked', () => {
    expect(filterRepos(repos, { ...DEFAULT_REPO_FILTERS, hideForks: true }).map((r) => r.name)).toEqual(['alpha', 'gamma']);
    expect(filterRepos(repos, { ...DEFAULT_REPO_FILTERS, hideArchived: true }).map((r) => r.name)).toEqual(['beta', 'alpha']);
  });

  it('sorts by stars descending and by name ascending', () => {
    expect(filterRepos(repos, DEFAULT_REPO_FILTERS).map((r) => r.name)).toEqual(['beta', 'alpha', 'gamma']);
    expect(filterRepos(repos, { ...DEFAULT_REPO_FILTERS, sort: 'name' }).map((r) => r.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('lists distinct languages without null values', () => {
    expect(listLanguages(repos)).toEqual(['JavaScript', 'TypeScript']);
  });
});

describe('formatting helpers', () => {
  it('formats byte sizes, counts, short SHAs, and line counts', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toMatch(/KB/);
    expect(formatCount(1500)).toMatch(/1\.5k/i);
    expect(shortSha(SHA)).toBe('aaaaaaa');
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('')).toBe(0);
  });
});

describe('error descriptions', () => {
  it('maps explorer error codes to friendly copy without raw upstream text', () => {
    const notFound = describeError(new ExplorerApiError('raw upstream text', 404, 'REPO_NOT_FOUND'));
    expect(notFound.title).toBe('Repository not found');
    expect(notFound.message).not.toContain('raw upstream');
    expect(notFound.retryable).toBe(false);
  });

  it('marks rate limits as retryable and includes the wait time', () => {
    const limited = describeError(new ExplorerApiError('x', 429, 'GITHUB_RATE_LIMITED', 120));
    expect(limited.retryable).toBe(true);
    expect(limited.retryAfterSeconds).toBe(120);
    expect(limited.message).toContain('120');
  });

  it('handles unknown errors safely', () => {
    expect(describeError(new Error('secret stack')).message).not.toContain('secret stack');
    expect(describeError('boom').title).toBeTruthy();
  });
});
