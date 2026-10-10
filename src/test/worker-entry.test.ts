// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';

describe('Worker entry routing', () => {
  let assetsFetch: ReturnType<typeof vi.fn>;
  let env: Env;
  const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

  beforeEach(() => {
    assetsFetch = vi.fn().mockResolvedValue(new Response('<html>app</html>', { status: 200 }));
    env = { ASSETS: { fetch: assetsFetch } as unknown as Fetcher };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
    vi.stubGlobal('caches', { default: { match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves non-API requests from the ASSETS binding', async () => {
    const request = new Request('https://works.example.test/projects');
    const response = await worker.fetch(request, env, ctx);
    expect(await response.text()).toBe('<html>app</html>');
    expect(assetsFetch).toHaveBeenCalledTimes(1);
  });

  it('routes /api/repos to the API handler instead of assets', async () => {
    const response = await worker.fetch(new Request('https://works.example.test/api/repos'), env, ctx);
    expect(response.status).toBe(200);
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it('does not reference the legacy __STATIC_CONTENT global', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('__STATIC_CONTENT');
  });
});
