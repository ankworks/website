/**
 * Authenticated collaboration writes (Milestone D).
 *
 * Routes (owner is always the AnkWorks organization):
 *   POST  /api/repos/:repo/issues                  create an issue
 *   POST  /api/repos/:repo/issues/:number/comments add a conversation comment
 *   PATCH /api/repos/:repo/issues/:number          update title/state/labels
 *   POST  /api/repos/:repo/pulls                   open a pull request
 *   POST  /api/repos/:repo/pulls/:number/reviews   submit a review
 *   PUT   /api/repos/:repo/pulls/:number/merge     merge a pull request
 *
 * Permission model (fail closed, verified with the user's OWN token):
 *   comment / open issue / open PR → read access,
 *   triage actions (labels, close/reopen, reviews) → triage access,
 *   merge → write access.
 * GITHUB_TOKEN / app credentials are never used for these user writes.
 */

import { validateBranchName } from '../shared/changes';
import { ORG_NAME } from '../shared/validation';
import { readSession, type SessionPayload } from './auth';
import type { Env } from './env';
import { UpstreamError, errorResponse, jsonResponse } from './github-client';
import { logEvent } from './logging';
import { requireRepo } from './params';
import { authorizeWrite, type RepoNeed } from './authorization';
import { isSameOrigin } from './http';

const API = 'https://api.github.com';
const TITLE_MAX = 300;
const BODY_MAX = 10_000;
const LABEL_MAX = 20;
const LABEL_PATTERN = /^[A-Za-z0-9 _.:/-]{1,50}$/;
/** GitHub login: alphanumeric plus single hyphens, max 39 characters. */
const LOGIN_PATTERN = /^(?!-)[A-Za-z0-9-]{1,39}$/;

function apiHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ankworks-forge',
    'Content-Type': 'application/json',
  };
}

async function readRequestBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > 200_000) return null;
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function invalid(code: string, message: string): Response {
  return errorResponse(400, code, message);
}

/**
 * V3-B authorization for collaboration writes.
 *
 * Every route states the minimum repository permission it needs; the guard adds
 * session verification, AnkWorks membership verification, and the user-scoped
 * token assertion before the actual GitHub call is made.
 */
async function authorize(session: SessionPayload, env: Env, repo: string, need: RepoNeed, action: string): Promise<void> {
  await authorizeWrite(session, env, { repo, action, need });
}

function requireSession(env: Env, request: Request): Promise<SessionPayload | null> {
  return readSession(request, env);
}

function validTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= TITLE_MAX ? trimmed : null;
}

function validBody(value: unknown): string {
  return typeof value === 'string' && value.length <= BODY_MAX ? value : '';
}

function validLabels(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > LABEL_MAX) return null;
  const labels: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !LABEL_PATTERN.test(entry)) return null;
    labels.push(entry);
  }
  return labels;
}

function validLogins(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const logins: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !LOGIN_PATTERN.test(entry)) return null;
    logins.push(entry);
  }
  return logins;
}

async function upstreamWrite(
  session: SessionPayload,
  method: string,
  path: string,
  payload: unknown
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${API}${path}`, {
    method,
    redirect: 'manual',
    headers: apiHeaders(session.token),
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data: unknown = await response.json().catch(() => null);
  return { status: response.status, data };
}

function mapUpstreamFailure(status: number, data: unknown): UpstreamError {
  const message = (data as { message?: string } | null)?.message ?? '';
  if (status === 401) return new UpstreamError(401, 'UNAUTHENTICATED', 'GitHub rejected your session. Sign in again.');
  if (status === 403) {
    return new UpstreamError(403, 'FORBIDDEN', message || 'GitHub refused this action for your account.');
  }
  if (status === 404) return new UpstreamError(404, 'NOT_FOUND', 'The target no longer exists.');
  // GitHub answers 410 when the feature is switched off for the repository
  // (issues disabled, comments locked). Reporting "GitHub is unavailable" here
  // sends the user chasing an outage that does not exist.
  if (status === 410) {
    return new UpstreamError(410, 'FEATURE_DISABLED', message || 'That feature is disabled for this repository.');
  }
  if (status === 422) return new UpstreamError(422, 'WRITE_REJECTED', message || 'GitHub rejected the request.');
  if (status === 405) return new UpstreamError(405, 'METHOD_NOT_ALLOWED', 'This action is not allowed here.');
  return new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'GitHub is unavailable right now.');
}

function summarize(data: unknown, fallbackNumber: number): Record<string, unknown> {
  const record = (data ?? {}) as Record<string, unknown>;
  return {
    number: typeof record.number === 'number' ? record.number : fallbackNumber,
    state: typeof record.state === 'string' ? record.state : 'open',
    html_url: typeof record.html_url === 'string' ? record.html_url : '',
    title: typeof record.title === 'string' ? record.title : '',
    merged: record.merged === true,
    comment_id: typeof record.id === 'number' ? record.id : 0,
    id: typeof record.id === 'number' ? record.id : 0,
  };
}

interface RouteMatch {
  kind: 'issues' | 'pulls' | 'comments';
  number: number | null;
  action: 'comments' | 'reviews' | 'merge' | null;
  /** Comment id for `/comments/:id` (edit / delete an existing comment). */
  commentId: string | null;
}

function parseRoute(pathname: string): RouteMatch | null {
  // Editing or deleting an existing conversation comment:
  //   PATCH|DELETE /api/repos/:repo/comments/:id
  const comment = /^\/api\/repos\/[^/]+\/comments\/(\d{1,20})$/.exec(pathname);
  if (comment) return { kind: 'comments', number: null, action: null, commentId: comment[1] ?? null };

  const match = /^\/api\/repos\/[^/]+\/(issues|pulls)(?:\/(\d+)(?:\/(comments|reviews|merge))?)?$/.exec(pathname);
  if (!match) return null;
  return {
    kind: match[1] === 'issues' ? 'issues' : 'pulls',
    number: match[2] ? Number(match[2]) : null,
    action: (match[3] as RouteMatch['action'] | undefined) ?? null,
    commentId: null,
  };
}

/** True for write-method requests this module handles. */
export function isCollabWriteRequest(method: string, pathname: string): boolean {
  const route = parseRoute(pathname);
  if (!route) return false;
  if (route.kind === 'comments') return method === 'PATCH' || method === 'DELETE';
  if (method === 'POST') return route.number === null || route.action === 'comments' || route.action === 'reviews';
  // PATCH: issue metadata, and pull request title/body/state/base.
  if (method === 'PATCH') return route.number !== null && route.action === null;
  if (method === 'PUT') return route.kind === 'pulls' && route.action === 'merge';
  return false;
}

export async function handleCollabWrite(pathname: string, request: Request, env: Env): Promise<Response> {
  const route = parseRoute(pathname);
  if (!route) return errorResponse(404, 'NOT_FOUND', 'API endpoint not found.');
  const repo = requireRepo(pathname.split('/')[3] ?? '');
  const session = await requireSession(env, request);
  if (!session) return errorResponse(401, 'UNAUTHENTICATED', 'Sign in to use collaboration features.');
  // CSRF: a cross-origin form post must never be able to act with this session.
  if (!isSameOrigin(request)) return errorResponse(403, 'CSRF_FAILED', 'Cross-origin writes are not allowed.');
  const body = await readRequestBody(request);

  // ---- Create issue ----
  if (route.kind === 'issues' && route.number === null && request.method === 'POST') {
    const title = validTitle(body?.title);
    if (!title) return invalid('INVALID_TITLE', 'A non-empty title is required.');
    const labels = validLabels(body?.labels);
    if (labels === null) return invalid('INVALID_LABELS', 'One or more labels are invalid.');
    await authorize(session, env, repo, 'read', 'issue.create');
    const { status, data } = await upstreamWrite(session, 'POST', `/repos/${ORG_NAME}/${repo}/issues`, {
      title,
      body: validBody(body?.body),
      labels,
    });
    if (status < 200 || status >= 300) throw mapUpstreamFailure(status, data);
    logEvent('debug', 'issue_created', { repo });
    return jsonResponse({ ...summarize(data, 0) }, 0);
  }

  // ---- Comment on issue/PR conversation ----
  if (route.action === 'comments' && request.method === 'POST' && route.number !== null) {
    const text = typeof body?.body === 'string' && body.body.trim().length > 0 && body.body.length <= BODY_MAX ? body.body : null;
    if (!text) return invalid('INVALID_BODY', 'A non-empty comment body is required.');
    await authorize(session, env, repo, 'read', 'issue.comment');
    const { status, data } = await upstreamWrite(session, 'POST', `/repos/${ORG_NAME}/${repo}/issues/${route.number}/comments`, {
      body: text,
    });
    if (status < 200 || status >= 300) throw mapUpstreamFailure(status, data);
    logEvent('debug', 'issue_commented', { repo, number: route.number });
    return jsonResponse({ ...summarize(data, route.number) }, 0);
  }

  // ---- Update issue (title, state, labels) ----
  if (route.kind === 'issues' && route.number !== null && request.method === 'PATCH' && route.action === null) {
    const payload: Record<string, unknown> = {};
    if (body?.title !== undefined) {
      const title = validTitle(body.title);
      if (!title) return invalid('INVALID_TITLE', 'A non-empty title is required.');
      payload.title = title;
    }
    if (body?.state !== undefined) {
      if (body.state !== 'open' && body.state !== 'closed') return invalid('INVALID_STATE', 'state must be open or closed.');
      payload.state = body.state;
      if (body.state === 'closed') {
        const reason = body.state_reason;
        if (reason !== undefined && reason !== 'completed' && reason !== 'not_planned') {
          return invalid('INVALID_STATE_REASON', 'state_reason must be completed or not_planned.');
        }
        // GitHub requires a state_reason alongside `closed`; default it rather
        // than letting the write fail with an opaque upstream error.
        payload.state_reason = reason ?? 'completed';
      }
    }
    if (body?.labels !== undefined) {
      const labels = validLabels(body.labels);
      if (labels === null) return invalid('INVALID_LABELS', 'One or more labels are invalid.');
      payload.labels = labels;
    }
    if (body?.body !== undefined) payload.body = validBody(body.body);
    if (body?.assignees !== undefined) {
      const assignees = validLogins(body.assignees);
      if (assignees === null) return invalid('INVALID_ASSIGNEES', 'Assignees must be GitHub usernames.');
      payload.assignees = assignees;
    }
    if (body?.milestone !== undefined) {
      if (body.milestone !== null && !(typeof body.milestone === 'number' && Number.isInteger(body.milestone) && body.milestone > 0)) {
        return invalid('INVALID_MILESTONE', 'milestone must be a positive milestone number or null.');
      }
      payload.milestone = body.milestone;
    }
    if (Object.keys(payload).length === 0) return invalid('EMPTY_UPDATE', 'Nothing to update.');
    await authorize(session, env, repo, 'triage', 'issue.update');
    const { status, data } = await upstreamWrite(session, 'PATCH', `/repos/${ORG_NAME}/${repo}/issues/${route.number}`, payload);
    if (status < 200 || status >= 300) throw mapUpstreamFailure(status, data);
    logEvent('debug', 'issue_updated', { repo, number: route.number });
    return jsonResponse({ ...summarize(data, route.number) }, 0);
  }

  // ---- Edit or delete an existing conversation comment ----
  // GitHub stays the authority: an author may edit or delete their own comment
  // with read access, and anyone with write access may moderate one. Forge
  // refuses the clearly unauthorised cases early and reports GitHub's answer
  // for the rest instead of guessing who owns the comment.
  if (route.kind === 'comments' && route.commentId !== null) {
    if (request.method === 'PATCH') {
      const text = typeof body?.body === 'string' && body.body.trim().length > 0 && body.body.length <= BODY_MAX ? body.body : null;
      if (!text) return invalid('INVALID_BODY', 'A non-empty comment body is required.');
      await authorize(session, env, repo, 'read', 'comment.update');
      const { status, data } = await upstreamWrite(session, 'PATCH', `/repos/${ORG_NAME}/${repo}/issues/comments/${route.commentId}`, {
        body: text,
      });
      if (status < 200 || status >= 300) throw mapUpstreamFailure(status, data);
      logEvent('debug', 'comment_edited', { repo, commentId: route.commentId });
      return jsonResponse({ ...summarize(data, 0) }, 0);
    }
    await authorize(session, env, repo, 'read', 'comment.delete');
    const { status, data } = await upstreamWrite(session, 'DELETE', `/repos/${ORG_NAME}/${repo}/issues/comments/${route.commentId}`, undefined);
    if (status < 200 || status >= 300) throw mapUpstreamFailure(status, data);
    logEvent('debug', 'comment_deleted', { repo, commentId: route.commentId });
    return jsonResponse({ deleted: true, id: Number(route.commentId) }, 0);
  }

  // ---- Update a pull request (title, body, state, base) ----
  if (route.kind === 'pulls' && route.number !== null && request.method === 'PATCH' && route.action === null) {
    const payload: Record<string, unknown> = {};
    if (body?.title !== undefined) {
      const title = validTitle(body.title);
      if (!title) return invalid('INVALID_TITLE', 'A non-empty title is required.');
      payload.title = title;
    }
    if (body?.body !== undefined) payload.body = validBody(body.body);
    if (body?.state !== undefined) {
      if (body.state !== 'open' && body.state !== 'closed') return invalid('INVALID_STATE', 'state must be open or closed.');
      payload.state = body.state;
    }
    if (body?.base !== undefined) {
      const base = validateBranchName(body.base);
      if (!base.ok) return invalid('INVALID_BRANCH', 'base must be a valid branch name.');
      payload.base = base.name;
    }
    if (Object.keys(payload).length === 0) return invalid('EMPTY_UPDATE', 'Nothing to update.');
    // Retargeting a pull request rewrites its merge target: that needs write
    // access. Title, body, and open/close are conversation edits (triage).
    await authorize(session, env, repo, payload.base === undefined ? 'triage' : 'write', 'pull.update');
    const { status, data } = await upstreamWrite(session, 'PATCH', `/repos/${ORG_NAME}/${repo}/pulls/${route.number}`, payload);
    if (status < 200 || status >= 300) throw mapUpstreamFailure(status, data);
    logEvent('debug', 'pull_updated', { repo, number: route.number });
    return jsonResponse({ ...summarize(data, route.number) }, 0);
  }

  // ---- Open pull request ----
  if (route.kind === 'pulls' && route.number === null && request.method === 'POST') {
    const title = validTitle(body?.title);
    const head = validateBranchName(body?.head);
    const base = validateBranchName(body?.base);
    if (!title) return invalid('INVALID_TITLE', 'A non-empty title is required.');
    if (!head.ok || !base.ok) return invalid('INVALID_BRANCH', 'head and base must be valid branch names.');
    await authorize(session, env, repo, 'read', 'pull.create');
    const { status, data } = await upstreamWrite(session, 'POST', `/repos/${ORG_NAME}/${repo}/pulls`, {
      title,
      body: validBody(body?.body),
      head: head.name,
      base: base.name,
    });
    if (status < 200 || status >= 300) throw mapUpstreamFailure(status, data);
    logEvent('debug', 'pull_opened', { repo, head: head.name, base: base.name });
    return jsonResponse({ ...summarize(data, 0) }, 0);
  }

  // ---- Submit review (COMMENT / APPROVE / REQUEST_CHANGES) ----
  if (route.action === 'reviews' && request.method === 'POST' && route.number !== null) {
    const event = body?.event;
    if (event !== 'COMMENT' && event !== 'APPROVE' && event !== 'REQUEST_CHANGES') {
      return invalid('INVALID_REVIEW_EVENT', 'event must be COMMENT, APPROVE, or REQUEST_CHANGES.');
    }
    const text = typeof body?.body === 'string' && body.body.length <= BODY_MAX ? body.body : '';
    if (event !== 'APPROVE' && text.trim().length === 0) {
      return invalid('INVALID_BODY', 'A review body is required unless approving.');
    }
    await authorize(session, env, repo, 'triage', 'pull.review');
    const { status, data } = await upstreamWrite(session, 'POST', `/repos/${ORG_NAME}/${repo}/pulls/${route.number}/reviews`, {
      event,
      body: text,
    });
    if (status < 200 || status >= 300) throw mapUpstreamFailure(status, data);
    logEvent('debug', 'pull_reviewed', { repo, number: route.number, event });
    return jsonResponse({ ...summarize(data, route.number) }, 0);
  }

  // ---- Merge pull request ----
  if (route.action === 'merge' && request.method === 'PUT' && route.number !== null) {
    const method = body?.merge_method;
    if (method !== 'merge' && method !== 'squash' && method !== 'rebase') {
      return invalid('INVALID_MERGE_METHOD', 'merge_method must be merge, squash, or rebase.');
    }
    // Merging is irreversible. The UI must send an explicit confirmation, and
    // the server requires it too so a stray or replayed request cannot merge.
    if (body?.confirm !== true) {
      return invalid('CONFIRMATION_REQUIRED', 'Confirm the merge before it is performed.');
    }
    const commitTitle = typeof body?.commit_title === 'string' && body.commit_title.length <= TITLE_MAX ? body.commit_title : undefined;
    const commitMessage = typeof body?.commit_message === 'string' && body.commit_message.length <= BODY_MAX ? body.commit_message : undefined;
    // Merging into a protected branch is EXACTLY what protected branches are
    // for, so the direct-push protection check is deliberately not applied
    // here; branch protection governs pushes, not pull-request merges.
    await authorize(session, env, repo, 'write', 'pull.merge');
    const { status, data } = await upstreamWrite(session, 'PUT', `/repos/${ORG_NAME}/${repo}/pulls/${route.number}/merge`, {
      merge_method: method,
      ...(commitTitle === undefined ? {} : { commit_title: commitTitle }),
      ...(commitMessage === undefined ? {} : { commit_message: commitMessage }),
    });
    if (status < 200 || status >= 300) throw mapUpstreamFailure(status, data);
    logEvent('debug', 'pull_merged', { repo, number: route.number, method });
    return jsonResponse({ ...summarize(data, route.number), merged: (data as { merged?: boolean } | null)?.merged === true }, 0);
  }

  return errorResponse(404, 'NOT_FOUND', 'API endpoint not found.');
}
