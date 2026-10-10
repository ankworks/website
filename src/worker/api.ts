/**
 * GET /api/repos — public repositories of the AnkWorks GitHub organization.
 *
 * - Uses unauthenticated GitHub REST requests unless the optional GITHUB_TOKEN
 *   Worker secret is configured. The token is only sent upstream, never returned.
 * - Follows GitHub pagination via the Link header (no assumed repository count).
 * - Applies a timeout to every upstream request and maps failures to explicit errors.
 * - Returns only public, sanitized repositories and caches successful results for 5 minutes.
 * - Does not return partial data: if any page fails, the whole request fails.
 */

import { sanitizeRepository } from '../shared/repository';
import type { ApiError, Repository, RepositoriesResponse } from '../types';
import type { Env } from './env';

const GITHUB_API_ORIGIN = 'https://api.github.com';
const ORG_NAME = 'ankworks';
const USER_AGENT = 'AnkWorks-Website/1.0 (+https://works.ankb.qzz.io)';
const GITHUB_API_VERSION = '2022-11-28';
const PER_PAGE = 100;
/** Safety ceiling: 30 pages × 100 repositories. Exceeding it is reported as an error. */
const MAX_PAGES = 30;
const UPSTREAM_TIMEOUT_MS = 8000;
export const CACHE_TTL_SECONDS = 5 * 60;
const API_PATH = '/api/repos';

/** Error raised for any failure that should be returned to the client. */
export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  retryAfterSeconds?: number
): Response {
  const body: ApiError = { error: code, message, status };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(retryAfterSeconds);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function buildPageUrl(page: number): string {
  const url = new URL(`/orgs/${ORG_NAME}/repos`, GITHUB_API_ORIGIN);
  url.searchParams.set('type', 'public');
  url.searchParams.set('per_page', String(PER_PAGE));
  url.searchParams.set('page', String(page));
  return url.toString();
}

/** Numeric id of the AnkWorks organization (used by GitHub in pagination links). */
const ORG_ID = 340385619;

/**
 * Only follow pagination links that stay on this organization's repository listing.
 * GitHub returns the numeric form (/organizations/{id}/repos) in Link headers.
 */
function isAllowedPageUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return (
      url.origin === GITHUB_API_ORIGIN &&
      (url.pathname === `/orgs/${ORG_NAME}/repos` || url.pathname === `/organizations/${ORG_ID}/repos`)
    );
  } catch {
    return false;
  }
}

export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

function retryAfterFromHeaders(response: Response): number {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.ceil(retryAfter);
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    return Math.max(1, Math.ceil(reset - Date.now() / 1000));
  }
  return 60;
}

async function requestGitHubPage(url: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    return await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new UpstreamError(504, 'GITHUB_TIMEOUT', 'GitHub API did not respond in time. Please try again later.');
    }
    throw new UpstreamError(502, 'GITHUB_UNREACHABLE', 'Could not reach the GitHub API. Please try again later.');
  }
}

function assertUpstreamOk(response: Response): void {
  if (response.ok) return;

  const remaining = response.headers.get('x-ratelimit-remaining');
  const isRateLimited =
    response.status === 429 ||
    (response.status === 403 && (remaining === '0' || response.headers.has('retry-after')));
  if (isRateLimited) {
    throw new UpstreamError(
      429,
      'GITHUB_RATE_LIMITED',
      'GitHub API rate limit reached. Please try again later.',
      retryAfterFromHeaders(response)
    );
  }
  if (response.status === 404) {
    throw new UpstreamError(404, 'ORG_NOT_FOUND', 'The GitHub organization could not be found.');
  }
  if (response.status >= 500) {
    throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'GitHub API is currently unavailable. Please try again later.');
  }
  throw new UpstreamError(502, 'GITHUB_ERROR', `GitHub API returned an unexpected status (${response.status}).`);
}

async function readPagePayload(response: Response): Promise<unknown[]> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new UpstreamError(502, 'INVALID_UPSTREAM_RESPONSE', 'GitHub API returned an invalid response.');
  }
  if (!Array.isArray(payload)) {
    throw new UpstreamError(502, 'INVALID_UPSTREAM_RESPONSE', 'GitHub API returned an unexpected response format.');
  }
  return payload;
}

/** Fetch every public repository of the organization, following pagination. */
export async function fetchAllPublicRepos(env: Pick<Env, 'GITHUB_TOKEN'>): Promise<Repository[]> {
  const repos: Repository[] = [];
  const seenIds = new Set<number>();
  let nextUrl: string | null = buildPageUrl(1);
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

    const response = await requestGitHubPage(nextUrl, env.GITHUB_TOKEN);
    assertUpstreamOk(response);
    const payload = await readPagePayload(response);

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
      throw new UpstreamError(502, 'INVALID_UPSTREAM_RESPONSE', 'GitHub API returned an unexpected pagination link.');
    }
    nextUrl = link;
  }

  return repos;
}

function withCacheHeader(response: Response, value: 'HIT' | 'MISS'): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Cache', value);
  return new Response(response.body, { status: response.status, headers });
}

/** Handle GET /api/repos. Returns an error Response for every failure path. */
export async function handleApiRequest(
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== API_PATH) {
    return errorResponse(404, 'NOT_FOUND', 'API endpoint not found.');
  }
  if (request.method !== 'GET') {
    const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
    response.headers.set('Allow', 'GET');
    return response;
  }

  // Cache key is normalized (no query string) so arbitrary query params cannot bloat the cache.
  const cacheKey = new Request(new URL(API_PATH, url.origin).toString(), { method: 'GET' });
  const cache = caches.default;

  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return withCacheHeader(cached, 'HIT');
    }
  } catch (error) {
    // A cache failure must not break the endpoint; fall through to a fresh fetch.
    // eslint-disable-next-line no-console
    console.error('Cache read failed', error);
  }

  try {
    const repos = await fetchAllPublicRepos(env);
    const body: RepositoriesResponse = {
      org: ORG_NAME,
      repos,
      total_count: repos.length,
      fetched_at: new Date().toISOString(),
    };
    const response = new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
        'X-Content-Type-Options': 'nosniff',
      },
    });

    // Store only successful responses; errors are never cached.
    const toStore = response.clone();
    const store = cache.put(cacheKey, toStore).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('Cache write failed', error);
    });
    if (ctx) {
      ctx.waitUntil(store);
    } else {
      await store;
    }

    return withCacheHeader(response, 'MISS');
  } catch (error) {
    if (error instanceof UpstreamError) {
      return errorResponse(error.status, error.code, error.message, error.retryAfterSeconds);
    }
    // eslint-disable-next-line no-console
    console.error('Unexpected error while loading repositories', error);
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
