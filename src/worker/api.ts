/**
 * Read-only JSON API for the AnkWorks repository explorer.
 *
 * GET /api/repos                              public repositories (sanitized list)
 * GET /api/org                                organization profile
 * GET /api/repos/:repo                        repository metadata
 * GET /api/repos/:repo/branches?page=         branch list (paginated)
 * GET /api/repos/:repo/tree?ref=&path=        directory listing
 * GET /api/repos/:repo/last-commit?ref=&path= latest commit touching a path
 * GET /api/repos/:repo/file?ref=&path=        file contents (size and type limited)
 * GET /api/repos/:repo/readme?ref=            README contents (size limited)
 * GET /api/repos/:repo/commits?ref=&page=     commit history (paginated)
 * GET /api/repos/:repo/raw?ref=&path=         raw file download (attachment)
 *
 * `ref` and `path` travel in query parameters, so ref names containing "/"
 * never need to be split out of a URL path. Every route is GET-only.
 */

import { ORG_NAME, parsePositiveInt } from '../shared/validation';
import type { RepositoriesResponse, Repository } from '../types';
import { sanitizeRepository } from '../shared/repository';
import type { Env } from './env';
import { cacheKeyFor, serveCached } from './cache';
import {
  UpstreamError,
  buildGitHubUrl,
  errorResponse,
  expectArray,
  githubGet,
  hasNextPage,
  jsonResponse,
  parseNextLink,
  readJson,
  repoApiPath,
} from './github-client';
import { sanitizeBranch, sanitizeCommit, sanitizeOrganization, sanitizeRepositoryDetail } from './sanitize';
import { handleRepoRoute } from './explorer';
import { logEvent } from './logging';
import { requireRef, requireRepo } from './params';

export { parseNextLink, errorResponse };

export const CACHE_TTL_SECONDS = 5 * 60;
const REPOS_PATH = '/api/repos';
const PER_PAGE = 100;
/** Safety ceiling: 30 pages × 100 repositories. Exceeding it is reported as an error. */
const MAX_PAGES = 30;

/** Numeric id of the AnkWorks organization (GitHub uses /organizations/{id} in some Link headers). */
const ORG_ID = 340385619;

/**
 * Only follow pagination links that stay on this organization's repository list.
 * Anything else is treated as an invalid upstream response.
 */
function isAllowedPageUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return (
      url.origin === 'https://api.github.com' &&
      (url.pathname === `/orgs/${ORG_NAME}/repos` || url.pathname === `/organizations/${ORG_ID}/repos`)
    );
  } catch {
    return false;
  }
}

/** Fetch every public repository of the organization, following pagination. */
export async function fetchAllPublicRepos(env: Pick<Env, 'GITHUB_TOKEN'>): Promise<Repository[]> {
  const repos: Repository[] = [];
  const seenIds = new Set<number>();
  let nextUrl: string | null = buildGitHubUrl(`/orgs/${ORG_NAME}/repos`, { type: 'public', per_page: PER_PAGE, page: 1 });
  let pagesFetched = 0;

  while (nextUrl) {
    if (pagesFetched >= MAX_PAGES) {
      throw new UpstreamError(
        502,
        'PAGINATION_LIMIT',
        `The organization has more than ${MAX_PAGES * PER_PAGE} public repositories; the API limit must be raised.`
      );
    }
    pagesFetched += 1;

    const response = await githubGet(nextUrl, env, {
      notFound: { code: 'ORG_NOT_FOUND', message: 'The GitHub organization could not be found.' },
    });
    const payload = expectArray(await readJson(response));

    for (const item of payload) {
      const repo = sanitizeRepository(item);
      if (repo && !seenIds.has(repo.id)) {
        seenIds.add(repo.id);
        repos.push(repo);
      }
    }

    const link = parseNextLink(response.headers.get('link'));
    if (payload.length === 0 || !link) break;
    if (!isAllowedPageUrl(link)) {
      throw new UpstreamError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub API returned an unexpected pagination link.');
    }
    logEvent('debug', 'github_pagination', { stage: 'pagination', page: pagesFetched + 1 });
    nextUrl = link;
  }

  return repos;
}

async function handleRepositoryList(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const key = cacheKeyFor(new URL(request.url).origin, REPOS_PATH);
  return serveCached(key, ctx, async () => {
    const repos = await fetchAllPublicRepos(env);
    const body: RepositoriesResponse = {
      org: ORG_NAME,
      repos,
      total_count: repos.length,
      fetched_at: new Date().toISOString(),
    };
    return jsonResponse(body, CACHE_TTL_SECONDS);
  });
}

async function handleOrganization(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const key = cacheKeyFor(new URL(request.url).origin, '/api/org');
  return serveCached(key, ctx, async () => {
    const response = await githubGet(buildGitHubUrl(`/orgs/${ORG_NAME}`), env, {
      notFound: { code: 'ORG_NOT_FOUND', message: 'The GitHub organization could not be found.' },
    });
    const org = sanitizeOrganization(await readJson(response));
    if (!org) {
      throw new UpstreamError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub API returned an unexpected response format.');
    }
    return jsonResponse({ org, fetched_at: new Date().toISOString() }, CACHE_TTL_SECONDS);
  });
}

async function handleRepositoryDetail(repo: string, request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}`);
  return serveCached(key, ctx, async () => {
    const response = await githubGet(buildGitHubUrl(repoApiPath(repo)), env, {
      notFound: { code: 'REPO_NOT_FOUND', message: 'Repository not found.' },
    });
    const detail = sanitizeRepositoryDetail(await readJson(response), repo);
    if (!detail) {
      // Private, foreign, or malformed repositories are reported as not found.
      throw new UpstreamError(404, 'REPO_NOT_FOUND', 'Repository not found.');
    }
    return jsonResponse({ repo: detail }, CACHE_TTL_SECONDS);
  });
}

async function handleBranches(repo: string, params: URLSearchParams, request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const page = parsePositiveInt(params.get('page'), 1, 1000);
  const perPage = parsePositiveInt(params.get('per_page'), 50, 100);
  if (page === null || perPage === null) throw new UpstreamError(400, 'INVALID_PARAMETER', 'Invalid pagination parameters.');

  const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/branches`, { page, per_page: perPage });
  return serveCached(key, ctx, async () => {
    const url = buildGitHubUrl(repoApiPath(repo, '/branches'), { per_page: perPage, page });
    const response = await githubGet(url, env, {
      notFound: { code: 'REPO_NOT_FOUND', message: 'Repository not found.' },
    });
    const branches = expectArray(await readJson(response))
      .map(sanitizeBranch)
      .filter((branch): branch is NonNullable<typeof branch> => branch !== null);
    return jsonResponse({ branches, page, per_page: perPage, has_next: hasNextPage(response) }, CACHE_TTL_SECONDS);
  });
}

async function handleCommits(repo: string, params: URLSearchParams, request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const ref = requireRef(params);
  const page = parsePositiveInt(params.get('page'), 1, 10_000);
  const perPage = parsePositiveInt(params.get('per_page'), 30, 100);
  if (page === null || perPage === null) throw new UpstreamError(400, 'INVALID_PARAMETER', 'Invalid pagination parameters.');

  const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/commits`, { ref, page, per_page: perPage });
  return serveCached(key, ctx, async () => {
    const url = buildGitHubUrl(repoApiPath(repo, '/commits'), { sha: ref, per_page: perPage, page });
    const response = await githubGet(url, env, {
      notFound: { code: 'REPO_NOT_FOUND', message: 'Repository not found.' },
      unprocessable: { code: 'REF_NOT_FOUND', message: 'The requested branch, tag, or commit does not exist.' },
    });
    const commits = expectArray(await readJson(response))
      .map((item) => sanitizeCommit(item, repo))
      .filter((commit): commit is NonNullable<typeof commit> => commit !== null);
    return jsonResponse({ ref, commits, page, per_page: perPage, has_next: hasNextPage(response) }, 120);
  });
}

/** Route /api/repos/:repo/* to the explorer handlers. */
async function handleRepoScoped(
  repoSegment: string,
  action: string,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(repoSegment);
  } catch {
    throw new UpstreamError(400, 'INVALID_REPO', 'Invalid repository name.');
  }
  const repo = requireRepo(decoded);
  const params = new URL(request.url).searchParams;

  if (action === '') return handleRepositoryDetail(repo, request, env, ctx);
  if (action === 'branches') return handleBranches(repo, params, request, env, ctx);
  if (action === 'commits') return handleCommits(repo, params, request, env, ctx);
  return handleRepoRoute({ action, repo, params, request, env, ctx });
}

/** Entry point for every /api request. Returns an error Response for every failure path. */
export async function handleApiRequest(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const startedAt = Date.now();
  const path = url.pathname;
  logEvent('debug', 'api_request', { method: request.method, path });

  const complete = (response: Response): Response => {
    logEvent(response.ok ? 'debug' : 'warn', 'api_response', {
      status: response.status,
      durationMs: Date.now() - startedAt,
      path,
    });
    return response;
  };

  if (request.method !== 'GET') {
    const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
    response.headers.set('Allow', 'GET');
    return complete(response);
  }

  try {
    if (url.pathname === REPOS_PATH) return complete(await handleRepositoryList(request, env, ctx));
    if (url.pathname === '/api/org') return complete(await handleOrganization(request, env, ctx));

    const match = /^\/api\/repos\/([^/]+)(?:\/([a-z-]+))?$/.exec(url.pathname);
    if (match) {
      return complete(await handleRepoScoped(match[1], match[2] ?? '', request, env, ctx));
    }

    return complete(errorResponse(404, 'NOT_FOUND', 'API endpoint not found.'));
  } catch (error) {
    if (error instanceof UpstreamError) {
      logEvent('warn', 'api_failure', {
        stage: 'api',
        code: error.code,
        status: error.status,
        errorName: 'UpstreamError',
        durationMs: Date.now() - startedAt,
        path,
      });
      return complete(errorResponse(error.status, error.code, error.message, error.retryAfterSeconds));
    }
    // eslint-disable-next-line no-console
    console.error('Unexpected error in API handler', error);
    logEvent('error', 'api_failure', {
      stage: 'api',
      code: 'INTERNAL_ERROR',
      status: 500,
      errorName: error instanceof Error ? error.name : typeof error,
      durationMs: Date.now() - startedAt,
      path,
    });
    return complete(errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred.'));
  }
}

