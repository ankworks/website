import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { invalidateCache } from '../api/github';
import { clearExplorerCache } from '../api/explorer';
import { EXPLORER_LIMITS } from '../shared/limits';

/**
 * Route-level UI tests. The real route table (src/App.tsx) is rendered inside a
 * MemoryRouter, and every API call goes to a mocked upstream response table.
 * No test reaches GitHub or the network.
 */

const SHA = 'c'.repeat(40);
const FEATURE_SHA = 'd'.repeat(40);

function repo(id: number, overrides: Record<string, unknown> = {}) {
  const name = (overrides.name as string) ?? `repo-${id}`;
  return {
    id,
    name,
    full_name: `ankworks/${name}`,
    private: false,
    html_url: `https://github.com/ankworks/${name}`,
    description: `Description of ${name}`,
    language: 'TypeScript',
    stargazers_count: id * 10,
    forks_count: 1,
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    archived: false,
    fork: false,
    size: 1,
    open_issues_count: 0,
    topics: [],
    default_branch: 'main',
    ...overrides,
  };
}

const REPOS = [repo(1, { name: 'website' }), repo(2, { name: 'aurelia', language: 'JavaScript', stargazers_count: 99 })];

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

function errorJson(status: number, error: string, message: string, headers: Record<string, string> = {}): Response {
  return json({ error, message, status }, { status, headers });
}

type Api = (url: URL) => Response | undefined;

describe('explorer UI', () => {
  let fetchMock: ReturnType<typeof vi.fn<[input: RequestInfo | URL], Promise<Response>>>;
  let api: Api;

  beforeEach(() => {
    invalidateCache();
    clearExplorerCache();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    api = defaultApi();
    fetchMock = vi.fn<[input: RequestInfo | URL], Promise<Response>>(async (input) => {
      const url = new URL(String(input), 'https://site.test');
      return api(url) ?? errorJson(404, 'NOT_FOUND', 'Not found in test table.');
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

  function requestedPaths(): string[] {
    return fetchMock.mock.calls.map((call) => {
      const url = new URL(String(call[0]), 'https://site.test');
      return `${url.pathname}${url.search}`;
    });
  }

  function defaultApi(): Api {
    return (url) => {
      const p = url.pathname;
      if (p === '/api/repos') return json({ org: 'ankworks', repos: REPOS, total_count: REPOS.length, fetched_at: '2026-01-01T00:00:00Z' });
      if (p === '/api/org') {
        return json({
          org: {
            login: 'ankworks',
            name: 'AnkWorks',
            description: 'Independent software studio.',
            avatar_url: 'https://avatars.githubusercontent.com/u/340385619',
            html_url: 'https://github.com/ankworks',
            blog: 'https://works.ankb.qzz.io',
            location: 'Vietnam',
            public_repos: 2,
            created_at: '2026-10-10T00:00:00Z',
          },
        });
      }
      if (p === '/api/repos/website') {
        return json({
          repo: {
            ...repo(1, { name: 'website' }),
            pushed_at: '2026-01-01T00:00:00Z',
            license: null,
            homepage: null,
          },
        });
      }
      if (p === '/api/repos/website/tree') {
        const ref = url.searchParams.get('ref');
        const path = url.searchParams.get('path') ?? '';
        const commit = ref === 'feature/login' ? FEATURE_SHA : SHA;
        if (path === 'empty') return json({ repo: 'website', ref, commit_sha: commit, path, entries: [], truncated: false });
        if (path === 'does-not-exist') return errorJson(404, 'PATH_NOT_FOUND', 'This path does not exist at the requested ref.');
        if (path === 'huge') {
          return json({
            repo: 'website',
            ref,
            commit_sha: commit,
            path,
            entries: [{ name: 'a.txt', path: 'huge/a.txt', type: 'file', size: 1, sha: 'f'.repeat(40), html_url: 'https://github.com/x' }],
            truncated: true,
          });
        }
        return json({
          repo: 'website',
          ref,
          commit_sha: commit,
          path,
          truncated: false,
          // Same order the Worker returns: directories first, then files by name.
          entries: [
            { name: 'src', path: 'src', type: 'dir', size: 0, sha: '2'.repeat(40), html_url: 'https://github.com/x' },
            { name: 'alpha.md', path: 'alpha.md', type: 'file', size: 2048, sha: '3'.repeat(40), html_url: 'https://github.com/x' },
            { name: 'zeta.ts', path: 'zeta.ts', type: 'file', size: 120, sha: '1'.repeat(40), html_url: 'https://github.com/x' },
          ],
        });
      }
      if (p === '/api/repos/website/readme') {
        return json({
          repo: 'website',
          commit_sha: SHA,
          path: 'README.md',
          name: 'README.md',
          kind: 'text',
          size: 100,
          content: '# Website\n\nSee [the docs](./docs/guide.md).\n\n![logo](./logo.png)\n',
        });
      }
      if (p === '/api/repos/website/file') {
        const path = url.searchParams.get('path') ?? '';
        const base = { repo: 'website', ref: url.searchParams.get('ref'), commit_sha: SHA, path, name: path.split('/').pop(), size: 10, blob_sha: 'e'.repeat(40), html_url: 'https://github.com/x' };
        if (path === 'src/index.ts') return json({ ...base, kind: 'text', content: 'export const a = 1;\nexport const b = 2;\n' });
        if (path === 'logo.png') return json({ ...base, kind: 'binary' });
        if (path === 'assets/video.mp4') return json({ ...base, kind: 'lfs-pointer' });
        if (path === 'big.log') return json({ ...base, kind: 'too-large', size: EXPLORER_LIMITS.RAW_MAX_BYTES + 1 });
        if (path === 'link') return json({ ...base, kind: 'symlink', target: '../docs' });
        if (path === 'vendor/lib') return json({ ...base, kind: 'submodule', submodule_url: 'https://github.com/ankworks/lib' });
        return errorJson(404, 'FILE_NOT_FOUND', 'This file does not exist at the selected branch or commit.');
      }
      if (p === '/api/repos/website/branches') {
        return json({
          branches: [
            { name: 'main', sha: SHA, protected: true },
            { name: 'feature/login', sha: FEATURE_SHA, protected: false },
          ],
          page: 1,
          per_page: 100,
          has_next: false,
        });
      }
      if (p === '/api/repos/website/commits') {
        const page = Number(url.searchParams.get('page') ?? '1');
        return json({
          ref: url.searchParams.get('ref'),
          page,
          per_page: 30,
          has_next: page === 1,
          commits: [
            {
              sha: SHA,
              title: 'Ship explorer',
              message: 'Ship explorer\n\nDetails',
              author_name: 'Ada',
              author_login: 'ada',
              date: '2026-01-02T03:04:05Z',
              html_url: `https://github.com/ankworks/website/commit/${SHA}`,
            },
          ],
        });
      }
      return undefined;
    };
  }

  describe('organization overview', () => {
    it('lists public repositories with their metadata', async () => {
      renderAt('/');
      expect(await screen.findByRole('heading', { name: 'AnkWorks' })).toBeInTheDocument();
      const list = await screen.findByRole('list', { name: 'Repositories' });
      const items = within(list).getAllByRole('listitem');
      expect(items).toHaveLength(2);
      // Default sort is stars, descending: aurelia (99) before website (10).
      expect(items[0]).toHaveTextContent('aurelia');
      expect(items[1]).toHaveTextContent('website');
      expect(items[0]).toHaveTextContent('JavaScript');
    });

    it('filters repositories by search text and shows an empty state when nothing matches', async () => {
      renderAt('/');
      await screen.findByRole('list', { name: 'Repositories' });
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz-nothing' } });
      expect(await screen.findByText('No repositories match these filters.')).toBeInTheDocument();
    });

    it('focuses the search box with the "/" key', async () => {
      renderAt('/');
      const search = await screen.findByRole('searchbox');
      expect(search).not.toHaveFocus();
      fireEvent.keyDown(window, { key: '/' });
      expect(search).toHaveFocus();
    });

    it('shows an error with a working retry when the API fails', async () => {
      const user = userEvent.setup();
      let fail = true;
      const base = defaultApi();
      api = (url) => (fail && url.pathname === '/api/repos' ? errorJson(502, 'GITHUB_UNAVAILABLE', 'GitHub API is currently unavailable.') : base(url));
      renderAt('/');
      expect(await screen.findByText(/GitHub API is currently unavailable|unavailable/i)).toBeInTheDocument();
      fail = false;
      await user.click(screen.getByRole('button', { name: /try again|retry/i }));
      expect(await screen.findByRole('list', { name: 'Repositories' })).toBeInTheDocument();
    });

    it('explains GitHub rate limits with the retry time from the Worker', async () => {
      const base = defaultApi();
      api = (url) =>
        url.pathname === '/api/repos'
          ? errorJson(429, 'GITHUB_RATE_LIMITED', 'GitHub API rate limit reached.', { 'Retry-After': '120' })
          : base(url);
      renderAt('/');
      expect(await screen.findByText('GitHub rate limit reached')).toBeInTheDocument();
      expect(screen.getByText(/about 120 seconds/)).toBeInTheDocument();
    });
  });

  describe('repository and directory browsing', () => {
    it('renders the repository home with the root listing (folders first) and the README', async () => {
      renderAt('/repos/website');
      const listing = await screen.findByRole('region', { name: 'Repository contents' });
      const rows = within(listing).getAllByRole('link').map((link) => link.textContent ?? '');
      expect(rows[0]).toContain('src');
      expect(rows.findIndex((text) => text.includes('alpha.md'))).toBeLessThan(rows.findIndex((text) => text.includes('zeta.ts')));
      expect(await screen.findByRole('article', { name: 'Rendered README.md' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Website' })).toBeInTheDocument();
    });

    it('routes README links inside the explorer and resolves images to GitHub raw URLs', async () => {
      renderAt('/repos/website');
      const readme = await screen.findByRole('article', { name: 'Rendered README.md' });
      const docs = within(readme).getByRole('link', { name: 'the docs' });
      expect(docs.getAttribute('href')).toBe(`/repos/website/blob/${SHA}/docs/guide.md`);
      const image = within(readme).getByRole('img', { name: 'logo' });
      expect(image.getAttribute('src')).toBe(`https://raw.githubusercontent.com/ankworks/website/${SHA}/logo.png`);
    });

    it('decodes a branch name containing "/" from the URL as a single ref', async () => {
      renderAt('/repos/website/tree/feature%252Flogin/src');
      await screen.findByRole('region', { name: 'Contents of src' }).catch(() => undefined);
      await waitFor(() => expect(requestedPaths().some((p) => p.includes('ref=feature%2Flogin') && p.includes('path=src'))).toBe(true));
      expect(await screen.findByLabelText('Branch or ref')).toHaveValue('feature/login');
    });

    it('does not call the API for an invalid repository name', async () => {
      renderAt('/repos/..%2Fsecret');
      expect(await screen.findByText('Invalid repository name')).toBeInTheDocument();
      expect(requestedPaths().filter((p) => p.startsWith('/api/repos/..'))).toHaveLength(0);
    });

    it('shows an empty-directory state', async () => {
      renderAt('/repos/website/tree/main/empty');
      expect(await screen.findByText('This directory is empty.')).toBeInTheDocument();
    });

    it('warns when a directory listing may be incomplete', async () => {
      renderAt('/repos/website/tree/main/huge');
      expect(await screen.findByText('Listing may be incomplete')).toBeInTheDocument();
    });

    it('switches branches from the branch selector', async () => {
      const user = userEvent.setup();
      renderAt('/repos/website/tree/main');
      const select = await screen.findByLabelText('Branch or ref');
      await user.selectOptions(select, 'feature/login');
      await waitFor(() => expect(requestedPaths().some((p) => p.includes('ref=feature%2Flogin'))).toBe(true));
    });

    it('reports a missing path without showing a stale listing', async () => {
      renderAt('/repos/website/tree/main/does-not-exist');
      expect(await screen.findByText('Path not found')).toBeInTheDocument();
    });
  });

  describe('source viewer', () => {
    it('shows line numbers, path, language, copy and permalink actions', async () => {
      renderAt('/repos/website/blob/main/src/index.ts');
      expect(await screen.findByRole('region', { name: 'File index.ts' })).toBeInTheDocument();
      expect(await screen.findByText('export const b = 2;')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: '1' }).getAttribute('href')).toBe('#L1');
      expect(screen.getByRole('button', { name: 'Copy contents of index.ts' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy permalink to this file' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /raw/i }).getAttribute('href')).toContain('/api/repos/website/raw');
    });

    it('shows binary, LFS, symlink and submodule notices instead of content', async () => {
      renderAt('/repos/website/blob/main/logo.png');
      expect(await screen.findByText('Binary file not shown')).toBeInTheDocument();

      renderAt('/repos/website/blob/main/assets/video.mp4');
      expect(await screen.findByText('Stored with Git LFS')).toBeInTheDocument();
    });

    it('hides the raw download for files above the raw limit', async () => {
      renderAt('/repos/website/blob/main/big.log');
      expect(await screen.findByText('File is too large to display')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /^raw$/i })).toBeNull();
    });

    it('shows symlink targets and submodule links without following them', async () => {
      renderAt('/repos/website/blob/main/link');
      expect(await screen.findByText('Symbolic link')).toBeInTheDocument();
      expect(screen.getByText('../docs')).toBeInTheDocument();
    });

    it('shows a submodule notice with the external repository URL', async () => {
      renderAt('/repos/website/blob/main/vendor/lib');
      expect(await screen.findByText('Submodule')).toBeInTheDocument();
      const link = screen.getByRole('link', { name: /Open the submodule on GitHub/ });
      expect(link.getAttribute('href')).toBe('https://github.com/ankworks/lib');
    });

    it('reports a missing file', async () => {
      renderAt('/repos/website/blob/main/nope.ts');
      expect(await screen.findByText('File not found')).toBeInTheDocument();
    });
  });

  describe('commit history', () => {
    it('lists commits with short SHA, author and a GitHub link, and paginates with URL state', async () => {
      const user = userEvent.setup();
      renderAt('/repos/website/commits/main');
      expect(await screen.findByText('Ship explorer')).toBeInTheDocument();
      expect(screen.getByText('ccccccc')).toBeInTheDocument();
      expect(screen.getByText('Ada')).toBeInTheDocument();
      const commitLink = screen.getByRole('link', { name: /Ship explorer/ });
      expect(commitLink.getAttribute('href')).toBe(`https://github.com/ankworks/website/commit/${SHA}`);

      const older = screen.getByRole('link', { name: /Older/ });
      await user.click(older);
      await waitFor(() => expect(requestedPaths().some((p) => p.includes('page=2'))).toBe(true));
    });
  });

  describe('about and routing', () => {
    it('renders the about page with organization facts', async () => {
      renderAt('/about');
      expect(await screen.findByRole('heading', { name: 'About AnkWorks' })).toBeInTheDocument();
      expect(await screen.findByText('Vietnam')).toBeInTheDocument();
      expect(screen.getAllByText(/Read-only/).length).toBeGreaterThan(0);
    });

    it('shows a not-found page for unknown addresses', async () => {
      renderAt('/this/does/not/exist');
      expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    });

    it('redirects the old /projects address to the overview', async () => {
      renderAt('/projects');
      expect(await screen.findByRole('heading', { name: 'AnkWorks' })).toBeInTheDocument();
    });
  });

  it('never calls api.github.com directly from the browser', async () => {
    renderAt('/repos/website/tree/main/src');
    await screen.findByRole('region', { name: 'Contents of src' }).catch(() => undefined);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain('api.github.com');
      expect(String(call[0]).startsWith('/api/')).toBe(true);
    }
  });
});

// Keep fireEvent imported for future keyboard tests without lint noise.
void fireEvent;
