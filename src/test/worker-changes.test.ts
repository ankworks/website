// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleApiRequest } from '../worker/api';
import { encryptSession, SESSION_COOKIE, type SessionPayload } from '../worker/auth';
import type { Env } from '../worker/env';

/**
 * Milestone C: authenticated writes (commit, branch create) and compare.
 *
 * Invariants: 401 without session, 403 without push permission (verified with
 * the USER's token before any write), input validation before upstream calls,
 * and the write itself always uses the user token — never GITHUB_TOKEN.
 */

const ORIGIN = 'https://works.example.test';
const SESSION_KEY = 'session-encryption-key-0123456789abcdef';
const USER_TOKEN = 'ghu_USER_TOKEN_987';

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function env(): Env {
  return {
    ASSETS: {} as Fetcher,
    GITHUB_TOKEN: 'ghp_SERVER_TOKEN_MUST_NOT_BE_USED',
    SESSION_ENCRYPTION_KEY: SESSION_KEY,
    GITHUB_APP_CLIENT_ID: 'client',
    GITHUB_APP_CLIENT_SECRET: 'secret',
  };
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

async function sessionCookie(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    v: 1,
    user: { id: 42, login: 'octocat', name: null, avatarUrl: '', htmlUrl: 'https://github.com/octocat' },
    token: USER_TOKEN,
    iat: now,
    exp: now + 3600,
  };
  return encryptSession(payload, SESSION_KEY);
}

function authed(path: string, init: RequestInit, cookie: string): Request {
  const headers = new Headers(init.headers);
  headers.set('Cookie', `${SESSION_COOKIE}=${encodeURIComponent(cookie)}`);
  headers.set('Content-Type', 'application/json');
  return request(path, { ...init, headers });
}

describe('changes routes', () => {
  let fetchMock: ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;

  function stubFetch(handler: Handler) {
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async (input, init) => {
      const url = new URL(String(input), ORIGIN);
      return handler(url, init);
    });
    vi.stubGlobal('fetch', fetchMock);
  }

  function seenUpstream(): string[] {
    return fetchMock.mock.calls.map((call) => new URL(String(call[0]), ORIGIN).href);
  }

  beforeEach(() => {
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async () => json({}, 500));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('POST /api/repos/:repo/commit', () => {
    const BODY = { message: 'Update guide', content: '# Hello\n', branch: 'main', path: 'docs/guide.md', sha: 'e'.repeat(40) };

    function commitRequest(body: unknown, cookie: string | null) {
      const init: RequestInit = { method: 'POST', body: JSON.stringify(body) };
      return cookie ? authed('/api/repos/website/commit', init, cookie) : request('/api/repos/website/commit', { ...init, headers: { 'Content-Type': 'application/json' } });
    }

    it('requires a session', async () => {
      const response = await handleApiRequest(commitRequest(BODY, null), env());
      expect(response.status).toBe(401);
      expect(((await response.json()) as { error: string }).error).toBe('UNAUTHENTICATED');
    });

    it('verifies push permission with the user token and rejects read-only users', async () => {
      stubFetch((url, init) => {
        if (url.pathname === '/repos/ankworks/website') {
          expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${USER_TOKEN}`);
          return json({ permissions: { admin: false, push: false, pull: true } });
        }
        return json({}, 500);
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(commitRequest(BODY, cookie), env());
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe('FORBIDDEN');
      // No write must reach the contents endpoint.
      expect(seenUpstream().some((href) => href.includes('/contents/'))).toBe(false);
    });

    it('commits with the user token and never the server GITHUB_TOKEN', async () => {
      stubFetch((url, init) => {
        if (url.pathname === '/repos/ankworks/website') return json({ permissions: { push: true } });
        if (url.pathname === '/repos/ankworks/website/contents/docs/guide.md') {
          expect(init?.method).toBe('PUT');
          const headers = init?.headers as Record<string, string>;
          expect(headers.Authorization).toBe(`Bearer ${USER_TOKEN}`);
          expect(headers.Authorization).not.toContain('ghp_SERVER_TOKEN_MUST_NOT_BE_USED');
          const body = JSON.parse(String(init?.body)) as Record<string, string>;
          expect(body.message).toBe('Update guide');
          expect(body.branch).toBe('main');
          expect(body.sha).toBe('e'.repeat(40));
          expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe('# Hello\n');
          return json({ commit: { sha: 'a'.repeat(40), html_url: 'https://github.com/ankworks/website/commit/aaa' }, content: { sha: 'b'.repeat(40), path: 'docs/guide.md' } });
        }
        return json({}, 500);
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(commitRequest(BODY, cookie), env());
      expect(response.status).toBe(200);
      const result = (await response.json()) as Record<string, unknown>;
      expect(result.branch).toBe('main');
      expect((result.commit as Record<string, string>).sha).toBe('a'.repeat(40));
    });

    it('validates message, branch, path, and sha before any upstream call', async () => {
      const cookie = await sessionCookie();
      const cases = [
        { ...BODY, message: '   ' },
        { ...BODY, branch: 'bad branch' },
        { ...BODY, path: '../etc/passwd' },
        { ...BODY, sha: 'nope' },
      ];
      for (const body of cases) {
        const response = await handleApiRequest(commitRequest(body, cookie), env());
        expect(response.status).toBe(400);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps stale blob conflicts to STALE_BLOB', async () => {
      stubFetch((url) => {
        if (url.pathname === '/repos/ankworks/website') return json({ permissions: { push: true } });
        return json({ message: 'sha does not match' }, 422);
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(commitRequest(BODY, cookie), env());
      expect(response.status).toBe(422);
      expect(((await response.json()) as { error: string }).error).toBe('STALE_BLOB');
    });

    it('rejects GET with Allow: POST', async () => {
      const response = await handleApiRequest(request('/api/repos/website/commit'), env());
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('POST');
    });
  });

  describe('POST /api/repos/:repo/branches', () => {
    it('creates a branch from an existing branch via the user token', async () => {
      stubFetch((url, init) => {
        if (url.pathname === '/repos/ankworks/website') return json({ permissions: { push: true } });
        if (url.pathname === '/repos/ankworks/website/git/ref/heads/main') return json({ object: { sha: 'c'.repeat(40) } });
        if (url.pathname === '/repos/ankworks/website/git/refs') {
          expect(init?.method).toBe('POST');
          expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${USER_TOKEN}`);
          const body = JSON.parse(String(init?.body)) as Record<string, string>;
          expect(body).toEqual({ ref: 'refs/heads/feature/login', sha: 'c'.repeat(40) });
          return json({ ref: 'refs/heads/feature/login', object: { sha: 'c'.repeat(40) } });
        }
        return json({}, 500);
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        authed('/api/repos/website/branches', { method: 'POST', body: JSON.stringify({ name: 'feature/login', from: 'main' }) }, cookie),
        env()
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ name: 'feature/login', sha: 'c'.repeat(40) });
    });

    it('accepts a commit sha as the start point', async () => {
      stubFetch((url) => {
        if (url.pathname === '/repos/ankworks/website') return json({ permissions: { push: true } });
        if (url.pathname === '/repos/ankworks/website/git/refs') return json({ object: { sha: 'd'.repeat(40) } });
        return json({}, 500);
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        authed('/api/repos/website/branches', { method: 'POST', body: JSON.stringify({ name: 'hotfix/x', from: 'd'.repeat(40) }) }, cookie),
        env()
      );
      expect(response.status).toBe(200);
      expect(seenUpstream().some((href) => href.includes('/git/ref/heads/'))).toBe(false);
    });

    it('maps a missing start branch to REF_NOT_FOUND', async () => {
      stubFetch((url) => {
        if (url.pathname === '/repos/ankworks/website') return json({ permissions: { push: true } });
        return json({ message: 'Not Found' }, 404);
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        authed('/api/repos/website/branches', { method: 'POST', body: JSON.stringify({ name: 'feature/x', from: 'ghost' }) }, cookie),
        env()
      );
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe('REF_NOT_FOUND');
    });

    it('maps duplicate names to BRANCH_EXISTS', async () => {
      stubFetch((url) => {
        if (url.pathname === '/repos/ankworks/website') return json({ permissions: { push: true } });
        if (url.pathname === '/repos/ankworks/website/git/ref/heads/main') return json({ object: { sha: 'c'.repeat(40) } });
        return json({ message: 'Reference already exists' }, 422);
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        authed('/api/repos/website/branches', { method: 'POST', body: JSON.stringify({ name: 'main2', from: 'main' }) }, cookie),
        env()
      );
      expect(response.status).toBe(422);
      expect(((await response.json()) as { error: string }).error).toBe('BRANCH_EXISTS');
    });

    it('fails closed without push permission', async () => {
      stubFetch((url) => (url.pathname === '/repos/ankworks/website' ? json({ permissions: { push: false } }) : json({}, 500)));
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        authed('/api/repos/website/branches', { method: 'POST', body: JSON.stringify({ name: 'x/y', from: 'main' }) }, cookie),
        env()
      );
      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/repos/:repo/compare', () => {
    it('returns a normalized compare payload with patches', async () => {
      stubFetch((url) => {
        expect(url.pathname).toBe('/repos/ankworks/website/compare/main...feature%2Fx');
        return json({
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
          total_commits: 2,
          html_url: 'https://github.com/ankworks/website/compare/main...feature/x',
          files: [
            { filename: 'docs/guide.md', status: 'modified', additions: 3, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new\n' },
            { filename: 'logo.png', status: 'added', additions: 0, deletions: 0 },
          ],
        });
      });
      const response = await handleApiRequest(request('/api/repos/website/compare?base=main&head=feature%2Fx'), env());
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.status).toBe('ahead');
      expect(body.total_commits).toBe(2);
      const files = body.files as Array<Record<string, unknown>>;
      expect(files).toHaveLength(2);
      expect(files[0].patch).toContain('+new');
      expect(files[1].patch).toBeNull();
    });

    it('validates parameters', async () => {
      const response = await handleApiRequest(request('/api/repos/website/compare?base=main'), env());
      expect(response.status).toBe(400);
    });

    it('maps missing refs to COMPARE_NOT_FOUND', async () => {
      stubFetch(() => json({ message: 'Not Found' }, 404));
      const response = await handleApiRequest(request('/api/repos/website/compare?base=main&head=nope'), env());
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe('COMPARE_NOT_FOUND');
    });
  });
});
