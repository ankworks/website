/**
 * Browser client for V3-C Discussions and reactions.
 *
 * Contract: never talk to GitHub directly, shape-check every payload, and never
 * invent a count. When the API reports no reaction tally the UI renders
 * "reactions unavailable" rather than a zero.
 *
 * Mutations are authenticated (HttpOnly cookie) and never cached; read-only
 * listing endpoints may be cached briefly like the other public insights.
 */

import {
  isDiscussionCategoriesResponse,
  isDiscussionDetailResponse,
  isDiscussionsResponse,
  isReactionsResponse,
  type DiscussionCategoriesResponse,
  type DiscussionDetailResponse,
  type DiscussionsResponse,
  type ReactionContent,
  type ReactionSubjectKind,
  type ReactionsResponse,
} from '../shared/discussions';
import { ExplorerApiError } from './explorer';

const API_BASE = '/api';
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60_000;

type Guard<T> = (value: unknown) => value is T;

const cache = new Map<string, { at: number; value: unknown }>();

function buildUrl(path: string, query: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${API_BASE}${path}?${qs}` : `${API_BASE}${path}`;
}

function signal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
}

async function readError(response: Response): Promise<ExplorerApiError> {
  let message = 'The request failed.';
  let code = 'REQUEST_FAILED';
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object') {
      const record = body as { message?: unknown; error?: unknown };
      if (typeof record.message === 'string' && record.message) message = record.message;
      if (typeof record.error === 'string') code = record.error;
    }
  } catch {
    // Keep the generic message when the error body is not JSON.
  }
  return new ExplorerApiError(message, response.status, code);
}

async function getJson<T>(url: string, guard: Guard<T>, options: { cache: boolean } = { cache: true }): Promise<T> {
  if (options.cache) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  }
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: options.cache ? 'default' : 'no-store',
      signal: signal(),
    });
  } catch {
    throw new ExplorerApiError('Could not reach the Forge service.', 0, 'NETWORK_ERROR');
  }
  if (!response.ok) throw await readError(response);
  const body: unknown = await response.json().catch(() => null);
  if (!guard(body)) throw new ExplorerApiError('The Forge service returned an invalid response.', response.status, 'INVALID_RESPONSE');
  if (options.cache) cache.set(url, { at: Date.now(), value: body });
  return body;
}

async function writeJson<T>(url: string, method: string, payload: unknown, guard: Guard<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
      signal: signal(),
    });
  } catch {
    throw new ExplorerApiError('Could not reach the Forge service.', 0, 'NETWORK_ERROR');
  }
  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!guard(body)) throw new ExplorerApiError('The Forge service returned an invalid response.', response.status, 'INVALID_RESPONSE');
  return body;
}

export interface DiscussionListQuery {
  category?: string;
  after?: string;
  q?: string;
  orderBy?: 'CREATED_AT' | 'UPDATED_AT';
  direction?: 'ASC' | 'DESC';
  perPage?: number;
}

const alwaysTrue: Guard<unknown> = (value: unknown): value is unknown => value !== undefined;

export const discussionsApi = {
  categories: (repo: string): Promise<DiscussionCategoriesResponse> =>
    getJson(buildUrl(`/repos/${encodeURIComponent(repo)}/discussions/categories`), isDiscussionCategoriesResponse),

  list: (repo: string, query: DiscussionListQuery = {}): Promise<DiscussionsResponse> =>
    getJson(
      buildUrl(`/repos/${encodeURIComponent(repo)}/discussions`, {
        category: query.category,
        after: query.after,
        q: query.q,
        orderBy: query.orderBy,
        direction: query.direction,
        per_page: query.perPage,
      }),
      isDiscussionsResponse
    ),

  detail: (repo: string, number: number, after?: string): Promise<DiscussionDetailResponse> =>
    getJson(
      buildUrl(`/repos/${encodeURIComponent(repo)}/discussions/${number}`, { after, per_page: 50 }),
      isDiscussionDetailResponse
    ),

  create: (repo: string, input: { title: string; body: string; categoryId: string }): Promise<{ id: string; number?: number; url: string }> =>
    writeJson(buildUrl(`/repos/${encodeURIComponent(repo)}/discussions`), 'POST', input, alwaysTrue) as Promise<{
      id: string;
      number?: number;
      url: string;
    }>,

  update: (
    repo: string,
    number: number,
    input: { title?: string; body?: string; categoryId?: string }
  ): Promise<{ id: string; number?: number; url: string }> =>
    writeJson(buildUrl(`/repos/${encodeURIComponent(repo)}/discussions/${number}`), 'PATCH', input, alwaysTrue) as Promise<{
      id: string;
      number?: number;
      url: string;
    }>,

  comment: (
    repo: string,
    number: number,
    input: { body: string; parentCommentId?: string }
  ): Promise<{ id: string; commentId?: string; url: string }> =>
    writeJson(
      buildUrl(`/repos/${encodeURIComponent(repo)}/discussions/${number}/comments`),
      'POST',
      input,
      alwaysTrue
    ) as Promise<{ id: string; commentId?: string; url: string }>,

  editComment: (repo: string, commentId: string, body: string): Promise<{ id: string }> =>
    writeJson(
      buildUrl(`/repos/${encodeURIComponent(repo)}/discussions/comments/${encodeURIComponent(commentId)}`),
      'PATCH',
      { body },
      alwaysTrue
    ) as Promise<{ id: string }>,

  deleteComment: (repo: string, commentId: string): Promise<void> =>
    writeJson(
      buildUrl(`/repos/${encodeURIComponent(repo)}/discussions/comments/${encodeURIComponent(commentId)}`),
      'DELETE',
      {},
      alwaysTrue
    ) as Promise<void>,

  markAnswer: (repo: string, number: number, commentId: string): Promise<unknown> =>
    writeJson(buildUrl(`/repos/${encodeURIComponent(repo)}/discussions/${number}/answer`), 'POST', { commentId }, alwaysTrue),

  unmarkAnswer: (repo: string, number: number, commentId: string): Promise<unknown> =>
    writeJson(buildUrl(`/repos/${encodeURIComponent(repo)}/discussions/${number}/answer`), 'DELETE', { commentId }, alwaysTrue),

  lock: (repo: string, number: number): Promise<unknown> =>
    writeJson(buildUrl(`/repos/${encodeURIComponent(repo)}/discussions/${number}/lock`), 'POST', {}, alwaysTrue),

  unlock: (repo: string, number: number): Promise<unknown> =>
    writeJson(buildUrl(`/repos/${encodeURIComponent(repo)}/discussions/${number}/unlock`), 'POST', {}, alwaysTrue),

  react: (repo: string, subjectId: string, content: ReactionContent): Promise<void> =>
    writeJson(buildUrl(`/repos/${encodeURIComponent(repo)}/discussions/reactions`), 'POST', { subjectId, content }, alwaysTrue) as Promise<void>,

  unreact: (repo: string, subjectId: string, content: ReactionContent): Promise<void> =>
    writeJson(buildUrl(`/repos/${encodeURIComponent(repo)}/discussions/reactions`), 'DELETE', { subjectId, content }, alwaysTrue) as Promise<void>,
};

export const reactionsApi = {
  /** Public tallies for an issue, pull request, or comment. */
  get: (repo: string, kind: ReactionSubjectKind, target: string): Promise<ReactionsResponse> =>
    getJson(
      buildUrl(`/repos/${encodeURIComponent(repo)}/reactions`, { kind, target }),
      isReactionsResponse,
      { cache: false }
    ),

  add: (repo: string, kind: ReactionSubjectKind, target: string, content: ReactionContent): Promise<ReactionsResponse> =>
    writeJson(buildUrl(`/repos/${encodeURIComponent(repo)}/reactions`), 'POST', { kind, target, content }, isReactionsResponse),

  remove: (repo: string, kind: ReactionSubjectKind, target: string, content: ReactionContent): Promise<ReactionsResponse> =>
    writeJson(buildUrl(`/repos/${encodeURIComponent(repo)}/reactions`), 'DELETE', { kind, target, content }, isReactionsResponse),
};

/** Clear cached discussion listings (tests, explicit refresh). */
export function clearDiscussionsCache(): void {
  cache.clear();
}
