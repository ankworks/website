/**
 * Browser client for repository insights (V3-A).
 *
 * Same contract as the explorer client: never call GitHub directly, shape-check
 * every payload, cache successes briefly, never cache errors.
 *
 * Authenticated calls (membership) explicitly bypass the cache and force
 * `no-store`, because a private answer must never be reused from memory across
 * sessions.
 */

import {
  isContributorsResponse,
  isLanguagesResponse,
  isReleasesResponse,
  isRepoDocResponse,
  isRepoDocsResponse,
  isWorkflowsResponse,
  isWorkflowRunsResponse,
  type ContributorsResponse,
  type LanguagesResponse,
  type ReleasesResponse,
  type RepoDocKey,
  type RepoDocResponse,
  type RepoDocsResponse,
  type WorkflowsResponse,
  type WorkflowRunsResponse,
} from '../shared/insights';
import { isMembershipResponse, type MembershipResponse } from '../shared/membership';
import { isIssueTemplatesResponse, type IssueTemplatesResponse } from '../shared/issue-templates';
import { ExplorerApiError } from './explorer';

const API_BASE = '/api';
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60_000;

type Guard<T> = (value: unknown) => value is T;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export function buildUrl(path: string, query: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${API_BASE}${path}?${qs}` : `${API_BASE}${path}`;
}

function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;
}

async function readError(response: Response): Promise<ExplorerApiError> {
  let message = 'The request failed.';
  let code = 'REQUEST_FAILED';
  try {
    const body: unknown = await response.json();
    if (isRecord(body)) {
      if (typeof body.message === 'string' && body.message) message = body.message;
      if (typeof body.error === 'string' && body.error) code = body.error;
    }
  } catch {
    // Keep the generic message when the error body is not JSON.
  }
  const retryAfter = Number(response.headers.get('Retry-After'));
  return new ExplorerApiError(
    message,
    response.status,
    code,
    Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined
  );
}

async function getJson<T>(url: string, guard: Guard<T>, options: { cache: boolean } = { cache: true }): Promise<T> {
  if (options.cache) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
    const pending = inflight.get(url);
    if (pending) return pending as Promise<T>;
  }

  const request = (async (): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: options.cache ? 'default' : 'no-store',
        signal: timeoutSignal(),
      });
    } catch {
      throw new ExplorerApiError('Could not reach the Forge service.', 0, 'NETWORK_ERROR');
    }
    if (!response.ok) throw await readError(response);
    const body: unknown = await response.json().catch(() => null);
    if (!guard(body)) {
      throw new ExplorerApiError('The Forge service returned an invalid response.', response.status, 'INVALID_RESPONSE');
    }
    if (options.cache) cache.set(url, { at: Date.now(), value: body });
    return body;
  })().finally(() => {
    inflight.delete(url);
  });

  if (options.cache) inflight.set(url, request);
  return request;
}

export interface FileSearchResponse {
  repo: string;
  ref: string;
  commit_sha: string;
  query: string;
  hits: Array<{ path: string; name: string }>;
  truncated: boolean;
}

const isFileSearchResponse: Guard<FileSearchResponse> = (value): value is FileSearchResponse =>
  isRecord(value) && Array.isArray(value.hits) && typeof value.commit_sha === 'string';

export const insightsApi = {
  contributors: (repo: string, page = 1): Promise<ContributorsResponse> =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}/contributors`, { page, per_page: 30 }), isContributorsResponse),

  languages: (repo: string): Promise<LanguagesResponse> =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}/languages`), isLanguagesResponse),

  releases: (repo: string, page = 1): Promise<ReleasesResponse> =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}/releases`, { page, per_page: 20 }), isReleasesResponse),

  workflows: (repo: string, page = 1): Promise<WorkflowsResponse> =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}/workflows`, { page, per_page: 30 }), isWorkflowsResponse),

  runs: (repo: string, page = 1, branch?: string, status?: string): Promise<WorkflowRunsResponse> =>
    getJson(
      buildUrl(`/repos/${encodeURIComponent(repo)}/runs`, { page, per_page: 20, branch, status }),
      isWorkflowRunsResponse
    ),

  /** "Go to file": bounded path filter over one recursive tree listing. */
  fileSearch: (repo: string, ref: string, query: string): Promise<FileSearchResponse> =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}/file-search`, { ref, q: query }), isFileSearchResponse),

  /** Documents that actually exist at the ref (README / Contributing / License / Security). */
  docs: (repo: string, ref: string): Promise<RepoDocsResponse> =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}/docs`, { ref }), isRepoDocsResponse),

  doc: (repo: string, ref: string, key: RepoDocKey): Promise<RepoDocResponse> =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}/doc`, { ref, key }), isRepoDocResponse),

  /**
   * The signed-in user's own membership status.
   * Never cached: an authorization answer must always be fresh.
   */
  membership: (): Promise<MembershipResponse> =>
    getJson(buildUrl('/auth/membership'), isMembershipResponse, { cache: false }),

  /** V3-C: issue templates from `.github/ISSUE_TEMPLATE/` (display only). */
  issueTemplates: (repo: string, ref?: string): Promise<IssueTemplatesResponse> =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}/issue-templates`, { ref }), isIssueTemplatesResponse),
};

/** Clear cached insight responses (tests and explicit refresh). */
export function clearInsightsCache(): void {
  cache.clear();
  inflight.clear();
}
