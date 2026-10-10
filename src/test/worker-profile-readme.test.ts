// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleApiRequest } from '../worker/api';
import type { Env } from '../worker/env';

/**
 * GET /api/org/profile-readme against a mocked GitHub upstream.
 *
 * The endpoint reads only the fixed `ankworks/.github` -> `profile/README.md`
 * path. Missing repository/file is a graceful 404; private or foreign
 * repositories fail closed; nothing reaches api.github.com.
 */

const ORIGIN = 'https://works.example.test';
const SHA = 'e'.repeat(40);
const REPO_URL = '/repos/ankworks/.github';
const COMMIT_URL = '/repos/ankworks/.github/commits/main';
const CONTENTS_URL = '/repos/ankworks/.github/contents/profile/README.md';

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
    ...init,
  });
}

function dotGithubRepo(overrides: Record<string, unknown> = {}) {
  return {
    id: 1412975963,
    name: '.github',
    full_name: 'ankworks/.github',
    private: false,
    html_url: 'https://github.com/ankworks/.github',
    owner: { login: 'ankworks' },
    description: null,
    language: null,
    stargazers_count: 0,
    forks_count: 0,
    updated_at: '2026-01-01T00:00:00Z',
    pushed_at: '2026-01-01T00:00:00Z',
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

function commitObject() {
  return {
    sha: SHA,
    commit: {
      message: 'Update profile',
      author: { name: 'Ada', email: 'ada@example.test', date: '2026-01-02T03:04:05Z' },
      committer: { name: 'Ada', email: 'ada@example.test', date: '2026-01-02T03:04:05Z' },
    },
    author: { login: 'ada' },
    html_url: `https://github.com/ankworks/.github/commit/${SHA}`,
  };
}

function fileObject(content: string, overrides: Record<string, unknown> = {}) {
  const bytes = new TextEncoder().encode(content);
  return {
    type: 'file',
    name: 'README.md',
    path: 'profile/README.md',
    sha: 'f'.repeat(40),
    size: bytes.byteLength,
    encoding: 'base64',
    content: Buffer.from(bytes).toString('base64'),
    html_url: `https://github.com/ankworks/.github/blob/main/profile/README.md`,
    ...overrides,
  };
}

describe('GET /api/org/profile-readme', () => {
  let fetchMock: ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;
  let handler: Handler;
  let cache: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
  const env: Env = { ASSETS: {} as Fetcher };

  beforeEach(() => {
    handler = () => new Response('unrouted', { status: 500 });
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async (input, init) => handler(new URL(String(input)), init));
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

  function api(path: string, init?: RequestInit) {
    return handleApiRequest(new Request(`${ORIGIN}${path}`, init), env);
  }

  /** The default happy path: repo detail -> commit -> profile/README.md. */
  function useHappyPath(markdown = '# AnkWorks\n\nHello.\n', fileOverrides: Record<string, unknown> = {}) {
    handler = (url) => {
      if (url.pathname === REPO_URL) return json(dotGithubRepo());
      if (url.pathname === COMMIT_URL) return json(commitObject());
      if (url.pathname === CONTENTS_URL) return json(fileObject(markdown, fileOverrides));
      return new Response('unrouted', { status: 500 });
    };
  }

  it('returns the profile README source with cache headers on a miss', async () => {
    useHappyPath();

    const response = await api('/api/org/profile-readme');
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Cache')).toBe('MISS');
    expect(response.headers.get('Cache-Control')).toContain('max-age=300');

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      repo: '.github',
      path: 'profile/README.md',
      name: 'README.md',
      commit_sha: SHA,
      kind: 'text',
      content: '# AnkWorks\n\nHello.\n',
      html_url: `https://github.com/ankworks/.github/blob/${SHA}/profile/README.md`,
    });
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('resolves the fixed upstream paths only (repo, default branch, profile README)', async () => {
    useHappyPath();
    await api('/api/org/profile-readme');
    const paths = fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname);
    expect(paths).toEqual([REPO_URL, COMMIT_URL, CONTENTS_URL]);
  });

  it('serves the cached response on a hit without touching GitHub', async () => {
    useHappyPath();
    const first = await api('/api/org/profile-readme');
    cache.match.mockResolvedValueOnce(first.clone());

    const second = await api('/api/org/profile-readme');
    expect(second.status).toBe(200);
    expect(second.headers.get('X-Cache')).toBe('HIT');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns a graceful 404 when the .github repository is missing', async () => {
    handler = (url) => {
      if (url.pathname === REPO_URL) return json({ message: 'Not Found' }, { status: 404 });
      return new Response('unrouted', { status: 500 });
    };
    const response = await api('/api/org/profile-readme');
    expect(response.status).toBe(404);
    expect((await response.json()) as { error: string }).toMatchObject({ error: 'PROFILE_README_NOT_FOUND' });
  });

  it('returns a graceful 404 when profile/README.md is missing', async () => {
    handler = (url) => {
      if (url.pathname === REPO_URL) return json(dotGithubRepo());
      if (url.pathname === COMMIT_URL) return json(commitObject());
      if (url.pathname === CONTENTS_URL) return json({ message: 'Not Found' }, { status: 404 });
      return new Response('unrouted', { status: 500 });
    };
    const response = await api('/api/org/profile-readme');
    expect(response.status).toBe(404);
    expect((await response.json()) as { error: string }).toMatchObject({ error: 'PROFILE_README_NOT_FOUND' });
  });

  it('fails closed for a private .github repository (no private data leaks)', async () => {
    handler = (url) => {
      if (url.pathname === REPO_URL) return json(dotGithubRepo({ private: true }));
      return new Response('unrouted', { status: 500 });
    };
    const response = await api('/api/org/profile-readme');
    expect(response.status).toBe(404);
    expect((await response.json()) as { error: string }).toMatchObject({ error: 'PROFILE_README_NOT_FOUND' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the upstream repository belongs to a foreign owner', async () => {
    handler = (url) => {
      if (url.pathname === REPO_URL) return json(dotGithubRepo({ full_name: 'other/.github', owner: { login: 'other' } }));
      return new Response('unrouted', { status: 500 });
    };
    const response = await api('/api/org/profile-readme');
    expect(response.status).toBe(404);
  });

  it('maps an empty repository (unresolvable default branch) to the graceful 404', async () => {
    handler = (url) => {
      if (url.pathname === REPO_URL) return json(dotGithubRepo());
      if (url.pathname === COMMIT_URL) return json({ message: 'No commit found' }, { status: 422 });
      return new Response('unrouted', { status: 500 });
    };
    const response = await api('/api/org/profile-readme');
    expect(response.status).toBe(404);
    expect((await response.json()) as { error: string }).toMatchObject({ error: 'PROFILE_README_NOT_FOUND' });
  });

  it('reports an oversized profile README as too-large instead of truncating it', async () => {
    useHappyPath('x', { size: 600 * 1024, content: null, encoding: 'none' });
    const response = await api('/api/org/profile-readme');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe('too-large');
    expect(body).not.toHaveProperty('content');
  });

  it('reports binary content without exposing it', async () => {
    handler = (url) => {
      if (url.pathname === REPO_URL) return json(dotGithubRepo());
      if (url.pathname === COMMIT_URL) return json(commitObject());
      if (url.pathname === CONTENTS_URL) {
        return json(fileObject('xx', { size: 4, content: Buffer.from([0, 1, 2, 3]).toString('base64') }));
      }
      return new Response('unrouted', { status: 500 });
    };
    const response = await api('/api/org/profile-readme');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.kind).toBe('binary');
    expect(body).not.toHaveProperty('content');
  });

  it('rejects non-GET requests', async () => {
    const response = await api('/api/org/profile-readme', { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never caches error responses', async () => {
    handler = (url) => {
      if (url.pathname === REPO_URL) return json({ message: 'Not Found' }, { status: 404 });
      return new Response('unrouted', { status: 500 });
    };
    await api('/api/org/profile-readme');
    expect(cache.put).not.toHaveBeenCalled();
  });
});
