/**
 * Browser client for the repository list (GET /api/repos).
 *
 * The browser never calls api.github.com directly: the Worker owns the upstream
 * request, caching, pagination, and sanitization. Other explorer endpoints live
 * in ./explorer.ts.
 */
import type { ApiError, Repository, RepositoriesResponse } from '../types';
import { normalizeRepository, isValidRepository, sanitizeRepository } from '../shared/repository';

export { normalizeRepository, isValidRepository };

const REPOS_ENDPOINT = '/api/repos';
const REQUEST_TIMEOUT_MS = 15000;
/** Client-side cache duration; matches the Worker cache TTL (5 minutes). */
const CACHE_DURATION = 5 * 60 * 1000;

let reposCache: { data: Repository[]; timestamp: number } | null = null;
let inflightRequest: Promise<Repository[]> | null = null;

/** Error thrown by the client; `code` mirrors the Worker's error code when available. */
export class RepositoryApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'RepositoryApiError';
  }
}

function isRepositoriesResponse(value: unknown): value is RepositoriesResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { repos?: unknown }).repos)
  );
}

async function readErrorMessage(response: Response): Promise<ApiError | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body) {
      return body as ApiError;
    }
  } catch {
    // Non-JSON error body; fall back to the generic message below.
  }
  return null;
}

async function fetchRepositoriesFromApi(): Promise<Repository[]> {
  let response: Response;
  try {
    response = await fetch(REPOS_ENDPOINT, {
      headers: { Accept: 'application/json' },
      signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
        ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        : undefined,
    });
  } catch {
    throw new RepositoryApiError('Could not load repositories. Check your connection and try again.', 0, 'NETWORK_ERROR');
  }

  if (!response.ok) {
    const apiError = await readErrorMessage(response);
    const retryAfter = Number(response.headers.get('Retry-After'));
    throw new RepositoryApiError(
      apiError?.message || `Failed to load repositories (HTTP ${response.status}).`,
      response.status,
      apiError?.error || 'HTTP_ERROR',
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined
    );
  }

  const body: unknown = await response.json().catch(() => null);
  if (!isRepositoriesResponse(body)) {
    throw new RepositoryApiError('The repository service returned an invalid response.', response.status, 'INVALID_RESPONSE');
  }

  // Defense in depth: re-sanitize every item before it reaches the UI.
  return body.repos
    .map(sanitizeRepository)
    .filter((repo): repo is Repository => repo !== null);
}

/**
 * Get public repositories of the organization (includes forks and archived repos;
 * the UI decides what to show). Uses a 5-minute in-memory cache.
 */
export async function getRepositories(forceRefresh: boolean = false): Promise<Repository[]> {
  if (!forceRefresh && reposCache && Date.now() - reposCache.timestamp < CACHE_DURATION) {
    return reposCache.data;
  }

  if (!inflightRequest) {
    inflightRequest = fetchRepositoriesFromApi()
      .then((data) => {
        reposCache = { data, timestamp: Date.now() };
        return data;
      })
      .finally(() => {
        inflightRequest = null;
      });
  }

  return inflightRequest;
}

/** Drop the client cache so the next call refetches from the Worker. */
export function invalidateCache(): void {
  reposCache = null;
}

/** Expose cache state (used for diagnostics and tests). */
export function getCacheStatus(): { cached: boolean; timestamp: number | null } {
  return {
    cached: reposCache !== null,
    timestamp: reposCache?.timestamp ?? null,
  };
}

export { CACHE_DURATION };
