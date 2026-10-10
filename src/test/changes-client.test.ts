import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { changesApi } from '../api/changes';
import { ExplorerApiError } from '../api/explorer';

/** Milestone C client: commit, branch create, and compare request contracts. */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type FetchMock = ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;

describe('changesApi', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function last(): { url: string; init: RequestInit } {
    const [input, init] = fetchMock.mock.calls.at(-1) ?? [];
    return { url: String(input), init: (init ?? {}) as RequestInit };
  }

  it('POSTs a commit with JSON body', async () => {
    fetchMock.mockResolvedValueOnce(json({ branch: 'main', path: 'a.md', commit: { sha: 'a'.repeat(40), message: 'm', html_url: '' }, content: { sha: 'b'.repeat(40), path: 'a.md' } }));
    const result = await changesApi.commit('website', { message: 'm', content: 'x', branch: 'main', path: 'a.md' });
    expect(result.commit.sha).toBe('a'.repeat(40));
    expect(last().url).toBe('/api/repos/website/commit');
    expect(last().init.method).toBe('POST');
  });

  it('rejects malformed commit payloads', async () => {
    fetchMock.mockResolvedValueOnce(json({ nope: true }));
    await expect(changesApi.commit('website', { message: 'm', content: 'x', branch: 'main', path: 'a.md' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('surfaces worker errors', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'STALE_BLOB', message: 'Reload.', status: 422 }, 422));
    await expect(changesApi.commit('website', { message: 'm', content: 'x', branch: 'main', path: 'a.md' })).rejects.toMatchObject({ code: 'STALE_BLOB', status: 422 });
  });

  it('POSTs branch creation', async () => {
    fetchMock.mockResolvedValueOnce(json({ name: 'x', sha: 'c'.repeat(40) }));
    const result = await changesApi.createBranch('website', { name: 'x', from: 'main' });
    expect(result.sha).toBe('c'.repeat(40));
    expect(last().url).toBe('/api/repos/website/branches');
  });

  it('GETs compare and validates the payload', async () => {
    fetchMock.mockResolvedValueOnce(json({ repo: 'website', base: 'main', head: 'x', status: 'ahead', ahead_by: 1, behind_by: 0, total_commits: 1, html_url: '', files: [], fetched_at: '' }));
    const result = await changesApi.compare('website', 'main', 'x');
    expect(result.status).toBe('ahead');
    expect(last().url).toBe('/api/repos/website/compare?base=main&head=x');
  });

  it('rejects malformed compare payloads', async () => {
    fetchMock.mockResolvedValueOnce(json({ files: 'nope' }));
    await expect(changesApi.compare('website', 'main', 'x')).rejects.toBeInstanceOf(ExplorerApiError);
  });
});
