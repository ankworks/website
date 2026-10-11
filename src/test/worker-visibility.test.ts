// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleApiRequest, repoInPath } from '../worker/api';
import { encryptSession, SESSION_COOKIE, type SessionPayload } from '../worker/auth';
import { clearMembershipCache } from '../worker/membership';
import { parseHiddenRepos } from '../shared/visibility';
import type { Env } from '../worker/env';

/**
 * The repository Forge is built from (`ankworks/website`) must not be readable
 * through Forge.
 *
 * These tests assert the SERVER-side rule: a 404 on every scoped route, and a
 * filtered result on every listing. The browser never gets the data, so no
 * amount of client-side digging can surface it.
 *
 * Reminder of the real limitation, stated in src/shared/visibility.ts: the
 * GitHub repository stays public. This is a Forge-side presentation rule and is
 * not a confidentiality control.
 */

const ORIGIN = 'https://works.example.test';
const SESSION_KEY = 'session-encryption-key-0123456789abcdef';
const USER_TOKEN = 'oauth-user-token-555';

function json(body: unknown, options: { status?: number } | number = 200): Response {
  const status = typeof options === 'number' ? options : (options.status ?? 200);
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function env(hidden = 'website'): Env {
  return {
    ASSETS: {} as Fetcher,
    SESSION_ENCRYPTION_KEY: SESSION_KEY,
    GITHUB_TOKEN: 'ghp_SERVER_TOKEN',
    FORGE_SELF_REPO: hidden,
  };
}

function openEnv(): Env {
  return { ASSETS: {} as Fetcher, SESSION_ENCRYPTION_KEY: SESSION_KEY, GITHUB_TOKEN: 'ghp_SERVER_TOKEN' };
}

async function cookie(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    v: 1,
    user: { id: 42, login: 'octocat', name: null, avatarUrl: '', htmlUrl: '' },
    token: USER_TOKEN,
    iat: now,
    exp: now + 3600,
  };
  return encryptSession(payload, SESSION_KEY);
}

function get(path: string): Request {
  return new Request(`${ORIGIN}${path}`, { method: 'GET', headers: { Accept: 'application/json' } });
}

function post(path: string, body: unknown, sessionCookie: string | null): Request {
  const headers = new Headers({ 'Content-Type': 'application/json', Origin: ORIGIN });
  if (sessionCookie) headers.set('Cookie', `${SESSION_COOKIE}=${encodeURIComponent(sessionCookie)}`);
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
}

function publicRepo(name: string): Record<string, unknown> {
  return {
    id: Math.floor(Math.random() * 100000),
    name,
    full_name: `ankworks/${name}`,
    private: false,
    html_url: `https://github.com/ankworks/${name}`,
    default_branch: 'main',
    owner: { login: 'ankworks' },
    permissions: { admin: true, push: true, pull: true, triage: true },
  };
}

function stub(handler?: (url: URL, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), ORIGIN);
    if (url.pathname === '/user/memberships/orgs/ankworks') return json({ state: 'active', role: 'member' });
    if (/^\/repos\/ankworks\/[^/]+$/.test(url.pathname) && (init?.method ?? 'GET') === 'GET') {
      const name = url.pathname.split('/')[3] ?? '';
      return json(publicRepo(name));
    }
    if (handler) return handler(url, init);
    return json({}, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearMembershipCache();
  fetchMock = vi.fn() as unknown as typeof fetchMock;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('caches', { default: undefined, open: async () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('configuration parsing', () => {
  it('parses a comma-separated, case-insensitive list', () => {
    expect(parseHiddenRepos('website')).toEqual(['website']);
    expect(parseHiddenRepos('Website, aurelia ,, stage-browser')).toEqual(['website', 'aurelia', 'stage-browser']);
    expect(parseHiddenRepos('')).toEqual([]);
    expect(parseHiddenRepos(undefined)).toEqual([]);
    expect(parseHiddenRepos('website,website')).toEqual(['website']);
  });

  it('extracts the repository from a scoped API path', () => {
    expect(repoInPath('/api/repos/website')).toBe('website');
    expect(repoInPath('/api/repos/website/tree/main/src')).toBe('website');
    expect(repoInPath('/api/repos/my%2Frepo')).toBe('my/repo');
    expect(repoInPath('/api/repos')).toBeNull();
    expect(repoInPath('/api/org')).toBeNull();
  });
});

describe('scoped routes are blocked with 404', () => {
  it('blocks the repository home', async () => {
    stub();
    const response = await handleApiRequest(get('/api/repos/website'), env());
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe('NOT_FOUND');
  });

  it('blocks nested source routes', async () => {
    stub();
    for (const path of [
      '/api/repos/website/tree/main/src',
      '/api/repos/website/blob/main/README.md',
      '/api/repos/website/commits/main',
      '/api/repos/website/branches',
      '/api/repos/website/tags',
      '/api/repos/website/readme',
      '/api/repos/website/file?path=README.md',
      '/api/repos/website/raw?ref=main&path=README.md',
    ]) {
      const response = await handleApiRequest(get(path), env());
      expect(response.status, path).toBe(404);
    }
  });

  it('blocks issues, pull requests, discussions, and insights', async () => {
    stub();
    for (const path of [
      '/api/repos/website/issues',
      '/api/repos/website/issues/7',
      '/api/repos/website/pulls',
      '/api/repos/website/pulls/7',
      '/api/repos/website/discussions',
      '/api/repos/website/discussions/3',
      '/api/repos/website/contributors',
      '/api/repos/website/languages',
      '/api/repos/website/releases',
      '/api/repos/website/workflows',
      '/api/repos/website/issue-templates',
      '/api/repos/website/reactions?kind=issue&target=7',
    ]) {
      const response = await handleApiRequest(get(path), env());
      expect(response.status, path).toBe(404);
    }
  });

  it('blocks authenticated writes too, and never reaches GitHub', async () => {
    const mock = stub();
    const cookieValue = await cookie();
    for (const [path, body] of [
      ['/api/repos/website/issues', { title: 'x' }],
      ['/api/repos/website/pulls', { title: 'x', head: 'a', base: 'b' }],
      ['/api/repos/website/commit', { message: 'x', content: 'y', branch: 'main', path: 'a.md' }],
    ] as const) {
      const response = await handleApiRequest(post(path, body, cookieValue), env());
      expect(response.status, path).toBe(404);
    }
    // No upstream call carries the hidden repository name.
    for (const call of mock.mock.calls) {
      expect(String(call[0])).not.toContain('/repos/ankworks/website/');
    }
  });

  it('is case-insensitive, like GitHub repository names', async () => {
    stub();
    const response = await handleApiRequest(get('/api/repos/WebSite'), env());
    expect(response.status).toBe(404);
  });

  it('answers 404 — never 403 — so existence is not confirmed', async () => {
    stub();
    const response = await handleApiRequest(get('/api/repos/website'), env());
    expect(response.status).toBe(404);
    // A blocked repository is indistinguishable from one that does not exist.
    expect((await response.json()) as { error: string }).toEqual({
      error: 'NOT_FOUND',
      message: 'API endpoint not found.',
      status: 404,
    });
  });
});

describe('other repositories are unaffected', () => {
  it('serves a normal repository', async () => {
    stub();
    const response = await handleApiRequest(get('/api/repos/aurelia'), env());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { repo: { name: string } };
    expect(body.repo.name).toBe('aurelia');
  });

  it('leaves everything alone when no repository is configured as hidden', async () => {
    stub();
    const response = await handleApiRequest(get('/api/repos/website'), openEnv());
    expect(response.status).toBe(200);
  });
});

describe('listings exclude the hidden repository', () => {
  it('filters the public repository list', async () => {
    stub((url) => {
      if (url.pathname === '/orgs/ankworks/repos') {
        return json([
          publicRepo('website'),
          publicRepo('aurelia'),
          publicRepo('stage-browser'),
        ]);
      }
      return json({}, 500);
    });
    const response = await handleApiRequest(get('/api/repos'), env());
    const body = (await response.json()) as { repos: Array<{ name: string }>; total_count: number };
    expect(body.repos.map((repo) => repo.name)).toEqual(['aurelia', 'stage-browser']);
    expect(body.total_count).toBe(2);
  });

  it('filters organization-wide issue and pull request search', async () => {
    stub((url) => {
      if (url.pathname === '/search/issues') {
        return json({
          total_count: 2,
          incomplete_results: false,
          items: [
            { number: 1, title: 'Hidden issue', state: 'open', html_url: 'https://github.com/ankworks/website/issues/1', repository_url: 'https://api.github.com/repos/ankworks/website', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', user: { login: 'ada' } },
            { number: 2, title: 'Visible issue', state: 'open', html_url: 'https://github.com/ankworks/aurelia/issues/2', repository_url: 'https://api.github.com/repos/ankworks/aurelia', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', user: { login: 'ada' } },
          ],
        });
      }
      return json({}, 500);
    });
    const response = await handleApiRequest(get('/api/issues'), env());
    const body = (await response.json()) as { items: Array<{ repo: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.repo).toBe('aurelia');
  });

  it('filters organization activity', async () => {
    stub((url) => {
      if (url.pathname === '/orgs/ankworks/events') {
        return json([
          { id: '1', type: 'PushEvent', actor: { login: 'ada', display_login: 'ada' }, repo: { name: 'ankworks/website' }, created_at: '2026-01-01T00:00:00Z', payload: {} },
          { id: '2', type: 'PushEvent', actor: { login: 'ada', display_login: 'ada' }, repo: { name: 'ankworks/aurelia' }, created_at: '2026-01-01T00:00:00Z', payload: {} },
        ]);
      }
      return json({}, 500);
    });
    const response = await handleApiRequest(get('/api/activity'), env());
    const body = (await response.json()) as { events: Array<{ repo: string }> };
    expect(body.events.map((event) => event.repo)).toEqual(['aurelia']);
  });

  it('filters org-scoped search results', async () => {
    stub((url) => {
      if (url.pathname.startsWith('/search/')) {
        return json({
          total_count: 2,
          items: [
            { name: 'website', html_url: 'https://github.com/ankworks/website', full_name: 'ankworks/website' },
            { name: 'aurelia', html_url: 'https://github.com/ankworks/aurelia', full_name: 'ankworks/aurelia' },
          ],
        });
      }
      return json({}, 500);
    });
    const response = await handleApiRequest(get('/api/search?q=forge&type=repos'), env());
    const body = (await response.json()) as { items: Array<{ title: string }> };
    expect(body.items.map((item) => item.title)).toEqual(['aurelia']);
  });
});

describe('authorization is untouched', () => {
  it('still refuses an unauthenticated write on a visible repository', async () => {
    stub();
    const response = await handleApiRequest(post('/api/repos/aurelia/issues', { title: 'x' }, null), env());
    expect(response.status).toBe(401);
  });

  it('still refuses a cross-origin write on a visible repository', async () => {
    stub();
    const cookieValue = await cookie();
    const headers = new Headers({ 'Content-Type': 'application/json', Origin: 'https://evil.example.test' });
    headers.set('Cookie', `${SESSION_COOKIE}=${encodeURIComponent(cookieValue)}`);
    const response = await handleApiRequest(
      new Request(`${ORIGIN}/api/repos/aurelia/issues`, { method: 'POST', headers, body: JSON.stringify({ title: 'x' }) }),
      env()
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe('CSRF_FAILED');
  });

  it('still lets a verified member write to a visible repository', async () => {
    stub((url, init) => {
      if (url.pathname === '/repos/ankworks/aurelia/issues' && (init?.method ?? 'GET') === 'POST') {
        return json({ number: 12, state: 'open', html_url: 'https://github.com/ankworks/aurelia/issues/12', id: 3, title: 'x' });
      }
      return json({}, 500);
    });
    const cookieValue = await cookie();
    const response = await handleApiRequest(post('/api/repos/aurelia/issues', { title: 'Visible work' }, cookieValue), env());
    expect(response.status).toBe(200);
  });
});
