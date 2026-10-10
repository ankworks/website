// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleApiRequest } from '../worker/api';
import { encryptSession, SESSION_COOKIE, type SessionPayload } from '../worker/auth';
import type { Env } from '../worker/env';

/**
 * Milestone D: collaboration writes (issues, comments, reviews, merges).
 * Permission matrix and fail-closed behavior against a mocked GitHub API.
 */

const ORIGIN = 'https://works.example.test';
const SESSION_KEY = 'session-encryption-key-0123456789abcdef';
const USER_TOKEN = 'ghu_USER_TOKEN_555';

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function env(): Env {
  return { ASSETS: {} as Fetcher, SESSION_ENCRYPTION_KEY: SESSION_KEY, GITHUB_TOKEN: 'ghp_SERVER_MUST_NOT_APPEAR' };
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

function writeRequest(path: string, method: string, body: unknown, sessionCookie: string | null): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (sessionCookie) headers.set('Cookie', `${SESSION_COOKIE}=${encodeURIComponent(sessionCookie)}`);
  return new Request(`${ORIGIN}${path}`, { method, headers, body: JSON.stringify(body ?? {}) });
}

describe('collaboration writes', () => {
  let fetchMock: ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;

  function stubFetch(handler: Handler) {
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async (input, init) => {
      return handler(new URL(String(input), ORIGIN), init);
    });
    vi.stubGlobal('fetch', fetchMock);
  }

  function seenUpstream(): string[] {
    return fetchMock.mock.calls.map((call) => new URL(String(call[0]), ORIGIN).href);
  }

  /** Permissions returned by the mocked repository lookup. */
  function stubPermissions(permissions: Record<string, unknown>, onWrite?: Handler) {
    stubFetch((url, init) => {
      if (url.pathname === '/repos/ankworks/website' && (init?.method ?? 'GET') === 'GET') {
        return json({ permissions });
      }
      return onWrite ? onWrite(url, init) : json({ number: 7, state: 'open', html_url: 'https://github.com/ankworks/website/issues/7', id: 99 });
    });
  }

  beforeEach(() => {
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async () => json({}, 500));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects unauthenticated writes', async () => {
    const response = await handleApiRequest(writeRequest('/api/repos/website/issues', 'POST', { title: 'x' }, null), env());
    expect(response.status).toBe(401);
  });

  describe('issues', () => {
    it('creates an issue with read access, sending only sanitized fields', async () => {
      stubPermissions({ pull: true }, (url, init) => {
        expect(url.pathname).toBe('/repos/ankworks/website/issues');
        expect(init?.method).toBe('POST');
        expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${USER_TOKEN}`);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toEqual({ title: 'Bug', body: 'details', labels: ['bug'] });
        return json({ number: 7, state: 'open', html_url: 'u', title: 'Bug', id: 5 });
      });
      const c = await cookie();
      const response = await handleApiRequest(
        writeRequest('/api/repos/website/issues', 'POST', { title: 'Bug', body: 'details', labels: ['bug'], assignees: ['admin'], malicious: true }, c),
        env()
      );
      expect(response.status).toBe(200);
      expect(((await response.json()) as { number: number }).number).toBe(7);
    });

    it('reports a repository with Issues turned off as FEATURE_DISABLED, not an outage', async () => {
      // GitHub answers 410 "Issues has been disabled in this repository." — seen
      // for real on ankworks/website. Mapping it to GITHUB_UNAVAILABLE sent users
      // chasing an outage that did not exist.
      stubPermissions({ pull: true }, () => json({ message: 'Issues has been disabled in this repository.', status: '410' }, 410));
      const c = await cookie();
      const response = await handleApiRequest(writeRequest('/api/repos/website/issues', 'POST', { title: 'Bug' }, c), env());
      expect(response.status).toBe(410);
      const body = (await response.json()) as { error: string; message: string };
      expect(body.error).toBe('FEATURE_DISABLED');
      expect(body.message).toMatch(/Issues has been disabled/i);
    });

    it('reports an upstream 403 as FORBIDDEN instead of an outage', async () => {
      stubPermissions({ pull: true }, () => json({ message: 'Resource not accessible by personal access token' }, 403));
      const c = await cookie();
      const response = await handleApiRequest(writeRequest('/api/repos/website/issues', 'POST', { title: 'Bug' }, c), env());
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe('FORBIDDEN');
    });

    it('validates title and labels before any upstream call', async () => {
      const c = await cookie();
      for (const body of [{ title: '' }, { title: 'ok', labels: ['bad label!'] }, { title: 'ok', labels: Array(30).fill('x') }]) {
        const response = await handleApiRequest(writeRequest('/api/repos/website/issues', 'POST', body, c), env());
        expect(response.status).toBe(400);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('requires triage to update labels/state', async () => {
      stubPermissions({ pull: true, triage: false, push: false });
      const c = await cookie();
      const response = await handleApiRequest(
        writeRequest('/api/repos/website/issues/7', 'PATCH', { state: 'closed' }, c),
        env()
      );
      expect(response.status).toBe(403);
    });

    it('updates state and labels with triage access', async () => {
      stubPermissions({ triage: true }, (url, init) => {
        expect(url.pathname).toBe('/repos/ankworks/website/issues/7');
        expect(init?.method).toBe('PATCH');
        return json({ number: 7, state: 'closed', html_url: 'u', id: 5 });
      });
      const c = await cookie();
      const response = await handleApiRequest(
        writeRequest('/api/repos/website/issues/7', 'PATCH', { state: 'closed', labels: ['done'] }, c),
        env()
      );
      expect(response.status).toBe(200);
    });

    it('rejects empty updates and bad states', async () => {
      const c = await cookie();
      expect((await handleApiRequest(writeRequest('/api/repos/website/issues/7', 'PATCH', {}, c), env())).status).toBe(400);
      expect((await handleApiRequest(writeRequest('/api/repos/website/issues/7', 'PATCH', { state: 'locked' }, c), env())).status).toBe(400);
    });
  });

  describe('comments and reviews', () => {
    it('posts an issue comment with read access', async () => {
      stubPermissions({ pull: true }, (url) => {
        expect(url.pathname).toBe('/repos/ankworks/website/issues/7/comments');
        return json({ id: 33, body: 'hello' });
      });
      const c = await cookie();
      const response = await handleApiRequest(
        writeRequest('/api/repos/website/issues/7/comments', 'POST', { body: 'hello' }, c),
        env()
      );
      expect(response.status).toBe(200);
    });

    it('rejects empty comments', async () => {
      const c = await cookie();
      const response = await handleApiRequest(writeRequest('/api/repos/website/issues/7/comments', 'POST', { body: '  ' }, c), env());
      expect(response.status).toBe(400);
    });

    it('requires triage access for reviews and validates the event', async () => {
      const c = await cookie();
      const bad = await handleApiRequest(
        writeRequest('/api/repos/website/pulls/7/reviews', 'POST', { event: 'MERGE', body: 'x' }, c),
        env()
      );
      expect(bad.status).toBe(400);

      stubPermissions({ pull: true, triage: false });
      const denied = await handleApiRequest(
        writeRequest('/api/repos/website/pulls/7/reviews', 'POST', { event: 'COMMENT', body: 'x' }, c),
        env()
      );
      expect(denied.status).toBe(403);

      stubPermissions({ triage: true }, (url, init) => {
        expect(url.pathname).toBe('/repos/ankworks/website/pulls/7/reviews');
        const body = JSON.parse(String(init?.body)) as Record<string, string>;
        expect(body).toEqual({ event: 'APPROVE', body: '' });
        return json({ id: 1, state: 'approved' });
      });
      const ok = await handleApiRequest(
        writeRequest('/api/repos/website/pulls/7/reviews', 'POST', { event: 'APPROVE' }, c),
        env()
      );
      expect(ok.status).toBe(200);
    });

    it('requires a body for COMMENT and REQUEST_CHANGES reviews', async () => {
      const c = await cookie();
      const response = await handleApiRequest(
        writeRequest('/api/repos/website/pulls/7/reviews', 'POST', { event: 'REQUEST_CHANGES' }, c),
        env()
      );
      expect(response.status).toBe(400);
    });
  });

  describe('pull requests', () => {
    it('opens a PR with read access and validated branches', async () => {
      stubPermissions({ pull: true }, (url, init) => {
        expect(url.pathname).toBe('/repos/ankworks/website/pulls');
        const body = JSON.parse(String(init?.body)) as Record<string, string>;
        expect(body).toEqual({ title: 'Add feature', body: 'why', head: 'feature/x', base: 'main' });
        return json({ number: 3, state: 'open', html_url: 'u', id: 8 });
      });
      const c = await cookie();
      const response = await handleApiRequest(
        writeRequest('/api/repos/website/pulls', 'POST', { title: 'Add feature', body: 'why', head: 'feature/x', base: 'main' }, c),
        env()
      );
      expect(response.status).toBe(200);
    });

    it('rejects malformed PR input before upstream calls', async () => {
      const c = await cookie();
      for (const body of [{ title: '', head: 'a', base: 'main' }, { title: 'ok', head: '../x', base: 'main' }, { title: 'ok', head: 'a', base: '' }]) {
        const response = await handleApiRequest(writeRequest('/api/repos/website/pulls', 'POST', body, c), env());
        expect(response.status).toBe(400);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('merges only with write access and a valid merge method', async () => {
      const c = await cookie();
      const badMethod = await handleApiRequest(
        writeRequest('/api/repos/website/pulls/3/merge', 'PUT', { merge_method: 'fast-forward' }, c),
        env()
      );
      expect(badMethod.status).toBe(400);

      stubPermissions({ push: false, pull: true });
      const denied = await handleApiRequest(writeRequest('/api/repos/website/pulls/3/merge', 'PUT', { merge_method: 'merge' }, c), env());
      expect(denied.status).toBe(403);
      expect(seenUpstream().some((href) => href.includes('/merge'))).toBe(false);

      stubPermissions({ push: true }, (url, init) => {
        expect(url.pathname).toBe('/repos/ankworks/website/pulls/3/merge');
        expect(init?.method).toBe('PUT');
        expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${USER_TOKEN}`);
        return json({ merged: true, sha: 'f'.repeat(40) });
      });
      const ok = await handleApiRequest(writeRequest('/api/repos/website/pulls/3/merge', 'PUT', { merge_method: 'squash' }, c), env());
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { merged: boolean }).merged).toBe(true);
    });
  });

  describe('routing', () => {
    it('intercepts only write methods on collaboration paths', async () => {
      const { isCollabWriteRequest } = await import('../worker/collab-writes');
      expect(isCollabWriteRequest('POST', '/api/repos/website/issues')).toBe(true);
      expect(isCollabWriteRequest('POST', '/api/repos/website/issues/7/comments')).toBe(true);
      expect(isCollabWriteRequest('PATCH', '/api/repos/website/issues/7')).toBe(true);
      expect(isCollabWriteRequest('POST', '/api/repos/website/pulls')).toBe(true);
      expect(isCollabWriteRequest('POST', '/api/repos/website/pulls/7/reviews')).toBe(true);
      expect(isCollabWriteRequest('PUT', '/api/repos/website/pulls/7/merge')).toBe(true);
      // GET stays with the read-only routes; unrelated paths never match.
      expect(isCollabWriteRequest('GET', '/api/repos/website/issues/7')).toBe(false);
      expect(isCollabWriteRequest('GET', '/api/repos/website/pulls')).toBe(false);
      expect(isCollabWriteRequest('POST', '/api/repos/website/commit')).toBe(false);
      expect(isCollabWriteRequest('POST', '/api/repos/website/issues/7/labels')).toBe(false);
    });
  });
});
