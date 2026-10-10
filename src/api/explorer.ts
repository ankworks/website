/**
 * Browser client for the explorer endpoints of the AnkWorks Worker.
 *
 * The browser never calls api.github.com. Responses are shape-checked, and
 * successful responses are cached briefly in memory so back/forward navigation
 * and repeated views do not refetch. Errors are never cached.
 */
import type {
  BranchesResponse,
  CommitsResponse,
  FileResponse,
  LastCommitResponse,
  OrganizationResponse,
  ReadmeResponse,
  RepositoryDetailResponse,
  TreeResponse,
} from '../types';

const API_BASE = '/api';
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60_000;

/** Error with a machine-readable code mirrored from the Worker. */
export class ExplorerApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'ExplorerApiError';
  }
}

type Guard<T> = (value: unknown) => value is T;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

function buildUrl(path: string, query: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${API_BASE}${path}?${qs}` : `${API_BASE}${path}`;
}

async function readErrorBody(response: Response): Promise<{ error?: string; message?: string } | null> {
  try {
    const body: unknown = await response.json();
    return isRecord(body) ? (body as { error?: string; message?: string }) : null;
  } catch {
    return null;
  }
}

function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;
}

async function getJson<T>(url: string, guard: Guard<T>): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;

  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;

  const request = (async (): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' }, signal: timeoutSignal() });
    } catch {
      throw new ExplorerApiError('Could not reach the explorer service.', 0, 'NETWORK_ERROR');
    }

    if (!response.ok) {
      const body = await readErrorBody(response);
      const retryAfter = Number(response.headers.get('Retry-After'));
      throw new ExplorerApiError(
        body?.message || `Request failed (HTTP ${response.status}).`,
        response.status,
        body?.error || 'HTTP_ERROR',
        Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined
      );
    }

    const body: unknown = await response.json().catch(() => null);
    if (!guard(body)) {
      throw new ExplorerApiError('The explorer service returned an invalid response.', response.status, 'INVALID_RESPONSE');
    }
    cache.set(url, { at: Date.now(), value: body });
    return body;
  })().finally(() => {
    inflight.delete(url);
  });

  inflight.set(url, request);
  return request;
}

const isOrganizationResponse: Guard<OrganizationResponse> = (v): v is OrganizationResponse =>
  isRecord(v) && isRecord(v.org) && typeof v.org.login === 'string';

const isRepositoryDetailResponse: Guard<RepositoryDetailResponse> = (v): v is RepositoryDetailResponse =>
  isRecord(v) && isRecord(v.repo) && typeof v.repo.name === 'string';

const isBranchesResponse: Guard<BranchesResponse> = (v): v is BranchesResponse =>
  isRecord(v) && Array.isArray(v.branches) && typeof v.has_next === 'boolean';

const isTreeResponse: Guard<TreeResponse> = (v): v is TreeResponse =>
  isRecord(v) && Array.isArray(v.entries) && typeof v.commit_sha === 'string';

const isLastCommitResponse: Guard<LastCommitResponse> = (v): v is LastCommitResponse =>
  isRecord(v) && 'commit' in v;

const isFileResponse: Guard<FileResponse> = (v): v is FileResponse =>
  isRecord(v) && typeof v.kind === 'string' && typeof v.commit_sha === 'string';

const isReadmeResponse: Guard<ReadmeResponse> = (v): v is ReadmeResponse =>
  isRecord(v) && typeof v.kind === 'string' && typeof v.commit_sha === 'string';

const isCommitsResponse: Guard<CommitsResponse> = (v): v is CommitsResponse =>
  isRecord(v) && Array.isArray(v.commits) && typeof v.has_next === 'boolean';

export const explorerApi = {
  organization: () => getJson(buildUrl('/org'), isOrganizationResponse),

  repository: (repo: string) =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}`), isRepositoryDetailResponse),

  branches: (repo: string, page: number) =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}/branches`, { page, per_page: 100 }), isBranchesResponse),

  tree: (repo: string, ref: string, path: string) =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}/tree`, { ref, path }), isTreeResponse),

  lastCommit: (repo: string, ref: string, path: string) =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}/last-commit`, { ref, path }), isLastCommitResponse),

  file: (repo: string, ref: string, path: string) =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}/file`, { ref, path }), isFileResponse),

  readme: (repo: string, ref: string) =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}/readme`, { ref }), isReadmeResponse),

  commits: (repo: string, ref: string, page: number) =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}/commits`, { ref, page, per_page: 30 }), isCommitsResponse),

  /** Same-origin URL that downloads the file as an attachment. */
  rawUrl: (repo: string, ref: string, path: string) =>
    buildUrl(`/repos/${encodeURIComponent(repo)}/raw`, { ref, path }),
};

/** Clear cached responses (used by tests and by an explicit refresh). */
export function clearExplorerCache(): void {
  cache.clear();
  inflight.clear();
}
