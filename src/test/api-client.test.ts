import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getRepositories, invalidateCache, RepositoryApiError } from '../api/github';

function repo(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `repo-${id}`,
    full_name: `ankworks/repo-${id}`,
    private: false,
    html_url: `https://github.com/ankworks/repo-${id}`,
    description: null,
    language: 'TypeScript',
    stargazers_count: id,
    forks_count: 0,
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    archived: false,
    fork: false,
    size: 1,
    open_issues_count: 0,
    topics: [],
    default_branch: 'main',
    ...overrides,
  };
}

function okResponse(repos: unknown[]) {
  return new Response(JSON.stringify({ org: 'ankworks', repos, total_count: repos.length, fetched_at: '2026-01-01T00:00:00Z' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('browser API client (GET /api/repos)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invalidateCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the same-origin Worker endpoint, never api.github.com directly', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([repo(1)]));
    await getRepositories();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/repos');
  });

  it('returns sanitized repositories and drops invalid items', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([repo(1), repo(2, { private: true }), repo(3, { html_url: 'javascript:x' })]));
    const repos = await getRepositories();
    expect(repos.map((r) => r.id)).toEqual([1]);
  });

  it('caches results and refetches when forced', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okResponse([repo(1)])));
    await getRepositories();
    await getRepositories();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getRepositories(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okResponse([repo(1)])));
    await Promise.all([getRepositories(), getRepositories(), getRepositories()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces the Worker error message and code', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'GITHUB_RATE_LIMITED', message: 'GitHub API rate limit reached.', status: 429 }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const error = await getRepositories().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RepositoryApiError);
    expect((error as RepositoryApiError).code).toBe('GITHUB_RATE_LIMITED');
    expect((error as RepositoryApiError).status).toBe(429);
    expect((error as Error).message).toBe('GitHub API rate limit reached.');
  });

  it('reports network failures with a friendly message', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(getRepositories()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('rejects malformed success bodies', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>oops</html>', { status: 200 }));
    await expect(getRepositories()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });




});
