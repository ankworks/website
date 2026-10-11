/**
 * Reactions on issues, pull requests, and their comments (V3-C).
 *
 *   GET    /api/repos/:repo/reactions?kind=&target=   current tallies (public)
 *   POST   /api/repos/:repo/reactions                 add the viewer's reaction
 *   DELETE /api/repos/:repo/reactions                 remove the viewer's reaction
 *
 * Design rules:
 * - Counts are whatever GitHub reported. Nothing is computed, cached, or
 *   defaulted: when GitHub does not return a tally the API returns an empty
 *   list and the UI renders "reactions unavailable" instead of a fake 0.
 * - Pull requests are issues as far as the reactions API is concerned, so
 *   `pull` and `issue` share GitHub's issues endpoint. That is GitHub's own
 *   behaviour, not a shortcut invented here.
 * - Removals are scoped to the VIEWER's own reaction: the id used in the
 *   DELETE is looked up from the viewer's own login, never taken from the
 *   request body, so a caller cannot delete somebody else's reaction.
 * - Every mutation goes through `authorizeWrite` (session → AnkWorks
 *   membership → real repository permission → user-scoped token).
 */

import { ORG_NAME } from '../shared/validation';
import {
  canonicalReaction,
  isReactionContent,
  restReactionName,
  type ReactionGroup,
  type ReactionSubjectKind,
  type ReactionsResponse,
} from '../shared/discussions';
import { readSession, type SessionPayload } from './auth';
import type { Env } from './env';
import { UpstreamError, errorResponse, jsonResponse } from './github-client';
import { isSameOrigin, privateJson, readJsonBody } from './http';
import { logEvent } from './logging';
import { requireRepo } from './params';
import { authorizeWrite } from './authorization';

const API = 'https://api.github.com';
const REACTIONS_TTL_SECONDS = 30;

/** Matches a REST id (numeric) or a GraphQL node id (base64). */
const TARGET_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

interface ReactionSubject {
  kind: ReactionSubjectKind;
  /** REST path segment for the subject, e.g. `/repos/ankworks/website/issues/12`. */
  path: string;
}

function headers(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ankworks-forge',
  };
}

/**
 * Map a subject to the documented GitHub reactions endpoint.
 *
 * Discussions are handled separately (GraphQL); asking for them here is a
 * programming error, and the caller must not silently fall back to REST.
 */
function restSubject(repo: string, kind: ReactionSubjectKind, target: string): ReactionSubject | null {
  const base = `/repos/${ORG_NAME}/${repo}`;
  if (!TARGET_PATTERN.test(target)) return null;
  switch (kind) {
    case 'issue':
    case 'pull':
      // Pull requests are issues for the reactions API.
      if (!/^\d{1,10}$/.test(target)) return null;
      return { kind, path: `${base}/issues/${target}` };
    case 'issue-comment':
      if (!/^\d{1,20}$/.test(target)) return null;
      return { kind, path: `${base}/issues/comments/${target}` };
    case 'pull-comment':
      if (!/^\d{1,20}$/.test(target)) return null;
      return { kind, path: `${base}/pulls/comments/${target}` };
    default:
      return null;
  }
}

interface RawReaction {
  id?: number;
  content?: string;
  user?: { login?: string } | null;
}

function parseReactionList(payload: unknown): RawReaction[] {
  return Array.isArray(payload) ? (payload as RawReaction[]) : [];
}

/**
 * Read the tallies GitHub reports for a subject.
 *
 * The list endpoint returns one entry per reaction, so the grouped counts are
 * derived by tallying GitHub's own rows — never by inventing numbers.
 */
function toGroups(rows: RawReaction[], viewerLogin: string | null): ReactionGroup[] {
  const counts = new Map<string, { count: number; viewer: boolean }>();
  for (const row of rows) {
    const content = canonicalReaction(row.content);
    if (!content) continue;
    const entry = counts.get(content) ?? { count: 0, viewer: false };
    entry.count += 1;
    if (viewerLogin && row.user?.login === viewerLogin) entry.viewer = true;
    counts.set(content, entry);
  }
  const groups: ReactionGroup[] = [];
  for (const [content, entry] of counts) {
    if (!isReactionContent(content)) continue;
    groups.push({ content, count: entry.count, viewerHasReacted: entry.viewer });
  }
  groups.sort((a, b) => a.content.localeCompare(b.content));
  return groups;
}

function response(repo: string, kind: ReactionSubjectKind, target: string, groups: ReactionGroup[]): ReactionsResponse {
  return {
    subject: kind,
    repo,
    targetId: target,
    reactions: groups,
    totalCount: groups.reduce((sum, group) => sum + group.count, 0),
  };
}

async function readTallies(
  subject: ReactionSubject,
  token: string | undefined,
  viewerLogin: string | null
): Promise<ReactionGroup[]> {
  const init: RequestInit = { method: 'GET', redirect: 'manual' };
  const requestHeaders = headers(token ?? '');
  if (!token) delete (requestHeaders as Record<string, string | undefined>).Authorization;
  const res = await fetch(`${API}${subject.path}/reactions?per_page=100`, { ...init, headers: requestHeaders });
  if (res.status === 404) throw new UpstreamError(404, 'NOT_FOUND', 'That subject no longer exists.');
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'GitHub is unavailable right now.');
  }
  const payload: unknown = await res.json().catch(() => null);
  return toGroups(parseReactionList(payload), viewerLogin);
}

export function isReactionsRoute(pathname: string): boolean {
  return /^\/api\/repos\/[^/]+\/reactions$/.test(pathname);
}

export async function handleReactionsRoute(pathname: string, request: Request, env: Env): Promise<Response> {
  const repo = requireRepo(pathname.split('/')[3] ?? '');
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? '';
  if (request.method === 'GET') {
    const subject = restSubject(repo, kind as ReactionSubjectKind, url.searchParams.get('target') ?? '');
    if (!subject) return errorResponse(400, 'INVALID_SUBJECT', 'A valid kind and target are required.');
    // Public read: an unauthenticated viewer sees the same tally as GitHub's
    // anonymous view, so the response may be cached briefly.
    const groups = await readTallies(subject, env.GITHUB_TOKEN, null);
    return jsonResponse(response(repo, subject.kind, url.searchParams.get('target') ?? '', groups), REACTIONS_TTL_SECONDS);
  }

  if (request.method !== 'POST' && request.method !== 'DELETE') {
    const res = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only GET, POST, and DELETE are supported.');
    res.headers.set('Allow', 'GET, POST, DELETE');
    return res;
  }

  const session = await readSession(request, env);
  if (!session) return errorResponse(401, 'UNAUTHENTICATED', 'Sign in to react.');
  if (!isSameOrigin(request)) return errorResponse(403, 'CSRF_FAILED', 'Cross-origin writes are not allowed.');

  const body = await readJsonBody(request);
  const bodyKind = typeof body?.kind === 'string' ? body.kind : kind;
  const target = typeof body?.target === 'string' ? body.target : (url.searchParams.get('target') ?? '');
  const content = body?.content;
  if (!isReactionContent(content)) {
    return errorResponse(400, 'INVALID_REACTION', 'content must be one of GitHub\'s eight reactions.');
  }

  const subject = restSubject(repo, bodyKind as ReactionSubjectKind, target);
  if (!subject) return errorResponse(400, 'INVALID_SUBJECT', 'A valid kind and target are required.');

  // Reactions are conversation participation: read access is enough, but the
  // viewer still has to be a verified AnkWorks member (V3-B).
  await authorizeWrite(session, env, { repo, action: request.method === 'DELETE' ? 'reaction.remove' : 'reaction.add', need: 'read' });

  if (request.method === 'POST') {
    const res = await fetch(`${API}${subject.path}/reactions`, {
      method: 'POST',
      redirect: 'manual',
      headers: { ...headers(session.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: restReactionName(content) }),
    });
    // 200 with the existing reaction is the documented idempotent answer.
    if (res.status !== 200 && res.status !== 201) {
      await res.body?.cancel().catch(() => undefined);
      throw mapFailure(res.status);
    }
    await res.body?.cancel().catch(() => undefined);
  } else {
    // Only the viewer's own reaction may be removed: find its id in the
    // viewer's own list rather than trusting anything from the request.
    const rows = await listRows(subject, session);
    const own = rows.find((row) => canonicalReaction(row.content) === content && row.user?.login === session.user.login);
    if (own && typeof own.id === 'number') {
      const res = await fetch(`${API}${subject.path}/reactions/${own.id}`, {
        method: 'DELETE',
        redirect: 'manual',
        headers: headers(session.token),
      });
      if (res.status !== 204 && res.status !== 200) {
        await res.body?.cancel().catch(() => undefined);
        throw mapFailure(res.status);
      }
      await res.body?.cancel().catch(() => undefined);
    }
  }

  const groups = await readTallies(subject, session.token, session.user.login);
  logEvent('debug', request.method === 'DELETE' ? 'reaction_removed' : 'reaction_added', {
    repo,
    kind: subject.kind,
    content,
  });
  // Viewer-specific answer: never let it reach a shared cache.
  return privateJson(response(repo, subject.kind, target, groups));
}

async function listRows(subject: ReactionSubject, session: SessionPayload): Promise<RawReaction[]> {
  const res = await fetch(`${API}${subject.path}/reactions?per_page=100`, {
    method: 'GET',
    redirect: 'manual',
    headers: headers(session.token),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw mapFailure(res.status);
  }
  const payload: unknown = await res.json().catch(() => null);
  return parseReactionList(payload);
}

function mapFailure(status: number): UpstreamError {
  if (status === 401) return new UpstreamError(401, 'UNAUTHENTICATED', 'GitHub rejected your session. Sign in again.');
  if (status === 403) return new UpstreamError(403, 'FORBIDDEN', 'GitHub refused this reaction for your account.');
  if (status === 404) return new UpstreamError(404, 'NOT_FOUND', 'That subject no longer exists.');
  // GitHub answers 410 when reactions are disabled or the conversation is locked.
  if (status === 410) return new UpstreamError(410, 'FEATURE_DISABLED', 'Reactions are disabled here.');
  if (status === 422) return new UpstreamError(422, 'WRITE_REJECTED', 'GitHub rejected the reaction.');
  return new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'GitHub is unavailable right now.');
}
