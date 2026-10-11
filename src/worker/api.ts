/**
 * Read-only JSON API for the AnkWorks repository explorer.
 *
 * GET /api/repos                              public repositories (sanitized list)
 * GET /api/org                                organization profile
 * GET /api/org/profile-readme                 organization profile README (fixed path)
 * GET /api/activity?limit=                    public organization activity
 * GET /api/issues and /api/pulls               public organization collaboration search
 * GET /api/repos/:repo                        repository metadata
 * GET /api/repos/:repo/branches?page=         branch list (paginated)
 * GET /api/repos/:repo/tags?page=             tag list (paginated)
 * GET /api/repos/:repo/issues/*               issues and comments (read-only)
 * GET /api/repos/:repo/pulls/*                pull requests and review data (read-only)
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
import type { TagsResponse } from '../types/collaboration';
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
import { sanitizeBranch, sanitizeCommit, sanitizeOrganization, sanitizeRepositoryDetail, sanitizeTag } from './sanitize';
import { handleOrgProfileReadme, handleRepoRoute } from './explorer';
import { handleAuthRoute } from './auth';
import { handleChangesRoute } from './changes';
import { handleCollabWrite, isCollabWriteRequest } from './collab-writes';
import { handleGuestRoute, isModerationRequest } from './guest';
import { handleNotifications, handleSearch } from './search';
import { handleHealth, newRequestId, trackApiOutcome } from './ops';
import { handleOrganizationActivity, handleOrganizationIssues, handleRepositoryCollaboration, validateRepositoryCollaborationRequest } from './collaboration';
import { logEvent } from './logging';
import { requireFilePath, requirePath, requireRef, requireRepo } from './params';
import { handleInsightRoute, isInsightAction, logInsightRequest, type InsightAction } from './insights';
import {
  handleFeaturedAdminRoute,
  handleFeaturedList,
  handleMembershipRequest,
} from './featured';

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

async function verifyPublicRepository(repo: string, env: Env): Promise<void> {
  // Check visibility live before every scoped read. This prevents a newly-private
  // repository's previously public data from being served from a route cache.
  const response = await githubGet(buildGitHubUrl(repoApiPath(repo)), env, {
    notFound: { code: 'REPO_NOT_FOUND', message: 'Repository not found.' },
  });
  const detail = sanitizeRepositoryDetail(await readJson(response), repo);
  if (!detail) throw new UpstreamError(404, 'REPO_NOT_FOUND', 'Repository not found.');
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

async function handleTags(repo: string, params: URLSearchParams, request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const page = parsePositiveInt(params.get('page'), 1, 1000);
  const perPage = parsePositiveInt(params.get('per_page'), 50, 100);
  if (page === null || perPage === null) throw new UpstreamError(400, 'INVALID_PARAMETER', 'Invalid pagination parameters.');

  const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/tags`, { page, per_page: perPage });
  return serveCached(key, ctx, async () => {
    const url = buildGitHubUrl(repoApiPath(repo, '/tags'), { per_page: perPage, page });
    const response = await githubGet(url, env, {
      notFound: { code: 'REPO_NOT_FOUND', message: 'Repository not found.' },
    });
    const tags = expectArray(await readJson(response))
      .map(sanitizeTag)
      .filter((tag): tag is NonNullable<typeof tag> => tag !== null);
    const body: TagsResponse = { tags, page, per_page: perPage, has_next: hasNextPage(response) };
    return jsonResponse(body, CACHE_TTL_SECONDS);
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

function validateScopedParameters(action: string, number: string | undefined, subresource: string | undefined, params: URLSearchParams): void {
  if (action === 'issues' || action === 'pulls') {
    validateRepositoryCollaborationRequest(action, number, subresource, params);
    return;
  }
  if (number !== undefined || subresource !== undefined) throw new UpstreamError(404, 'NOT_FOUND', 'API endpoint not found.');

  if (action === 'branches' || action === 'tags' || action === 'commits') {
    const page = parsePositiveInt(params.get('page'), 1, action === 'commits' ? 10_000 : 1000);
    const perPage = parsePositiveInt(params.get('per_page'), action === 'commits' ? 30 : 50, 100);
    if (page === null || perPage === null) throw new UpstreamError(400, 'INVALID_PARAMETER', 'Invalid pagination parameters.');
  }
  if (action === 'commits' || action === 'tree' || action === 'last-commit' || action === 'file' || action === 'readme' || action === 'raw') {
    requireRef(params);
  }
  if (action === 'tree' || action === 'last-commit') requirePath(params);
  if (action === 'file' || action === 'raw') requireFilePath(params);
}

/** Route public repository and collaboration reads through the scoped Worker API. */
async function handleRepoScoped(
  repoSegment: string,
  action: string,
  number: string | undefined,
  subresource: string | undefined,
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

  const knownActions = ['branches', 'tags', 'commits', 'tree', 'last-commit', 'file', 'readme', 'raw', 'issues', 'pulls'];
  if (!knownActions.includes(action)) throw new UpstreamError(404, 'NOT_FOUND', 'API endpoint not found.');

  validateScopedParameters(action, number, subresource, params);

  // A configured GITHUB_TOKEN must never turn a public route into a private-repository proxy.
  // Verify visibility before consulting any scoped data cache.
  await verifyPublicRepository(repo, env);

  if (action === 'issues' || action === 'pulls') {
    return handleRepositoryCollaboration({
      repo,
      resource: action,
      number,
      subresource,
      params,
      request,
      env,
      ctx,
    });
  }
  if (number !== undefined || subresource !== undefined) throw new UpstreamError(404, 'NOT_FOUND', 'API endpoint not found.');
  if (action === 'branches') return handleBranches(repo, params, request, env, ctx);
  if (action === 'tags') return handleTags(repo, params, request, env, ctx);
  if (action === 'commits') return handleCommits(repo, params, request, env, ctx);
  return handleRepoRoute({ action, repo, params, request, env, ctx });
}

/** Entry point for every /api request. Returns an error Response for every failure path. */
export async function handleApiRequest(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const startedAt = Date.now();
  const path = url.pathname;
  logEvent('debug', 'api_request', { method: request.method, path });

  const requestId = newRequestId();
  const complete = (response: Response): Response => {
    logEvent(response.ok ? 'debug' : 'warn', 'api_response', {
      status: response.status,
      durationMs: Date.now() - startedAt,
      path,
      requestId,
    });
    trackApiOutcome(response, requestId);
    response.headers.set('X-Request-Id', requestId);
    return response;
  };

  try {
    // Auth routes handle their own method gating (login/callback/session are
    // GET, logout is POST) and manage session cookies — dispatch before the
    // GET-only rule so their errors surface through the shared handler.
    if (path === '/api/auth/login' || path === '/api/auth/callback' || path === '/api/auth/session' || path === '/api/auth/logout' || path === '/api/auth/permissions') {
      return complete(await handleAuthRoute(request, env));
    }

    // V3-B: the signed-in user's own membership status. Private, never cached.
    if (path === '/api/auth/membership') return complete(await handleMembershipRequest(request, env));

    // V3-A: public list of featured (pinned) repositories.
    if (path === '/api/featured') {
      if (request.method !== 'GET') {
        const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
        response.headers.set('Allow', 'GET');
        return complete(response);
      }
      return complete(await handleFeaturedList(request, env, ctx));
    }

    // V3-E: Forge administration routes (featured pins for now).
    if (path.startsWith('/api/admin/')) {
      const result = await handleFeaturedAdminRoute(path, request, env);
      if (result) return complete(result);
    }

    // V3-A: repository insights (contributors, languages, releases, actions, docs).
    const insightMatch = /^\/api\/repos\/([^/]+)\/([a-z-]+)$/.exec(path);
    if (insightMatch && isInsightAction(insightMatch[2] ?? '')) {
      if (request.method !== 'GET') {
        const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
        response.headers.set('Allow', 'GET');
        return complete(response);
      }
      let decoded: string;
      try {
        decoded = decodeURIComponent(insightMatch[1] ?? '');
      } catch {
        return complete(errorResponse(400, 'INVALID_REPO', 'Invalid repository name.'));
      }
      const repo = requireRepo(decoded);
      await verifyPublicRepository(repo, env);
      const action = (insightMatch[2] ?? '') as InsightAction;
      logInsightRequest(action);
      return complete(await handleInsightRoute(action, repo, request, env, ctx));
    }

    // Authenticated writes and compare (Milestone C): POST commit/branches,
    // GET compare. GET /branches passes through to the read-only list route.
    const changesMatch = /^\/api\/repos\/([^/]+)\/(commit|branches|compare)$/.exec(path);
    if (changesMatch) {
      const action = changesMatch[2];
      const passthrough = action === 'branches' && request.method === 'GET';
      if (!passthrough) {
        return complete(await handleChangesRoute(action, changesMatch[1], request, env));
      }
    }

    // Collaboration writes (Milestone D): issues, comments, reviews, merges.
    if (isCollabWriteRequest(request.method, path)) {
      return complete(await handleCollabWrite(path, request, env));
    }

    // Guest submissions and moderation (Milestone E).
    if (path === '/api/guest/issues' || path === '/api/guest/config' || isModerationRequest(request.method, path)) {
      return complete(await handleGuestRoute(path, request, env));
    }

    // Search, notifications, and health (Milestone F).
    if (path === '/api/search') return complete(await handleSearch(request));
    if (path === '/api/notifications') return complete(await handleNotifications(request, env));
    if (path === '/api/health') return complete(handleHealth(request));

    if (request.method !== 'GET') {
      const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
      response.headers.set('Allow', 'GET');
      return complete(response);
    }

    if (url.pathname === REPOS_PATH) return complete(await handleRepositoryList(request, env, ctx));
    if (url.pathname === '/api/org') return complete(await handleOrganization(request, env, ctx));
    if (url.pathname === '/api/org/profile-readme') return complete(await handleOrgProfileReadme(request, env, ctx));
    if (url.pathname === '/api/activity') return complete(await handleOrganizationActivity(request, env, ctx));
    if (url.pathname === '/api/issues') return complete(await handleOrganizationIssues('issues', request, env, ctx));
    if (url.pathname === '/api/pulls') return complete(await handleOrganizationIssues('pulls', request, env, ctx));

    const match = /^\/api\/repos\/([^/]+)(?:\/([a-z-]+)(?:\/([^/]+)(?:\/([a-z-]+))?)?)?$/.exec(url.pathname);
    if (match) {
      return complete(await handleRepoScoped(match[1], match[2] ?? '', match[3], match[4], request, env, ctx));
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

