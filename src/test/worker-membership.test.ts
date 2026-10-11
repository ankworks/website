// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { clearMembershipCache, requireForgeAdmin, verifyMembership } from '../worker/membership';
import { assertMemberWrite } from '../worker/featured';
import type { Env } from '../worker/env';
import type { SessionPayload } from '../worker/auth';
import { UpstreamError } from '../worker/github-client';

const USER = { v: 1 as const, user: { id: 1001, login: 'alice', name: 'Alice', avatarUrl: '', htmlUrl: '' } };

function session(token = 'user-token'): SessionPayload {
  return { ...USER, token, iat: 0, exp: Math.floor(Date.now() / 1000) + 3600 };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

/** Route the mocked GitHub API by path. */
function stub(routes: Record<string, () => Response>, fallbackStatus = 404) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = url.replace('https://api.github.com', '');
    for (const [pattern, handler] of Object.entries(routes)) {
      if (path.startsWith(pattern)) return handler();
    }
    return json({ message: 'Not Found' }, { status: fallbackStatus });
  });
}

type FetchMock = Mock<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>;
let fetchMock: FetchMock;

beforeEach(() => {
  clearMembershipCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearMembershipCache();
});

describe('organization membership verification', () => {
  it('reports guests as not signed in instead of "unverifiable"', async () => {
    const status = await verifyMembership(null, { ASSETS: {} as Fetcher } as Env);
    expect(status.state).toBe('not-member');
    expect(status.reason).toBe('unauthenticated');
    expect(status.isMember).toBe(false);
    // A guest is definitively not a member: no upstream call is needed.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verifies an active membership through the authoritative endpoint', async () => {
    fetchMock = stub({ '/user/memberships/orgs/ankworks': () => json({ state: 'active', role: 'admin' }) });
    vi.stubGlobal('fetch', fetchMock);

    const status = await verifyMembership(session(), { ASSETS: {} as Fetcher } as Env);
    expect(status.state).toBe('member');
    expect(status.isMember).toBe(true);
    expect(status.role).toBe('admin');
    expect(status.isOrgAdmin).toBe(true);
    expect(status.reason).toBe('org-membership');
  });

  it('treats a pending membership as not a member', async () => {
    fetchMock = stub({ '/user/memberships/orgs/ankworks': () => json({ state: 'pending', role: 'member' }) });
    vi.stubGlobal('fetch', fetchMock);

    const status = await verifyMembership(session(), { ASSETS: {} as Fetcher } as Env);
    expect(status.state).toBe('not-member');
    expect(status.reason).toBe('pending-membership');
  });

  it('reads a definitive 404 from the membership endpoint as "not a member"', async () => {
    fetchMock = stub({}, 404);
    vi.stubGlobal('fetch', fetchMock);

    const status = await verifyMembership(session(), { ASSETS: {} as Fetcher } as Env);
    expect(status.state).toBe('not-member');
    expect(status.reason).toBe('not-a-member');
  });

  it('accepts a public membership when the token cannot read private membership', async () => {
    fetchMock = stub(
      {
        '/user/memberships/orgs/ankworks': () => json({ message: 'Resource not accessible' }, { status: 403 }),
        '/orgs/ankworks/members/alice': () => new Response(null, { status: 204 }),
      },
      404
    );
    vi.stubGlobal('fetch', fetchMock);

    const status = await verifyMembership(session(), { ASSETS: {} as Fetcher } as Env);
    expect(status.state).toBe('member');
    expect(status.reason).toBe('public-membership');
    // Public membership says nothing about the org role: never claim admin.
    expect(status.isOrgAdmin).toBe(false);
  });

  it('FAILS CLOSED when insufficient scope hides a possibly private membership', async () => {
    fetchMock = stub(
      {
        '/user/memberships/orgs/ankworks': () => json({ message: 'Resource not accessible' }, { status: 403 }),
        // 404 here is ambiguous: not a member, or a private member we cannot see.
        '/orgs/ankworks/members/alice': () => json({ message: 'Not Found' }, { status: 404 }),
      },
      404
    );
    vi.stubGlobal('fetch', fetchMock);

    const status = await verifyMembership(session(), { ASSETS: {} as Fetcher } as Env);
    expect(status.state).toBe('unverifiable');
    expect(status.reason).toBe('insufficient-scope');
    expect(status.isMember).toBe(false);
  });

  it('FAILS CLOSED when the GitHub API is unreachable or rate limited', async () => {
    for (const response of [
      () => json({ message: 'rate limited' }, { status: 429, headers: { 'retry-after': '60' } }),
      () => json({ message: 'boom' }, { status: 500 }),
    ]) {
      clearMembershipCache();
      fetchMock = stub({ '/user/memberships/orgs/ankworks': response }, 502);
      vi.stubGlobal('fetch', fetchMock);
      const status = await verifyMembership(session(), { ASSETS: {} as Fetcher } as Env);
      expect(status.state).toBe('unverifiable');
      expect(status.reason).toBe('upstream-unavailable');
    }
  });

  it('never follows a redirect as proof of membership', async () => {
    fetchMock = stub(
      {
        '/user/memberships/orgs/ankworks': () =>
          new Response(null, { status: 302, headers: { Location: 'https://api.github.com/elsewhere' } }),
      },
      404
    );
    vi.stubGlobal('fetch', fetchMock);

    const status = await verifyMembership(session(), { ASSETS: {} as Fetcher } as Env);
    expect(status.state).toBe('unverifiable');
  });

  it('caches a verified result but never caches an outage', async () => {
    fetchMock = stub({ '/user/memberships/orgs/ankworks': () => json({ state: 'active', role: 'member' }) }, 404);
    vi.stubGlobal('fetch', fetchMock);

    const first = await verifyMembership(session(), { ASSETS: {} as Fetcher } as Env);
    expect(first.cached).toBe(false);
    const second = await verifyMembership(session(), { ASSETS: {} as Fetcher } as Env);
    expect(second.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clearMembershipCache();
    fetchMock = stub({ '/user/memberships/orgs/ankworks': () => json({}, { status: 500 }) }, 502);
    vi.stubGlobal('fetch', fetchMock);
    await verifyMembership(session(), { ASSETS: {} as Fetcher } as Env);
    const retry = await verifyMembership(session(), { ASSETS: {} as Fetcher } as Env);
    expect(retry.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the login proven by the token, not a client-supplied value', async () => {
    fetchMock = stub({ '/user/memberships/orgs/ankworks': () => json({ state: 'active', role: 'member' }) }, 404);
    vi.stubGlobal('fetch', fetchMock);

    const status = await verifyMembership(session(), { ASSETS: {} as Fetcher } as Env);
    const firstCall = fetchMock.mock.calls[0]?.[0] as string;
    expect(firstCall).toContain('/user/memberships/orgs/ankworks');
    expect(status.login).toBe('alice');
  });
});

describe('Forge administrator authorization', () => {
  it('grants access to a verified organization owner', async () => {
    fetchMock = stub({ '/user/memberships/orgs/ankworks': () => json({ state: 'active', role: 'admin' }) }, 404);
    vi.stubGlobal('fetch', fetchMock);

    const gate = await requireForgeAdmin(session(), { ASSETS: {} as Fetcher } as Env);
    expect(gate.granted).toBe(true);
  });

  it('denies an ordinary member who is not explicitly authorized', async () => {
    fetchMock = stub({ '/user/memberships/orgs/ankworks': () => json({ state: 'active', role: 'member' }) }, 404);
    vi.stubGlobal('fetch', fetchMock);

    const gate = await requireForgeAdmin(session(), { ASSETS: {} as Fetcher } as Env);
    expect(gate.granted).toBe(false);
    expect(gate.status.isMember).toBe(true);
  });

  it('grants access to a configured Forge admin who is only an ordinary member', async () => {
    fetchMock = stub({ '/user/memberships/orgs/ankworks': () => json({ state: 'active', role: 'member' }) }, 404);
    vi.stubGlobal('fetch', fetchMock);

    const gate = await requireForgeAdmin(session(), {
      ASSETS: {} as Fetcher,
      FORGE_ADMIN_LOGINS: 'bob, alice',
    } as Env);
    expect(gate.granted).toBe(true);
    expect(gate.status.isForgeAdmin).toBe(true);
  });

  it('denies a non-member even when they are listed as a Forge admin', async () => {
    fetchMock = stub({}, 404);
    vi.stubGlobal('fetch', fetchMock);

    const gate = await requireForgeAdmin(session(), {
      ASSETS: {} as Fetcher,
      FORGE_ADMIN_LOGINS: 'alice',
    } as Env);
    expect(gate.granted).toBe(false);
    expect(gate.status.state).toBe('not-member');
  });

  it('fails closed for administration when membership is unverifiable', async () => {
    fetchMock = stub({ '/user/memberships/orgs/ankworks': () => json({}, { status: 500 }) }, 502);
    vi.stubGlobal('fetch', fetchMock);

    const gate = await requireForgeAdmin(session(), { ASSETS: {} as Fetcher } as Env);
    expect(gate.granted).toBe(false);
    expect(gate.status.state).toBe('unverifiable');
  });
});

describe('assertMemberWrite (organization-only writes)', () => {
  it('requires a session', async () => {
    await expect(assertMemberWrite(null, { ASSETS: {} as Fetcher } as Env, 'test')).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('refuses a signed-in non-member with 403', async () => {
    fetchMock = stub({}, 404);
    vi.stubGlobal('fetch', fetchMock);

    const error = await assertMemberWrite(session(), { ASSETS: {} as Fetcher } as Env, 'test').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).status).toBe(403);
    expect((error as UpstreamError).code).toBe('NOT_ORG_MEMBER');
  });

  it('refuses an unverifiable membership with 503 (never a silent pass)', async () => {
    fetchMock = stub({ '/user/memberships/orgs/ankworks': () => json({}, { status: 500 }) }, 502);
    vi.stubGlobal('fetch', fetchMock);

    const error = await assertMemberWrite(session(), { ASSETS: {} as Fetcher } as Env, 'test').catch((e: unknown) => e);
    expect((error as UpstreamError).status).toBe(503);
    expect((error as UpstreamError).code).toBe('MEMBERSHIP_UNVERIFIABLE');
  });

  it('allows a verified member', async () => {
    fetchMock = stub({ '/user/memberships/orgs/ankworks': () => json({ state: 'active', role: 'member' }) }, 404);
    vi.stubGlobal('fetch', fetchMock);

    await expect(assertMemberWrite(session(), { ASSETS: {} as Fetcher } as Env, 'test')).resolves.toBeUndefined();
  });
});
