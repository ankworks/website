// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleApiRequest } from '../worker/api';
import { encryptSession, SESSION_COOKIE, type SessionPayload } from '../worker/auth';
import { clearMembershipCache } from '../worker/membership';
import { buildTemplate } from '../worker/issue-templates';
import type { Env } from '../worker/env';

/**
 * V3-C: issues, pull requests, reactions, Discussions, and issue templates.
 *
 * Every upstream call is mocked; no live GitHub credentials are used. The
 * emphasis is on authorization (V3-B still applies to every new write) and on
 * never inventing data: an absent tally stays absent.
 */

const ORIGIN = 'https://works.example.test';
const SESSION_KEY = 'session-encryption-key-0123456789abcdef';
const USER_TOKEN = 'oauth-user-token-555';
const CROSS_ORIGIN = 'https://evil.example.test';

type FetchMock = ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;
type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, options: { status?: number } | number = 200): Response {
  const status = typeof options === 'number' ? options : (options.status ?? 200);
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function env(): Env {
  return { ASSETS: {} as Fetcher, SESSION_ENCRYPTION_KEY: SESSION_KEY, GITHUB_TOKEN: 'ghp_SERVER_TOKEN' };
}

async function cookieFor(login = 'octocat'): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    v: 1,
    user: { id: 42, login, name: null, avatarUrl: '', htmlUrl: `https://github.com/${login}` },
    token: USER_TOKEN,
    iat: now,
    exp: now + 3600,
  };
  return encryptSession(payload, SESSION_KEY);
}

function request(path: string, method: string, body: unknown, cookie: string | null, origin: string | null = ORIGIN): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (origin) headers.set('Origin', origin);
  if (cookie) headers.set('Cookie', `${SESSION_COOKIE}=${encodeURIComponent(cookie)}`);
  return new Request(`${ORIGIN}${path}`, { method, headers, body: JSON.stringify(body ?? {}) });
}

function get(path: string): Request {
  return new Request(`${ORIGIN}${path}`, { method: 'GET', headers: { Accept: 'application/json' } });
}

interface Scenario {
  membership?: number | Record<string, unknown>;
  permissions?: Record<string, unknown> | number;
}

/** Public repository payload that passes the Worker's sanitizer. */
function publicRepo(permissions: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 7,
    name: 'website',
    full_name: 'ankworks/website',
    private: false,
    html_url: 'https://github.com/ankworks/website',
    default_branch: 'main',
    owner: { login: 'ankworks' },
    permissions,
  };
}

/**
 * Install the upstream stub.
 *
 * `graphql` receives the parsed GraphQL request body so a test can assert on
 * the operation name and the variables without depending on formatting.
 */
function stub({
  membership = { state: 'active', role: 'member' },
  permissions = { push: true, pull: true, triage: true },
  rest,
  graphql,
}: Scenario & { rest?: Handler; graphql?: (operationName: string, variables: Record<string, unknown>, init?: RequestInit) => Response | Promise<Response> } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), ORIGIN);
    const method = init?.method ?? 'GET';
    const path = url.pathname;

    if (path === '/user/memberships/orgs/ankworks') {
      return typeof membership === 'number' ? json({}, membership) : json(membership);
    }
    if (path === '/graphql') {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { operationName?: string; query?: string; variables?: Record<string, unknown> };
      const name = parsed.operationName ?? (/query\s+(\w+)/.exec(parsed.query ?? '')?.[1] ?? /mutation\s+(\w+)/.exec(parsed.query ?? '')?.[1] ?? '');
      if (graphql) return graphql(name, parsed.variables ?? {}, init);
      return json({ data: {} });
    }
    if (/^\/repos\/ankworks\/[^/]+$/.test(path) && method === 'GET') {
      return typeof permissions === 'number' ? json({}, permissions) : json(publicRepo(permissions));
    }
    if (/^\/repos\/ankworks\/[^/]+\/branches\//.test(path)) {
      return json({ name: 'main', protected: false, protection: { enforce_admins: { enabled: false } } });
    }
    if (rest) return rest(url, init);
    return json({}, 500);
  }) as unknown as FetchMock;
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function upstreamCalls(fetchMock: FetchMock): Array<{ path: string; method: string; body: unknown; auth: string | null }> {
  return fetchMock.mock.calls.map((call) => {
    const init = (call[1] ?? {}) as RequestInit;
    let body: unknown = null;
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    return {
      path: new URL(String(call[0]), ORIGIN).pathname,
      method: init.method ?? 'GET',
      body,
      auth: ((init.headers ?? {}) as Record<string, string>).Authorization ?? null,
    };
  });
}

let fetchMock: FetchMock;

beforeEach(() => {
  clearMembershipCache();
  fetchMock = vi.fn() as unknown as FetchMock;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('caches', { default: undefined, open: async () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

describe('V3-C reactions', () => {
  it('reads tallies publicly and never sends the server token as the viewer', async () => {
    const mock = stub({
      rest: (url, init) => {
        if (/\/reactions/.test(url.pathname) && (init?.method ?? 'GET') === 'GET') {
          return json([
            { id: 1, content: '+1', user: { login: 'alice' } },
            { id: 2, content: '+1', user: { login: 'bob' } },
            { id: 3, content: 'heart', user: { login: 'alice' } },
          ]);
        }
        return json({}, 500);
      },
    });
    const response = await handleApiRequest(get('/api/repos/website/reactions?kind=issue&target=7'), env());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { totalCount: number; reactions: Array<{ content: string; count: number; viewerHasReacted: boolean }> };
    expect(body.totalCount).toBe(3);
    // Canonical GitHub names, counted from GitHub's own rows, sorted by name.
    expect(body.reactions).toEqual([
      { content: 'HEART', count: 1, viewerHasReacted: false },
      { content: 'THUMBS_UP', count: 2, viewerHasReacted: false },
    ]);
    // The server token may be used for a public read, but never the viewer's identity.
    expect(upstreamCalls(mock)[0]?.path).toBe('/repos/ankworks/website/issues/7/reactions');
  });

  it('adds a reaction with the viewer\'s own token', async () => {
    const mock = stub({
      rest: (url, init) => {
        if (/\/reactions/.test(url.pathname)) {
          if ((init?.method ?? 'GET') === 'POST') return json({ id: 9, content: '+1' }, 201);
          return json([{ id: 9, content: '+1', user: { login: 'octocat' } }]);
        }
        return json({}, 500);
      },
    });
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/reactions', 'POST', { kind: 'issue', target: '7', content: 'HEART' }, cookie),
      env()
    );
    expect(response.status).toBe(200);
    const post = upstreamCalls(mock).find((call) => call.method === 'POST');
    expect(post?.path).toBe('/repos/ankworks/website/issues/7/reactions');
    expect(post?.auth).toBe(`Bearer ${USER_TOKEN}`);
    // The REST API spells the reaction `heart`; GraphQL spells it `HEART`.
    expect(post?.body).toEqual({ content: 'heart' });
    const body = (await response.json()) as { reactions: Array<{ viewerHasReacted: boolean }> };
    expect(body.reactions[0]?.viewerHasReacted).toBe(true);
  });

  it('removes only the viewer\'s own reaction — never an id supplied by the caller', async () => {
    const mock = stub({
      rest: (url, init) => {
        if (/\/reactions/.test(url.pathname)) {
          if ((init?.method ?? 'GET') === 'DELETE') return new Response(null, { status: 204 });
          if ((init?.method ?? 'GET') === 'GET') {
            return json([
              { id: 111, content: '+1', user: { login: 'someone-else' } },
              { id: 222, content: '+1', user: { login: 'octocat' } },
            ]);
          }
        }
        return json({}, 500);
      },
    });
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      // The caller tries to delete somebody else's reaction (id 111).
      request('/api/repos/website/reactions', 'DELETE', { kind: 'issue', target: '7', content: 'THUMBS_UP', reactionId: 111 }, cookie),
      env()
    );
    expect(response.status).toBe(200);
    const del = upstreamCalls(mock).find((call) => call.method === 'DELETE');
    expect(del?.path).toBe('/repos/ankworks/website/issues/7/reactions/222');
  });

  it('maps reactions on a pull request to GitHub\'s issues endpoint', async () => {
    const mock = stub({
      rest: (url, init) => {
        if (/\/reactions/.test(url.pathname)) {
          if ((init?.method ?? 'GET') === 'POST') return json({ id: 1, content: 'rocket' }, 201);
          return json([]);
        }
        return json({}, 500);
      },
    });
    const cookie = await cookieFor();
    await handleApiRequest(
      request('/api/repos/website/reactions', 'POST', { kind: 'pull', target: '12', content: 'ROCKET' }, cookie),
      env()
    );
    expect(upstreamCalls(mock).some((call) => call.path === '/repos/ankworks/website/issues/12/reactions')).toBe(true);
  });

  it('routes review-comment reactions to the pulls/comments endpoint', async () => {
    const mock = stub({
      rest: (url, init) => {
        if (/\/reactions/.test(url.pathname)) {
          if ((init?.method ?? 'GET') === 'POST') return json({ id: 1, content: 'eyes' }, 201);
          return json([]);
        }
        return json({}, 500);
      },
    });
    const cookie = await cookieFor();
    await handleApiRequest(
      request('/api/repos/website/reactions', 'POST', { kind: 'pull-comment', target: '555', content: 'EYES' }, cookie),
      env()
    );
    expect(upstreamCalls(mock).some((call) => call.path === '/repos/ankworks/website/pulls/comments/555/reactions')).toBe(true);
  });

  it('rejects an invented reaction', async () => {
    stub();
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/reactions', 'POST', { kind: 'issue', target: '7', content: 'PARTY_PARROT' }, cookie),
      env()
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('INVALID_REACTION');
  });

  it('rejects a target that is not an id', async () => {
    stub();
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/reactions', 'POST', { kind: 'issue', target: '7; DROP TABLE', content: 'HEART' }, cookie),
      env()
    );
    expect(response.status).toBe(400);
  });

  describe('authorization', () => {
    it('refuses guests', async () => {
      stub();
      const response = await handleApiRequest(
        request('/api/repos/website/reactions', 'POST', { kind: 'issue', target: '7', content: 'HEART' }, null),
        env()
      );
      expect(response.status).toBe(401);
    });

    it('refuses a signed-in non-member', async () => {
      // `{}` is what GitHub returns for a user with no membership: not an error,
      // simply not a member. Forge must not read that as permission to write.
      stub({ membership: {} });
      const cookie = await cookieFor();
      const response = await handleApiRequest(
        request('/api/repos/website/reactions', 'POST', { kind: 'issue', target: '7', content: 'HEART' }, cookie),
        env()
      );
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe('NOT_ORG_MEMBER');
    });

    it('refuses a member whose membership cannot be verified (fail closed)', async () => {
      stub({ membership: 500 });
      const cookie = await cookieFor();
      const response = await handleApiRequest(
        request('/api/repos/website/reactions', 'POST', { kind: 'issue', target: '7', content: 'HEART' }, cookie),
        env()
      );
      expect(response.status).toBe(503);
    });

    it('refuses cross-origin reaction writes', async () => {
      stub();
      const cookie = await cookieFor();
      const response = await handleApiRequest(
        request('/api/repos/website/reactions', 'POST', { kind: 'issue', target: '7', content: 'HEART' }, cookie, CROSS_ORIGIN),
        env()
      );
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe('CSRF_FAILED');
    });
  });
});

// ---------------------------------------------------------------------------
// Issue editing, comments, pull requests
// ---------------------------------------------------------------------------

describe('V3-C issue and pull request editing', () => {
  it('sends body, assignees, milestone, and state_reason on an issue update', async () => {
    const mock = stub({
      rest: (url, init) => {
        if (url.pathname === '/repos/ankworks/website/issues/7' && (init?.method ?? 'GET') === 'PATCH') {
          return json({ number: 7, id: 1, state: 'closed', html_url: 'u', title: 't' });
        }
        return json({}, 500);
      },
    });
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request(
        '/api/repos/website/issues/7',
        'PATCH',
        { body: 'new body', assignees: ['alice', 'bob'], milestone: 3, state: 'closed', state_reason: 'not_planned' },
        cookie
      ),
      env()
    );
    expect(response.status).toBe(200);
    const patch = upstreamCalls(mock).find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({
      body: 'new body',
      assignees: ['alice', 'bob'],
      milestone: 3,
      state: 'closed',
      state_reason: 'not_planned',
    });
  });

  it('rejects an assignee that is not a GitHub login', async () => {
    stub();
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/issues/7', 'PATCH', { assignees: ['alice; rm -rf /'] }, cookie),
      env()
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('INVALID_ASSIGNEES');
  });

  it('edits a comment with the viewer\'s token', async () => {
    const mock = stub({
      rest: (url, init) => {
        if (url.pathname === '/repos/ankworks/website/issues/comments/42' && (init?.method ?? 'GET') === 'PATCH') {
          return json({ id: 42, body: 'edited' });
        }
        return json({}, 500);
      },
    });
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/comments/42', 'PATCH', { body: 'edited text' }, cookie),
      env()
    );
    expect(response.status).toBe(200);
    const patch = upstreamCalls(mock).find((call) => call.method === 'PATCH');
    expect(patch?.path).toBe('/repos/ankworks/website/issues/comments/42');
    expect(patch?.auth).toBe(`Bearer ${USER_TOKEN}`);
  });

  it('deletes a comment', async () => {
    const mock = stub({
      rest: (url, init) => {
        if (url.pathname === '/repos/ankworks/website/issues/comments/42' && (init?.method ?? 'GET') === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        return json({}, 500);
      },
    });
    const cookie = await cookieFor();
    const response = await handleApiRequest(request('/api/repos/website/comments/42', 'DELETE', {}, cookie), env());
    expect(response.status).toBe(200);
    expect(upstreamCalls(mock).some((call) => call.method === 'DELETE')).toBe(true);
  });

  it('refuses a comment edit from a non-member', async () => {
    stub({ membership: {} });
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/comments/42', 'PATCH', { body: 'hijacked' }, cookie),
      env()
    );
    expect(response.status).toBe(403);
  });

  it('edits a pull request title with triage access', async () => {
    const mock = stub({
      permissions: { pull: true, triage: true, push: false },
      rest: (url, init) => {
        if (url.pathname === '/repos/ankworks/website/pulls/7' && (init?.method ?? 'GET') === 'PATCH') {
          return json({ number: 7, id: 1, state: 'open', html_url: 'u', title: 'new' });
        }
        return json({}, 500);
      },
    });
    const cookie = await cookieFor();
    const response = await handleApiRequest(request('/api/repos/website/pulls/7', 'PATCH', { title: 'new' }, cookie), env());
    expect(response.status).toBe(200);
    const patch = upstreamCalls(mock).find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({ title: 'new' });
  });

  it('requires write access to retarget a pull request', async () => {
    stub({ permissions: { pull: true, triage: true, push: false } });
    const cookie = await cookieFor();
    const response = await handleApiRequest(request('/api/repos/website/pulls/7', 'PATCH', { base: 'release' }, cookie), env());
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe('FORBIDDEN');
  });

  it('refuses a merge without an explicit confirmation and never calls GitHub', async () => {
    const mock = stub();
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/pulls/7/merge', 'PUT', { merge_method: 'squash' }, cookie),
      env()
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('CONFIRMATION_REQUIRED');
    expect(upstreamCalls(mock).some((call) => call.path.endsWith('/merge'))).toBe(false);
  });

  it('merges once the confirmation is present', async () => {
    const mock = stub({
      rest: (url) => {
        if (url.pathname.endsWith('/merge')) return json({ merged: true, sha: 'a'.repeat(40), message: 'ok' });
        return json({}, 500);
      },
    });
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/pulls/7/merge', 'PUT', { merge_method: 'squash', confirm: true }, cookie),
      env()
    );
    expect(response.status).toBe(200);
    const put = upstreamCalls(mock).find((call) => call.method === 'PUT');
    expect(put?.path).toBe('/repos/ankworks/website/pulls/7/merge');
    expect(put?.body).toEqual({ merge_method: 'squash' });
  });
});

// ---------------------------------------------------------------------------
// Discussions (GraphQL)
// ---------------------------------------------------------------------------

const CATEGORY = { id: 'DIC_kwDOABC123', name: 'Announcements', emoji: ':mega:', slug: 'announcements', description: 'News', isAnswerable: false };

function discussionNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'D_kwDOABC456',
    number: 3,
    title: 'How do I deploy?',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    upvoteCount: 4,
    locked: false,
    url: 'https://github.com/ankworks/website/discussions/3',
    author: { login: 'alice', avatarUrl: 'https://avatars.test/alice', url: 'https://github.com/alice' },
    category: CATEGORY,
    reactionGroups: [{ content: 'THUMBS_UP', count: 2, viewerHasReacted: true }],
    answer: null,
    comments: { totalCount: 1 },
    ...overrides,
  };
}

describe('V3-C discussions', () => {
  it('lists discussion categories publicly', async () => {
    const mock = stub({
      graphql: (name) => {
        if (name === 'discussionCategories') {
          return json({ data: { repository: { discussionCategories: { nodes: [CATEGORY] } } } });
        }
        return json({ data: {} });
      },
    });
    const response = await handleApiRequest(get('/api/repos/website/discussions/categories'), env());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { enabled: boolean; categories: Array<{ name: string }> };
    expect(body.enabled).toBe(true);
    expect(body.categories[0]?.name).toBe('Announcements');
    const call = upstreamCalls(mock).find((entry) => entry.path === '/graphql');
    expect(call?.body).toMatchObject({ variables: { owner: 'ankworks', name: 'website' } });
  });

  it('reports Discussions as disabled instead of fabricating categories', async () => {
    stub({ graphql: () => json({ data: { repository: { discussionCategories: { nodes: [] } } } }) });
    const response = await handleApiRequest(get('/api/repos/website/discussions/categories'), env());
    const body = (await response.json()) as { enabled: boolean; categories: unknown[] };
    expect(body.enabled).toBe(false);
    expect(body.categories).toEqual([]);
  });

  it('lists discussions with pagination cursors', async () => {
    stub({
      graphql: (name) => {
        if (name === 'discussionList') {
          return json({
            data: {
              repository: {
                discussions: {
                  pageInfo: { hasNextPage: true, endCursor: 'CURSOR1', hasPreviousPage: false, startCursor: null },
                  nodes: [discussionNode()],
                },
              },
            },
          });
        }
        return json({ data: {} });
      },
    });
    const response = await handleApiRequest(get('/api/repos/website/discussions'), env());
    const body = (await response.json()) as { discussions: Array<{ number: number; answered: boolean }>; pageInfo: { hasNextPage: boolean } };
    expect(body.discussions).toHaveLength(1);
    expect(body.discussions[0]?.number).toBe(3);
    expect(body.discussions[0]?.answered).toBe(false);
    expect(body.pageInfo.hasNextPage).toBe(true);
  });

  it('scopes discussion search to the organization repository', async () => {
    const mock = stub({
      graphql: (name) => {
        if (name === 'discussionSearch') {
          return json({ data: { search: { pageInfo: { hasNextPage: false }, nodes: [discussionNode()] } } });
        }
        return json({ data: {} });
      },
    });
    await handleApiRequest(get('/api/repos/website/discussions?q=deploy'), env());
    const call = upstreamCalls(mock).find((entry) => entry.path === '/graphql');
    expect((call?.body as { variables: { query: string } }).variables.query).toMatch(/^repo:ankworks\/website deploy$/);
  });

  it('returns 404 for a discussion GitHub does not return', async () => {
    stub({ graphql: () => json({ data: { repository: { discussion: null } } }) });
    const response = await handleApiRequest(get('/api/repos/website/discussions/3'), env());
    expect(response.status).toBe(404);
  });

  it('refuses to create a discussion as a guest', async () => {
    stub();
    const response = await handleApiRequest(
      request('/api/repos/website/discussions', 'POST', { title: 'Hi', body: 'there', categoryId: CATEGORY.id }, null),
      env()
    );
    expect(response.status).toBe(401);
  });

  it('refuses a cross-origin discussion creation', async () => {
    stub();
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/discussions', 'POST', { title: 'Hi', body: 'there', categoryId: CATEGORY.id }, cookie, CROSS_ORIGIN),
      env()
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe('CSRF_FAILED');
  });

  it('rejects a category node id that does not belong to the repository', async () => {
    stub({
      graphql: (name) => {
        if (name === 'discussionCategories') {
          return json({ data: { repository: { discussionCategories: { nodes: [CATEGORY] } } } });
        }
        return json({ data: {} });
      },
    });
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/discussions', 'POST', { title: 'Hi', body: 'there', categoryId: 'DIC_NOT_IN_THIS_REPO' }, cookie),
      env()
    );
    expect(response.status).toBe(403);
  });

  it('creates a discussion with the viewer\'s token and a verified category', async () => {
    const mock = stub({
      graphql: (name) => {
        if (name === 'discussionCategories') {
          return json({ data: { repository: { discussionCategories: { nodes: [CATEGORY] } } } });
        }
        if (name === 'repositoryId') return json({ data: { repository: { id: 'R_123' } } });
        if (name === 'createDiscussion') {
          return json({ data: { createDiscussion: { discussion: { id: 'D_1', number: 9, url: 'https://github.com/ankworks/website/discussions/9' } } } });
        }
        return json({ data: {} });
      },
    });
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/discussions', 'POST', { title: 'Hi', body: 'there', categoryId: CATEGORY.id }, cookie),
      env()
    );
    expect(response.status).toBe(201);
    const call = upstreamCalls(mock).find(
      (entry) => entry.path === '/graphql' && (entry.body as { operationName?: string }).operationName === 'createDiscussion'
    );
    expect((call?.body as { variables: Record<string, unknown> }).variables).toEqual({
      repositoryId: 'R_123',
      categoryId: CATEGORY.id,
      title: 'Hi',
      body: 'there',
    });
    expect(call?.auth).toBe(`Bearer ${USER_TOKEN}`);
  });

  it('surfaces GraphQL errors as failures instead of pretending the write worked', async () => {
    stub({
      graphql: () => json({ data: null, errors: [{ message: 'Resource not accessible by integration', type: 'FORBIDDEN' }] }),
    });
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/discussions', 'POST', { title: 'Hi', body: 'there', categoryId: CATEGORY.id }, cookie),
      env()
    );
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe('GRAPHQL_ERROR');
  });

  it('refuses to comment on a locked discussion', async () => {
    stub({
      graphql: (name) => {
        if (name === 'discussionDetail') {
          return json({ data: { repository: { discussion: discussionNode({ locked: true, body: 'b', viewerCanUpdate: false, viewerCanDelete: false, comments: { totalCount: 0, nodes: [], pageInfo: { hasNextPage: false } } }) } } });
        }
        return json({ data: {} });
      },
    });
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/discussions/3/comments', 'POST', { body: 'me too' }, cookie),
      env()
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe('LOCKED');
  });

  it('adds a reply through parentCommentId', async () => {
    const mock = stub({
      graphql: (name, variables) => {
        if (name === 'discussionDetail') {
          return json({ data: { repository: { discussion: discussionNode({ body: 'b', comments: { totalCount: 0, nodes: [], pageInfo: { hasNextPage: false } } }) } } });
        }
        if (name === 'addDiscussionReply') {
          expect(variables.parentCommentId).toBe('DC_kwDOABC789');
          return json({ data: { addDiscussionReply: { comment: { id: 'DC_2', url: 'https://github.com/x' } } } });
        }
        return json({ data: {} });
      },
    });
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/discussions/3/comments', 'POST', { body: 'nested', parentCommentId: 'DC_kwDOABC789' }, cookie),
      env()
    );
    expect(response.status).toBe(201);
    expect(upstreamCalls(mock).some((entry) => String(entry.path) === '/graphql')).toBe(true);
  });

  it('requires write access to lock a discussion', async () => {
    stub({ permissions: { pull: true, triage: true, push: false } });
    const cookie = await cookieFor();
    const response = await handleApiRequest(request('/api/repos/website/discussions/3/lock', 'POST', {}, cookie), env());
    expect(response.status).toBe(403);
  });

  it('marks an answer only for a comment that belongs to the discussion', async () => {
    const comment = { id: 'DC_kwDOABC789', body: 'answer body', createdAt: '2026-01-01T00:00:00Z', updatedAt: null, isAnswer: false, viewerCanUpdate: false, viewerCanDelete: false, author: { login: 'alice', avatarUrl: null, url: 'u' }, reactionGroups: [], replies: { nodes: [] } };
    stub({
      graphql: (name) => {
        if (name === 'discussionDetail') {
          return json({ data: { repository: { discussion: discussionNode({ body: 'b', comments: { totalCount: 1, nodes: [comment], pageInfo: { hasNextPage: false } } }) } } });
        }
        if (name === 'markDiscussionCommentAsAnswer') return json({ data: { markDiscussionCommentAsAnswer: { discussion: { id: 'D_1' } } } });
        return json({ data: {} });
      },
    });
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/discussions/3/answer', 'POST', { commentId: 'DC_kwDOABC789' }, cookie),
      env()
    );
    expect(response.status).toBe(200);
  });

  it('refuses to mark a comment from another discussion as the answer', async () => {
    const comment = { id: 'DC_kwDOABC789', body: 'x', createdAt: 'd', updatedAt: null, isAnswer: false, viewerCanUpdate: false, viewerCanDelete: false, author: null, reactionGroups: [], replies: { nodes: [] } };
    stub({
      graphql: (name) => {
        if (name === 'discussionDetail') {
          return json({ data: { repository: { discussion: discussionNode({ body: 'b', comments: { totalCount: 1, nodes: [comment], pageInfo: { hasNextPage: false } } }) } } });
        }
        return json({ data: {} });
      },
    });
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/discussions/3/answer', 'POST', { commentId: 'DC_SOMEWHERE_ELSE' }, cookie),
      env()
    );
    expect(response.status).toBe(403);
  });

  it('reacts to a discussion through GraphQL with the viewer\'s token', async () => {
    const mock = stub({
      graphql: (name) => {
        if (name === 'addReaction') return json({ data: { addReaction: { reaction: { content: 'HOORAY' }, subject: { id: 'D_1' } } } });
        return json({ data: {} });
      },
    });
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/discussions/reactions', 'POST', { subjectId: 'D_kwDOABC456', content: 'HOORAY' }, cookie),
      env()
    );
    expect(response.status).toBe(204);
    const call = upstreamCalls(mock).find((entry) => entry.path === '/graphql');
    expect((call?.body as { variables: Record<string, unknown> }).variables).toEqual({ subjectId: 'D_kwDOABC456', content: 'HOORAY' });
    expect(call?.auth).toBe(`Bearer ${USER_TOKEN}`);
  });

  it('rejects a subject id that is not a GraphQL node id', async () => {
    stub();
    const cookie = await cookieFor();
    const response = await handleApiRequest(
      request('/api/repos/website/discussions/reactions', 'POST', { subjectId: 'D_1; DROP', content: 'HOORAY' }, cookie),
      env()
    );
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Issue templates
// ---------------------------------------------------------------------------

describe('V3-C issue templates', () => {
  it('reads the front matter of a classic Markdown template', () => {
    const template = buildTemplate(
      'bug_report.md',
      ['---', 'name: Bug report', 'about: Something is broken', 'title: "[BUG] "', 'labels: bug, triage', 'assignees: alice', '---', '', '## What happened', '', 'Steps to reproduce'].join('\n')
    );
    expect(template.name).toBe('Bug report');
    expect(template.about).toBe('Something is broken');
    expect(template.title).toBe('[BUG] ');
    expect(template.labels).toEqual(['bug', 'triage']);
    expect(template.assignees).toEqual(['alice']);
    expect(template.body).toContain('## What happened');
    expect(template.format).toBe('markdown');
    expect(template.parsed).toBe(true);
  });

  it('renders a GitHub issue form as static Markdown without executing it', () => {
    const template = buildTemplate(
      'config.yml',
      [
        '---',
        'name: Config help',
        'about: Ask about configuration',
        'body:',
        '  - type: markdown',
        '    attributes:',
        '      value: |',
        '        Thanks for filing this.',
        '  - type: input',
        '    attributes:',
        '      label: Version',
        '      description: Which version?',
        '  - type: dropdown',
        '    attributes:',
        '      label: Area',
        '      options:',
        '        - auth',
        '        - explorer',
        '  - type: checkboxes',
        '    attributes:',
        '      label: Checklist',
        '      options:',
        '        - label: I searched',
        '---',
      ].join('\n')
    );
    expect(template.format).toBe('yaml-form');
    expect(template.parsed).toBe(true);
    expect(template.body).toContain('**Version**');
    expect(template.body).toContain('Which version?');
    expect(template.body).toContain('_Choose one:_ auth, explorer');
    expect(template.body).toContain('- [ ] I searched');
  });

  it('marks a form it cannot understand as unparsed so the UI can say so', () => {
    const template = buildTemplate('weird.yml', ['---', 'name: Weird', 'body:', '  - something: unexpected', '---'].join('\n'));
    expect(template.parsed).toBe(false);
  });

  it('serves templates publicly with caching headers', async () => {
    stub({
      rest: (url) => {
        if (url.pathname === '/repos/ankworks/website/contents/.github/ISSUE_TEMPLATE') {
          return json([{ name: 'bug_report.md', type: 'file', size: 512 }]);
        }
        if (url.pathname === '/repos/ankworks/website/contents/.github/ISSUE_TEMPLATE/bug_report.md') {
          return json({ encoding: 'base64', content: Buffer.from('---\nname: Bug\n---\n\nDescribe the bug\n', 'utf8').toString('base64') });
        }
        return json({}, 404);
      },
    });
    const response = await handleApiRequest(get('/api/repos/website/issue-templates'), env());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { enabled: boolean; templates: Array<{ name: string; body: string }> };
    expect(body.enabled).toBe(true);
    expect(body.templates[0]?.name).toBe('Bug');
    expect(body.templates[0]?.body).toBe('Describe the bug');
    expect(response.headers.get('Cache-Control')).toMatch(/public/);
  });

  it('reports no templates instead of inventing one', async () => {
    stub({ rest: () => json({}, 404) });
    const response = await handleApiRequest(get('/api/repos/website/issue-templates'), env());
    const body = (await response.json()) as { enabled: boolean; templates: unknown[] };
    expect(body.enabled).toBe(false);
    expect(body.templates).toEqual([]);
  });
});
