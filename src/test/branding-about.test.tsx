import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { invalidateCache } from '../api/github';
import { clearExplorerCache } from '../api/explorer';
import { clearInsightsCache } from '../api/insights';
import { clearDiscussionsCache } from '../api/discussions';

/**
 * Branding, visibility, and the About page.
 *
 * The point of these tests is the *copy* and the *routing*: no global
 * "read-only" claim remains, the About page renders the organization's real
 * profile README (not text invented here), and that README is sanitized exactly
 * like any other Markdown surface.
 *
 * The server-side half of hiding `ankworks/website` is covered in
 * `worker-visibility.test.ts`.
 */

const SHA = 'c'.repeat(40);

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

function repo(name: string): Record<string, unknown> {
  return {
    id: name.length,
    name,
    full_name: `ankworks/${name}`,
    private: false,
    html_url: `https://github.com/ankworks/${name}`,
    description: `${name} description`,
    language: 'TypeScript',
    stargazers_count: 3,
    forks_count: 1,
    watchers_count: 2,
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    pushed_at: '2026-01-01T00:00:00Z',
    archived: false,
    fork: false,
    size: 10,
    open_issues_count: 1,
    topics: [],
    default_branch: 'main',
    owner: { login: 'ankworks' },
    license: null,
    homepage: null,
    has_wiki: false,
    has_issues: true,
    has_discussions: false,
  };
}

const ORG = {
  login: 'ankworks',
  name: 'AnkWorks',
  description: 'Independent software studio.',
  avatar_url: '/branding/ankworks-logo.webp',
  html_url: 'https://github.com/ankworks',
  blog: 'https://works.ankb.qzz.io',
  location: 'Vietnam',
  public_repos: 2,
  created_at: '2020-01-01T00:00:00Z',
};

const PROFILE_README = [
  '# AnkWorks',
  '',
  'We build focused software.',
  '',
  '> [!IMPORTANT]',
  '> Read the contributing guide first.',
  '',
  '| Team | Focus |',
  '| :--- | ---: |',
  '| Platform | Forge |',
  '',
  '- [x] Ship the explorer',
  '- [ ] Ship the wiki',
  '',
  '```ts',
  'export const answer = 42;',
  '```',
].join('\n');

interface Options {
  profileReadme?: { status: number; body: unknown } | null;
}

function api({ profileReadme }: Options = {}) {
  return (url: URL): Response | undefined => {
    const path = url.pathname;
    if (path === '/api/org') return json({ org: ORG, fetched_at: '2026-01-01T00:00:00Z' });
    if (path === '/api/featured') return json({ items: [], configured: false, fetched_at: '2026-01-01T00:00:00Z' });
    if (path === '/api/auth/session') return json({ authenticated: false, user: null, expiresAt: null, authEnabled: false });
    if (path === '/api/auth/membership') {
      return json({ state: 'not-member', login: null, id: null, role: null, reason: 'unauthenticated', isMember: false, isOrgAdmin: false, isForgeAdmin: false, checked_at: '2026-01-01T00:00:00Z', cached: false });
    }
    if (path === '/api/repos') {
      // The Worker already filtered the hidden repository out.
      return json({ org: 'ankworks', repos: [repo('aurelia'), repo('stage-browser')], total_count: 2, fetched_at: '2026-01-01T00:00:00Z' });
    }
    if (path === '/api/activity') return json({ events: [], fetched_at: '2026-01-01T00:00:00Z' });
    if (path === '/api/org/profile-readme') {
      if (profileReadme === null) {
        return json({ error: 'PROFILE_README_NOT_FOUND', message: 'The organization has not published a profile README.', status: 404 }, { status: 404 });
      }
      if (profileReadme) return json(profileReadme.body, { status: profileReadme.status });
      return json({
        repo: '.github',
        path: 'profile/README.md',
        name: 'README.md',
        commit_sha: SHA,
        html_url: 'https://github.com/ankworks/.github/blob/main/profile/README.md',
        size: PROFILE_README.length,
        kind: 'text',
        content: PROFILE_README,
        fetched_at: '2026-01-01T00:00:00Z',
      });
    }
    return undefined;
  };
}

function install(options: Options = {}) {
  invalidateCache();
  clearExplorerCache();
  clearInsightsCache();
  clearDiscussionsCache();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  const table = api(options);
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://site.test');
    return table(url) ?? json({ error: 'NOT_FOUND', message: `Not found in test table: ${url.pathname}`, status: 404 }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>
  );
}

describe('branding: no global read-only claim', () => {
  beforeEach(() => {
    install();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops the Read-only badge from the header', async () => {
    renderAt('/');
    const nav = await screen.findByRole('navigation', { name: 'Primary navigation' });
    const header = nav.closest('header');
    expect(header).not.toBeNull();
    expect(header?.textContent).not.toMatch(/read-only/i);
  });

  it('replaces the outdated footer statement', async () => {
    renderAt('/');
    const footer = await screen.findByRole('contentinfo');
    expect(footer.textContent).not.toMatch(/Forge is read-only/i);
    expect(footer.textContent).toMatch(/GitHub-powered development platform/i);
    expect(footer.textContent).toMatch(/GitHub remains the source of truth/i);
  });

  it('does not link the footer to the Forge implementation repository', async () => {
    renderAt('/');
    const footer = await screen.findByRole('contentinfo');
    const hrefs = Array.from(footer.querySelectorAll('a')).map((anchor) => anchor.getAttribute('href'));
    for (const href of hrefs) {
      expect(href ?? '').not.toContain('ankworks/website');
    }
  });
});

describe('About page', () => {
  beforeEach(() => {
    install();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the organization logo and name', async () => {
    renderAt('/about');
    // The page heading and the README's own `# AnkWorks` heading are both level 1.
    const headings = await screen.findAllByRole('heading', { level: 1 });
    expect(headings.length).toBeGreaterThan(0);
    expect(headings[0]?.textContent).toBe('AnkWorks');
    const logo = screen.getByAltText('AnkWorks organization logo');
    expect(logo).toBeTruthy();
  });

  it('renders the real Organization Profile README', async () => {
    renderAt('/about');
    expect(await screen.findByText('We build focused software.')).toBeTruthy();
    // The README is Markdown, not a hardcoded duplicate: alerts, tables, task
    // lists, and code fences all come through the shared renderer.
    expect(await screen.findByText('Important')).toBeTruthy();
    expect(screen.getByText('Read the contributing guide first.')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Team', 'Focus']);
    // Syntax-highlighted code is split into spans, so match the text content.
    expect(document.body.textContent).toContain('answer');
  });

  it('links to the profile README on GitHub and does not redirect there', async () => {
    renderAt('/about');
    const link = await screen.findByRole('link', { name: /View source on GitHub/i });
    expect(link.getAttribute('href')).toContain('ankworks/.github');
    // The page itself stays on Forge.
    expect((await screen.findAllByRole('heading', { level: 1 })).length).toBeGreaterThan(0);
  });

  it('still renders organization facts', async () => {
    renderAt('/about');
    expect(await screen.findByText('github.com/ankworks')).toBeTruthy();
    expect(screen.getByText('Vietnam')).toBeTruthy();
  });

  it('shows a graceful fallback when no profile README is published', async () => {
    install({ profileReadme: null });
    renderAt('/about');
    expect(await screen.findByText(/has not published a profile README/i)).toBeTruthy();
    expect((await screen.findAllByRole('heading', { level: 1, name: 'AnkWorks' })).length).toBeGreaterThan(0);
  });
});

describe('About README is sanitized', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('strips scripts, event handlers, and unsafe URLs from the profile README', async () => {
    install({
      profileReadme: {
        status: 200,
        body: {
          repo: '.github',
          path: 'profile/README.md',
          name: 'README.md',
          commit_sha: SHA,
          html_url: 'https://github.com/ankworks/.github/blob/main/profile/README.md',
          size: 100,
          kind: 'text',
          content: [
            '# Real heading',
            '',
            '<script>window.__xss = true;</script>',
            '<img src=x onerror="window.__xss = true">',
            '<iframe src="https://evil.example"></iframe>',
            '[click](javascript:alert(1))',
          ].join('\n'),
          fetched_at: '2026-01-01T00:00:00Z',
        },
      },
    });
    const { container } = renderAt('/about');
    expect(await screen.findByText('Real heading')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    // No element may carry an event handler or an unsafe URL scheme. The
    // payload's text can survive as literal characters (that is inert), but it
    // must never survive as markup or as a destination.
    for (const element of container.querySelectorAll('*')) {
      for (const attribute of element.getAttributeNames()) {
        expect(attribute.toLowerCase()).not.toMatch(/^on/);
        const value = element.getAttribute(attribute) ?? '';
        expect(value.toLowerCase()).not.toContain('javascript:');
      }
    }
    expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined();
  });
});

describe('dashboard and About share one README source', () => {
  beforeEach(() => {
    install();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the same profile section on the dashboard', async () => {
    renderAt('/');
    expect(await screen.findByText('We build focused software.')).toBeTruthy();
    expect(screen.getByText('ankworks/.github · profile/README.md')).toBeTruthy();
  });

  it('never hardcodes organization prose in the About page', async () => {
    // The About page renders whatever the API returned; with different content
    // it shows different words, proving there is no duplicated copy.
    install({
      profileReadme: {
        status: 200,
        body: {
          repo: '.github',
          path: 'profile/README.md',
          name: 'README.md',
          commit_sha: SHA,
          html_url: 'https://github.com/ankworks/.github/blob/main/profile/README.md',
          size: 20,
          kind: 'text',
          content: '# Completely different content\n',
          fetched_at: '2026-01-01T00:00:00Z',
        },
      },
    });
    renderAt('/about');
    expect(await screen.findByText('Completely different content')).toBeTruthy();
    expect(screen.queryByText('We build focused software.')).toBeNull();
  });
});

describe('public repository list excludes the Forge repository', () => {
  beforeEach(() => {
    install();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows only the repositories the Worker returned', async () => {
    renderAt('/repos');
    await waitFor(() => expect(document.body.textContent).toContain('aurelia'));
    expect(document.body.textContent).toContain('stage-browser');
    expect(document.body.textContent).not.toContain('ankworks/website');
  });
});
