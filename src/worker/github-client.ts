/**
 * Bounded, allowlisted client for the GitHub REST API.
 *
 * Security properties:
 * - Only https://api.github.com with paths under /orgs/ankworks or /repos/ankworks/
 *   plus the fixed /search/issues endpoint can be requested. Arbitrary URLs never reach fetch().
 * - Every request has a timeout; every body read has a byte limit.
 * - Redirects use "manual" mode: workerd's fetch only implements "follow" and
 *   "manual" (redirect: "error" throws a TypeError before the request is sent),
 *   and a redirect is followed only when its target stays inside the same
 *   allowlist, up to a bounded number of hops.
 * - The optional GITHUB_TOKEN is sent upstream only and never echoed back.
 * - Upstream failures are mapped to explicit, non-sensitive error codes:
 *   GITHUB_RATE_LIMITED (429), GITHUB_TIMEOUT (504), GITHUB_NETWORK_ERROR (502),
 *   GITHUB_UPSTREAM_ERROR (502), GITHUB_RESPONSE_INVALID (502).
 */
import type { ApiError } from '../types';
import { EXPLORER_LIMITS } from '../shared/limits';
import { ORG_NAME, isValidRepoName, encodePathSegments } from '../shared/validation';
import { logEvent } from './logging';

export const GITHUB_API_ORIGIN = 'https://api.github.com';
const USER_AGENT = 'AnkWorks-Website/1.0 (+https://works.ankb.qzz.io)';
const GITHUB_API_VERSION = '2022-11-28';
export const UPSTREAM_TIMEOUT_MS = 8000;
/** Maximum number of redirects followed for a single logical request. */
const MAX_REDIRECTS = 3;

/** Error that is safe to return to the browser. */
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

/** Headers sent with every API response (static assets get theirs from public/_headers). */
export const API_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

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
    ...API_SECURITY_HEADERS,
  };
  if (retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(retryAfterSeconds);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function jsonResponse(body: unknown, ttlSeconds: number): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`,
      ...API_SECURITY_HEADERS,
    },
  });
}

type QueryValue = string | number | undefined;

/** Build an allowlisted GitHub API URL. Throws for any path outside the organization. */
export function buildGitHubUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(path, GITHUB_API_ORIGIN);
  const allowed =
    url.pathname === `/orgs/${ORG_NAME}` ||
    url.pathname.startsWith(`/orgs/${ORG_NAME}/`) ||
    url.pathname.startsWith(`/repos/${ORG_NAME}/`) ||
    url.pathname === '/search/issues';
  if (url.origin !== GITHUB_API_ORIGIN || !allowed) {
    throw new UpstreamError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/** API path for a repository of the organization. The name is validated first. */
export function repoApiPath(repo: string, suffix = ''): string {
  if (!isValidRepoName(repo)) {
    throw new UpstreamError(400, 'INVALID_REPO', 'Invalid repository name.');
  }
  return `/repos/${ORG_NAME}/${encodeURIComponent(repo)}${suffix}`;
}

export interface GitHubGetOptions {
  token?: string;
  accept?: string;
  /** Error to report for HTTP 404 (defaults to a generic not-found). */
  notFound?: { code: string; message: string };
  /** Error to report for HTTP 422 (GitHub uses it for unknown refs). */
  unprocessable?: { code: string; message: string };
  /**
   * Error to report for HTTP 403 that is NOT rate limiting. GitHub answers 403
   * for features that are switched off (for example Actions), and a caller may
   * prefer an explicit "unavailable" code over a generic upstream failure.
   */
  forbidden?: { code: string; message: string };
}

function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  return response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after');
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

type FetchFailureStage = 'upstream_fetch' | 'upstream_body';

/** Map a rejected fetch (or body read) to a safe, explicit upstream error. */
export function mapFetchError(
  error: unknown,
  stage: FetchFailureStage = 'upstream_fetch',
  durationMs: number | null = null
): UpstreamError {
  if (error instanceof UpstreamError) return error;
  const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  const mapped = isTimeout
    ? new UpstreamError(504, 'GITHUB_TIMEOUT', 'GitHub API did not respond in time. Please try again later.')
    : new UpstreamError(502, 'GITHUB_NETWORK_ERROR', 'Could not reach the GitHub API. Please try again later.');
  logEvent('warn', 'github_api_failure', { stage, errorName: error instanceof Error ? error.name : typeof error, durationMs, upstreamStatus: null });
  return mapped;
}

/** Map a non-OK upstream response to an UpstreamError. */
export function upstreamErrorFor(response: Response, options: GitHubGetOptions = {}): UpstreamError {
  if (isRateLimited(response)) {
    return new UpstreamError(
      429,
      'GITHUB_RATE_LIMITED',
      'GitHub API rate limit reached. Please try again later.',
      retryAfterFromHeaders(response)
    );
  }
  if (response.status === 403 && options.forbidden) {
    return new UpstreamError(403, options.forbidden.code, options.forbidden.message);
  }
  if (response.status === 404) {
    const notFound =
      options.notFound ?? { code: 'UPSTREAM_NOT_FOUND', message: 'The requested GitHub resource could not be found.' };
    return new UpstreamError(404, notFound.code, notFound.message);
  }
  if (response.status === 422 && options.unprocessable) {
    return new UpstreamError(400, options.unprocessable.code, options.unprocessable.message);
  }
  if (response.status === 451) {
    return new UpstreamError(404, 'REPO_UNAVAILABLE', 'This repository is unavailable.');
  }
  if (response.status >= 500) {
    return new UpstreamError(502, 'GITHUB_UPSTREAM_ERROR', 'GitHub API is currently unavailable. Please try again later.');
  }
  return new UpstreamError(502, 'GITHUB_UPSTREAM_ERROR', 'GitHub API returned an unexpected response. Please try again later.');
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Validate a redirect target against the same allowlist as buildGitHubUrl.
 * Relative locations are resolved against the URL that produced them.
 */
export function validateGitHubRedirect(location: string | null, fromUrl: string): string | null {
  if (!location) return null;
  let url: URL;
  try {
    url = new URL(location, fromUrl);
  } catch {
    return null;
  }
  if (url.origin !== GITHUB_API_ORIGIN || url.username !== '' || url.password !== '') return null;
  const allowed =
    url.pathname === `/orgs/${ORG_NAME}` ||
    url.pathname.startsWith(`/orgs/${ORG_NAME}/`) ||
    url.pathname.startsWith(`/repos/${ORG_NAME}/`) ||
    url.pathname === '/search/issues';
  return allowed ? url.toString() : null;
}

/**
 * Perform GET hops until a non-redirect response arrives. Redirects are only
 * followed when the target stays inside the GitHub allowlist; anything else is
 * an error. The body of redirect responses is never read.
 */
async function fetchGitHub(url: string, headers: Record<string, string>): Promise<Response> {
  let currentUrl = url;
  for (let redirects = 0; ; redirects += 1) {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        headers,
        // workerd only implements "follow" and "manual"; "error" would throw a
        // TypeError before the request is sent. "manual" lets us validate the
        // redirect target against the allowlist before following it.
        redirect: 'manual',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (error) {
      throw mapFetchError(error, 'upstream_fetch', Date.now() - startedAt);
    }
    if (!isRedirectStatus(response.status)) return response;

    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => undefined);
    if (redirects >= MAX_REDIRECTS) {
      logEvent('warn', 'github_api_failure', {
        stage: 'redirect',
        errorName: 'RedirectLimitExceeded',
        durationMs: Date.now() - startedAt,
        upstreamStatus: response.status,
      });
      throw new UpstreamError(502, 'GITHUB_UPSTREAM_ERROR', 'GitHub API returned an unexpected redirect.');
    }
    const nextUrl = validateGitHubRedirect(location, currentUrl);
    if (nextUrl === null) {
      logEvent('warn', 'github_api_failure', {
        stage: 'redirect',
        errorName: 'RedirectOutsideAllowlist',
        durationMs: Date.now() - startedAt,
        upstreamStatus: response.status,
      });
      throw new UpstreamError(502, 'GITHUB_UPSTREAM_ERROR', 'GitHub API returned an unexpected redirect.');
    }
    logEvent('debug', 'github_redirect', { stage: 'redirect', redirect: redirects + 1 });
    currentUrl = nextUrl;
  }
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/** Perform an allowlisted GET against the GitHub API. Resolves only for OK responses. */
export async function githubGet(
  url: string,
  env: { GITHUB_TOKEN?: string },
  options: GitHubGetOptions = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: options.accept ?? 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }

  const startedAt = Date.now();
  logEvent('debug', 'github_fetch_start', { stage: 'upstream_fetch', upstreamPath: pathnameOf(url) });
  const response = await fetchGitHub(url, headers);
  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    logEvent('warn', 'upstream_status', {
      stage: 'upstream_fetch',
      upstreamStatus: response.status,
      durationMs,
      upstreamPath: pathnameOf(url),
    });
    // Drain the body so the connection can be reused; the content is never used.
    await response.body?.cancel().catch(() => undefined);
    throw upstreamErrorFor(response, options);
  }
  return response;
}

/** Read a response body into memory, aborting once `maxBytes` is exceeded. */
export async function readBodyLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamError(502, 'UPSTREAM_TOO_LARGE', 'GitHub returned more data than the explorer allows.');
  }
  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new UpstreamError(502, 'UPSTREAM_TOO_LARGE', 'GitHub returned more data than the explorer allows.');
      }
      chunks.push(value);
    }
  } catch (error) {
    throw mapFetchError(error, 'upstream_body');
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Parse a JSON body with a size limit. */
export async function readJson(response: Response, maxBytes = EXPLORER_LIMITS.UPSTREAM_JSON_MAX_BYTES): Promise<unknown> {
  const bytes = await readBodyLimited(response, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new UpstreamError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub API returned an invalid response.');
  }
}

export function expectArray(payload: unknown): unknown[] {
  if (!Array.isArray(payload)) {
    throw new UpstreamError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub API returned an unexpected response format.');
  }
  return payload;
}

export function expectObject(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new UpstreamError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub API returned an unexpected response format.');
  }
  return payload as Record<string, unknown>;
}

/** Contents path → API URL segment (no trailing slash for the repository root). */
export function contentsApiPath(repo: string, path: string): string {
  return path === '' ? repoApiPath(repo, '/contents') : repoApiPath(repo, `/contents/${encodePathSegments(path)}`);
}

const LINK_NEXT = /<([^>]+)>\s*;\s*rel="next"/;

/** True when a Link header advertises a next page. */
export function hasNextPage(response: Response): boolean {
  return LINK_NEXT.test(response.headers.get('link') ?? '');
}

/** Extract the rel="next" URL from a Link header. */
export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}
