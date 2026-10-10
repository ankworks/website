// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleApiRequest } from '../worker/api';
import { decryptSession, encryptSession, SESSION_COOKIE, OAUTH_STATE_COOKIE, type SessionPayload } from '../worker/auth';
import type { Env } from '../worker/env';

/**
 * Milestone B: OAuth login/callback, encrypted session cookies, logout,
 * and permission detection against a mocked GitHub upstream.
 *
 * Invariants under test: the access token never appears in any response body,
 * cookies are HttpOnly/Secure/SameSite=Lax, CSRF state mismatches fail closed,
 * tampered/expired sessions are rejected, and permissions use the user token.
 */

const ORIGIN = 'https://works.example.test';
const CLIENT_ID = 'client-id-test';
const CLIENT_SECRET = 'client-secret-test';
const SESSION_KEY = 'session-encryption-key-0123456789abcdef';
const USER_TOKEN = 'ghu_SUPER_SECRET_TOKEN_123';

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: {} as Fetcher,
    GITHUB_APP_CLIENT_ID: CLIENT_ID,
    GITHUB_APP_CLIENT_SECRET: CLIENT_SECRET,
    SESSION_ENCRYPTION_KEY: SESSION_KEY,
    ...overrides,
  };
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

function setCookiesOf(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = response.headers.get('Set-Cookie');
  return single ? [single] : [];
}

function sessionCookieValue(cookies: string[]): string | null {
  for (const cookie of cookies) {
    const [pair] = cookie.split(';');
    const index = pair.indexOf('=');
    if (pair.slice(0, index).trim() === SESSION_COOKIE) return decodeURIComponent(pair.slice(index + 1));
  }
  return null;
}

async function signedSessionCookie(overrides: Partial<SessionPayload> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    v: 1,
    user: { id: 42, login: 'octocat', name: 'Octo Cat', avatarUrl: 'https://avatars.githubusercontent.com/u/42', htmlUrl: 'https://github.com/octocat' },
    token: USER_TOKEN,
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
  return encryptSession(payload, SESSION_KEY);
}

describe('auth routes', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function stubFetch(handler: Handler) {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), ORIGIN);
      return handler(url, init);
    });
    vi.stubGlobal('fetch', fetchMock);
  }

  beforeEach(() => {
    fetchMock = vi.fn(async () => json({}, 500));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('GET /api/auth/login', () => {
    it('redirects to GitHub OAuth with state bound to a CSRF cookie', async () => {
      stubFetch(() => json({}));
      const response = await handleApiRequest(request('/api/auth/login'), env());

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get('Location') ?? '');
      expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
      expect(location.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback`);
      expect(location.searchParams.get('scope')).toBe('read:user');
      const state = location.searchParams.get('state') ?? '';
      expect(state.length).toBeGreaterThan(20);

      const cookies = setCookiesOf(response);
      const stateCookie = cookies.find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`)) ?? '';
      expect(stateCookie).toContain(`=${encodeURIComponent(state)};`);
      expect(stateCookie).toContain('HttpOnly');
      expect(stateCookie).toContain('Secure');
      expect(stateCookie).toContain('SameSite=Lax');
      expect(stateCookie).toContain('Max-Age=600');
    });

    it('returns 503 AUTH_NOT_CONFIGURED when OAuth secrets are missing', async () => {
      const response = await handleApiRequest(request('/api/auth/login'), env({ GITHUB_APP_CLIENT_SECRET: undefined }));
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe('AUTH_NOT_CONFIGURED');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    it('rejects non-GET methods with Allow: GET', async () => {
      const response = await handleApiRequest(request('/api/auth/login', { method: 'POST' }), env());
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET');
    });
  });

  describe('GET /api/auth/session', () => {
    it('reports anonymous without a cookie', async () => {
      const response = await handleApiRequest(request('/api/auth/session'), env());
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({ authenticated: false, user: null, expiresAt: null, authEnabled: true });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    it('reports authEnabled=false when secrets are missing', async () => {
      const response = await handleApiRequest(request('/api/auth/session'), env({ SESSION_ENCRYPTION_KEY: undefined }));
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.authEnabled).toBe(false);
    });

    it('returns the user for a valid session and never leaks the token', async () => {
      const cookie = await signedSessionCookie();
      const response = await handleApiRequest(request('/api/auth/session', { headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(cookie)}` } }), env());
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain(USER_TOKEN);
      const body = JSON.parse(text) as Record<string, unknown>;
      expect(body.authenticated).toBe(true);
      expect(body.user).toEqual({
        id: 42,
        login: 'octocat',
        name: 'Octo Cat',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42',
        htmlUrl: 'https://github.com/octocat',
      });
      expect(typeof body.expiresAt).toBe('string');
    });

    it('fails closed on a tampered session cookie', async () => {
      const cookie = await signedSessionCookie();
      const flipped = cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A');
      const response = await handleApiRequest(request('/api/auth/session', { headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(flipped)}` } }), env());
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.authenticated).toBe(false);
    });

    it('rejects an expired session', async () => {
      const now = Math.floor(Date.now() / 1000);
      const cookie = await signedSessionCookie({ iat: now - 7200, exp: now - 3600 });
      const response = await handleApiRequest(request('/api/auth/session', { headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(cookie)}` } }), env());
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.authenticated).toBe(false);
    });

    it('rejects a session sealed with a different key', async () => {
      const now = Math.floor(Date.now() / 1000);
      const foreign = await encryptSession(
        { v: 1, user: { id: 1, login: 'mallory', name: null, avatarUrl: '', htmlUrl: '' }, token: 'x', iat: now, exp: now + 3600 },
        'a-completely-different-key-000000'
      );
      const response = await handleApiRequest(request('/api/auth/session', { headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(foreign)}` } }), env());
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.authenticated).toBe(false);
    });
  });

  describe('GET /api/auth/callback', () => {
    function callbackRequest(state: string | null, stateCookie: string | null, code = 'oauth-code'): Request {
      const query = new URLSearchParams();
      if (code) query.set('code', code);
      if (state) query.set('state', state);
      const headers: Record<string, string> = {};
      if (stateCookie !== null) headers.Cookie = `${OAUTH_STATE_COOKIE}=${encodeURIComponent(stateCookie)}`;
      return request(`/api/auth/callback?${query.toString()}`, { headers });
    }

    it('exchanges the code, seals a session cookie, and redirects home', async () => {
      stubFetch((url, init) => {
        if (url.href === 'https://github.com/login/oauth/access_token') {
          expect(init?.method).toBe('POST');
          const body = JSON.parse(String(init?.body)) as Record<string, string>;
          expect(body.client_id).toBe(CLIENT_ID);
          expect(body.client_secret).toBe(CLIENT_SECRET);
          expect(body.code).toBe('oauth-code');
          return json({ access_token: USER_TOKEN, token_type: 'bearer', scope: 'read:user' });
        }
        if (url.href === 'https://api.github.com/user') {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          expect(headers.Authorization).toBe(`Bearer ${USER_TOKEN}`);
          return json({ id: 42, login: 'octocat', name: 'Octo Cat', avatar_url: 'https://avatars.githubusercontent.com/u/42', html_url: 'https://github.com/octocat' });
        }
        return json({}, 500);
      });

      const response = await handleApiRequest(callbackRequest('state-abc', 'state-abc'), env());
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe(`${ORIGIN}/`);

      const cookies = setCookiesOf(response);
      const sealed = sessionCookieValue(cookies);
      expect(sealed).not.toBeNull();
      expect(sealed).not.toContain(USER_TOKEN);
      const sessionCookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? '';
      expect(sessionCookie).toContain('HttpOnly');
      expect(sessionCookie).toContain('Secure');
      expect(sessionCookie).toContain('SameSite=Lax');
      // The CSRF state cookie is cleared after a successful exchange.
      expect(cookies.some((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`) && c.includes('Max-Age=0'))).toBe(true);

      // Round-trip: the sealed cookie opens a valid session on /api/auth/session.
      const followUp = await handleApiRequest(
        request('/api/auth/session', { headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(sealed ?? '')}` } }),
        env()
      );
      const body = (await followUp.json()) as Record<string, unknown>;
      expect(body.authenticated).toBe(true);
      expect((body.user as Record<string, unknown>).login).toBe('octocat');
    });

    it('rejects a state mismatch without creating a session', async () => {
      stubFetch(() => json({ access_token: USER_TOKEN }));
      const response = await handleApiRequest(callbackRequest('state-abc', 'state-EVIL'), env());
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe(`${ORIGIN}/?auth_error=OAUTH_STATE_MISMATCH`);
      expect(sessionCookieValue(setCookiesOf(response))).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a missing state cookie', async () => {
      stubFetch(() => json({ access_token: USER_TOKEN }));
      const response = await handleApiRequest(callbackRequest('state-abc', null), env());
      expect(response.headers.get('Location')).toBe(`${ORIGIN}/?auth_error=OAUTH_STATE_MISMATCH`);
      expect(sessionCookieValue(setCookiesOf(response))).toBeNull();
    });

    it('maps a rejected code exchange to OAUTH_EXCHANGE_FAILED', async () => {
      stubFetch(() => json({ error: 'bad_verification_code', error_description: 'The code is wrong' }));
      const response = await handleApiRequest(callbackRequest('s1', 's1'), env());
      expect(response.headers.get('Location')).toBe(`${ORIGIN}/?auth_error=OAUTH_EXCHANGE_FAILED`);
      expect(sessionCookieValue(setCookiesOf(response))).toBeNull();
    });

    it('maps an upstream outage to OAUTH_EXCHANGE_FAILED', async () => {
      stubFetch(() => json({}, 502));
      const response = await handleApiRequest(callbackRequest('s1', 's1'), env());
      expect(response.headers.get('Location')).toBe(`${ORIGIN}/?auth_error=OAUTH_EXCHANGE_FAILED`);
    });

    it('maps a rejected user lookup to OAUTH_USER_FAILED', async () => {
      stubFetch((url) => {
        if (url.href === 'https://github.com/login/oauth/access_token') {
          return json({ access_token: USER_TOKEN });
        }
        return json({ message: 'Bad credentials' }, 401);
      });
      const response = await handleApiRequest(callbackRequest('s1', 's1'), env());
      expect(response.headers.get('Location')).toBe(`${ORIGIN}/?auth_error=OAUTH_USER_FAILED`);
      expect(sessionCookieValue(setCookiesOf(response))).toBeNull();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears the session and state cookies', async () => {
      const response = await handleApiRequest(request('/api/auth/logout', { method: 'POST' }), env());
      expect(response.status).toBe(200);
      const cookies = setCookiesOf(response);
      expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`) && c.includes('Max-Age=0'))).toBe(true);
      expect(cookies.some((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`) && c.includes('Max-Age=0'))).toBe(true);
    });

    it('rejects GET with Allow: POST', async () => {
      const response = await handleApiRequest(request('/api/auth/logout'), env());
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('POST');
    });
  });

  describe('GET /api/auth/permissions', () => {
    function permissionsRequest(owner: string, repo: string, cookie: string | null): Request {
      const headers: Record<string, string> = {};
      if (cookie) headers.Cookie = `${SESSION_COOKIE}=${encodeURIComponent(cookie)}`;
      return request(`/api/auth/permissions?owner=${owner}&repo=${repo}`, { headers });
    }

    it('requires a session (401 without cookie)', async () => {
      const response = await handleApiRequest(permissionsRequest('ankworks', 'website', null), env());
      expect(response.status).toBe(401);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('UNAUTHENTICATED');
    });

    it('maps admin permissions using the user token', async () => {
      stubFetch((url, init) => {
        expect(url.href).toBe('https://api.github.com/repos/ankworks/website');
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(headers.Authorization).toBe(`Bearer ${USER_TOKEN}`);
        return json({ id: 1, full_name: 'ankworks/website', permissions: { admin: true, maintain: true, push: true, triage: true, pull: true } });
      });
      const cookie = await signedSessionCookie();
      const response = await handleApiRequest(permissionsRequest('ankworks', 'website', cookie), env());
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({
        owner: 'ankworks',
        repo: 'website',
        canRead: true,
        canWrite: true,
        canTriage: true,
        canAdmin: true,
        role: 'admin',
        source: 'user-token',
      });
    });

    it('maps pull-only access to read-only capabilities', async () => {
      stubFetch(() => json({ id: 1, permissions: { admin: false, maintain: false, push: false, triage: false, pull: true } }));
      const cookie = await signedSessionCookie();
      const response = await handleApiRequest(permissionsRequest('ankworks', 'website', cookie), env());
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({
        owner: 'ankworks',
        repo: 'website',
        canRead: true,
        canWrite: false,
        canTriage: false,
        canAdmin: false,
        role: 'read',
        source: 'user-token',
      });
    });

    it('maps write access without admin to role "write"', async () => {
      stubFetch(() => json({ id: 1, permissions: { admin: false, maintain: false, push: true, triage: true, pull: true } }));
      const cookie = await signedSessionCookie();
      const response = await handleApiRequest(permissionsRequest('ankworks', 'website', cookie), env());
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.role).toBe('write');
      expect(body.canWrite).toBe(true);
      expect(body.canTriage).toBe(true);
      expect(body.canAdmin).toBe(false);
    });

    it('fails closed with 404 when the repository is invisible to the user', async () => {
      stubFetch(() => json({ message: 'Not Found' }, 404));
      const cookie = await signedSessionCookie();
      const response = await handleApiRequest(permissionsRequest('ankworks', 'secrets', cookie), env());
      expect(response.status).toBe(404);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('REPOSITORY_NOT_FOUND');
    });

    it('validates owner/repo parameters', async () => {
      const cookie = await signedSessionCookie();
      const response = await handleApiRequest(permissionsRequest('ankworks/evil', 'website', cookie), env());
      expect(response.status).toBe(400);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('INVALID_PARAMETER');
    });
  });

  describe('session crypto', () => {
    it('round-trips a payload and rejects garbage', async () => {
      const sealed = await signedSessionCookie();
      const opened = await decryptSession(sealed, SESSION_KEY);
      expect(opened?.user.login).toBe('octocat');
      expect(opened?.token).toBe(USER_TOKEN);
      expect(await decryptSession('not-a-cookie', SESSION_KEY)).toBeNull();
      expect(await decryptSession('a.b', SESSION_KEY)).toBeNull();
    });
  });

  describe('unknown /api/auth path', () => {
    it('returns 404', async () => {
      const response = await handleApiRequest(request('/api/auth/nope'), env());
      expect(response.status).toBe(404);
    });
  });
});
