// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { handleApiRequest } from '../worker/api';
import { clearMembershipCache } from '../worker/membership';
import { encryptSession, SESSION_COOKIE, type SessionPayload } from '../worker/auth';
import type { Env } from '../worker/env';
import { asD1, FakeD1 } from './helpers/fake-d1';

const ORIGIN = 'https://works.example.test';
const SESSION_KEY = 'test-encryption-key-32-chars-minimum!';

function payloadFor(login: string, id: number): SessionPayload {
  return {
    v: 1,
    user: { id, login, name: login, avatarUrl: '', htmlUrl: `https://github.com/${login}` },
    token: 'user-token',
    iat: 0,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

async function cookieFor(login: string, id: number): Promise<string> {
  return `${SESSION_COOKIE}=${encodeURIComponent(await encryptSession(payloadFor(login, id), SESSION_KEY))}`;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

function repoPayload(name: string): Record<string, unknown> {
  return {
    id: 7,
    name,
    full_name: `ankworks/${name}`,
    private: false,
    html_url: `https://github.com/ankworks/${name}`,
    default_branch: 'main',
    owner: { login: 'ankworks' },
  };
}

type FetchMock = Mock<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>;
let fetchMock: FetchMock;
let db: FakeD1;

function env(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: {} as Fetcher,
    SESSION_ENCRYPTION_KEY: SESSION_KEY,
    DB: asD1(db),
    ...overrides,
  } as Env;
}

/** Membership outcome + repository existence check. */
function stubGithub(options: { membership?: number | Record<string, unknown>; repoExists?: boolean }) {
  const { membership = 200, repoExists = true } = options;
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/user/memberships/orgs/ankworks')) {
      if (typeof membership === 'number') return json({ message: 'x' }, { status: membership });
      return json(membership);
    }
    if (/\/repos\/ankworks\/[^/]+$/.test(url)) {
      return repoExists ? json(repoPayload('website')) : json({ message: 'Not Found' }, { status: 404 });
    }
    return json({ message: 'Not Found' }, { status: 404 });
  });
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: { Origin: ORIGIN, ...(init.headers ?? {}) },
  });
}

beforeEach(() => {
  clearMembershipCache();
  db = new FakeD1();
  fetchMock = stubGithub({});
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('caches', {
    default: { match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearMembershipCache();
});

describe('GET /api/featured (public read)', () => {
  it('reports an empty, unconfigured list when D1 is missing instead of failing', async () => {
    const response = await handleApiRequest(request('/api/featured'), { ASSETS: {} as Fetcher } as Env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ items: [], configured: false });
    // Must never be shared-cached while unconfigured: it is a configuration answer.
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('lists pinned repositories in configured order', async () => {
    db = new FakeD1({
      featured_repos: [
        { repo: 'zeta', position: 1, added_at: '', added_by: 1 },
        { repo: 'alpha', position: 0, added_at: '', added_by: 1 },
      ],
    });
    const response = await handleApiRequest(request('/api/featured'), env());
    const body = (await response.json()) as { items: Array<{ repo: string; position: number }>; configured: boolean };
    expect(body.configured).toBe(true);
    expect(body.items.map((item) => item.repo)).toEqual(['alpha', 'zeta']);
    // Public data: shared caching is allowed.
    expect(response.headers.get('Cache-Control')).toContain('public');
  });

  it('rejects writes on the public endpoint', async () => {
    const response = await handleApiRequest(request('/api/featured', { method: 'POST', body: '{}' }), env());
    expect(response.status).toBe(405);
  });
});

describe('admin-only featured mutations', () => {
  async function pin(login: string, id: number, body: unknown, extra: RequestInit = {}) {
    const cookie = await cookieFor(login, id);
    return handleApiRequest(
      request('/api/admin/featured', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        ...extra,
      }),
      env()
    );
  }

  it('refuses guests and signed-in non-members', async () => {
    fetchMock = stubGithub({ membership: 404 });
    vi.stubGlobal('fetch', fetchMock);

    const anonymous = await handleApiRequest(
      request('/api/admin/featured', { method: 'POST', body: JSON.stringify({ repo: 'website' }) }),
      env()
    );
    expect(anonymous.status).toBe(401);

    const outsider = await pin('outsider', 2002, { repo: 'website' });
    expect(outsider.status).toBe(403);
    expect(((await outsider.json()) as Record<string, unknown>).error).toBe('NOT_ORG_MEMBER');
    expect(db.tables.featured_repos ?? []).toHaveLength(0);
  });

  it('fails closed when membership cannot be verified', async () => {
    fetchMock = stubGithub({ membership: 500 });
    vi.stubGlobal('fetch', fetchMock);

    const response = await pin('alice', 1001, { repo: 'website' });
    expect(response.status).toBe(503);
    expect(((await response.json()) as Record<string, unknown>).error).toBe('MEMBERSHIP_UNVERIFIABLE');
    expect(db.tables.featured_repos ?? []).toHaveLength(0);
  });

  it('refuses an ordinary member who is not a Forge admin', async () => {
    fetchMock = stubGithub({ membership: { state: 'active', role: 'member' } });
    vi.stubGlobal('fetch', fetchMock);

    const response = await pin('alice', 1001, { repo: 'website' });
    expect(response.status).toBe(403);
    expect(db.tables.featured_repos ?? []).toHaveLength(0);
  });

  it('lets an authorized Forge admin pin a real repository', async () => {
    fetchMock = stubGithub({ membership: { state: 'active', role: 'member' } });
    vi.stubGlobal('fetch', fetchMock);

    const response = await pin('alice', 1001, { repo: 'website' }, {});
    // alice is an ordinary member → denied unless configured as a Forge admin.
    expect(response.status).toBe(403);

    const adminEnv = env({ FORGE_ADMIN_LOGINS: 'alice' });
    const allowed = await handleApiRequest(
      request('/api/admin/featured', {
        method: 'POST',
        body: JSON.stringify({ repo: 'website' }),
        headers: { 'Content-Type': 'application/json', Cookie: await cookieFor('alice', 1001) },
      }),
      adminEnv
    );
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as Record<string, unknown>).status).toBe('pinned');
    expect(db.tables.featured_repos).toHaveLength(1);
    expect(db.tables.featured_repos?.[0]?.repo).toBe('website');
  });

  it('rejects a repository that is not a public AnkWorks repository', async () => {
    fetchMock = stubGithub({ membership: { state: 'active', role: 'admin' }, repoExists: false });
    vi.stubGlobal('fetch', fetchMock);

    const response = await pin('alice', 1001, { repo: 'website' });
    expect(response.status).toBe(400);
    expect(((await response.json()) as Record<string, unknown>).error).toBe('UNKNOWN_REPOSITORY');
  });

  it('rejects malformed repository names before touching the database', async () => {
    fetchMock = stubGithub({ membership: { state: 'active', role: 'admin' } });
    vi.stubGlobal('fetch', fetchMock);

    for (const repo of ['../etc', 'a/b', '', 'name with spaces']) {
      const response = await pin('alice', 1001, { repo });
      expect(response.status).toBe(400);
      expect(((await response.json()) as Record<string, unknown>).error).toBe('INVALID_REPO');
    }
    expect(db.tables.featured_repos ?? []).toHaveLength(0);
  });

  it('enforces CSRF: a cross-origin write is refused', async () => {
    fetchMock = stubGithub({ membership: { state: 'active', role: 'admin' } });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleApiRequest(
      new Request(`${ORIGIN}/api/admin/featured`, {
        method: 'POST',
        body: JSON.stringify({ repo: 'website' }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example.test',
          Cookie: await cookieFor('alice', 1001),
        },
      }),
      env()
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as Record<string, unknown>).error).toBe('CSRF_FAILED');
    expect(db.tables.featured_repos ?? []).toHaveLength(0);
  });

  it('refuses a state-changing request with no Origin header at all', async () => {
    fetchMock = stubGithub({ membership: { state: 'active', role: 'admin' } });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleApiRequest(
      new Request(`${ORIGIN}/api/admin/featured`, {
        method: 'POST',
        body: JSON.stringify({ repo: 'website' }),
        headers: { 'Content-Type': 'application/json', Cookie: await cookieFor('alice', 1001) },
      }),
      env()
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as Record<string, unknown>).error).toBe('CSRF_FAILED');
  });

  it('reorders pins and unpins, admin only', async () => {
    db = new FakeD1({
      featured_repos: [
        { repo: 'alpha', position: 0, added_at: '', added_by: 1 },
        { repo: 'beta', position: 1, added_at: '', added_by: 1 },
      ],
    });
    fetchMock = stubGithub({ membership: { state: 'active', role: 'admin' } });
    vi.stubGlobal('fetch', fetchMock);
    const cookie = await cookieFor('alice', 1001);

    const ordered = await handleApiRequest(
      request('/api/admin/featured/order', {
        method: 'POST',
        body: JSON.stringify({ repos: ['beta', 'alpha'] }),
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
      }),
      env()
    );
    expect(ordered.status).toBe(200);
    expect(db.tables.featured_repos?.map((row) => [row.repo, row.position])).toEqual([
      ['alpha', 1],
      ['beta', 0],
    ]);

    const removed = await handleApiRequest(
      request('/api/admin/featured/alpha', { method: 'DELETE', headers: { Cookie: cookie } }),
      env()
    );
    expect(removed.status).toBe(200);
    expect(db.tables.featured_repos?.map((row) => row.repo)).toEqual(['beta']);
  });

  it('enforces the pin limit', async () => {
    db = new FakeD1({
      featured_repos: Array.from({ length: 12 }, (_, index) => ({
        repo: `repo-${index}`,
        position: index,
        added_at: '',
        added_by: 1,
      })),
    });
    fetchMock = stubGithub({ membership: { state: 'active', role: 'admin' } });
    vi.stubGlobal('fetch', fetchMock);

    const response = await pin('alice', 1001, { repo: 'website' });
    expect(response.status).toBe(409);
    expect(((await response.json()) as Record<string, unknown>).error).toBe('FEATURED_LIMIT');
  });

  it('reports the feature as unavailable when D1 is not configured', async () => {
    fetchMock = stubGithub({ membership: { state: 'active', role: 'admin' } });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleApiRequest(
      request('/api/admin/featured', {
        method: 'POST',
        body: JSON.stringify({ repo: 'website' }),
        headers: { 'Content-Type': 'application/json', Cookie: await cookieFor('alice', 1001) },
      }),
      { ASSETS: {} as Fetcher, SESSION_ENCRYPTION_KEY: SESSION_KEY } as Env
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as Record<string, unknown>).error).toBe('FEATURED_NOT_CONFIGURED');
  });
});

describe('GET /api/auth/membership', () => {
  it('returns the guest status without any token and without caching it', async () => {
    const response = await handleApiRequest(request('/api/auth/membership'), env());
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ state: 'not-member', reason: 'unauthenticated', isMember: false });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('returns the verified membership for a signed-in member', async () => {
    fetchMock = stubGithub({ membership: { state: 'active', role: 'member' } });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleApiRequest(
      request('/api/auth/membership', { headers: { Cookie: await cookieFor('alice', 1001) } }),
      env()
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ state: 'member', isMember: true, login: 'alice' });
    // Never leak the access token.
    expect(JSON.stringify(body)).not.toContain('user-token');
  });
});
