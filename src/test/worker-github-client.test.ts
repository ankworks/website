// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  UpstreamError,
  buildGitHubUrl,
  mapFetchError,
  upstreamErrorFor,
  validateGitHubRedirect,
  githubGet,
  readJson,
  expectArray,
} from '../worker/github-client';

const ORG_REPOS = 'https://api.github.com/orgs/ankworks/repos';

describe('validateGitHubRedirect', () => {
  it('accepts absolute allowlisted targets', () => {
    const next = 'https://api.github.com/orgs/ankworks/repos?type=public&per_page=100&page=1';
    expect(validateGitHubRedirect(next, ORG_REPOS)).toBe(next);
  });

  it('accepts relative allowlisted targets resolved against the source URL', () => {
    expect(validateGitHubRedirect('/orgs/ankworks/repos?page=2', ORG_REPOS)).toBe(
      'https://api.github.com/orgs/ankworks/repos?page=2'
    );
  });

  it('accepts allowlisted repository paths', () => {
    expect(validateGitHubRedirect('https://api.github.com/repos/ankworks/website/contents', ORG_REPOS)).toBe(
      'https://api.github.com/repos/ankworks/website/contents'
    );
  });

  it('rejects targets on a different origin', () => {
    expect(validateGitHubRedirect('https://evil.example.test/repos', ORG_REPOS)).toBeNull();
  });

  it('rejects targets for another organization or user', () => {
    expect(validateGitHubRedirect('https://api.github.com/orgs/other-org/repos', ORG_REPOS)).toBeNull();
    expect(validateGitHubRedirect('https://api.github.com/users/ankworks/repos', ORG_REPOS)).toBeNull();
    expect(validateGitHubRedirect('https://api.github.com/orgs/ankworksevil/repos', ORG_REPOS)).toBeNull();
  });

  it('rejects targets with embedded credentials', () => {
    expect(validateGitHubRedirect('https://user:pass@api.github.com/orgs/ankworks/repos', ORG_REPOS)).toBeNull();
  });

  it('rejects non-https schemes and malformed values', () => {
    expect(validateGitHubRedirect('http://api.github.com/orgs/ankworks/repos', ORG_REPOS)).toBeNull();
    expect(validateGitHubRedirect(null, ORG_REPOS)).toBeNull();
    expect(validateGitHubRedirect('', ORG_REPOS)).toBeNull();
  });

  it('rejects relative paths that resolve outside the organization allowlist', () => {
    expect(validateGitHubRedirect('../users/other', ORG_REPOS)).toBeNull();
    expect(validateGitHubRedirect('/users/other/repos', ORG_REPOS)).toBeNull();
  });
});

describe('mapFetchError', () => {
  it('maps TimeoutError to 504 GITHUB_TIMEOUT', () => {
    const error = mapFetchError(new DOMException('timed out', 'TimeoutError'));
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error.status).toBe(504);
    expect(error.code).toBe('GITHUB_TIMEOUT');
  });

  it('maps AbortError to 504 GITHUB_TIMEOUT', () => {
    const error = mapFetchError(new DOMException('aborted', 'AbortError'));
    expect(error.status).toBe(504);
    expect(error.code).toBe('GITHUB_TIMEOUT');
  });

  it('maps other fetch rejections to 502 GITHUB_NETWORK_ERROR', () => {
    const error = mapFetchError(new TypeError('fetch failed'));
    expect(error.status).toBe(502);
    expect(error.code).toBe('GITHUB_NETWORK_ERROR');
  });

  it('passes UpstreamError instances through unchanged', () => {
    const original = new UpstreamError(404, 'REPO_NOT_FOUND', 'Repository not found.');
    expect(mapFetchError(original)).toBe(original);
  });
});

describe('upstreamErrorFor', () => {
  it('maps 403 with x-ratelimit-remaining=0 to GITHUB_RATE_LIMITED with Retry-After', () => {
    const reset = Math.floor(Date.now() / 1000) + 90;
    const response = new Response('rate limited', {
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    });
    const error = upstreamErrorFor(response);
    expect(error.status).toBe(429);
    expect(error.code).toBe('GITHUB_RATE_LIMITED');
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(90);
  });

  it('maps 429 to GITHUB_RATE_LIMITED', () => {
    const error = upstreamErrorFor(new Response('rate limited', { status: 429, headers: { 'retry-after': '30' } }));
    expect(error.status).toBe(429);
    expect(error.code).toBe('GITHUB_RATE_LIMITED');
    expect(error.retryAfterSeconds).toBe(30);
  });

  it('maps 500 and 503 to 502 GITHUB_UPSTREAM_ERROR', () => {
    for (const status of [500, 502, 503]) {
      const error = upstreamErrorFor(new Response('boom', { status }));
      expect(error.status).toBe(502);
      expect(error.code).toBe('GITHUB_UPSTREAM_ERROR');
    }
  });

  it('maps other unexpected statuses to GITHUB_UPSTREAM_ERROR without leaking them', () => {
    const error = upstreamErrorFor(new Response('teapot', { status: 418 }));
    expect(error.status).toBe(502);
    expect(error.code).toBe('GITHUB_UPSTREAM_ERROR');
    expect(error.message).not.toContain('418');
  });

  it('maps 404 to the route-specific not-found error', () => {
    const error = upstreamErrorFor(new Response('nope', { status: 404 }), {
      notFound: { code: 'REPO_NOT_FOUND', message: 'Repository not found.' },
    });
    expect(error.status).toBe(404);
    expect(error.code).toBe('REPO_NOT_FOUND');
  });
});

describe('githubGet redirect handling', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests with manual redirect mode and a timeout signal', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await githubGet(buildGitHubUrl('/orgs/ankworks'), {});
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('follows an allowlisted redirect and resolves with the final response', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { Location: ORG_REPOS } }))
      .mockResolvedValueOnce(new Response('[{"id":1}]', { status: 200 }));
    const response = await githubGet(ORG_REPOS, {});
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, ORG_REPOS, expect.anything());
  });

  it('rejects redirects that leave the allowlist and does not follow them', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 301, headers: { Location: 'https://evil.example.test/' } }));
    await expect(githubGet(ORG_REPOS, {})).rejects.toMatchObject({ status: 502, code: 'GITHUB_UPSTREAM_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never echoes the token into errors', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const error = await githubGet(ORG_REPOS, { GITHUB_TOKEN: 'ghp_should_not_leak_1234567890' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect(String((error as UpstreamError).message)).not.toContain('ghp_should_not_leak');
    expect(JSON.stringify(error)).not.toContain('ghp_should_not_leak');
  });
});

describe('response validation', () => {
  it('readJson rejects non-JSON bodies as GITHUB_RESPONSE_INVALID', async () => {
    const response = new Response('this is not json', { status: 200, headers: { 'Content-Type': 'application/json' } });
    await expect(readJson(response)).rejects.toMatchObject({ status: 502, code: 'GITHUB_RESPONSE_INVALID' });
  });

  it('readJson rejects oversized bodies as UPSTREAM_TOO_LARGE', async () => {
    const response = new Response('x'.repeat(64), { status: 200 });
    await expect(readJson(response, 16)).rejects.toMatchObject({ status: 502, code: 'UPSTREAM_TOO_LARGE' });
  });

  it('expectArray rejects non-array payloads as GITHUB_RESPONSE_INVALID', () => {
    expect(() => expectArray({ nope: true })).toThrowError(UpstreamError);
    try {
      expectArray({ nope: true });
    } catch (error) {
      expect((error as UpstreamError).code).toBe('GITHUB_RESPONSE_INVALID');
    }
    expect(() => expectArray([1, 2])).not.toThrow();
  });
});
