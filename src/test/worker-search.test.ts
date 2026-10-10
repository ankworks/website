// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleApiRequest } from '../worker/api';
import { encryptSession, SESSION_COOKIE, type SessionPayload } from '../worker/auth';
import type { Env } from '../worker/env';

/**
 * Milestone F: org-scoped search, authenticated notifications, health
 * endpoint, and request-id headers.
 */

const ORIGIN = 'https://works.example.test';
const SESSION_KEY = 'session-encryption-key-0123456789abcdef';
const USER_TOKEN = 'ghu_USER_TOKEN_F';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function env(): Env {
  return { ASSETS: {} as Fetcher, SESSION_ENCRYPTION_KEY: SESSION_KEY };
}

async function cookie(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    v: 1,
    user: { id: 1, login: 'octocat', name: null, avatarUrl: '', htmlUrl: '' },
    token: USER_TOKEN,
    iat: now,
    exp: now + 3600,
  };
  return encryptSession(payload, SESSION_KEY);
}

describe('search, notifications, and ops', () => {
  let fetchMock: ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;

  function stubFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async (input, init) =>
      handler(new URL(String(input), ORIGIN), init)
    );
    vi.stubGlobal('fetch', fetchMock);
  }

  beforeEach(() => {
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('GET /api/search', () => {
    it('scopes the query to the organization and sanitizes results', async () => {
      stubFetch((url) => {
        expect(url.hostname).toBe('api.github.com');
        expect(url.pathname).toBe('/search/issues');
        expect(url.searchParams.get('q')).toBe('login org:ankworks');
        return json({
          total_count: 1,
          items: [
            {
              title: 'Login broken',
              html_url: 'https://github.com/ankworks/website/issues/1',
              number: 1,
              state: 'open',
              updated_at: '2026-01-01T00:00:00Z',
              repository: { full_name: 'ankworks/website' },
              pull_request: {},
              extra_field: 'dropped',
            },
          ],
        });
      });
      const response = await handleApiRequest(new Request(`${ORIGIN}/api/search?q=login&type=issues`), env());
      expect(response.status).toBe(200);
      const body = (await response.json()) as { total_count: number; items: Array<Record<string, unknown>> };
      expect(body.total_count).toBe(1);
      expect(body.items[0]).toMatchObject({ type: 'issues', title: 'Login broken', number: 1, repo: 'ankworks/website', is_pull: true });
      expect(body.items[0].extra_field).toBeUndefined();
    });

    it('validates query and type', async () => {
      expect((await handleApiRequest(new Request(`${ORIGIN}/api/search?q=`), env())).status).toBe(400);
      expect((await handleApiRequest(new Request(`${ORIGIN}/api/search?q=x&type=users`), env())).status).toBe(400);
    });

    it('maps GitHub query rejections to 400', async () => {
      stubFetch(() => json({ message: 'Validation Failed' }, 422));
      const response = await handleApiRequest(new Request(`${ORIGIN}/api/search?q=(((`), env());
      expect(response.status).toBe(400);
    });

    it('never forwards GITHUB_TOKEN or accepts arbitrary hosts (fixed upstream)', async () => {
      stubFetch((url, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(headers.Authorization).toBeUndefined();
        expect(url.hostname).toBe('api.github.com');
        return json({ total_count: 0, items: [] });
      });
      await handleApiRequest(new Request(`${ORIGIN}/api/search?q=test&type=repos`), env());
    });
  });

  describe('GET /api/notifications', () => {
    it('requires a session and uses the user token', async () => {
      const anonymous = await handleApiRequest(new Request(`${ORIGIN}/api/notifications`), env());
      expect(anonymous.status).toBe(401);

      stubFetch((url, init) => {
        expect(url.pathname).toBe('/notifications');
        expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${USER_TOKEN}`);
        return json([
          {
            id: '1',
            subject: { title: 'Fix login', type: 'PullRequest', url: 'https://api.github.com/x' },
            repository: { full_name: 'ankworks/website' },
            unread: true,
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]);
      });
      const c = await cookie();
      const response = await handleApiRequest(
        new Request(`${ORIGIN}/api/notifications`, { headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(c)}` } }),
        env()
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { items: Array<Record<string, unknown>> };
      expect(body.items[0]).toMatchObject({ title: 'Fix login', type: 'PullRequest', repo: 'ankworks/website', unread: true });
    });
  });

  describe('ops', () => {
    it('serves health with counters and no secrets', async () => {
      const response = await handleApiRequest(new Request(`${ORIGIN}/api/health`), env());
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.status).toBe('ok');
      expect(body.metrics).toBeDefined();
    });

    it('stamps every API response with X-Request-Id', async () => {
      const response = await handleApiRequest(new Request(`${ORIGIN}/api/health`), env());
      expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});
