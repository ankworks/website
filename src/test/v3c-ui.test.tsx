import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { AuthProvider } from '../auth/AuthContext';
import ReactionsBar from '../components/collaboration/ReactionsBar';
import IssueTemplatePicker from '../components/collaboration/IssueTemplatePicker';
import { invalidateCache } from '../api/github';
import { clearExplorerCache } from '../api/explorer';
import { clearInsightsCache } from '../api/insights';
import { clearDiscussionsCache } from '../api/discussions';
import { MEMBER, NON_MEMBER } from './helpers/membership';

/**
 * V3-C UI tests: reactions, issue templates, and Discussions.
 *
 * Every API call is served from a mocked table; no test touches the network.
 * Where a control is enabled or disabled, the point under test is that the UI
 * follows the SERVER's membership answer instead of guessing — the Worker
 * re-checks authorization regardless (see worker-v3c.test.ts).
 */

const SHA = 'a'.repeat(40);
const CATEGORY = { id: 'DIC_kwDOABC123', name: 'Announcements', emoji: '📣', slug: 'announcements', description: 'News', isAnswerable: false };

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

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
    topics: ['web'],
    default_branch: 'main',
    owner: { login: 'ankworks' },
    license: 'MIT',
    homepage: null,
    has_wiki: true,
    has_issues: true,
    has_discussions: true,
    ...overrides,
  };
}

function comment(id: string, body: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    body,
    author: { login: 'alice', avatarUrl: null, htmlUrl: 'https://github.com/alice' },
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: null,
    isAnswer: false,
    replies: [],
    viewerCanUpdate: false,
    viewerCanDelete: false,
    reactions: [],
    ...overrides,
  };
}

function discussion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'D_kwDOABC456',
    number: 3,
    title: 'How do I deploy Forge?',
    author: { login: 'alice', avatarUrl: null, htmlUrl: 'https://github.com/alice' },
    category: CATEGORY,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    commentsCount: 1,
    upvoteCount: 4,
    locked: false,
    answered: false,
    url: 'https://github.com/ankworks/website/discussions/3',
    body: 'I read the README but the deploy step is unclear.',
    answer: null,
    comments: [comment('DC_kwDOABC789', 'Use `wrangler deploy`.')],
    viewerCanUpdate: false,
    viewerCanDelete: false,
    viewerCanLock: false,
    reactions: [{ content: 'THUMBS_UP', count: 2, viewerHasReacted: false }],
    ...overrides,
  };
}

type Api = (url: URL) => Response | undefined;

interface Options {
  membership?: unknown;
  authenticated?: boolean;
  hasDiscussions?: boolean;
  discussions?: unknown[];
}

function api({
  membership = NON_MEMBER(),
  authenticated = false,
  hasDiscussions = true,
  discussions: list = [discussion()],
}: Options = {}): Api {
  return (url) => {
    const path = url.pathname;
    if (path === '/api/org') {
      return json({ org: { login: 'ankworks', name: 'AnkWorks', description: null, avatar_url: '/branding/ankworks-logo.png', html_url: 'https://github.com/ankworks', blog: null, location: null, public_repos: 2, created_at: '2020-01-01T00:00:00Z' }, fetched_at: '2026-01-01T00:00:00Z' });
    }
    if (path === '/api/repos') return json({ org: 'ankworks', repos: [], total_count: 0, fetched_at: '2026-01-01T00:00:00Z' });
    if (path === '/api/featured') return json({ items: [], configured: false, fetched_at: '2026-01-01T00:00:00Z' });
    if (path === '/api/auth/session') {
      return json(
        authenticated
          ? { authenticated: true, user: { id: 7, login: 'octocat', name: null, avatarUrl: '', htmlUrl: 'https://github.com/octocat' }, expiresAt: '2027-01-01T00:00:00.000Z', authEnabled: true }
          : { authenticated: false, user: null, expiresAt: null, authEnabled: false }
      );
    }
    if (path === '/api/auth/membership') return json(membership);
    if (path === '/api/repos/website') {
      return json({ repo: repoPayload({ has_discussions: hasDiscussions }) });
    }
    if (path === '/api/repos/website/commits') {
      return json({ ref: 'main', commits: [{ sha: SHA, title: 'Commit', message: 'Commit', author_name: 'alice', author_login: 'alice', date: '2026-01-02T00:00:00Z', html_url: '#' }], page: 1, per_page: 30, has_next: false });
    }
    if (path === '/api/repos/website/last-commit') {
      return json({ path: '', commit: { sha: SHA, title: 'Commit', message: 'Commit', author_name: 'alice', author_login: 'alice', date: '2026-01-02T00:00:00Z', html_url: '#' } });
    }
    if (path === '/api/repos/website/branches') return json({ branches: [{ name: 'main', sha: SHA, protected: true }], page: 1, per_page: 100, has_next: false });
    if (path === '/api/repos/website/tags') return json({ tags: [], page: 1, per_page: 100, has_next: false });
    if (path === '/api/repos/website/contributors') return json({ contributors: [], page: 1, per_page: 30, has_next: false });
    if (path === '/api/repos/website/languages') return json({ total_bytes: 0, languages: [], fetched_at: '2026-01-01T00:00:00Z' });
    if (path === '/api/repos/website/releases') return json({ releases: [], page: 1, per_page: 20, has_next: false });
    if (path === '/api/repos/website/workflows') return json({ total_count: 0, workflows: [], page: 1, per_page: 30, has_next: false });
    if (path === '/api/repos/website/runs') return json({ total_count: 0, runs: [], page: 1, per_page: 20, has_next: false });
    if (path === '/api/repos/website/docs') return json({ repo: 'website', commit_sha: SHA, docs: [] });
    if (path === '/api/repos/website/discussions/categories') {
      return json({ repo: 'website', enabled: hasDiscussions, categories: hasDiscussions ? [CATEGORY] : [] });
    }
    if (path === '/api/repos/website/discussions') {
      return json({ repo: 'website', categoryId: null, discussions: list, pageInfo: { hasNextPage: false, endCursor: null, hasPreviousPage: false, startCursor: null } });
    }
    if (path === '/api/repos/website/discussions/3') {
      return json({ repo: 'website', discussion: discussion() });
    }
    if (path === '/api/repos/website/issue-templates') {
      return json({
        repo: 'website',
        enabled: true,
        templates: [
          { fileName: 'bug_report.md', name: 'Bug report', about: 'Something is broken', title: '[BUG] ', labels: ['bug'], assignees: [], body: '## What happened\n', format: 'markdown', parsed: true },
          { fileName: 'config.yml', name: 'Config help', about: null, title: null, labels: [], assignees: [], body: '**Version**\n', format: 'yaml-form', parsed: false },
        ],
      });
    }
    if (path === '/api/repos/website/reactions') {
      return json({ subject: 'issue', repo: 'website', targetId: '7', reactions: [{ content: 'THUMBS_UP', count: 3, viewerHasReacted: false }], totalCount: 3 });
    }
    if (path === '/api/activity') return json({ events: [], fetched_at: '2026-01-01T00:00:00Z' });
    if (path === '/api/org/profile-readme') return json({ error: 'PROFILE_README_NOT_FOUND', message: 'none', status: 404 }, { status: 404 });
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
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'https://site.test');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && path2(url) === '/api/repos/website/discussions/3/comments') {
      return json({ id: 'D_kwDOABC456', number: 3, url: 'https://github.com/ankworks/website/discussions/3', commentId: 'DC_new' }, { status: 201 });
    }
    return table(url) ?? json({ error: 'NOT_FOUND', message: 'Not found in test table: ' + url.pathname, status: 404 }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function path2(url: URL): string {
  return url.pathname;
}

describe('V3-C collaboration UI', () => {
  beforeEach(() => {
    install();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -- Reactions -------------------------------------------------------------

  it('shows the tallies GitHub reported and disables toggling for guests', async () => {
    install();
    render(
      <MemoryRouter>
        <AuthProvider>
          <ReactionsBar repo="website" kind="issue" target="7" />
        </AuthProvider>
      </MemoryRouter>
    );
    const button = await screen.findByTestId('reaction-thumbs_up');
    expect(button.textContent).toContain('3');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('reactions-readonly').textContent).toBe('Members only');
  });

  it('lets a verified member toggle a reaction and posts to the Worker', async () => {
    const fetchMock = install({ membership: MEMBER(), authenticated: true });
    render(
      <MemoryRouter>
        <AuthProvider>
          <ReactionsBar repo="website" kind="issue" target="7" />
        </AuthProvider>
      </MemoryRouter>
    );
    const button = await screen.findByTestId('reaction-thumbs_up');
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => {
          const init = call[1] as RequestInit | undefined;
          return String(call[0]).includes('/api/repos/website/reactions') && init?.method === 'POST';
        })
      ).toBe(true)
    );
  });

  it('says reactions are unavailable rather than showing a zero when the API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'GITHUB_UNAVAILABLE', message: 'GitHub is unavailable', status: 502 }, { status: 502 }))
    );
    render(
      <MemoryRouter>
        <AuthProvider>
          <ReactionsBar repo="website" kind="issue" target="7" />
        </AuthProvider>
      </MemoryRouter>
    );
    expect(await screen.findByTestId('reactions-unavailable')).toBeTruthy();
  });

  it('reports an empty reaction list honestly', async () => {
    const table = api();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'https://site.test');
        if (url.pathname === '/api/repos/website/reactions') {
          return json({ subject: 'issue', repo: 'website', targetId: '7', reactions: [], totalCount: 0 });
        }
        return table(url) ?? json({}, { status: 404 });
      })
    );
    render(
      <MemoryRouter>
        <AuthProvider>
          <ReactionsBar repo="website" kind="issue" target="7" />
        </AuthProvider>
      </MemoryRouter>
    );
    expect((await screen.findByTestId('reactions-empty')).textContent).toMatch(/No reactions yet/);
  });

  // -- Issue templates -------------------------------------------------------

  it('offers the repository templates and pre-fills the composer', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <IssueTemplatePicker
            repo="website"
            onSelect={(template) => {
              expect(template.name).toBe('Bug report');
              expect(template.body).toContain('## What happened');
              expect(template.labels).toEqual(['bug']);
            }}
          />
        </AuthProvider>
      </MemoryRouter>
    );
    const button = await screen.findByTestId('issue-template-bug_report.md');
    expect(button.textContent).toContain('Bug report');
    fireEvent.click(button);
  });

  it('warns that GitHub issue forms cannot be executed by Forge', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <IssueTemplatePicker repo="website" onSelect={() => undefined} />
        </AuthProvider>
      </MemoryRouter>
    );
    expect(await screen.findByTestId('issue-template-config.yml')).toBeTruthy();
    expect(await screen.findByText(/cannot run them/i)).toBeTruthy();
  });

  it('renders nothing when the repository has no templates', async () => {
    const table = api();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'https://site.test');
        if (url.pathname === '/api/repos/website/issue-templates') {
          return json({ repo: 'website', enabled: false, templates: [] });
        }
        return table(url) ?? json({}, { status: 404 });
      })
    );
    const { container } = render(
      <MemoryRouter>
        <AuthProvider>
          <IssueTemplatePicker repo="website" onSelect={() => undefined} />
        </AuthProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(container.textContent?.trim()).toBe(''));
  });

  // -- Discussions -----------------------------------------------------------

  function renderAt(url: string) {
    return render(
      <MemoryRouter initialEntries={[url]}>
        <App />
      </MemoryRouter>
    );
  }

  it('lists discussions at /repos/:repo/discussions', async () => {
    renderAt('/repos/website/discussions');
    expect(await screen.findByText('How do I deploy Forge?')).toBeTruthy();
    expect(screen.getByText(/@alice/)).toBeTruthy();
  });

  it('says so when the repository has Discussions disabled', async () => {
    install({ hasDiscussions: false });
    renderAt('/repos/website/discussions');
    expect(await screen.findByText(/Discussions are not enabled/i)).toBeTruthy();
  });

  it('renders a discussion with its replies', async () => {
    renderAt('/repos/website/discussions/3');
    expect(await screen.findByText('How do I deploy Forge?')).toBeTruthy();
    // The comment body is rendered as Markdown, so the backticks become <code>.
    expect(await screen.findByText('wrangler deploy')).toBeTruthy();
  });

  it('hides the reply composer from a signed-in non-member and explains why', async () => {
    install({ authenticated: true, membership: NON_MEMBER() });
    renderAt('/repos/website/discussions/3');
    expect(await screen.findByText(/Members only/i)).toBeTruthy();
    expect(screen.queryByLabelText('Reply body')).toBeNull();
  });

  it('lets a verified member post a reply', async () => {
    const fetchMock = install({ authenticated: true, membership: MEMBER() });
    renderAt('/repos/website/discussions/3');
    const composer = await screen.findByLabelText('Reply body');
    fireEvent.change(composer, { target: { value: 'Thanks, that worked.' } });
    fireEvent.click(screen.getByRole('button', { name: /Post reply/i }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => {
          const init = call[1] as RequestInit | undefined;
          return String(call[0]).includes('/discussions/3/comments') && init?.method === 'POST';
        })
      ).toBe(true)
    );
  });
});
