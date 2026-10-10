// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleApiRequest } from '../worker/api';
import type { Env } from '../worker/env';

const ORIGIN = 'https://works.example.test';
const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const PUBLIC_REPOSITORY = {
  id: 1,
  name: 'website',
  full_name: 'ankworks/website',
  private: false,
  html_url: 'https://github.com/ankworks/website',
  owner: { login: 'ankworks' },
  description: 'Forge website',
  language: 'TypeScript',
  stargazers_count: 1,
  forks_count: 0,
  updated_at: '2026-10-10T00:00:00Z',
  pushed_at: '2026-10-10T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  archived: false,
  fork: false,
  size: 10,
  open_issues_count: 1,
  topics: ['forge'],
  default_branch: 'main',
  has_wiki: true,
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
    ...init,
  });
}

function rawIssue(overrides: Record<string, unknown> = {}) {
  return {
    number: 7,
    title: 'Document the API',
    body: '## Details\n\nKeep it read-only.',
    state: 'open',
    state_reason: null,
    user: { login: 'dev-user', avatar_url: 'https://avatars.githubusercontent.com/u/123' },
    created_at: '2026-10-09T10:00:00Z',
    updated_at: '2026-10-10T10:00:00Z',
    closed_at: null,
    comments: 2,
    labels: [{ name: 'documentation', color: 'A3E635', description: 'Docs work' }],
    html_url: 'https://github.com/attacker/other/issues/7',
    ...overrides,
  };
}

function rawPull(overrides: Record<string, unknown> = {}) {
  return {
    ...rawIssue({ number: 12, title: 'Add Forge UI', comments: 1, labels: [] }),
    state: 'open',
    draft: false,
    merged: false,
    merged_at: null,
    base: { ref: 'main', sha: SHA, repo: { full_name: 'ankworks/website' } },
    head: { ref: 'feature/forge-ui', sha: SHA2, repo: { full_name: 'ankworks/website' } },
    additions: 42,
    deletions: 3,
    changed_files: 2,
    commits: 1,
    ...overrides,
  };
}

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

function withPublicRepository(route: Handler): Handler {
  return (url, init) => url.pathname === '/repos/ankworks/website' ? json(PUBLIC_REPOSITORY) : route(url, init);
}

describe('read-only GitHub collaboration API', () => {
  let handler: Handler;
  let fetchMock: ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;
  const env: Env = { ASSETS: {} as Fetcher };

  beforeEach(() => {
    handler = (url) => {
      if (url.pathname === '/repos/ankworks/website') return json(PUBLIC_REPOSITORY);
      return new Response('unexpected upstream request', { status: 500 });
    };
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>((input, init) => Promise.resolve(handler(new URL(String(input)), init)));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn().mockResolvedValue(undefined),
        put: vi.fn(async (_key: Request, response: Response) => { await response.arrayBuffer(); }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function api(path: string, requestEnv: Env = env) {
    return handleApiRequest(new Request(`${ORIGIN}${path}`), requestEnv);
  }

  it('returns sanitized organization events with same-domain routes', async () => {
    handler = (url) => {
      if (url.pathname === '/orgs/ankworks/events') {
        return json([{
          id: 'evt-1',
          type: 'PullRequestEvent',
          actor: { login: 'maintainer', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
          repo: { name: 'ankworks/website' },
          payload: { action: 'opened', number: 12, pull_request: { title: 'Add Forge UI' } },
          created_at: '2026-10-10T09:00:00Z',
        }]);
      }
      return new Response('not found', { status: 404 });
    };
    const response = await api('/api/activity?limit=5', { ...env, GITHUB_TOKEN: 'server-only-test-token' });
    expect(response.status).toBe(200);
    const requestHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(requestHeaders.Authorization).toBeUndefined();
    const body = await response.json() as { events: Array<Record<string, unknown>> };
    expect(body.events[0]).toMatchObject({
      id: 'evt-1',
      kind: 'pull',
      actor: 'maintainer',
      repo: 'website',
      summary: 'opened pull request #12 · Add Forge UI',
      href: '/repos/website/pulls/12',
    });
    expect(String(body.events[0].href)).not.toContain('github.com');
  });

  it('uses the fixed organization issue search query and sanitizes repository links', async () => {
    handler = (url) => {
      if (url.pathname === '/search/issues') {
        expect(url.searchParams.get('q')).toBe('org:ankworks is:issue state:open');
        return json({ total_count: 1, items: [rawIssue({ repository_url: 'https://api.github.com/repos/ankworks/website' })] }, {
          headers: { Link: '<https://api.github.com/search/issues?page=2>; rel="next"' },
        });
      }
      return new Response('not found', { status: 404 });
    };
    const response = await api('/api/issues?state=open&page=1', { ...env, GITHUB_TOKEN: 'server-only-test-token' });
    expect(response.status).toBe(200);
    const requestHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(requestHeaders.Authorization).toBeUndefined();
    const body = await response.json() as { items: Array<Record<string, unknown>>; total_count: number; has_next: boolean };
    expect(body).toMatchObject({ total_count: 1, has_next: true });
    expect(body.items[0].html_url).toBe('https://github.com/ankworks/website/issues/7');
    expect(body.items[0]).not.toHaveProperty('repository_url');
  });

  it('searches organization pull requests using the fixed query and sanitizes lifecycle data', async () => {
    handler = (url) => {
      if (url.pathname === '/search/issues') {
        expect(url.searchParams.get('q')).toBe('org:ankworks is:pr state:closed');
        expect(url.searchParams.get('page')).toBe('2');
        return json({
          total_count: 1,
          items: [rawPull({
            number: 14,
            title: 'Publish Forge',
            state: 'closed',
            merged: true,
            merged_at: '2026-10-10T11:00:00Z',
            repository_url: 'https://api.github.com/repos/ankworks/website',
            pull_request: { url: 'https://api.github.com/repos/ankworks/website/pulls/14' },
          })],
        });
      }
      return new Response('unrouted', { status: 500 });
    };
    const response = await api('/api/pulls?state=closed&page=2', { ...env, GITHUB_TOKEN: 'server-only-test-token' });
    expect(response.status).toBe(200);
    const requestHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(requestHeaders.Authorization).toBeUndefined();
    const body = await response.json() as { items: Array<Record<string, unknown>>; state: string; page: number };
    expect(body).toMatchObject({ state: 'closed', page: 2 });
    expect(body.items[0]).toMatchObject({ number: 14, repo: 'website', state: 'closed', merged: true, html_url: 'https://github.com/ankworks/website/pulls/14' });
    expect(body.items[0]).not.toHaveProperty('repository_url');
  });

  it('filters pull requests out of issue listings and paginates the upstream response', async () => {
    handler = withPublicRepository((url) => {
      if (url.pathname === '/repos/ankworks/website/issues') {
        return json([
          rawIssue({ number: 1 }),
          rawIssue({ number: 2, pull_request: { url: 'https://api.github.com/repos/ankworks/website/pulls/2' } }),
        ], { headers: { Link: '<https://api.github.com/repos/ankworks/website/issues?page=2>; rel="next"' } });
      }
      return new Response('unrouted', { status: 500 });
    });
    const response = await api('/api/repos/website/issues?state=all&page=1');
    expect(response.status).toBe(200);
    const body = await response.json() as { items: Array<{ number: number }>; has_next: boolean; total_count: number | null };
    expect(body.items.map((item) => item.number)).toEqual([1]);
    expect(body.has_next).toBe(true);
    expect(body.total_count).toBeNull();
  });

  it('returns an issue and paginated comments without forwarding untrusted GitHub URLs', async () => {
    handler = withPublicRepository((url) => {
      if (url.pathname === '/repos/ankworks/website/issues/7') return json(rawIssue());
      if (url.pathname === '/repos/ankworks/website/issues/7/comments') {
        return json([{ id: 99, body: 'Thanks!', user: { login: 'reviewer' }, created_at: '2026-10-10T12:00:00Z', updated_at: '2026-10-10T12:00:00Z' }]);
      }
      return new Response('unrouted', { status: 500 });
    });
    const issueResponse = await api('/api/repos/website/issues/7');
    expect(issueResponse.status).toBe(200);
    const issueBody = await issueResponse.json() as { issue: Record<string, unknown> };
    expect(issueBody.issue).toMatchObject({ number: 7, repo: 'website', state: 'open', html_url: 'https://github.com/ankworks/website/issues/7' });
    expect(issueBody.issue).not.toMatchObject({ html_url: 'https://github.com/attacker/other/issues/7' });

    const commentsResponse = await api('/api/repos/website/issues/7/comments?page=1');
    expect(commentsResponse.status).toBe(200);
    const commentsBody = await commentsResponse.json() as { comments: Array<Record<string, unknown>> };
    expect(commentsBody.comments[0]).toMatchObject({ id: 99, body: 'Thanks!', author: { login: 'reviewer' } });
  });

  it('lists validated tags and branch refs through public repository endpoints', async () => {
    handler = withPublicRepository((url) => {
      if (url.pathname === '/repos/ankworks/website/tags') {
        return json([
          { name: 'v1.2.0', commit: { sha: SHA } },
          { name: '../private', commit: { sha: SHA } },
          { name: 'v-bad-sha', commit: { sha: 'bad' } },
        ]);
      }
      return new Response('unrouted', { status: 500 });
    });
    const response = await api('/api/repos/website/tags?page=1');
    expect(response.status).toBe(200);
    const body = await response.json() as { tags: Array<{ name: string; sha: string }>; has_next: boolean };
    expect(body.tags).toEqual([{ name: 'v1.2.0', sha: SHA }]);
    expect(body.has_next).toBe(false);
  });

  it('returns pull request state, files, commits, conversation, and review comments', async () => {
    handler = withPublicRepository((url) => {
      if (url.pathname === '/repos/ankworks/website/pulls/12') return json(rawPull());
      if (url.pathname === '/repos/ankworks/website/pulls/12/files') return json([{ filename: 'src/App.tsx', status: 'modified', additions: 5, deletions: 1, changes: 6, patch: '@@ -1 +1 @@' }]);
      if (url.pathname === '/repos/ankworks/website/pulls/12/commits') return json([{ sha: SHA, commit: { message: 'Add dashboard', author: { name: 'Dev', date: '2026-10-10T10:00:00Z' } } }]);
      if (url.pathname === '/repos/ankworks/website/issues/12/comments') return json([{ id: 101, body: 'Looks good', user: { login: 'reviewer' }, created_at: '2026-10-10T10:00:00Z' }]);
      if (url.pathname === '/repos/ankworks/website/pulls/12/comments') return json([{ id: 102, body: 'Change this line', path: 'src/App.tsx', commit_id: SHA, user: { login: 'reviewer' }, created_at: '2026-10-10T10:01:00Z' }]);
      return new Response('unrouted', { status: 500 });
    });

    const pullResponse = await api('/api/repos/website/pulls/12');
    expect(pullResponse.status).toBe(200);
    const pullBody = await pullResponse.json() as { pull: Record<string, unknown> };
    expect(pullBody.pull).toMatchObject({ number: 12, state: 'open', draft: false, base_ref: 'main', head_ref: 'feature/forge-ui', additions: 42, deletions: 3, changed_files: 2, commits_count: 1 });

    const files = await api('/api/repos/website/pulls/12/files');
    expect(await files.json()).toMatchObject({ files: [{ filename: 'src/App.tsx', status: 'modified', patch: '@@ -1 +1 @@' }] });
    const commits = await api('/api/repos/website/pulls/12/commits');
    expect(await commits.json()).toMatchObject({ commits: [{ title: 'Add dashboard', sha: SHA }] });
    const comments = await api('/api/repos/website/pulls/12/comments');
    expect(await comments.json()).toMatchObject({ comments: [{ body: 'Looks good' }] });
    const reviewComments = await api('/api/repos/website/pulls/12/review-comments');
    expect(await reviewComments.json()).toMatchObject({ comments: [{ body: 'Change this line', path: 'src/App.tsx', commit_id: SHA }] });
  });

  it('fails closed for private repositories even if stale public route data is cached', async () => {
    const privateEnv: Env = { ...env, GITHUB_TOKEN: 'server-only-test-token' };
    const cacheMatch = vi.fn().mockResolvedValue(json({ items: [{ number: 7, title: 'Previously public' }] }));
    vi.stubGlobal('caches', { default: { match: cacheMatch, put: vi.fn().mockResolvedValue(undefined) } });
    handler = (url) => {
      if (url.pathname === '/repos/ankworks/website') return json({ ...PUBLIC_REPOSITORY, private: true });
      return new Response('private content must not be requested', { status: 200 });
    };
    const response = await api('/api/repos/website/issues', privateEnv);
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/repos/ankworks/website');
    expect(cacheMatch).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('private content');
  });

  it('rejects invalid state filters before requesting issue data', async () => {
    const response = await api('/api/repos/website/issues?state=assigned');
    expect(response.status).toBe(400);
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname.endsWith('/issues'))).toBe(false);
  });
});
