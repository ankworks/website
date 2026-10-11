// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleApiRequest } from '../worker/api';
import { encryptSession, SESSION_COOKIE, type SessionPayload } from '../worker/auth';
import { clearMembershipCache } from '../worker/membership';
import { FILE_CONTENT_MAX_BYTES } from '../shared/files';
import type { Env } from '../worker/env';

/**
 * Directive C: file management in the Worker.
 *
 * These tests assert the properties that matter, not the happy path:
 *
 * - authorization runs BEFORE any GitHub call, and fails closed;
 * - a duplicate file is never silently overwritten;
 * - a delete is verified against the blob sha the client loaded;
 * - a rename/move is ONE commit, and a concurrent branch update is refused
 *   rather than force-pushed;
 * - folders are created as `<directory>/.gitkeep`, because Git has no
 *   directories;
 * - the hidden Forge repository is unreachable here too.
 */

const ORIGIN = 'https://works.example.test';
const SESSION_KEY = 'session-encryption-key-0123456789abcdef';
// An ordinary user OAuth token. Never ghs_/ghu_: Forge refuses App tokens.
const USER_TOKEN = 'oauth-user-token-999';
const BLOB_A = 'a'.repeat(40);
const BLOB_B = 'b'.repeat(40);
const HEAD_SHA = '1'.repeat(40);
const TREE_SHA = '2'.repeat(40);
const NEW_TREE_SHA = '3'.repeat(40);
const NEW_COMMIT_SHA = '4'.repeat(40);

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response | null> | null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function env(): Env {
  return {
    ASSETS: {} as Fetcher,
    GITHUB_TOKEN: 'ghp_SERVER_TOKEN_MUST_NOT_BE_USED',
    SESSION_ENCRYPTION_KEY: SESSION_KEY,
    FORGE_SELF_REPO: 'website',
  };
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

function request(path: string, init: RequestInit = {}, cookie: string | null = null): Request {
  const headers = new Headers(init.headers);
  headers.set('Origin', ORIGIN);
  headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', `${SESSION_COOKIE}=${encodeURIComponent(cookie)}`);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

function crossOrigin(path: string, body: unknown, cookie: string): Request {
  const headers = new Headers({ 'Content-Type': 'application/json', Origin: 'https://evil.example.test' });
  headers.set('Cookie', `${SESSION_COOKIE}=${encodeURIComponent(cookie)}`);
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('file management routes', () => {
  let fetchMock: ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;

  function stub(overrides: Handler) {
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async (input, init) => {
      const url = new URL(String(input), ORIGIN);
      // The stub wins; `null` means "not handled" and falls through to the
      // defaults, so a test can override membership or branch protection.
      const handled = await overrides(url, init);
      if (handled) return handled;
      return withDefaults(url);
    });
    vi.stubGlobal('fetch', fetchMock);
  }

  /** Verified member, push permission, unprotected branch, no existing file. */
  function withDefaults(url: URL): Response {
    if (url.pathname === '/user/memberships/orgs/ankworks') return json({ state: 'active', role: 'member' });
    if (/^\/repos\/ankworks\/[^/]+\/branches\//.test(url.pathname)) return json({ name: 'main', protected: false });
    if (url.pathname === '/repos/ankworks/aurelia') return json({ permissions: { admin: true, push: true, pull: true } });
    throw new Error(`Unhandled upstream call in test: ${url.pathname}`);
  }

  function callsTo(method: string, pattern: RegExp): Array<{ url: URL; init?: RequestInit }> {
    return fetchMock.mock.calls
      .map((call) => ({ url: new URL(String(call[0]), ORIGIN), init: call[1] }))
      .filter((call) => (call.init?.method ?? 'GET') === method && pattern.test(call.url.pathname));
  }

  beforeEach(() => {
    clearMembershipCache();
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async () => json({}, 500));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // POST /api/repos/:repo/files — create
  // -------------------------------------------------------------------------

  describe('create', () => {
    const body = { path: 'docs/new.md', content: '# New\n', message: 'Add docs', branch: 'main' };

    it('refuses an unauthenticated request', async () => {
      stub(async () => json({}, 500));
      const response = await handleApiRequest(request('/api/repos/aurelia/files', { method: 'POST', body: JSON.stringify(body) }), env());
      expect(response.status).toBe(401);
      expect(((await response.json()) as { error: string }).error).toBe('UNAUTHENTICATED');
    });

    it('refuses a cross-origin request', async () => {
      stub(async () => json({}, 500));
      const cookie = await sessionCookie();
      const response = await handleApiRequest(crossOrigin('/api/repos/aurelia/files', body, cookie), env());
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe('CSRF_FAILED');
      // Nothing was sent to GitHub.
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('api.github.com'))).toBe(false);
    });

    it('refuses a signed-in non-member', async () => {
      stub(async (url) => {
        if (url.pathname === '/user/memberships/orgs/ankworks') return json({}, 404);
        if (url.pathname === '/user') return json({ login: 'octocat', id: 42 });
        if (url.pathname === '/orgs/ankworks/members/octocat') return json({}, 404);
        return null;
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files', { method: 'POST', body: JSON.stringify(body) }, cookie),
        env()
      );
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe('NOT_ORG_MEMBER');
    });

    it('refuses a member without push permission', async () => {
      stub(async (url) => {
        if (url.pathname === '/repos/ankworks/aurelia') return json({ permissions: { pull: true } });
        return null;
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files', { method: 'POST', body: JSON.stringify(body) }, cookie),
        env()
      );
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe('FORBIDDEN');
    });

    it('refuses a protected branch', async () => {
      // A repository admin is allowed through when protection does not enforce
      // admins, so this is an ordinary member with push access.
      stub(async (url) => {
        if (url.pathname === '/repos/ankworks/aurelia') return json({ permissions: { push: true, pull: true } });
        if (/^\/repos\/ankworks\/[^/]+\/branches\//.test(url.pathname)) return json({ name: 'main', protected: true });
        return null;
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files', { method: 'POST', body: JSON.stringify(body) }, cookie),
        env()
      );
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe('BRANCH_PROTECTED');
    });

    it('commits with the user token, never the server token', async () => {
      stub(async (url, init) => {
        if (url.pathname === '/repos/ankworks/aurelia/contents/docs/new.md' && init?.method === 'PUT') {
          return json({ commit: { sha: NEW_COMMIT_SHA, html_url: 'https://github.com/ankworks/aurelia/commit/x' }, content: { sha: BLOB_A, path: 'docs/new.md' } });
        }
        if (url.pathname === '/repos/ankworks/aurelia/contents/docs/new.md') return json({ message: 'Not Found' }, 404);
        return null;
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files', { method: 'POST', body: JSON.stringify(body) }, cookie),
        env()
      );
      expect(response.status).toBe(200);
      const put = callsTo('PUT', /contents/)[0];
      expect(put).toBeTruthy();
      const headers = (put?.init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${USER_TOKEN}`);
      expect(headers.Authorization).not.toContain('ghp_SERVER_TOKEN');
      const payload = JSON.parse(String(put?.init?.body ?? '{}')) as { content: string };
      expect(atob(payload.content)).toBe('# New\n');
    });

    it('refuses to overwrite an existing file', async () => {
      stub(async (url) => {
        if (url.pathname === '/repos/ankworks/aurelia/contents/docs/new.md') return json({ sha: BLOB_B, type: 'file' });
        return null;
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files', { method: 'POST', body: JSON.stringify(body) }, cookie),
        env()
      );
      expect(response.status).toBe(409);
      expect(((await response.json()) as { error: string }).error).toBe('FILE_EXISTS');
      expect(callsTo('PUT', /contents/)).toHaveLength(0);
    });

    it('accepts a replace when the blob sha is supplied', async () => {
      stub(async (url, init) => {
        if (url.pathname === '/repos/ankworks/aurelia/contents/docs/new.md' && init?.method === 'PUT') {
          return json({ commit: { sha: NEW_COMMIT_SHA, html_url: 'https://github.com/ankworks/aurelia/commit/x' }, content: { sha: BLOB_A, path: 'docs/new.md' } });
        }
        return null;
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files', { method: 'POST', body: JSON.stringify({ ...body, sha: BLOB_B }) }, cookie),
        env()
      );
      expect(response.status).toBe(200);
      const payload = JSON.parse(String(callsTo('PUT', /contents/)[0]?.init?.body ?? '{}')) as { sha: string };
      expect(payload.sha).toBe(BLOB_B);
    });

    it('rejects a path traversal', async () => {
      stub(async () => json({}, 500));
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files', { method: 'POST', body: JSON.stringify({ ...body, path: '../../etc/passwd' }) }, cookie),
        env()
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe('INVALID_PATH');
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('api.github.com'))).toBe(false);
    });

    it('rejects an invalid file name', async () => {
      stub(async () => json({}, 500));
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files', { method: 'POST', body: JSON.stringify({ directory: 'docs', name: '../evil.md', content: 'x', message: 'm', branch: 'main' }) }, cookie),
        env()
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe('INVALID_FILE_NAME');
    });

    it('joins a directory and a file name into the path', async () => {
      stub(async (url, init) => {
        if (url.pathname === '/repos/ankworks/aurelia/contents/src/index.ts' && init?.method === 'PUT') {
          return json({ commit: { sha: NEW_COMMIT_SHA, html_url: 'https://github.com/ankworks/aurelia/commit/x' }, content: { sha: BLOB_A, path: 'src/index.ts' } });
        }
        if (url.pathname === '/repos/ankworks/aurelia/contents/src/index.ts') return json({ message: 'Not Found' }, 404);
        return null;
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files', { method: 'POST', body: JSON.stringify({ directory: '/src/', name: 'index.ts', content: 'export {};', message: 'Add entry', branch: 'main' }) }, cookie),
        env()
      );
      expect(response.status).toBe(200);
      const result = (await response.json()) as { path: string };
      expect(result.path).toBe('src/index.ts');
    });

    it('rejects content above the size limit', async () => {
      stub(async () => json({}, 500));
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files', { method: 'POST', body: JSON.stringify({ ...body, content: 'x'.repeat(FILE_CONTENT_MAX_BYTES + 1) }) }, cookie),
        env()
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe('CONTENT_TOO_LARGE');
    });

    it('rejects an empty commit message', async () => {
      stub(async () => json({}, 500));
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files', { method: 'POST', body: JSON.stringify({ ...body, message: '   ' }) }, cookie),
        env()
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe('INVALID_MESSAGE');
    });

    it('creates the requested new branch first', async () => {
      const seen: string[] = [];
      stub(async (url, init) => {
        const method = init?.method ?? 'GET';
        if (url.pathname === '/repos/ankworks/aurelia/git/ref/heads/main' && method === 'GET') {
          return json({ object: { sha: HEAD_SHA } });
        }
        if (url.pathname === '/repos/ankworks/aurelia/git/refs' && method === 'POST') {
          seen.push('branch');
          return json({ ref: 'refs/heads/octocat/new-file', object: { sha: HEAD_SHA } });
        }
        if (url.pathname === '/repos/ankworks/aurelia/contents/docs/new.md' && method === 'GET') return json({ message: 'Not Found' }, 404);
        if (url.pathname === '/repos/ankworks/aurelia/contents/docs/new.md' && method === 'PUT') {
          seen.push('commit');
          return json({ commit: { sha: NEW_COMMIT_SHA, html_url: 'https://github.com/ankworks/aurelia/commit/x' }, content: { sha: BLOB_A, path: 'docs/new.md' } });
        }
        return null;
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files', { method: 'POST', body: JSON.stringify({ ...body, newBranch: 'octocat/new-file' }) }, cookie),
        env()
      );
      expect(response.status).toBe(200);
      const result = (await response.json()) as { branch: string; base_branch: string; new_branch: boolean };
      expect(result.branch).toBe('octocat/new-file');
      expect(result.base_branch).toBe('main');
      expect(result.new_branch).toBe(true);
      expect(seen).toEqual(['branch', 'commit']);
    });

    it('reports an existing new branch', async () => {
      stub(async (url) => {
        if (url.pathname === '/repos/ankworks/aurelia/git/ref/heads/main') return json({ object: { sha: HEAD_SHA } });
        if (url.pathname === '/repos/ankworks/aurelia/git/refs') return json({ message: 'Reference already exists' }, 422);
        return null;
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files', { method: 'POST', body: JSON.stringify({ ...body, newBranch: 'octocat/new-file' }) }, cookie),
        env()
      );
      expect(response.status).toBe(422);
      expect(((await response.json()) as { error: string }).error).toBe('BRANCH_EXISTS');
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/repos/:repo/files
  // -------------------------------------------------------------------------

  describe('delete', () => {
    const body = { path: 'docs/old.md', message: 'Remove old docs', branch: 'main', sha: BLOB_A };

    function deleteRequest(payload: unknown, cookie: string | null) {
      return request('/api/repos/aurelia/files', { method: 'DELETE', body: JSON.stringify(payload) }, cookie);
    }

    it('refuses a guest', async () => {
      stub(async () => json({}, 500));
      const response = await handleApiRequest(deleteRequest(body, null), env());
      expect(response.status).toBe(401);
      expect(((await response.json()) as { error: string }).error).toBe('UNAUTHENTICATED');
    });

    it('requires the blob sha', async () => {
      stub(async () => json({}, 500));
      const cookie = await sessionCookie();
      const response = await handleApiRequest(deleteRequest({ ...body, sha: 'not-a-sha' }, cookie), env());
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe('INVALID_BLOB_SHA');
    });

    it('deletes with the user token', async () => {
      stub(async (url, init) => {
        if (url.pathname === '/repos/ankworks/aurelia/contents/docs/old.md' && (init?.method ?? 'GET') === 'GET') {
          return json({ sha: BLOB_A, type: 'file', path: 'docs/old.md' });
        }
        if (url.pathname === '/repos/ankworks/aurelia/contents/docs/old.md' && init?.method === 'DELETE') {
          return json({ commit: { sha: NEW_COMMIT_SHA, html_url: 'https://github.com/ankworks/aurelia/commit/x' } });
        }
        return null;
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(deleteRequest(body, cookie), env());
      expect(response.status).toBe(200);
      const result = (await response.json()) as { path: string; branch: string; commit: { sha: string } };
      expect(result.path).toBe('docs/old.md');
      expect(result.commit.sha).toBe(NEW_COMMIT_SHA);
      const call = callsTo('DELETE', /contents/)[0];
      const headers = (call?.init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${USER_TOKEN}`);
    });

    it('refuses when the file changed since it was loaded', async () => {
      stub(async (url) => {
        if (url.pathname === '/repos/ankworks/aurelia/contents/docs/old.md') return json({ sha: BLOB_B, type: 'file' });
        return null;
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(deleteRequest(body, cookie), env());
      expect(response.status).toBe(409);
      expect(((await response.json()) as { error: string }).error).toBe('SHA_CONFLICT');
      expect(callsTo('DELETE', /contents/)).toHaveLength(0);
    });

    it('refuses a missing file', async () => {
      stub(async (url) => {
        if (url.pathname === '/repos/ankworks/aurelia/contents/docs/old.md') return json({ message: 'Not Found' }, 404);
        return null;
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(deleteRequest(body, cookie), env());
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe('FILE_NOT_FOUND');
    });

    it('refuses to delete a directory recursively', async () => {
      stub(async (url) => {
        if (url.pathname === '/repos/ankworks/aurelia/contents/docs') {
          return json([{ name: 'a.md', path: 'docs/a.md', type: 'file', sha: BLOB_A, size: 12 }]);
        }
        return null;
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        deleteRequest({ ...body, path: 'docs' }, cookie),
        env()
      );
      expect(response.status).toBe(422);
      expect(((await response.json()) as { error: string }).error).toBe('IS_DIRECTORY');
      expect(callsTo('DELETE', /contents/)).toHaveLength(0);
    });

    it('deletes only on an existing branch', async () => {
      stub(async () => json({}, 500));
      const cookie = await sessionCookie();
      const response = await handleApiRequest(deleteRequest({ ...body, newBranch: 'feature/x' }, cookie), env());
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe('INVALID_BRANCH');
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/repos/:repo/files/move
  // -------------------------------------------------------------------------

  describe('move', () => {
    const body = { from: 'docs/old.md', to: 'docs/new.md', message: 'Rename old.md', branch: 'main', sha: BLOB_A };

    /** Stub that serves a Git tree containing `docs/old.md` only. */
    function moveStub(options: { extra?: Array<{ path: string; sha: string }>; refStatus?: number } = {}) {
      const entries = [{ path: 'docs/old.md', mode: '100644', type: 'blob', sha: BLOB_A }, ...(options.extra ?? []).map((entry) => ({ mode: '100644', type: 'blob', ...entry }))];
      return async (url: URL, init?: RequestInit): Promise<Response | null> => {
        const method = init?.method ?? 'GET';
        if (url.pathname === '/repos/ankworks/aurelia/git/ref/heads/main' && method === 'GET') {
          return json({ object: { sha: HEAD_SHA } });
        }
        if (url.pathname === `/repos/ankworks/aurelia/git/commits/${HEAD_SHA}`) return json({ tree: { sha: TREE_SHA } });
        if (url.pathname === `/repos/ankworks/aurelia/git/trees/${TREE_SHA}`) return json({ sha: TREE_SHA, tree: entries, truncated: false });
        if (url.pathname === '/repos/ankworks/aurelia/git/trees' && method === 'POST') return json({ sha: NEW_TREE_SHA });
        if (url.pathname === '/repos/ankworks/aurelia/git/commits' && method === 'POST') return json({ sha: NEW_COMMIT_SHA });
        if (/^\/repos\/ankworks\/aurelia\/git\/refs\/heads\//.test(url.pathname) && method === 'PATCH') {
          if (options.refStatus) return json({ message: 'Update is not a fast forward' }, options.refStatus);
          return json({ object: { sha: NEW_COMMIT_SHA } });
        }
        return null;
      };
    }

    it('renames in ONE atomic commit and reports it honestly', async () => {
      stub(moveStub());
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files/move', { method: 'POST', body: JSON.stringify(body) }, cookie),
        env()
      );
      expect(response.status).toBe(200);
      const result = (await response.json()) as { atomic: boolean; commits: number; from: string; to: string };
      expect(result.atomic).toBe(true);
      expect(result.commits).toBe(1);
      expect(result.from).toBe('docs/old.md');
      expect(result.to).toBe('docs/new.md');

      // Exactly one commit and one ref update: never force-pushed, never two
      // commits with an intermediate state.
      expect(callsTo('POST', /\/git\/commits$/)).toHaveLength(1);
      expect(callsTo('PATCH', /\/git\/refs\/heads\//)).toHaveLength(1);

      const treeCall = callsTo('POST', /\/git\/trees$/)[0];
      const treePayload = JSON.parse(String(treeCall?.init?.body ?? '{}')) as {
        base_tree: string;
        tree: Array<{ path: string; sha: string | null }>;
      };
      expect(treePayload.base_tree).toBe(TREE_SHA);
      expect(treePayload.tree).toEqual([
        { path: 'docs/old.md', mode: '100644', type: 'blob', sha: null },
        { path: 'docs/new.md', mode: '100644', type: 'blob', sha: BLOB_A },
      ]);

      const refPayload = JSON.parse(String(callsTo('PATCH', /\/git\/refs\/heads\//)[0]?.init?.body ?? '{}')) as { force: boolean; sha: string };
      expect(refPayload).toEqual({ sha: NEW_COMMIT_SHA, force: false });
    });

    it('refuses a destination that already exists', async () => {
      stub(moveStub({ extra: [{ path: 'docs/new.md', sha: BLOB_B }] }));
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files/move', { method: 'POST', body: JSON.stringify(body) }, cookie),
        env()
      );
      expect(response.status).toBe(409);
      expect(((await response.json()) as { error: string }).error).toBe('DESTINATION_EXISTS');
      expect(callsTo('POST', /\/git\/commits$/)).toHaveLength(0);
    });

    it('refuses a source that does not exist', async () => {
      stub(moveStub());
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files/move', { method: 'POST', body: JSON.stringify({ ...body, from: 'docs/missing.md' }) }, cookie),
        env()
      );
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe('FILE_NOT_FOUND');
    });

    it('refuses an identical path', async () => {
      stub(moveStub());
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files/move', { method: 'POST', body: JSON.stringify({ ...body, to: 'docs/old.md' }) }, cookie),
        env()
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe('SAME_PATH');
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('api.github.com'))).toBe(false);
    });

    it('refuses when the file changed since it was loaded', async () => {
      stub(moveStub());
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files/move', { method: 'POST', body: JSON.stringify({ ...body, sha: BLOB_B }) }, cookie),
        env()
      );
      expect(response.status).toBe(409);
      expect(((await response.json()) as { error: string }).error).toBe('SHA_CONFLICT');
      expect(callsTo('POST', /\/git\/commits$/)).toHaveLength(0);
    });

    it('refuses instead of force-pushing when the branch moved', async () => {
      stub(moveStub({ refStatus: 409 }));
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files/move', { method: 'POST', body: JSON.stringify(body) }, cookie),
        env()
      );
      expect(response.status).toBe(409);
      expect(((await response.json()) as { error: string }).error).toBe('CONFLICT');
    });

    it('moves every file when the source is a directory', async () => {
      stub(moveStub({ extra: [{ path: 'docs/deep/other.md', sha: BLOB_B }] }));
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files/move', { method: 'POST', body: JSON.stringify({ from: 'docs', to: 'guides', message: 'Move docs', branch: 'main' }) }, cookie),
        env()
      );
      expect(response.status).toBe(200);
      const treePayload = JSON.parse(String(callsTo('POST', /\/git\/trees$/)[0]?.init?.body ?? '{}')) as {
        tree: Array<{ path: string; sha: string | null }>;
      };
      expect(treePayload.tree).toEqual([
        { path: 'docs/old.md', mode: '100644', type: 'blob', sha: null },
        { path: 'docs/deep/other.md', mode: '100644', type: 'blob', sha: null },
        { path: 'guides/old.md', mode: '100644', type: 'blob', sha: BLOB_A },
        { path: 'guides/deep/other.md', mode: '100644', type: 'blob', sha: BLOB_B },
      ]);
      // Still exactly one commit.
      expect(callsTo('POST', /\/git\/commits$/)).toHaveLength(1);
    });

    it('refuses a branch it cannot resolve', async () => {
      stub(async (url) => {
        if (/^\/repos\/ankworks\/aurelia\/git\/ref\/heads\//.test(url.pathname)) return json({ message: 'Not Found' }, 404);
        return null;
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files/move', { method: 'POST', body: JSON.stringify(body) }, cookie),
        env()
      );
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe('BRANCH_NOT_FOUND');
    });

    it('requires both paths', async () => {
      stub(async () => json({}, 500));
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files/move', { method: 'POST', body: JSON.stringify({ from: 'docs/old.md', message: 'm', branch: 'main' }) }, cookie),
        env()
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe('INVALID_PATH');
    });
  });

  // -------------------------------------------------------------------------
  // Routing and visibility
  // -------------------------------------------------------------------------

  describe('routing', () => {
    it('rejects GET on the file endpoints', async () => {
      stub(async () => json({}, 500));
      const response = await handleApiRequest(request('/api/repos/aurelia/files'), env());
      expect(response.status).toBe(405);
    });

    it('rejects POST on files/move?delete', async () => {
      stub(async () => json({}, 500));
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files/move', { method: 'DELETE', body: '{}' }, cookie),
        env()
      );
      expect(response.status).toBe(405);
    });

    it('serves 404 for the hidden Forge repository', async () => {
      stub(async () => json({}, 500));
      const cookie = await sessionCookie();
      for (const path of ['/api/repos/website/files', '/api/repos/website/files/move']) {
        const response = await handleApiRequest(
          request(path, { method: 'POST', body: JSON.stringify({ message: 'm', branch: 'main' }) }, cookie),
          env()
        );
        expect(response.status, path).toBe(404);
        expect(((await response.json()) as { error: string }).error).toBe('NOT_FOUND');
      }
    });

    it('never leaks the session token in an error body', async () => {
      stub(async (url) => {
        if (url.pathname === '/repos/ankworks/aurelia/contents/docs/new.md') return json({ message: `Bad credentials for ${USER_TOKEN}` }, 422);
        return null;
      });
      const cookie = await sessionCookie();
      const response = await handleApiRequest(
        request('/api/repos/aurelia/files', { method: 'POST', body: JSON.stringify({ path: 'docs/new.md', content: 'x', message: 'm', branch: 'main' }) }, cookie),
        env()
      );
      const text = await response.text();
      expect(text).not.toContain(USER_TOKEN);
      expect(text).not.toContain('ghp_SERVER_TOKEN');
    });
  });
});
