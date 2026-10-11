// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleApiRequest } from '../worker/api';
import { encryptSession, SESSION_COOKIE, type SessionPayload } from '../worker/auth';
import { clearMembershipCache } from '../worker/membership';
import type { Env } from '../worker/env';

/**
 * V3-B: organization-only authorization for every write route.
 *
 * The matrix below is the security contract: guests and signed-in non-members
 * are read-only, unverifiable membership fails closed, and a verified member is
 * still bound by their real GitHub repository permission and by branch
 * protection.
 */

const ORIGIN = 'https://works.example.test';
const SESSION_KEY = 'authorization-test-key-0123456789abcdef';
const USER_TOKEN = 'oauth-user-token-abc';

type FetchMock = ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

function env(overrides: Partial<Env> = {}): Env {
  return { ASSETS: {} as Fetcher, SESSION_ENCRYPTION_KEY: SESSION_KEY, ...overrides } as Env;
}

async function cookieFor(login: string, id: number, token = USER_TOKEN): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    v: 1,
    user: { id, login, name: null, avatarUrl: '', htmlUrl: `https://github.com/${login}` },
    token,
    iat: now,
    exp: now + 3600,
  };
  return `${SESSION_COOKIE}=${encodeURIComponent(await encryptSession(payload, SESSION_KEY))}`;
}

function writeRequest(path: string, method: string, body: unknown, cookie: string | null, origin: string | null = ORIGIN): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (origin) headers.set('Origin', origin);
  if (cookie) headers.set('Cookie', cookie);
  return new Request(`${ORIGIN}${path}`, { method, headers, body: JSON.stringify(body ?? {}) });
}

interface Scenario {
  membership?: number | Record<string, unknown>;
  permissions?: Record<string, unknown> | number;
  branch?: { protected?: boolean; enforceAdmins?: boolean } | number;
}

/** Build the upstream stub for a scenario. */
function upstream({ membership = { state: 'active', role: 'member' }, permissions = { push: true }, branch }: Scenario) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), ORIGIN);
    const method = init?.method ?? 'GET';
    const p = url.pathname;

    if (p === '/user/memberships/orgs/ankworks') {
      return typeof membership === 'number' ? json({}, { status: membership }) : json(membership);
    }
    if (/^\/repos\/ankworks\/[^/]+\/branches\//.test(p)) {
      if (typeof branch === 'number') return json({}, { status: branch });
      // `protected` is the field GitHub returns on a branch; `protection` only
      // appears when the caller has admin rights.
      return json({ name: 'main', protected: branch?.protected === true, protection: { enforce_admins: { enabled: branch?.enforceAdmins === true } } });
    }
    if (/^\/repos\/ankworks\/[^/]+$/.test(p) && method === 'GET') {
      if (typeof permissions === 'number') return json({}, { status: permissions });
      // A public repository payload that passes the Worker's sanitizer, plus
      // the permission block the authorization guard reads.
      return json({
        id: 7,
        name: 'website',
        full_name: 'ankworks/website',
        private: false,
        html_url: 'https://github.com/ankworks/website',
        default_branch: 'main',
        owner: { login: 'ankworks' },
        permissions,
      });
    }
    // Start point resolution when creating a branch.
    if (/\/git\/ref\/heads\//.test(p)) return json({ object: { sha: 'a'.repeat(40) } });
    // Public read of the collaboration search endpoint.
    if (p === '/search/issues') return json({ items: [], total_count: 0, incomplete_results: false });
    // Any other public read (issue/PR listings) expects an array.
    if (method === 'GET') return json([]);
    // The write itself.
    return json({ number: 7, id: 99, state: 'open', merged: true, html_url: 'https://github.com/ankworks/website/issues/7' }, { status: 200 });
  };
}

let fetchMock: FetchMock;

beforeEach(() => {
  clearMembershipCache();
  fetchMock = vi.fn() as unknown as FetchMock;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('caches', {
    default: { match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearMembershipCache();
});

async function call(
  path: string,
  method: string,
  body: unknown,
  scenario: Scenario = {},
  options: { cookie?: string | null; origin?: string | null } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  fetchMock.mockImplementation(upstream(scenario) as unknown as FetchMock);
  const cookie = options.cookie === undefined ? await cookieFor('alice', 1001) : options.cookie;
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  const response = await handleApiRequest(writeRequest(path, method, body, cookie, origin), env());
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return { status: response.status, body: payload };
}

const ISSUE = { title: 'A real issue' };
const COMMENT = { body: 'A comment' };
const COMMIT = { message: 'm', content: 'x', branch: 'main', path: 'a.txt' };

describe('V3-B write authorization: guests and non-members are read-only', () => {
  it('refuses a guest with 401 on every write route', async () => {
    for (const [path, method, body] of [
      ['/api/repos/website/issues', 'POST', ISSUE],
      ['/api/repos/website/issues/7/comments', 'POST', COMMENT],
      ['/api/repos/website/issues/7', 'PATCH', { title: 'renamed' }],
      ['/api/repos/website/pulls', 'POST', { title: 't', head: 'a', base: 'main' }],
      ['/api/repos/website/pulls/7/reviews', 'POST', { event: 'APPROVE' }],
      ['/api/repos/website/pulls/7/merge', 'PUT', { merge_method: 'squash', confirm: true }],
      ['/api/repos/website/commit', 'POST', COMMIT],
      ['/api/repos/website/branches', 'POST', { name: 'feature/x', from: 'main' }],
    ] as Array<[string, string, unknown]>) {
      const result = await call(path, method, body, {}, { cookie: null });
      expect(result.status, `${method} ${path}`).toBe(401);
      expect(result.body.error).toBe('UNAUTHENTICATED');
    }
  });

  it('refuses a signed-in non-member with 403 on every write route', async () => {
    for (const [path, method, body] of [
      ['/api/repos/website/issues', 'POST', ISSUE],
      ['/api/repos/website/issues/7/comments', 'POST', COMMENT],
      ['/api/repos/website/issues/7', 'PATCH', { title: 'renamed' }],
      ['/api/repos/website/pulls', 'POST', { title: 't', head: 'a', base: 'main' }],
      ['/api/repos/website/pulls/7/reviews', 'POST', { event: 'APPROVE' }],
      ['/api/repos/website/pulls/7/merge', 'PUT', { merge_method: 'squash', confirm: true }],
      ['/api/repos/website/commit', 'POST', COMMIT],
      ['/api/repos/website/branches', 'POST', { name: 'feature/x', from: 'main' }],
    ] as Array<[string, string, unknown]>) {
      const result = await call(path, method, body, { membership: 404 });
      expect(result.status, `${method} ${path}`).toBe(403);
      expect(result.body.error).toBe('NOT_ORG_MEMBER');
    }
  });

  it('fails closed with 503 when membership cannot be verified', async () => {
    for (const membership of [500, 429]) {
      const result = await call('/api/repos/website/issues', 'POST', ISSUE, { membership });
      expect(result.status).toBe(503);
      expect(result.body.error).toBe('MEMBERSHIP_UNVERIFIABLE');
    }
  });

  it('does not interpret insufficient API scope as membership', async () => {
    // Primary check 403 (no read:org) + public membership 404 is ambiguous.
    fetchMock.mockImplementation((async (input: RequestInfo | URL) => {
      const url = new URL(String(input), ORIGIN);
      if (url.pathname === '/user/memberships/orgs/ankworks') return json({}, { status: 403 });
      if (/^\/orgs\/ankworks\/members\//.test(url.pathname)) return json({}, { status: 404 });
      return json({ permissions: { push: true } });
    }) as unknown as FetchMock);

    const response = await handleApiRequest(
      writeRequest('/api/repos/website/issues', 'POST', ISSUE, await cookieFor('alice', 1001)),
      env()
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as Record<string, unknown>).error).toBe('MEMBERSHIP_UNVERIFIABLE');
  });

  it('never performs the upstream write when authorization fails', async () => {
    await call('/api/repos/website/issues', 'POST', ISSUE, { membership: 404 });
    const writes = fetchMock.mock.calls.filter((entry) => (entry[1]?.method ?? 'GET') !== 'GET');
    expect(writes).toHaveLength(0);
  });

  it('allows a verified member with the required repository permission', async () => {
    const result = await call('/api/repos/website/issues', 'POST', ISSUE, {
      membership: { state: 'active', role: 'member' },
      permissions: { pull: true },
    });
    expect(result.status).toBe(200);
  });
});

describe('V3-B write authorization: real repository permission still applies', () => {
  it('refuses a member without triage access from closing an issue', async () => {
    const result = await call('/api/repos/website/issues/7', 'PATCH', { state: 'closed' }, { permissions: { pull: true } });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('FORBIDDEN');
  });

  it('refuses a member without write access from merging', async () => {
    const result = await call('/api/repos/website/pulls/7/merge', 'PUT', { merge_method: 'squash', confirm: true }, {
      permissions: { triage: true },
    });
    expect(result.status).toBe(403);
  });

  it('fails closed when repository permissions cannot be read', async () => {
    const result = await call('/api/repos/website/issues', 'POST', ISSUE, { permissions: 500 });
    expect(result.status).toBe(502);
    expect(result.body.error).toBe('GITHUB_AUTH_UNAVAILABLE');
  });
});

describe('V3-B: user-scoped writes only', () => {
  it('refuses a GitHub App installation token as the acting credential', async () => {
    const result = await call(
      '/api/repos/website/issues',
      'POST',
      ISSUE,
      {},
      { cookie: await cookieFor('alice', 1001, 'ghs_installationTokenValue') }
    );
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('FORBIDDEN');
  });

  it('refuses a GitHub App user-to-server token as the acting credential', async () => {
    const result = await call(
      '/api/repos/website/issues',
      'POST',
      ISSUE,
      {},
      { cookie: await cookieFor('alice', 1001, 'ghu_appUserTokenValue') }
    );
    expect(result.status).toBe(403);
  });

  it('performs the write with the user token, never the server GITHUB_TOKEN', async () => {
    await call('/api/repos/website/issues', 'POST', ISSUE, {}, {});
    const write = fetchMock.mock.calls.find((entry) => entry[0] === 'https://api.github.com/repos/ankworks/website/issues');
    expect(write).toBeDefined();
    const headers = write?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe(`Bearer ${USER_TOKEN}`);
  });
});

describe('V3-B: branch protection and rulesets', () => {
  it('refuses a direct commit to a protected branch', async () => {
    const result = await call('/api/repos/website/commit', 'POST', COMMIT, {
      permissions: { push: true },
      branch: { protected: true },
    });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('BRANCH_PROTECTED');
  });

  it('allows an organization/repository admin when protections do not apply to admins', async () => {
    const result = await call('/api/repos/website/commit', 'POST', COMMIT, {
      permissions: { admin: true },
      branch: { protected: true, enforceAdmins: false },
    });
    expect(result.status).toBe(200);
  });

  it('refuses even an admin when enforce_admins is on', async () => {
    const result = await call('/api/repos/website/commit', 'POST', COMMIT, {
      permissions: { admin: true },
      branch: { protected: true, enforceAdmins: true },
    });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('BRANCH_PROTECTED');
  });

  it('fails closed when branch protection cannot be read', async () => {
    const result = await call('/api/repos/website/commit', 'POST', COMMIT, {
      permissions: { push: true },
      branch: 500,
    });
    expect(result.status).toBe(503);
    expect(result.body.error).toBe('BRANCH_PROTECTION_UNKNOWN');
  });

  it('allows creating a branch (the new branch cannot be protected yet)', async () => {
    const result = await call('/api/repos/website/branches', 'POST', { name: 'feature/x', from: 'main' }, {
      permissions: { push: true },
    });
    expect(result.status).toBe(200);
  });
});

describe('V3-B: CSRF on state-changing routes', () => {
  it('refuses a cross-origin write even with a valid session', async () => {
    const result = await call('/api/repos/website/issues', 'POST', ISSUE, {}, { origin: 'https://evil.example.test' });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('CSRF_FAILED');
  });

  it('refuses a write with no Origin header at all', async () => {
    const result = await call('/api/repos/website/issues', 'POST', ISSUE, {}, { origin: null });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('CSRF_FAILED');
  });

  it('still allows public reads without an Origin header', async () => {
    fetchMock.mockImplementation(upstream({}) as unknown as FetchMock);
    const response = await handleApiRequest(new Request(`${ORIGIN}/api/repos/website/issues`), env());
    expect(response.status).toBe(200);
  });
});
