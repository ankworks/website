import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authApi } from '../api/auth';
import { ExplorerApiError } from '../api/explorer';
import type { AuthSessionResponse } from '../types/auth';

/**
 * Browser-side auth client: session lookup, logout, and permission detection.
 * Sessions are never cached and malformed payloads are rejected.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SESSION_OK: AuthSessionResponse = {
  authenticated: true,
  user: { id: 7, login: 'octocat', name: 'Octo Cat', avatarUrl: 'https://avatars.githubusercontent.com/u/7', htmlUrl: 'https://github.com/octocat' },
  expiresAt: '2026-02-01T00:00:00.000Z',
  authEnabled: true,
};

const PERMISSIONS_OK = {
  owner: 'ankworks',
  repo: 'website',
  canRead: true,
  canWrite: true,
  canTriage: true,
  canAdmin: false,
  role: 'write',
  source: 'user-token',
};

describe('authApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function lastRequest(): { url: string; init: RequestInit } {
    const [input, init] = fetchMock.mock.calls.at(-1) ?? [];
    return { url: String(input), init: (init ?? {}) as RequestInit };
  }

  describe('session', () => {
    it('returns a valid session payload', async () => {
      fetchMock.mockResolvedValueOnce(json(SESSION_OK));
      const session = await authApi.session();
      expect(session).toEqual(SESSION_OK);
      const { url, init } = lastRequest();
      expect(url).toBe('/api/auth/session');
      expect(init.credentials).toBe('same-origin');
    });

    it('returns the signed-out shape without throwing', async () => {
      fetchMock.mockResolvedValueOnce(json({ authenticated: false, user: null, expiresAt: null, authEnabled: false }));
      const session = await authApi.session();
      expect(session.authenticated).toBe(false);
      expect(session.authEnabled).toBe(false);
    });

    it('rejects malformed payloads with INVALID_RESPONSE', async () => {
      fetchMock.mockResolvedValueOnce(json({ authenticated: 'yes' }));
      await expect(authApi.session()).rejects.toMatchObject({ code: 'INVALID_RESPONSE', name: 'ExplorerApiError' });
    });

    it('surfaces the worker error code', async () => {
      fetchMock.mockResolvedValueOnce(json({ error: 'AUTH_NOT_CONFIGURED', message: 'nope', status: 503 }, 503));
      await expect(authApi.session()).rejects.toMatchObject({ code: 'AUTH_NOT_CONFIGURED', status: 503 });
    });

    it('maps network failures to NETWORK_ERROR', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('offline'));
      await expect(authApi.session()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });
  });

  describe('logout', () => {
    it('POSTs logout and resolves', async () => {
      fetchMock.mockResolvedValueOnce(json({ ok: true }));
      await authApi.logout();
      const { url, init } = lastRequest();
      expect(url).toBe('/api/auth/logout');
      expect(init.method).toBe('POST');
    });

    it('propagates failures', async () => {
      fetchMock.mockResolvedValueOnce(json({ error: 'METHOD_NOT_ALLOWED', message: 'no', status: 405 }, 405));
      await expect(authApi.logout()).rejects.toBeInstanceOf(ExplorerApiError);
    });
  });

  describe('permissions', () => {
    it('returns mapped permissions and encodes query parameters', async () => {
      fetchMock.mockResolvedValueOnce(json(PERMISSIONS_OK));
      const permissions = await authApi.permissions('ankworks', 'website');
      expect(permissions).toEqual(PERMISSIONS_OK);
      expect(lastRequest().url).toBe('/api/auth/permissions?owner=ankworks&repo=website');
    });

    it('rejects malformed permission payloads', async () => {
      fetchMock.mockResolvedValueOnce(json({ owner: 'ankworks' }));
      await expect(authApi.permissions('ankworks', 'website')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    it('fails closed when the worker rejects the request', async () => {
      fetchMock.mockResolvedValueOnce(json({ error: 'UNAUTHENTICATED', message: 'Sign in required.', status: 401 }, 401));
      await expect(authApi.permissions('ankworks', 'website')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    });
  });
});
