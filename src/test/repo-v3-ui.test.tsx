import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { invalidateCache } from '../api/github';
import { clearExplorerCache } from '../api/explorer';
import { clearInsightsCache } from '../api/insights';

/**
 * V3-A UI tests: the two-column repository layout, the sidebar insights,
 * README/Contributing/License/Security tabs, Releases, and Actions.
 *
 * The real route table is rendered and every API call is served from a mocked
 * table. No test touches the network.
 */

const SHA = 'a'.repeat(40);

function repoPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'website',
    full_name: 'ankworks/website',
    private: false,
    html_url: 'https://github.com/ankworks/website',
    description: 'The AnkWorks website and Forge platform',
    language: 'TypeScript',
    stargazers_count: 42,
    forks_count: 7,
    watchers_count: 13,
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    pushed_at: '2026-01-02T00:00:00Z',
    archived: false,
    fork: false,
    size: 100,
    open_issues_count: 4,
    topics: ['web', 'cloudflare'],
    default_branch: 'main',
    owner: { login: 'ankworks' },
    license: 'MIT',
    homepage: 'https://works.ankb.qzz.io',
    has_wiki: true,
    has_issues: true,
    has_discussions: true,
    ...overrides,
  };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function contentsFile(name: string, content: string, extra: Record<string, unknown> = {}) {
  return { type: 'file', name, path: name, sha: SHA, size: content.length, encoding: 'base64', content: encodeBase64Utf8(content), ...extra };
}

type Api = (url: URL) => Response | undefined;

function defaultApi(): Api {
  return (url) => {
    const path = url.pathname;

    if (path === '/api/org') {
      return json({ org: { login: 'ankworks', name: 'AnkWorks', description: null, avatar_url: '/branding/ankworks-logo.png', html_url: 'https://github.com/ankworks', blog: null, location: null, public_repos: 2, created_at: '2020-01-01T00:00:00Z' }, fetched_at: '2026-01-01T00:00:00Z' });
    }
    if (path === '/api/repos') {
      return json({ org: 'ankworks', repos: [], total_count: 0, fetched_at: '2026-01-01T00:00:00Z' });
    }
    if (path === '/api/featured') {
      return json({ items: [], configured: false, fetched_at: '2026-01-01T00:00:00Z' });
    }
    if (path === '/api/auth/session') {
      return json({ authenticated: false, user: null, expiresAt: null, authEnabled: false });
    }
    if (path === '/api/auth/membership') {
      return json({ state: 'not-member', login: null, id: null, role: 'unknown', reason: 'unauthenticated', isMember: false, isOrgAdmin: false, isForgeAdmin: false, checked_at: '2026-01-01T00:00:00Z', cached: false });
    }
    if (path === '/api/repos/website') {
      return json({ repo: repoPayload() });
    }
    if (path === '/api/repos/website/commits') {
      return json({ ref: 'main', commits: [{ sha: SHA, title: 'Add the insights sidebar', message: 'Add the insights sidebar', author_name: 'alice', author_login: 'alice', date: '2026-01-02T00:00:00Z', html_url: 'https://github.com/ankworks/website/commit/' + SHA }], page: 1, per_page: 30, has_next: false });
    }
    if (path === '/api/repos/website/last-commit') {
      return json({ path: '', commit: { sha: SHA, title: 'Add the insights sidebar', message: 'Add the insights sidebar', author_name: 'alice', author_login: 'alice', date: '2026-01-02T00:00:00Z', html_url: 'https://github.com/ankworks/website/commit/' + SHA } });
    }
    if (path === '/api/repos/website/branches') {
      return json({ branches: [{ name: 'main', sha: SHA, protected: true }], page: 1, per_page: 100, has_next: false });
    }
    if (path === '/api/repos/website/tags') {
      return json({ tags: [], page: 1, per_page: 100, has_next: false });
    }
    if (path === '/api/repos/website/tree') {
      return json({ repo: 'website', ref: 'main', commit_sha: SHA, path: '', entries: [{ name: 'src', path: 'src', type: 'dir', size: 0, sha: SHA, html_url: '#' }], truncated: false });
    }
    if (path === '/api/repos/website/contributors') {
      return json({ contributors: [{ login: 'alice', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4', html_url: 'https://github.com/alice', contributions: 120 }, { login: 'bob', avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4', html_url: 'https://github.com/bob', contributions: 30 }], page: 1, per_page: 30, has_next: false });
    }
    if (path === '/api/repos/website/languages') {
      return json({ total_bytes: 1000, languages: [{ name: 'TypeScript', bytes: 800, percent: 80 }, { name: 'CSS', bytes: 200, percent: 20 }], fetched_at: '2026-01-01T00:00:00Z' });
    }
    if (path === '/api/repos/website/releases') {
      return json({ releases: [{ id: 11, tag_name: 'v3.0.0', name: 'Forge V3', draft: false, prerelease: true, published_at: '2026-01-05T00:00:00Z', created_at: '2026-01-05T00:00:00Z', body: '## Highlights\n\n- Repository insights\n- Actions viewer', author: 'alice', html_url: 'https://github.com/ankworks/website/releases/tag/v3.0.0', assets: [{ id: 1, name: 'bundle.zip', content_type: 'application/zip', size: 2048, download_count: 9, browser_download_url: 'https://github.com/ankworks/website/releases/download/v3.0.0/bundle.zip' }] }], page: 1, per_page: 20, has_next: false });
    }
    if (path === '/api/repos/website/workflows') {
      return json({ total_count: 1, workflows: [{ id: 77, name: 'CI', path: '.github/workflows/ci.yml', state: 'active', html_url: 'https://github.com/ankworks/website/actions/workflows/ci.yml' }], page: 1, per_page: 30, has_next: false });
    }
    if (path === '/api/repos/website/runs') {
      return json({ total_count: 1, runs: [{ id: 555, name: 'CI', display_title: 'CI on main', status: 'completed', conclusion: 'success', event: 'push', head_branch: 'main', head_sha: SHA, run_number: 12, created_at: '2026-01-06T10:00:00Z', updated_at: '2026-01-06T10:01:30Z', run_started_at: '2026-01-06T10:00:00Z', duration_ms: 90_000, actor: 'alice', workflow_id: 77, html_url: 'https://github.com/ankworks/website/actions/runs/555' }], page: 1, per_page: 20, has_next: false });
    }
    if (path === '/api/repos/website/docs') {
      return json({ repo: 'website', commit_sha: SHA, docs: [{ key: 'readme', label: 'README', path: 'README.md', name: 'README.md' }, { key: 'license', label: 'License', path: 'LICENSE', name: 'LICENSE' }] });
    }
    if (path === '/api/repos/website/doc') {
      const key = url.searchParams.get('key');
      if (key === 'readme') {
        return json({ repo: 'website', commit_sha: SHA, key: 'readme', path: 'README.md', name: 'README.md', kind: 'text', size: 20, html_url: 'https://github.com/ankworks/website/blob/' + SHA + '/README.md', content: '# AnkWorks Forge\n\nWelcome.' });
      }
      if (key === 'license') {
        return json({ repo: 'website', commit_sha: SHA, key: 'license', path: 'LICENSE', name: 'LICENSE', kind: 'text', size: 10, html_url: 'https://github.com/ankworks/website/blob/' + SHA + '/LICENSE', content: 'MIT License\n\nCopyright (c) AnkWorks' });
      }
      return json({ error: 'DOC_NOT_FOUND', message: 'nope', status: 404 }, { status: 404 });
    }
    if (path === '/api/repos/website/file-search') {
      return json({ repo: 'website', ref: 'main', commit_sha: SHA, query: 'src', hits: [{ path: 'src/App.tsx', name: 'App.tsx' }], truncated: false });
    }
    if (path === '/api/activity') return json({ events: [], fetched_at: '2026-01-01T00:00:00Z' });
    if (path === '/api/org/profile-readme') {
      return json({ error: 'PROFILE_README_NOT_FOUND', message: 'none', status: 404 }, { status: 404 });
    }
    if (path === '/api/repos/website/issues' || path === '/api/repos/website/pulls') {
      return json({ items: [], total_count: 0, state: 'open', page: 1, per_page: 30, has_next: false });
    }
    if (path === '/api/repos/website/readme') {
      return json({ repo: 'website', commit_sha: SHA, path: 'README.md', name: 'README.md', kind: 'text', size: 20, content: '# AnkWorks Forge\n\nWelcome.' });
    }
    if (path.startsWith('/api/repos/website/contents')) {
      return json([contentsFile('README.md', '# Hello')]);
    }
    return undefined;
  };
}

describe('V3-A repository experience', () => {
  let fetchMock: ReturnType<typeof vi.fn<[input: RequestInfo | URL], Promise<Response>>>;
  let api: Api;

  beforeEach(() => {
    invalidateCache();
    clearExplorerCache();
    clearInsightsCache();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    api = defaultApi();
    fetchMock = vi.fn<[input: RequestInfo | URL], Promise<Response>>(async (input) => {
      const url = new URL(String(input), 'https://site.test');
      return api(url) ?? json({ error: 'NOT_FOUND', message: 'Not found in test table: ' + url.pathname, status: 404 }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderAt(url: string) {
    return render(
      <MemoryRouter initialEntries={[url]}>
        <App />
      </MemoryRouter>
    );
  }

  it('renders the repository page as a two-column 75/25 layout with a sidebar', async () => {
    const { container } = renderAt('/repos/website');

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

    const main = container.querySelector('[data-repo-main]');
    const sidebar = screen.getByRole('complementary', { name: 'About this repository' });
    expect(main).not.toBeNull();
    expect(sidebar).toBeTruthy();

    // The grid that holds both columns uses a 3fr / 1fr split (75% / 25%).
    const grid = container.querySelector('[data-repo-columns]');
    expect(grid?.className).toContain('lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]');
    // Below `lg` there is a single column, so the layout stacks on tablet/mobile.
    expect(grid?.className).toContain('grid-cols-1');
    // The sidebar lives inside the same grid as the main column.
    expect(grid?.contains(main as Node)).toBe(true);
    expect(grid?.contains(sidebar)).toBe(true);
  });

  it('shows real insight data in the sidebar and never invents a number', async () => {
    renderAt('/repos/website');
    const sidebar = await screen.findByRole('complementary', { name: 'About this repository' });

    await waitFor(() => expect(within(sidebar).getByText('Contributors')).toBeInTheDocument());
    expect(within(sidebar).getByText('Languages')).toBeInTheDocument();
    expect(within(sidebar).getByText('Releases')).toBeInTheDocument();
    expect(within(sidebar).getByText('Recent activity')).toBeInTheDocument();

    // Statistics come from the API payloads.
    await waitFor(() => expect(within(sidebar).getByText('TypeScript')).toBeInTheDocument());
    expect(within(sidebar).getByText('42')).toBeInTheDocument(); // stars
    expect(within(sidebar).getByText('13')).toBeInTheDocument(); // watchers (subscribers)
    expect(within(sidebar).getByText('MIT')).toBeInTheDocument(); // license
    expect(within(sidebar).getByTitle('alice · 120 commits')).toBeInTheDocument();
    expect(within(sidebar).getByText('80% · 800 B')).toBeInTheDocument();
  });

  it('renders an em dash instead of guessing when watchers are unavailable', async () => {
    api = (url) => {
      if (url.pathname === '/api/repos/website') {
        return json({ repo: repoPayload({ watchers_count: null }) });
      }
      return defaultApi()(url);
    };
    renderAt('/repos/website');
    const sidebar = await screen.findByRole('complementary', { name: 'About this repository' });
    const watchers = within(sidebar).getByTitle('GitHub subscribers count');
    await waitFor(() => expect(watchers).toHaveTextContent('—'));
  });

  it('offers only the document tabs that exist, and renders Markdown safely', async () => {
    renderAt('/repos/website');

    const tabs = await screen.findByRole('tablist', { name: 'Repository documents' });
    await waitFor(() => expect(within(tabs).getByRole('tab', { name: 'README' })).toBeInTheDocument());
    expect(within(tabs).getByRole('tab', { name: 'License' })).toBeInTheDocument();
    // "Contributing" and "Security" do not exist at this ref → no tab.
    expect(within(tabs).queryByRole('tab', { name: 'Contributing' })).toBeNull();
    expect(within(tabs).queryByRole('tab', { name: 'Security' })).toBeNull();

    // README is selected by default.
    await waitFor(() => expect(screen.getByRole('article', { name: 'Rendered README.md' })).toBeInTheDocument());

    await userEvent.click(within(tabs).getByRole('tab', { name: 'License' }));
    await waitFor(() => expect(screen.getByRole('article', { name: 'Rendered LICENSE' })).toBeInTheDocument());
    expect(screen.getByText('MIT License')).toBeInTheDocument();
  });

  it('strips unsafe HTML from repository documents', async () => {
    api = (url) => {
      if (url.pathname === '/api/repos/website/doc' && url.searchParams.get('key') === 'readme') {
        return json({
          repo: 'website',
          commit_sha: SHA,
          key: 'readme',
          path: 'README.md',
          name: 'README.md',
          kind: 'text',
          size: 10,
          html_url: 'https://github.com/ankworks/website',
          content: '# Hi\n\n<script>window.__pwned = true;</script>\n\n<img src="x" onerror="window.__pwned=1">\n\n[link](javascript:alert(1))',
        });
      }
      return defaultApi()(url);
    };
    renderAt('/repos/website');

    await waitFor(() => expect(screen.getByRole('article', { name: 'Rendered README.md' })).toBeInTheDocument());
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    const article = screen.getByRole('article', { name: 'Rendered README.md' });
    expect(article.innerHTML).not.toContain('onerror');
    expect(article.querySelector('script')).toBeNull();
  });

  it('renders the Releases page with tag, notes, assets, and a GitHub download link', async () => {
    renderAt('/repos/website/releases');

    await waitFor(() => expect(screen.getByRole('heading', { name: /Forge V3/ })).toBeInTheDocument(), { timeout: 4000 });
    // The sidebar summary and the release card both carry the pre-release badge.
    expect(screen.getAllByText('Pre-release').length).toBeGreaterThan(0);
    expect(screen.getByText('v3.0.0')).toBeInTheDocument();
    expect(screen.getByText('Highlights')).toBeInTheDocument();

    const asset = screen.getByRole('link', { name: 'bundle.zip' });
    expect(asset).toHaveAttribute('href', 'https://github.com/ankworks/website/releases/download/v3.0.0/bundle.zip');
    // Assets are never proxied through the Worker.
    expect(asset.getAttribute('href')).not.toContain('/api/');
    expect(screen.getByText(/Downloads go directly to GitHub/)).toBeInTheDocument();
  });

  it('renders the Actions viewer read-only with run status, duration, and a GitHub logs link', async () => {
    renderAt('/repos/website/actions');

    await waitFor(() => expect(screen.getByText('CI on main')).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText(/1m 30s/)).toBeInTheDocument();
    expect(screen.getByText('#12')).toBeInTheDocument();

    const logs = screen.getByRole('link', { name: /View logs on GitHub/i });
    expect(logs).toHaveAttribute('href', 'https://github.com/ankworks/website/actions/runs/555');
    // No workflow execution controls exist.
    expect(screen.queryByRole('button', { name: /re-run/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /cancel workflow/i })).toBeNull();
    expect(screen.getByText(/Forge shows workflow runs only/)).toBeInTheDocument();
  });

  it('opens "Go to file" and links a match to the blob view', async () => {
    renderAt('/repos/website');

    const button = await screen.findByRole('button', { name: /Go to file/i });
    await userEvent.click(button);

    const input = await screen.findByLabelText('Search file paths');
    await userEvent.type(input, 'src');

    await waitFor(() => expect(screen.getByRole('option', { name: /src\/App\.tsx/ })).toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Go to file in website' })).toBeInTheDocument();
  });
});
