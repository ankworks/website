// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleApiRequest } from '../worker/api';
import { classifyContent, attachmentDisposition } from '../worker/explorer';
import type { Env } from '../worker/env';
import { EXPLORER_LIMITS } from '../shared/limits';

/**
 * Explorer endpoints with a mocked GitHub upstream. Every test routes fetch()
 * through an in-memory table; nothing reaches api.github.com.
 */

const ORIGIN = 'https://works.example.test';
const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
    ...init,
  });
}

function commitObject(sha = SHA, overrides: Record<string, unknown> = {}) {
  return {
    sha,
    commit: {
      message: 'Add feature\n\nLonger body',
      author: { name: 'Ada', email: 'ada@example.test', date: '2026-01-02T03:04:05Z' },
      committer: { name: 'Ada', email: 'ada@example.test', date: '2026-01-02T03:04:05Z' },
    },
    author: { login: 'ada' },
    html_url: `https://github.com/ankworks/website/commit/${sha}`,
    ...overrides,
  };
}

function fileObject(path: string, content: Uint8Array | string, overrides: Record<string, unknown> = {}) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return {
    type: 'file',
    name: path.split('/').pop(),
    path,
    sha: 'c'.repeat(40),
    size: bytes.byteLength,
    encoding: 'base64',
    content: Buffer.from(bytes).toString('base64'),
    html_url: `https://github.com/ankworks/website/blob/main/${path}`,
    ...overrides,
  };
}

function entry(name: string, type: 'file' | 'dir' | 'symlink' | 'submodule', size = 10) {
  return {
    type,
    name,
    path: name,
    sha: 'd'.repeat(40),
    size,
    html_url: `https://github.com/ankworks/website/tree/main/${name}`,
  };
}

describe('explorer endpoints (mocked upstream)', () => {
  let fetchMock: ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;
  let handler: Handler;
  const env: Env = { ASSETS: {} as Fetcher };

  beforeEach(() => {
    handler = () => new Response('unrouted', { status: 500 });
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async (input, init) => handler(new URL(String(input)), init));
    vi.stubGlobal('fetch', fetchMock);
    // No caching in these tests: each request must reach the mock.
    vi.stubGlobal('caches', { default: { match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function api(path: string, init?: RequestInit) {
    return handleApiRequest(new Request(`${ORIGIN}${path}`, init), env);
  }

  /** Route the commit-resolution call used by most endpoints. */
  function routeCommit(sha = SHA, ref = 'main') {
    return (url: URL) => {
      if (url.pathname === '/repos/ankworks/website/commits/' + encodeURIComponent(ref)) {
        return json(commitObject(sha));
      }
      return null;
    };
  }

  function use(...routes: Array<(url: URL) => Response | null>): void {
    handler = (url) => {
      for (const route of routes) {
        const response = route(url);
        if (response) return response;
      }
      return new Response('unrouted', { status: 500 });
    };
  }

  describe('tree', () => {
    it('lists directories before files and resolves the ref to a commit SHA first', async () => {
      use(routeCommit(), (url) =>
        url.pathname === '/repos/ankworks/website/contents' && url.searchParams.get('ref') === SHA
          ? json([entry('zeta.ts', 'file'), entry('src', 'dir'), entry('alpha.md', 'file'), entry('link', 'symlink')])
          : null
      );

      const response = await api('/api/repos/website/tree?ref=main');
      expect(response.status).toBe(200);
      const body = (await response.json()) as { commit_sha: string; entries: Array<{ name: string; type: string }>; truncated: boolean };
      expect(body.commit_sha).toBe(SHA);
      expect(body.entries.map((e) => e.name)).toEqual(['src', 'alpha.md', 'link', 'zeta.ts']);
      expect(body.entries[0].type).toBe('dir');
      expect(body.truncated).toBe(false);
    });

    it('reads nested directories and keeps the commit SHA, not the branch name, in upstream calls', async () => {
      use(routeCommit(), (url) =>
        url.pathname === '/repos/ankworks/website/contents/src/components' ? json([entry('Button.tsx', 'file')]) : null
      );
      const response = await api('/api/repos/website/tree?ref=main&path=src%2Fcomponents');
      expect(response.status).toBe(200);
      const contentsCall = fetchMock.mock.calls.map((c) => new URL(String(c[0]))).find((u) => u.pathname.includes('/contents/'));
      expect(contentsCall?.searchParams.get('ref')).toBe(SHA);
    });

    it('returns an empty listing for an empty directory', async () => {
      use(routeCommit(), (url) => (url.pathname === '/repos/ankworks/website/contents/empty' ? json([]) : null));
      const response = await api('/api/repos/website/tree?ref=main&path=empty');
      expect(response.status).toBe(200);
      expect(((await response.json()) as { entries: unknown[] }).entries).toEqual([]);
    });

    it('flags a listing as truncated when GitHub returns the maximum number of entries', async () => {
      const many = Array.from({ length: EXPLORER_LIMITS.CONTENTS_LISTING_MAX }, (_, i) => entry(`f${i}.txt`, 'file'));
      use(routeCommit(), (url) => (url.pathname === '/repos/ankworks/website/contents' ? json(many) : null));
      const body = (await (await api('/api/repos/website/tree?ref=main')).json()) as { truncated: boolean; entries: unknown[] };
      expect(body.truncated).toBe(true);
      expect(body.entries).toHaveLength(EXPLORER_LIMITS.CONTENTS_LISTING_MAX);
    });

    it('returns NOT_A_DIRECTORY when the path is a file', async () => {
      use(routeCommit(), (url) => (url.pathname === '/repos/ankworks/website/contents/README.md' ? json(fileObject('README.md', 'hi')) : null));
      const response = await api('/api/repos/website/tree?ref=main&path=README.md');
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe('NOT_A_DIRECTORY');
    });

    it('returns PATH_NOT_FOUND for a path missing at that ref', async () => {
      use(routeCommit(), () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }));
      const response = await api('/api/repos/website/tree?ref=main&path=nope');
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe('PATH_NOT_FOUND');
    });

    it('maps an unknown branch or commit to REF_NOT_FOUND', async () => {
      use(() => new Response(JSON.stringify({ message: 'No commit found for SHA' }), { status: 422 }));
      const response = await api('/api/repos/website/tree?ref=does-not-exist');
      expect(((await response.json()) as { error: string }).error).toBe('REF_NOT_FOUND');
    });

    it('rejects path traversal before any upstream call is made', async () => {
      for (const path of ['..%2F..%2Fetc', 'src%2F..%2F..%2Fsecret', 'src%2F%2E%2E%2Fsecret', 'a%5Cb', 'a%00b']) {
        const response = await api(`/api/repos/website/tree?ref=main&path=${path}`);
        expect(response.status, path).toBe(400);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects invalid repository names and missing refs without calling GitHub', async () => {
      expect((await api('/api/repos/..%2Fsecret/tree?ref=main')).status).toBe(400);
      expect((await api('/api/repos/has%20space/tree?ref=main')).status).toBe(400);
      const missing = await api('/api/repos/website/tree');
      expect(((await missing.json()) as { error: string }).error).toBe('MISSING_REF');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps an upstream rate limit to 429 with Retry-After and never caches it', async () => {
      const reset = Math.floor(Date.now() / 1000) + 90;
      use(() => new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
      }));
      const response = await api('/api/repos/website/tree?ref=main');
      expect(response.status).toBe(429);
      expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect(((await response.json()) as { error: string }).error).toBe('GITHUB_RATE_LIMITED');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    it('sends the optional GITHUB_TOKEN upstream only, never in the response', async () => {
      use(routeCommit(), (url) => (url.pathname === '/repos/ankworks/website/contents' ? json([]) : null));
      const tokenEnv: Env = { ASSETS: {} as Fetcher, GITHUB_TOKEN: 'ghp_secret_value_for_test' };
      const response = await handleApiRequest(new Request(`${ORIGIN}/api/repos/website/tree?ref=main`), tokenEnv);
      expect(response.status).toBe(200);
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer ghp_secret_value_for_test');
      expect(JSON.stringify(Object.fromEntries(response.headers))).not.toContain('ghp_secret');
      expect(await response.text()).not.toContain('ghp_secret');
    });

    it('only ever calls api.github.com with redirect handling in manual (allowlist-validated) mode', async () => {
      use(routeCommit(), (url) => (url.pathname === '/repos/ankworks/website/contents' ? json([]) : null));
      await api('/api/repos/website/tree?ref=main');
      for (const [input, init] of fetchMock.mock.calls) {
        expect(new URL(String(input)).origin).toBe('https://api.github.com');
        // workerd does not implement redirect:"error"; "manual" lets the client
        // validate redirect targets against the allowlist before following them.
        expect((init as RequestInit).redirect).toBe('manual');
      }
    });
  });

  it('normalizes a leading or trailing slash in the path query', async () => {
    use(routeCommit(), (url) => (url.pathname === '/repos/ankworks/website/contents/src' ? json([]) : null));
    const response = await api('/api/repos/website/tree?ref=main&path=%2Fsrc%2F');
    expect(response.status).toBe(200);
    expect(((await response.json()) as { path: string }).path).toBe('src');
  });

  describe('last-commit', () => {
    it('returns the latest commit touching the path', async () => {
      use((url) => (url.pathname === '/repos/ankworks/website/commits' && url.searchParams.get('path') === 'src' ? json([commitObject()]) : null));
      const body = (await (await api('/api/repos/website/last-commit?ref=main&path=src')).json()) as { commit: { sha: string } | null };
      expect(body.commit?.sha).toBe(SHA);
    });

    it('returns null when no commit touches the path', async () => {
      use((url) => (url.pathname === '/repos/ankworks/website/commits' ? json([]) : null));
      const body = (await (await api('/api/repos/website/last-commit?ref=main&path=new-file.ts')).json()) as { commit: unknown };
      expect(body.commit).toBeNull();
    });
  });

  describe('file', () => {
    it('returns text content with metadata at the resolved commit', async () => {
      use(routeCommit(), (url) =>
        url.pathname === '/repos/ankworks/website/contents/src/index.ts' ? json(fileObject('src/index.ts', 'export const a = 1;\n')) : null
      );
      const body = (await (await api('/api/repos/website/file?ref=main&path=src%2Findex.ts')).json()) as Record<string, unknown>;
      expect(body.kind).toBe('text');
      expect(body.content).toBe('export const a = 1;\n');
      expect(body.commit_sha).toBe(SHA);
      expect(body.name).toBe('index.ts');
      expect(body.html_url).toBe(`https://github.com/ankworks/website/blob/${SHA}/src/index.ts`);
    });

    it('classifies binary files without returning their bytes', async () => {
      use(routeCommit(), (url) =>
        url.pathname === '/repos/ankworks/website/contents/logo.png' ? json(fileObject('logo.png', new Uint8Array([0x89, 0x50, 0, 0x4e]))) : null
      );
      const body = (await (await api('/api/repos/website/file?ref=main&path=logo.png')).json()) as Record<string, unknown>;
      expect(body.kind).toBe('binary');
      expect(body).not.toHaveProperty('content');
    });

    it('classifies Git LFS pointer files', async () => {
      const pointer = 'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'e'.repeat(64) + '\nsize 123456\n';
      use(routeCommit(), (url) =>
        url.pathname === '/repos/ankworks/website/contents/assets/video.mp4' ? json(fileObject('assets/video.mp4', pointer)) : null
      );
      const body = (await (await api('/api/repos/website/file?ref=main&path=assets%2Fvideo.mp4')).json()) as Record<string, unknown>;
      expect(body.kind).toBe('lfs-pointer');
      expect(body).not.toHaveProperty('content');
    });

    it('reports oversized files as too-large without fetching their content', async () => {
      use(routeCommit(), (url) =>
        url.pathname === '/repos/ankworks/website/contents/big.json'
          ? json({ ...fileObject('big.json', 'x'), size: EXPLORER_LIMITS.VIEW_MAX_BYTES + 1, content: null, encoding: 'none' })
          : null
      );
      const body = (await (await api('/api/repos/website/file?ref=main&path=big.json')).json()) as Record<string, unknown>;
      expect(body.kind).toBe('too-large');
      expect(body).not.toHaveProperty('content');
    });

    it('reports symlinks with their target and submodules with their URL', async () => {
      use(routeCommit(), (url) => {
        if (url.pathname === '/repos/ankworks/website/contents/link') {
          return json({ type: 'symlink', name: 'link', path: 'link', sha: 'f'.repeat(40), size: 6, target: '../docs', html_url: 'https://github.com/x' });
        }
        if (url.pathname === '/repos/ankworks/website/contents/vendor/lib') {
          return json({ type: 'submodule', name: 'lib', path: 'vendor/lib', sha: 'f'.repeat(40), size: 0, submodule_git_url: 'https://github.com/ankworks/lib.git', html_url: 'https://github.com/x' });
        }
        return null;
      });
      const link = (await (await api('/api/repos/website/file?ref=main&path=link')).json()) as Record<string, unknown>;
      expect(link).toMatchObject({ kind: 'symlink', target: '../docs' });
      const sub = (await (await api('/api/repos/website/file?ref=main&path=vendor%2Flib')).json()) as Record<string, unknown>;
      expect(sub).toMatchObject({ kind: 'submodule', submodule_url: 'https://github.com/ankworks/lib.git' });
    });

    it('rejects directories with IS_DIRECTORY', async () => {
      use(routeCommit(), (url) => (url.pathname === '/repos/ankworks/website/contents/src' ? json([]) : null));
      const response = await api('/api/repos/website/file?ref=main&path=src');
      expect(((await response.json()) as { error: string }).error).toBe('IS_DIRECTORY');
    });

    it('requires a file path', async () => {
      const response = await api('/api/repos/website/file?ref=main');
      expect(((await response.json()) as { error: string }).error).toBe('INVALID_PATH');
    });
  });

  describe('readme', () => {
    it('returns the README text at the resolved commit', async () => {
      use(routeCommit(), (url) =>
        url.pathname === '/repos/ankworks/website/readme' ? json(fileObject('README.md', '# Hello\n')) : null
      );
      const body = (await (await api('/api/repos/website/readme?ref=main')).json()) as Record<string, unknown>;
      expect(body).toMatchObject({ kind: 'text', content: '# Hello\n', commit_sha: SHA, path: 'README.md' });
    });

    it('returns README_NOT_FOUND when the repository has no README', async () => {
      use(routeCommit(), () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }));
      const response = await api('/api/repos/website/readme?ref=main');
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe('README_NOT_FOUND');
    });
  });

  describe('raw', () => {
    it('streams the file as an attachment with hardening headers', async () => {
      use(routeCommit(), (url) => {
        if (url.pathname === '/repos/ankworks/website/contents/data.bin') {
          return json(fileObject('data.bin', new Uint8Array([1, 2, 3, 0])));
        }
        return null;
      });
      // Second call (raw body) returns bytes directly.
      const original = handler;
      handler = (url, init) => {
        const accept = (init?.headers as Record<string, string> | undefined)?.Accept;
        if (url.pathname === '/repos/ankworks/website/contents/data.bin' && accept === 'application/vnd.github.raw+json') {
          return new Response(new Uint8Array([1, 2, 3, 0]), { status: 200 });
        }
        return original(url, init);
      };

      const response = await api('/api/repos/website/raw?ref=main&path=data.bin');
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('Content-Security-Policy')).toContain('sandbox');
      expect(response.headers.get('Content-Disposition')).toBe(`attachment; filename="data.bin"; filename*=UTF-8''data.bin`);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 0]));
    });

    it('refuses files above the raw limit with 413 before downloading them', async () => {
      use(routeCommit(), (url) =>
        url.pathname === '/repos/ankworks/website/contents/huge.iso'
          ? json({ ...fileObject('huge.iso', 'x'), size: EXPLORER_LIMITS.RAW_MAX_BYTES + 1, content: null, encoding: 'none' })
          : null
      );
      const response = await api('/api/repos/website/raw?ref=main&path=huge.iso');
      expect(response.status).toBe(413);
      expect(((await response.json()) as { error: string }).error).toBe('FILE_TOO_LARGE');
      const rawCalls = fetchMock.mock.calls.filter((c) => ((c[1] as RequestInit).headers as Record<string, string>)?.Accept?.includes('raw'));
      expect(rawCalls).toHaveLength(0);
    });

    it('does not stream directories', async () => {
      use(routeCommit(), (url) => (url.pathname === '/repos/ankworks/website/contents/src' ? json([]) : null));
      const response = await api('/api/repos/website/raw?ref=main&path=src');
      expect(response.status).toBe(400);
    });
  });

  describe('commits and branches', () => {
    it('paginates commits using the Link header', async () => {
      use((url) => {
        if (url.pathname !== '/repos/ankworks/website/commits') return null;
        const page = url.searchParams.get('page');
        if (page === '1' || page === null) {
          return json([commitObject(SHA)], {
            headers: { 'Content-Type': 'application/json', Link: '<https://api.github.com/repos/ankworks/website/commits?page=2>; rel="next"' },
          });
        }
        return json([commitObject(SHA2)]);
      });

      const first = (await (await api('/api/repos/website/commits?ref=main&page=1')).json()) as { commits: Array<{ sha: string }>; has_next: boolean };
      expect(first.commits[0].sha).toBe(SHA);
      expect(first.has_next).toBe(true);

      const second = (await (await api('/api/repos/website/commits?ref=main&page=2')).json()) as { commits: Array<{ sha: string }>; has_next: boolean };
      expect(second.commits[0].sha).toBe(SHA2);
      expect(second.has_next).toBe(false);
    });

    it('does not invent commit fields that GitHub did not return', async () => {
      use((url) =>
        url.pathname === '/repos/ankworks/website/commits'
          ? json([{ sha: SHA, commit: { message: 'x', author: { name: 'Ada', date: '2026-01-02T03:04:05Z' } } }])
          : null
      );
      const body = (await (await api('/api/repos/website/commits?ref=main')).json()) as { commits: Array<Record<string, unknown>> };
      expect(body.commits[0].author_login).toBeNull();
      expect(body.commits[0].html_url).toBe(`https://github.com/ankworks/website/commit/${SHA}`);
    });

    it('lists branches with pagination state', async () => {
      use((url) =>
        url.pathname === '/repos/ankworks/website/branches'
          ? json([{ name: 'main', commit: { sha: SHA }, protected: true }], {
              headers: { 'Content-Type': 'application/json', Link: '<https://api.github.com/x?page=2>; rel="next"' },
            })
          : null
      );
      const body = (await (await api('/api/repos/website/branches?page=1')).json()) as { branches: Array<{ name: string }>; has_next: boolean };
      expect(body.branches.map((b) => b.name)).toEqual(['main']);
      expect(body.has_next).toBe(true);
    });

    it('returns 404 for unknown explorer actions', async () => {
      const response = await api('/api/repos/website/unknown?ref=main');
      expect(response.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

describe('classifyContent', () => {
  it('treats text as text', () => {
    expect(classifyContent(new TextEncoder().encode('hello'))).toEqual({ kind: 'text', text: 'hello' });
  });

  it('treats NUL bytes as binary', () => {
    expect(classifyContent(new Uint8Array([104, 0, 105]))).toEqual({ kind: 'binary' });
  });

  it('treats invalid UTF-8 as binary', () => {
    expect(classifyContent(new Uint8Array([0xff, 0xfe, 0xfd])).kind).toBe('binary');
  });

  it('detects LFS pointers only when they are small text', () => {
    const pointer = new TextEncoder().encode('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1\n');
    expect(classifyContent(pointer).kind).toBe('lfs-pointer');
    const big = new TextEncoder().encode('version https://git-lfs.github.com/spec/v1\n' + 'x'.repeat(5000));
    expect(classifyContent(big).kind).toBe('text');
  });
});

describe('attachmentDisposition', () => {
  it('escapes quotes and non-ASCII characters in the fallback name', () => {
    const header = attachmentDisposition('weird "name" é.txt');
    expect(header).toContain('filename="weird _name_ _.txt"');
    expect(header).toContain("filename*=UTF-8''weird%20%22name%22%20%C3%A9.txt");
  });
});
