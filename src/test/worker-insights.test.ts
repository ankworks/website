// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { handleApiRequest } from '../worker/api';
import type { Env } from '../worker/env';

const ORIGIN = 'https://works.example.test';
const REPO = 'website';

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

/** Minimal public repository payload that passes sanitizeRepositoryDetail. */
function repoPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    name: REPO,
    full_name: `ankworks/${REPO}`,
    private: false,
    description: 'AnkWorks website',
    html_url: `https://github.com/ankworks/${REPO}`,
    language: 'TypeScript',
    stargazers_count: 10,
    forks_count: 2,
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    pushed_at: '2026-01-01T00:00:00Z',
    archived: false,
    fork: false,
    size: 100,
    open_issues_count: 1,
    topics: ['web'],
    default_branch: 'main',
    owner: { login: 'ankworks' },
    license: { spdx_id: 'MIT', name: 'MIT License' },
    homepage: 'https://works.ankb.qzz.io',
    has_wiki: true,
    has_issues: true,
    ...overrides,
  };
}

function commitPayload(sha = 'a'.repeat(40)): Record<string, unknown> {
  return {
    sha,
    commit: { message: 'initial', author: { name: 'dev' }, committer: { date: '2026-01-01T00:00:00Z' } },
    author: { login: 'dev' },
  };
}

/** Route the mocked fetch by URL. Handlers are matched in order. */
function stubFetch(routes: Array<{ match: RegExp | string; response: () => Response }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const route of routes) {
      const hit = typeof route.match === 'string' ? url === route.match : route.match.test(url);
      if (hit) return route.response();
    }
    return json({ message: 'Not Found' }, { status: 404 });
  });
}

type FetchMock = Mock<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>;
let fetchMock: FetchMock;
let env: Env;

beforeEach(() => {
  fetchMock = stubFetch([{ match: /\/repos\/ankworks\/website$/, response: () => json(repoPayload()) }]);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('caches', {
    default: { match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) },
  });
  env = { ASSETS: {} as Fetcher } as Env;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await handleApiRequest(new Request(`${ORIGIN}${path}`), env);
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

describe('repository insights: contributors', () => {
  it('sanitizes contributors and never invents a login for anonymous entries', async () => {
    fetchMock.mockImplementation(
      stubFetch([
        { match: /\/repos\/ankworks\/website$/, response: () => json(repoPayload()) },
        {
          match: /\/contributors/,
          response: () =>
            json([
              {
                login: 'alice',
                avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
                contributions: 42,
                // Fields that must not leak into the response.
                email: 'alice@example.test',
                url: 'https://api.github.com/users/alice',
              },
              { login: 'invalid-email-address', type: 'Anonymous', contributions: 3, avatar_url: 'https://evil.test/a.png' },
            ]),
        },
      ])
    );

    const { status, body } = await get(`/api/repos/${REPO}/contributors`);
    expect(status).toBe(200);
    const contributors = body.contributors as Array<Record<string, unknown>>;
    expect(contributors).toHaveLength(2);
    expect(contributors[0]).toEqual({
      login: 'alice',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
      html_url: 'https://github.com/alice',
      contributions: 42,
    });
    // Anonymous: contribution count is kept, identity is not fabricated.
    expect(contributors[1]).toEqual({ login: null, avatar_url: null, html_url: '', contributions: 3 });
  });

  it('rejects a private repository before serving any scoped insight', async () => {
    fetchMock.mockImplementation(
      stubFetch([{ match: /\/repos\/ankworks\/website$/, response: () => json({ ...repoPayload(), private: true }) }])
    );
    const { status, body } = await get(`/api/repos/${REPO}/contributors`);
    expect(status).toBe(404);
    expect(body.error).toBe('REPO_NOT_FOUND');
  });
});

describe('repository insights: languages', () => {
  it('computes the percentage breakdown from GitHub bytes', async () => {
    fetchMock.mockImplementation(
      stubFetch([
        { match: /\/repos\/ankworks\/website$/, response: () => json(repoPayload()) },
        {
          match: /\/languages/,
          response: () => json({ TypeScript: 750, JavaScript: 250, 'Jupyter Notebook': 0 }),
        },
      ])
    );

    const { status, body } = await get(`/api/repos/${REPO}/languages`);
    expect(status).toBe(200);
    expect(body.total_bytes).toBe(1000);
    expect(body.languages).toEqual([
      { name: 'TypeScript', bytes: 750, percent: 75 },
      { name: 'JavaScript', bytes: 250, percent: 25 },
      { name: 'Jupyter Notebook', bytes: 0, percent: 0 },
    ]);
  });

  it('returns an empty breakdown instead of guessing when GitHub reports nothing', async () => {
    fetchMock.mockImplementation(
      stubFetch([
        { match: /\/repos\/ankworks\/website$/, response: () => json(repoPayload()) },
        { match: /\/languages/, response: () => json({}) },
      ])
    );
    const { body } = await get(`/api/repos/${REPO}/languages`);
    expect(body.total_bytes).toBe(0);
    expect(body.languages).toEqual([]);
  });
});

describe('repository insights: releases', () => {
  it('keeps GitHub-hosted assets and replaces any other download URL', async () => {
    fetchMock.mockImplementation(
      stubFetch([
        { match: /\/repos\/ankworks\/website$/, response: () => json(repoPayload()) },
        {
          match: /\/releases/,
          response: () =>
            json([
              {
                id: 9,
                tag_name: 'v3.0.0',
                name: 'Forge V3',
                prerelease: true,
                published_at: '2026-02-01T00:00:00Z',
                created_at: '2026-02-01T00:00:00Z',
                body: 'Release notes',
                author: { login: 'alice' },
                assets: [
                  {
                    id: 1,
                    name: 'bundle.zip',
                    size: 2048,
                    download_count: 7,
                    content_type: 'application/zip',
                    browser_download_url: 'https://github.com/ankworks/website/releases/download/v3.0.0/bundle.zip',
                  },
                  {
                    id: 2,
                    name: 'evil.sh',
                    size: 10,
                    download_count: 0,
                    content_type: 'text/plain',
                    browser_download_url: 'https://evil.example.test/evil.sh',
                  },
                  {
                    id: 3,
                    name: 'javascript-payload',
                    size: 10,
                    download_count: 0,
                    content_type: 'text/plain',
                    browser_download_url: 'javascript:alert(1)',
                  },
                ],
              },
            ]),
        },
      ])
    );

    const { status, body } = await get(`/api/repos/${REPO}/releases`);
    expect(status).toBe(200);
    const release = (body.releases as Array<Record<string, unknown>>)[0] as { assets: Array<Record<string, unknown>>; prerelease: boolean };
    expect(release.prerelease).toBe(true);
    expect(release.assets[0]?.browser_download_url).toBe(
      'https://github.com/ankworks/website/releases/download/v3.0.0/bundle.zip'
    );
    // Unsafe or unknown hosts fall back to the release page, never to the payload.
    expect(release.assets[1]?.browser_download_url).toBe(
      'https://github.com/ankworks/website/releases/tag/v3.0.0'
    );
    expect(release.assets[2]?.browser_download_url).toBe(
      'https://github.com/ankworks/website/releases/tag/v3.0.0'
    );
  });
});

describe('repository insights: GitHub Actions (read-only)', () => {
  it('lists workflows and degrades to an empty list when Actions is unavailable', async () => {
    fetchMock.mockImplementation(
      stubFetch([
        { match: /\/repos\/ankworks\/website$/, response: () => json(repoPayload()) },
        {
          match: /\/actions\/workflows/,
          response: () =>
            json({ total_count: 1, workflows: [{ id: 77, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' }] }),
        },
      ])
    );
    const { body } = await get(`/api/repos/${REPO}/workflows`);
    expect(body.total_count).toBe(1);
    const workflows = body.workflows as Array<Record<string, unknown>>;
    expect(workflows[0]?.html_url).toBe('https://github.com/ankworks/website/actions/workflows/.github%2Fworkflows%2Fci.yml');

    fetchMock.mockImplementation(
      stubFetch([
        { match: /\/repos\/ankworks\/website$/, response: () => json(repoPayload()) },
        { match: /\/actions\/workflows/, response: () => json({ message: 'Actions disabled' }, { status: 403 }) },
      ])
    );
    const disabled = await get(`/api/repos/${REPO}/workflows`);
    expect(disabled.status).toBe(200);
    expect(disabled.body.workflows).toEqual([]);
  });

  it('derives run durations and never exposes logs or secrets', async () => {
    fetchMock.mockImplementation(
      stubFetch([
        { match: /\/repos\/ankworks\/website$/, response: () => json(repoPayload()) },
        {
          match: /\/actions\/runs/,
          response: () =>
            json({
              total_count: 1,
              workflow_runs: [
                {
                  id: 555,
                  name: 'CI',
                  display_title: 'CI on main',
                  status: 'completed',
                  conclusion: 'success',
                  event: 'push',
                  head_branch: 'main',
                  head_sha: 'b'.repeat(40),
                  run_number: 12,
                  run_attempt: 1,
                  run_started_at: '2026-03-01T10:00:00Z',
                  updated_at: '2026-03-01T10:01:30Z',
                  created_at: '2026-03-01T10:00:00Z',
                  actor: { login: 'alice' },
                  workflow_id: 77,
                  // Upstream URLs are ignored; the link is rebuilt from validated parts.
                  html_url: 'https://api.github.com/INTERNAL/secret',
                  logs_url: 'https://api.github.com/INTERNAL/logs',
                  secrets: ['SHOULD_NEVER_APPEAR'],
                },
              ],
            }),
        },
      ])
    );

    const { body } = await get(`/api/repos/${REPO}/runs?branch=main`);
    const run = (body.runs as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    expect(run.duration_ms).toBe(90_000);
    expect(run.conclusion).toBe('success');
    expect(run.html_url).toBe('https://github.com/ankworks/website/actions/runs/555');
    expect(run.logs_url).toBeUndefined();
    expect(run.secrets).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('SHOULD_NEVER_APPEAR');
  });

  it('rejects an invalid branch or status filter', async () => {
    fetchMock.mockImplementation(
      stubFetch([{ match: /\/repos\/ankworks\/website$/, response: () => json(repoPayload()) }])
    );
    expect((await get(`/api/repos/${REPO}/runs?branch=..bad`)).status).toBe(400);
    expect((await get(`/api/repos/${REPO}/runs?status=<script>`)).status).toBe(400);
  });
});

describe('repository document tabs', () => {
  const listing = (entries: Array<Record<string, unknown>>) => () => json(entries);

  it('lists only documents that actually exist at the ref', async () => {
    fetchMock.mockImplementation(
      stubFetch([
        { match: /\/repos\/ankworks\/website$/, response: () => json(repoPayload()) },
        { match: /\/commits\/main$/, response: () => json(commitPayload()) },
        {
          match: /\/contents\?ref=/,
          response: listing([
            { type: 'file', name: 'LICENSE', path: 'LICENSE', sha: 'c'.repeat(40), size: 1000 },
            { type: 'dir', name: 'docs', path: 'docs', sha: 'd'.repeat(40), size: 0 },
          ]),
        },
        {
          match: /\/contents\/\.github\?ref=/,
          response: listing([{ type: 'file', name: 'SECURITY.md', path: '.github/SECURITY.md', sha: 'e'.repeat(40), size: 10 }]),
        },
        {
          match: /\/readme\?ref=/,
          response: () => json({ type: 'file', name: 'README.md', path: 'README.md', sha: 'f'.repeat(40), size: 20, encoding: 'base64', content: '' }),
        },
      ])
    );

    const { status, body } = await get(`/api/repos/${REPO}/docs?ref=main`);
    expect(status).toBe(200);
    const docs = body.docs as Array<Record<string, unknown>>;
    expect(docs.map((doc) => doc.key)).toEqual(['readme', 'license', 'security']);
    // "Contributing" is absent, so no tab is offered for it.
    expect(docs.map((doc) => doc.key)).not.toContain('contributing');
  });

  it('returns 404 for a document the repository does not have', async () => {
    fetchMock.mockImplementation(
      stubFetch([
        { match: /\/repos\/ankworks\/website$/, response: () => json(repoPayload()) },
        { match: /\/commits\/main$/, response: () => json(commitPayload()) },
        { match: /\/contents\?ref=/, response: listing([]) },
        { match: /\/contents\/\.github\?ref=/, response: () => json({ message: 'Not Found' }, { status: 404 }) },
      ])
    );

    const { status, body } = await get(`/api/repos/${REPO}/doc?ref=main&key=contributing`);
    expect(status).toBe(404);
    expect(body.error).toBe('DOC_NOT_FOUND');
  });

  it('rejects an unknown document key', async () => {
    fetchMock.mockImplementation(
      stubFetch([
        { match: /\/repos\/ankworks\/website$/, response: () => json(repoPayload()) },
        { match: /\/commits\/main$/, response: () => json(commitPayload()) },
      ])
    );
    expect((await get(`/api/repos/${REPO}/doc?ref=main&key=changelog`)).status).toBe(400);
  });
});
