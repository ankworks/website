// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleApiRequest, parseNextLink, fetchAllPublicRepos } from '../worker/api';
import type { Env } from '../worker/env';

const ORIGIN = 'https://works.example.test';
const FIRST_PAGE_URL = 'https://api.github.com/orgs/ankworks/repos?type=public&per_page=100&page=1';
const SECOND_PAGE_URL = 'https://api.github.com/orgs/ankworks/repos?type=public&per_page=100&page=2';

function rawRepo(overrides: Record<string, unknown> = {}) {
  const id = (overrides.id as number) ?? 1;
  return {
    id,
    name: `repo-${id}`,
    full_name: `ankworks/repo-${id}`,
    private: false,
    description: 'A test repository',
    html_url: `https://github.com/ankworks/repo-${id}`,
    language: 'TypeScript',
    stargazers_count: 10,
    forks_count: 2,
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    archived: false,
    fork: false,
    size: 100,
    open_issues_count: 1,
    topics: ['web'],
    // Extra upstream fields must not leak into the response.
    owner: { login: 'ankworks', avatar_url: 'https://example.test/avatar.png' },
    secret_field: 'should-not-leak',
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

type CacheMock = {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

describe('parseNextLink', () => {
  it('extracts the next page URL from a Link header', () => {
    const header =
      '<https://api.github.com/orgs/ankworks/repos?page=2>; rel="next", <https://api.github.com/orgs/ankworks/repos?page=3>; rel="last"';
    expect(parseNextLink(header)).toBe('https://api.github.com/orgs/ankworks/repos?page=2');
  });

  it('returns null when there is no next link', () => {
    expect(parseNextLink(null)).toBeNull();
    expect(parseNextLink('<https://api.github.com/x?page=1>; rel="prev"')).toBeNull();
  });
});

describe('GET /api/repos handler', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let cache: CacheMock;
  const env: Env = { ASSETS: {} as Fetcher };

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    cache = {
      match: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal('caches', { default: cache });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const request = (path = '/api/repos', init?: RequestInit) =>
    new Request(`${ORIGIN}${path}`, init);

  it('returns sanitized public repositories with cache headers on a cache miss', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([rawRepo({ id: 1 }), rawRepo({ id: 2, private: true })]));

    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Cache')).toBe('MISS');
    expect(response.headers.get('Cache-Control')).toContain('max-age=300');

    const body = (await response.json()) as { repos: Array<Record<string, unknown>>; total_count: number; org: string };
    expect(body.org).toBe('ankworks');
    expect(body.total_count).toBe(1);
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0]).toMatchObject({ id: 1, name: 'repo-1', html_url: 'https://github.com/ankworks/repo-1' });
    expect(body.repos[0]).not.toHaveProperty('owner');
    expect(body.repos[0]).not.toHaveProperty('secret_field');
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('requests only public repositories with the required GitHub headers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await handleApiRequest(request(), env);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(FIRST_PAGE_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/AnkWorks/);
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers.Authorization).toBeUndefined();
    expect(init.signal).toBeDefined();
  });

  it('uses redirect mode "manual" (workerd rejects redirect:"error" with a TypeError)', async () => {
    // Regression test for the production 502 GITHUB_UNREACHABLE: workerd's fetch
    // only implements "follow" and "manual". "error" threw a TypeError before the
    // request was even sent, and that TypeError was misclassified as a network
    // failure to GitHub.
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(200);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe('manual');
  });

  it('follows a redirect that stays inside the allowlisted GitHub paths', async () => {
    const redirectTarget = 'https://api.github.com/orgs/ankworks/repos?type=public&per_page=100&page=1';
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { Location: redirectTarget } }))
      .mockResolvedValueOnce(jsonResponse([rawRepo({ id: 7 })]));

    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { repos: Array<{ id: number }> };
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0].id).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, redirectTarget, expect.anything());
  });

  it('rejects a redirect to a different origin without following it', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 301, headers: { Location: 'https://evil.example.test/repos' } })
    );
    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe('GITHUB_UPSTREAM_ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a redirect to another GitHub organization without following it', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 301, headers: { Location: 'https://api.github.com/orgs/other-org/repos' } })
    );
    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe('GITHUB_UPSTREAM_ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops following redirects after the maximum number of hops', async () => {
    for (let i = 0; i < 4; i += 1) {
      fetchMock.mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { Location: FIRST_PAGE_URL } })
      );
    }
    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe('GITHUB_UPSTREAM_ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('maps upstream 429 to GITHUB_RATE_LIMITED with Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'rate limited' }, { status: 429, headers: { 'retry-after': '45' } }));
    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('45');
    expect(((await response.json()) as { error: string }).error).toBe('GITHUB_RATE_LIMITED');
  });

  it('rejects invalid JSON bodies as GITHUB_RESPONSE_INVALID', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('not-json', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe('GITHUB_RESPONSE_INVALID');
  });

  it('serves fresh data and logs CACHE_ERROR when the cache read throws', async () => {
    cache.match.mockRejectedValueOnce(new Error('simulated cache failure'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Cache')).toBe('MISS');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const lines = warnSpy.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes('"event":"cache_failure"') && line.includes('"code":"CACHE_ERROR"'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('serves fresh data and logs CACHE_ERROR when the cache write rejects', async () => {
    cache.put.mockRejectedValueOnce(new Error('simulated cache failure'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(jsonResponse([rawRepo({ id: 9 })]));

    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Cache')).toBe('MISS');
    const lines = warnSpy.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes('"event":"cache_failure"') && line.includes('"stage":"cache_write"'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('sends the GITHUB_TOKEN secret upstream only, never in the response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([rawRepo({ id: 5 })]));
    const response = await handleApiRequest(request(), { ...env, GITHUB_TOKEN: 'unit-test-token-value' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer unit-test-token-value');
    const text = await response.text();
    expect(text).not.toContain('unit-test-token-value');
  });

  it('follows pagination until the Link header has no next page', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => rawRepo({ id: i + 1, name: `r${i + 1}` }));
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(page1, {
          headers: {
            'Content-Type': 'application/json',
            Link: `<${SECOND_PAGE_URL}>; rel="next", <${SECOND_PAGE_URL}>; rel="last"`,
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse([rawRepo({ id: 101, name: 'r101' })]));

    const repos = await fetchAllPublicRepos(env);
    expect(repos).toHaveLength(101);
    expect(repos[100].id).toBe(101);
    expect(fetchMock).toHaveBeenNthCalledWith(2, SECOND_PAGE_URL, expect.anything());
  });

  it('deduplicates repositories that appear on more than one page', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([rawRepo({ id: 1 })], { headers: { 'Content-Type': 'application/json', Link: `<${SECOND_PAGE_URL}>; rel="next"` } })
      )
      .mockResolvedValueOnce(jsonResponse([rawRepo({ id: 1 }), rawRepo({ id: 2 })]));

    const repos = await fetchAllPublicRepos(env);
    expect(repos.map((r) => r.id)).toEqual([1, 2]);
  });

  it('follows the numeric organization pagination links GitHub actually returns', async () => {
    const numericNext = 'https://api.github.com/organizations/340385619/repos?type=public&per_page=100&page=2';
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([rawRepo({ id: 1 })], { headers: { 'Content-Type': 'application/json', Link: `<${numericNext}>; rel="next"` } })
      )
      .mockResolvedValueOnce(jsonResponse([rawRepo({ id: 2 })]));

    const repos = await fetchAllPublicRepos(env);
    expect(repos.map((r) => r.id)).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenNthCalledWith(2, numericNext, expect.anything());
  });

  it('rejects pagination links to other GitHub endpoints on the same host', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([rawRepo({ id: 1 })], {
        headers: { 'Content-Type': 'application/json', Link: '<https://api.github.com/users/someone/repos?page=2>; rel="next"' },
      })
    );
    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(502);
  });

  it('does not follow pagination links that leave the GitHub organization endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([rawRepo({ id: 1 })], {
        headers: { 'Content-Type': 'application/json', Link: '<https://evil.example.test/steal>; rel="next"' },
      })
    );

    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe('GITHUB_RESPONSE_INVALID');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list for an organization without public repositories', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { repos: unknown[]; total_count: number };
    expect(body.repos).toEqual([]);
    expect(body.total_count).toBe(0);
  });

  it('serves a cached response without calling GitHub', async () => {
    cache.match.mockResolvedValueOnce(
      new Response(JSON.stringify({ org: 'ankworks', repos: [], total_count: 0, fetched_at: 'x' }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      })
    );

    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Cache')).toBe('HIT');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keys the cache by path only, ignoring query strings', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await handleApiRequest(request('/api/repos?x=1&y=2'), env);
    const key = cache.put.mock.calls[0][0] as Request;
    expect(new URL(key.url).search).toBe('');
  });

  it('maps GitHub 500 responses to 502 GITHUB_UPSTREAM_ERROR and never caches the error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'boom' }, { status: 500 }));
    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(((await response.json()) as { error: string }).error).toBe('GITHUB_UPSTREAM_ERROR');
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('maps rate-limit responses to 429 with Retry-After', async () => {
    const reset = Math.floor(Date.now() / 1000) + 120;
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { message: 'API rate limit exceeded' },
        { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } }
      )
    );
    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(429);
    const retryAfter = Number(response.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(120);
    expect(((await response.json()) as { error: string }).error).toBe('GITHUB_RATE_LIMITED');
  });

  it('maps 404 from GitHub to ORG_NOT_FOUND', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, { status: 404 }));
    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe('ORG_NOT_FOUND');
  });

  it('maps network failures to 502 GITHUB_NETWORK_ERROR', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe('GITHUB_NETWORK_ERROR');
  });

  it('maps upstream timeouts to 504 GITHUB_TIMEOUT', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(504);
    expect(((await response.json()) as { error: string }).error).toBe('GITHUB_TIMEOUT');
  });

  it('rejects non-array GitHub payloads as GITHUB_RESPONSE_INVALID', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ unexpected: true }));
    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe('GITHUB_RESPONSE_INVALID');
  });

  it('does not return partial data when a later page fails', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([rawRepo({ id: 1 })], { headers: { 'Content-Type': 'application/json', Link: `<${SECOND_PAGE_URL}>; rel="next"` } })
      )
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, { status: 502 }));

    const response = await handleApiRequest(request(), env);
    expect(response.status).toBe(502);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('rejects non-GET methods with 405', async () => {
    const response = await handleApiRequest(request('/api/repos', { method: 'POST' }), env);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown API paths', async () => {
    const response = await handleApiRequest(request('/api/unknown'), env);
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
