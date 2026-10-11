/** Public, read-only GitHub issues, pull requests, tags, and organization activity. */
import type { CollaborationState, Collaborator, IssueComment, IssueLabel, IssueSummary, OrganizationEvent, PullRequestDetail, PullRequestFile, PullRequestReviewComment } from '../types/collaboration';
import { normalizeRepoPath, ORG_NAME, isCommitSha, isValidRef, isValidRepoName, parsePositiveInt } from '../shared/validation';
import { issuePath, pullRequestPath, repoPath, treePath } from '../shared/routes';
import type { Env } from './env';
import { cacheKeyFor, serveCached } from './cache';
import {
  UpstreamError,
  buildGitHubUrl,
  expectArray,
  expectObject,
  githubGet,
  hasNextPage,
  jsonResponse,
  readJson,
  repoApiPath,
} from './github-client';
import { githubUrl, sanitizeCommit } from './sanitize';
import { isHiddenRepo, parseHiddenRepos } from '../shared/visibility';

function hiddenRepos(env: Pick<Env, 'FORGE_SELF_REPO'>): string[] {
  return parseHiddenRepos(env.FORGE_SELF_REPO);
}

const CACHE_TTL_SECONDS = 60;
const DEFAULT_PER_PAGE = 30;
const MAX_PER_PAGE = 100;
const MAX_PAGE = 10_000;
const MAX_BODY_LENGTH = 24_000;
const MAX_PATCH_LENGTH = 20_000;
const EVENT_PAGE_SIZE = 50;

interface RouteArgs {
  repo: string;
  resource: 'issues' | 'pulls';
  number?: string;
  subresource?: string;
  params: URLSearchParams;
  request: Request;
  env: Env;
  ctx?: ExecutionContext;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' ? value.slice(0, maxLength) : null;
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return value;
}

function validPage(params: URLSearchParams): { page: number; perPage: number } {
  const page = parsePositiveInt(params.get('page'), 1, MAX_PAGE);
  const perPage = parsePositiveInt(params.get('per_page'), DEFAULT_PER_PAGE, MAX_PER_PAGE);
  if (page === null || perPage === null) {
    throw new UpstreamError(400, 'INVALID_PARAMETER', 'Invalid pagination parameters.');
  }
  return { page, perPage };
}

function stateFromParams(params: URLSearchParams): CollaborationState {
  const value = params.get('state') ?? 'open';
  if (value === 'open' || value === 'closed' || value === 'all') return value;
  throw new UpstreamError(400, 'INVALID_PARAMETER', 'State must be open, closed, or all.');
}

function issueNumber(value: string | undefined): number {
  if (!value || !/^\d{1,10}$/.test(value)) {
    throw new UpstreamError(400, 'INVALID_PARAMETER', 'Invalid issue or pull request number.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new UpstreamError(400, 'INVALID_PARAMETER', 'Invalid issue or pull request number.');
  }
  return parsed;
}

function sanitizeCollaborator(input: unknown): Collaborator | null {
  const raw = record(input);
  if (!raw) return null;
  const login = boundedString(raw.login, 39);
  let avatar: string | null = null;
  if (typeof raw.avatar_url === 'string' && raw.avatar_url.length <= 2048) {
    try {
      const url = new URL(raw.avatar_url);
      if (url.protocol === 'https:' && url.hostname === 'avatars.githubusercontent.com' && !url.username && !url.password) {
        avatar = url.toString();
      }
    } catch {
      avatar = null;
    }
  }
  return { login, avatar_url: avatar };
}

function sanitizeLabels(input: unknown): IssueLabel[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 50).flatMap((value) => {
    const raw = record(value);
    if (!raw) return [];
    const name = boundedString(raw.name, 100);
    if (name === null) return [];
    const color = typeof raw.color === 'string' && /^[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color.toLowerCase() : null;
    return [{ name, color, description: boundedString(raw.description, 300) }];
  });
}

function sanitizeIssueFields(input: unknown, repo: string, includeBody: boolean): IssueSummary | null {
  const raw = record(input);
  if (!raw || raw.pull_request !== undefined && raw.pull_request !== null) return null;
  const number = integer(raw.number);
  const title = boundedString(raw.title, 300);
  const state = raw.state === 'open' || raw.state === 'closed' ? raw.state : null;
  const createdAt = isoDate(raw.created_at);
  const updatedAt = isoDate(raw.updated_at);
  if (number < 1 || title === null || state === null || createdAt === null || updatedAt === null) return null;

  const stateReason = raw.state_reason === 'completed' || raw.state_reason === 'not_planned' || raw.state_reason === 'reopened'
    ? raw.state_reason
    : null;
  return {
    number,
    repo,
    title,
    body: includeBody ? boundedString(raw.body, MAX_BODY_LENGTH) : null,
    state,
    state_reason: stateReason,
    author: sanitizeCollaborator(raw.user),
    created_at: createdAt,
    updated_at: updatedAt,
    closed_at: isoDate(raw.closed_at),
    comments: integer(raw.comments),
    labels: sanitizeLabels(raw.labels),
    html_url: `${githubUrl(repo, 'issues')}/${number}`,
  };
}

function sanitizePullRequest(input: unknown, repo: string, includeBody: boolean): PullRequestDetail | null {
  const raw = record(input);
  if (!raw) return null;
  const number = integer(raw.number);
  const title = boundedString(raw.title, 300);
  const state = raw.state === 'open' || raw.state === 'closed' ? raw.state : null;
  const createdAt = isoDate(raw.created_at);
  const updatedAt = isoDate(raw.updated_at);
  const base = record(raw.base);
  const head = record(raw.head);
  const isSearchResult = raw.pull_request !== undefined && raw.pull_request !== null;
  if (number < 1 || title === null || state === null || createdAt === null || updatedAt === null || (!isSearchResult && (!base || !head))) {
    return null;
  }

  const baseRef = base && typeof base.ref === 'string' && isValidRef(base.ref) ? base.ref : null;
  const headRef = head && typeof head.ref === 'string' && isValidRef(head.ref) ? head.ref : null;
  const baseSha = base && typeof base.sha === 'string' && isCommitSha(base.sha) ? base.sha : null;
  const headSha = head && typeof head.sha === 'string' && isCommitSha(head.sha) ? head.sha : null;
  const mergedAt = isoDate(raw.merged_at);

  return {
    number,
    repo,
    title,
    body: includeBody ? boundedString(raw.body, MAX_BODY_LENGTH) : null,
    state,
    state_reason: null,
    author: sanitizeCollaborator(raw.user),
    created_at: createdAt,
    updated_at: updatedAt,
    closed_at: isoDate(raw.closed_at),
    comments: integer(raw.comments),
    labels: sanitizeLabels(raw.labels),
    html_url: `${githubUrl(repo, 'pulls')}/${number}`,
    draft: raw.draft === true,
    merged: raw.merged === true || mergedAt !== null,
    merged_at: mergedAt,
    base_ref: baseRef,
    base_sha: baseSha,
    head_ref: headRef,
    head_sha: headSha,
    additions: integer(raw.additions),
    deletions: integer(raw.deletions),
    changed_files: integer(raw.changed_files),
    commits_count: integer(raw.commits),
  };
}

function repositoryNameFromSearchItem(input: unknown): string | null {
  const raw = record(input);
  const value = raw?.repository_url;
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const match = /^\/repos\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (url.origin !== 'https://api.github.com' || !match || decodeURIComponent(match[1]).toLowerCase() !== ORG_NAME) return null;
    const repo = decodeURIComponent(match[2]);
    return isValidRepoName(repo) ? repo : null;
  } catch {
    return null;
  }
}

function buildListQuery(resource: 'issues' | 'pulls', state: CollaborationState): string {
  if (state === 'all') return `org:${ORG_NAME} is:${resource === 'issues' ? 'issue' : 'pr'}`;
  return `org:${ORG_NAME} is:${resource === 'issues' ? 'issue' : 'pr'} state:${state}`;
}

async function handleIssueCollection(
  repo: string | null,
  resource: 'issues' | 'pulls',
  params: URLSearchParams,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const state = stateFromParams(params);
  const { page, perPage } = validPage(params);
  const cachePath = repo ? `/api/repos/${repo}/${resource}` : `/api/${resource}`;
  const key = cacheKeyFor(new URL(request.url).origin, cachePath, { state, page, per_page: perPage });

  return serveCached(key, ctx, async () => {
    const response = repo
      ? await githubGet(buildGitHubUrl(repoApiPath(repo, resource === 'pulls' ? '/pulls' : '/issues'), {
          state,
          sort: 'updated',
          direction: 'desc',
          per_page: perPage,
          page,
        }), env, { notFound: { code: 'REPO_NOT_FOUND', message: 'Repository not found.' } })
      : await githubGet(buildGitHubUrl('/search/issues', {
          q: buildListQuery(resource, state),
          per_page: perPage,
          page,
        }), {}); // Organization-wide search must remain anonymous/public even when a token is configured.

    const payload = await readJson(response);
    const search = repo === null;
    const rawItems = search ? expectArray(expectObject(payload).items) : expectArray(payload);
    const items = rawItems.flatMap((item) => {
      const itemRepo = repo ?? repositoryNameFromSearchItem(item);
      if (!itemRepo) return [];
      // Visibility rule: never surface the repository Forge is built from.
      if (isHiddenRepo(itemRepo, hiddenRepos(env))) return [];
      if (resource === 'issues') {
        const issue = sanitizeIssueFields(item, itemRepo, false);
        return issue ? [issue] : [];
      }
      const pull = sanitizePullRequest(item, itemRepo, false);
      return pull ? [pull] : [];
    });
    const totalCount = search ? integer(expectObject(payload).total_count) : null;

    return jsonResponse({ items, total_count: totalCount, state, page, per_page: perPage, has_next: hasNextPage(response) }, CACHE_TTL_SECONDS);
  });
}

async function handleComments(
  repo: string,
  number: number,
  kind: 'issue' | 'pull' | 'review',
  params: URLSearchParams,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const { page, perPage } = validPage(params);
  const path = kind === 'review'
    ? `/pulls/${number}/comments`
    : `/issues/${number}/comments`;
  const endpoint = kind === 'review' ? 'review-comments' : 'comments';
  const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/${kind === 'pull' || kind === 'review' ? 'pulls' : 'issues'}/${number}/${endpoint}`, { page, per_page: perPage });

  return serveCached(key, ctx, async () => {
    const response = await githubGet(buildGitHubUrl(repoApiPath(repo, path), { per_page: perPage, page }), env, {
      notFound: { code: kind === 'pull' || kind === 'review' ? 'PULL_REQUEST_NOT_FOUND' : 'ISSUE_NOT_FOUND', message: kind === 'pull' || kind === 'review' ? 'Pull request not found.' : 'Issue not found.' },
    });
    const rawComments = expectArray(await readJson(response));
    const comments = rawComments.flatMap((input) => {
      const raw = record(input);
      if (!raw) return [];
      const id = integer(raw.id);
      const body = boundedString(raw.body, MAX_BODY_LENGTH);
      const createdAt = isoDate(raw.created_at);
      const updatedAt = isoDate(raw.updated_at) ?? createdAt;
      if (id < 1 || body === null || createdAt === null) return [];
      const base: IssueComment = {
        id,
        author: sanitizeCollaborator(raw.user),
        body,
        created_at: createdAt,
        updated_at: updatedAt ?? createdAt,
      };
      if (kind !== 'review') return [base];
      const reviewRawPath = typeof raw.path === 'string' ? normalizeRepoPath(raw.path) : null;
      const commitId = typeof raw.commit_id === 'string' && isCommitSha(raw.commit_id) ? raw.commit_id : null;
      return [{ ...base, path: reviewRawPath, commit_id: commitId } satisfies PullRequestReviewComment];
    });
    return jsonResponse({ comments, page, per_page: perPage, has_next: hasNextPage(response) }, CACHE_TTL_SECONDS);
  });
}

function sanitizePullRequestFile(input: unknown): PullRequestFile | null {
  const raw = record(input);
  if (!raw) return null;
  const filename = typeof raw.filename === 'string' ? normalizeRepoPath(raw.filename) : null;
  const status = raw.status;
  const allowedStatuses = ['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'] as const;
  if (!filename || !allowedStatuses.includes(status as (typeof allowedStatuses)[number])) return null;
  const previousFilename = typeof raw.previous_filename === 'string' ? normalizeRepoPath(raw.previous_filename) : null;
  return {
    filename,
    previous_filename: previousFilename,
    status: status as PullRequestFile['status'],
    additions: integer(raw.additions),
    deletions: integer(raw.deletions),
    changes: integer(raw.changes),
    patch: boundedString(raw.patch, MAX_PATCH_LENGTH),
  };
}

async function handlePullFiles(
  repo: string,
  number: number,
  params: URLSearchParams,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const { page, perPage } = validPage(params);
  const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/pulls/${number}/files`, { page, per_page: perPage });
  return serveCached(key, ctx, async () => {
    const response = await githubGet(buildGitHubUrl(repoApiPath(repo, `/pulls/${number}/files`), { per_page: perPage, page }), env, {
      notFound: { code: 'PULL_REQUEST_NOT_FOUND', message: 'Pull request not found.' },
    });
    const files = expectArray(await readJson(response))
      .map(sanitizePullRequestFile)
      .filter((file): file is PullRequestFile => file !== null);
    return jsonResponse({ files, page, per_page: perPage, has_next: hasNextPage(response) }, CACHE_TTL_SECONDS);
  });
}

async function handlePullCommits(
  repo: string,
  number: number,
  params: URLSearchParams,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const { page, perPage } = validPage(params);
  const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/pulls/${number}/commits`, { page, per_page: perPage });
  return serveCached(key, ctx, async () => {
    const response = await githubGet(buildGitHubUrl(repoApiPath(repo, `/pulls/${number}/commits`), { per_page: perPage, page }), env, {
      notFound: { code: 'PULL_REQUEST_NOT_FOUND', message: 'Pull request not found.' },
    });
    const commits = expectArray(await readJson(response))
      .map((item) => sanitizeCommit(item, repo))
      .filter((commit): commit is NonNullable<typeof commit> => commit !== null);
    return jsonResponse({ commits, page, per_page: perPage, has_next: hasNextPage(response) }, CACHE_TTL_SECONDS);
  });
}

export function validateRepositoryCollaborationRequest(
  resource: 'issues' | 'pulls',
  numberParam: string | undefined,
  subresource: string | undefined,
  params: URLSearchParams
): void {
  if (numberParam === undefined) {
    if (subresource !== undefined) throw new UpstreamError(404, 'NOT_FOUND', 'API endpoint not found.');
    stateFromParams(params);
    validPage(params);
    return;
  }

  issueNumber(numberParam);
  if (resource === 'issues') {
    if (subresource === undefined) return;
    if (subresource === 'comments') {
      validPage(params);
      return;
    }
    throw new UpstreamError(404, 'NOT_FOUND', 'API endpoint not found.');
  }
  if (subresource === undefined) return;
  if (subresource === 'comments' || subresource === 'review-comments' || subresource === 'files' || subresource === 'commits') {
    validPage(params);
    return;
  }
  throw new UpstreamError(404, 'NOT_FOUND', 'API endpoint not found.');
}

export async function handleRepositoryCollaboration(args: RouteArgs): Promise<Response> {
  const { repo, resource, number: numberParam, subresource, params, request, env, ctx } = args;
  validateRepositoryCollaborationRequest(resource, numberParam, subresource, params);
  if (numberParam === undefined) {
    if (subresource !== undefined) throw new UpstreamError(404, 'NOT_FOUND', 'API endpoint not found.');
    return handleIssueCollection(repo, resource, params, request, env, ctx);
  }

  const number = issueNumber(numberParam);
  if (resource === 'issues') {
    if (subresource === undefined) {
      const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/issues/${number}`);
      return serveCached(key, ctx, async () => {
        const response = await githubGet(buildGitHubUrl(repoApiPath(repo, `/issues/${number}`)), env, {
          notFound: { code: 'ISSUE_NOT_FOUND', message: 'Issue not found.' },
        });
        const issue = sanitizeIssueFields(await readJson(response), repo, true);
        if (!issue) throw new UpstreamError(404, 'ISSUE_NOT_FOUND', 'Issue not found.');
        return jsonResponse({ issue }, CACHE_TTL_SECONDS);
      });
    }
    if (subresource === 'comments') return handleComments(repo, number, 'issue', params, request, env, ctx);
    throw new UpstreamError(404, 'NOT_FOUND', 'API endpoint not found.');
  }

  if (subresource === undefined) {
    const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/pulls/${number}`);
    return serveCached(key, ctx, async () => {
      const response = await githubGet(buildGitHubUrl(repoApiPath(repo, `/pulls/${number}`)), env, {
        notFound: { code: 'PULL_REQUEST_NOT_FOUND', message: 'Pull request not found.' },
      });
      const pull = sanitizePullRequest(await readJson(response), repo, true);
      if (!pull) throw new UpstreamError(404, 'PULL_REQUEST_NOT_FOUND', 'Pull request not found.');
      return jsonResponse({ pull }, CACHE_TTL_SECONDS);
    });
  }
  if (subresource === 'comments') return handleComments(repo, number, 'pull', params, request, env, ctx);
  if (subresource === 'review-comments') return handleComments(repo, number, 'review', params, request, env, ctx);
  if (subresource === 'files') return handlePullFiles(repo, number, params, request, env, ctx);
  if (subresource === 'commits') return handlePullCommits(repo, number, params, request, env, ctx);
  throw new UpstreamError(404, 'NOT_FOUND', 'API endpoint not found.');
}

function eventText(raw: Record<string, unknown>, repo: string): Omit<OrganizationEvent, 'id' | 'actor' | 'repo' | 'created_at'> | null {
  const payload = record(raw.payload) ?? {};
  const action = typeof payload.action === 'string' ? payload.action.replace(/[^a-z_]/gi, '').slice(0, 30) : '';
  const actionText = action.replace(/_/g, ' ');

  if (raw.type === 'PushEvent') {
    const ref = typeof payload.ref === 'string' ? payload.ref.replace(/^refs\/heads\//, '') : '';
    if (!ref || !isValidRef(ref)) return { kind: 'push', summary: 'pushed to the repository', href: repoPath(repo) };
    return { kind: 'push', summary: `pushed to ${ref}`, href: treePath(repo, ref) };
  }
  if (raw.type === 'IssuesEvent' || raw.type === 'PullRequestEvent') {
    const isPull = raw.type === 'PullRequestEvent';
    const detail = record(isPull ? payload.pull_request : payload.issue) ?? {};
    const number = integer(payload.number) || integer(detail.number);
    if (number < 1) return null;
    const title = boundedString(detail.title, 120);
    const label = isPull ? 'pull request' : 'issue';
    const verb = actionText || 'updated';
    return {
      kind: isPull ? 'pull' : 'issue',
      summary: `${verb} ${label} #${number}${title ? ` · ${title}` : ''}`,
      href: isPull ? pullRequestPath(repo, number) : issuePath(repo, number),
    };
  }
  if (raw.type === 'IssueCommentEvent') {
    const issue = record(payload.issue) ?? {};
    const number = integer(issue.number);
    if (number < 1) return null;
    const isPull = record(issue.pull_request) !== null;
    return {
      kind: 'comment',
      summary: `${actionText || 'added a comment to'} ${isPull ? 'pull request' : 'issue'} #${number}`,
      href: isPull ? pullRequestPath(repo, number) : issuePath(repo, number),
    };
  }
  if (raw.type === 'CreateEvent') {
    const ref = typeof payload.ref === 'string' ? payload.ref.slice(0, 255) : '';
    const refType = payload.ref_type === 'branch' || payload.ref_type === 'tag' ? payload.ref_type : null;
    if (refType && ref && isValidRef(ref)) return { kind: 'branch', summary: `created ${refType} ${ref}`, href: treePath(repo, ref) };
    return { kind: 'branch', summary: 'created repository content', href: repoPath(repo) };
  }
  if (raw.type === 'ReleaseEvent') {
    const release = record(payload.release) ?? {};
    const tag = boundedString(release.tag_name, 120);
    return { kind: 'release', summary: `${actionText || 'published'} release${tag ? ` ${tag}` : ''}`, href: repoPath(repo) };
  }
  if (raw.type === 'WatchEvent') return { kind: 'star', summary: 'starred the repository', href: repoPath(repo) };
  if (raw.type === 'ForkEvent') return { kind: 'fork', summary: 'forked the repository', href: repoPath(repo) };
  return null;
}

function sanitizeOrganizationEvent(input: unknown): OrganizationEvent | null {
  const raw = record(input);
  if (!raw || typeof raw.id !== 'string' || raw.id.length < 1 || raw.id.length > 64) return null;
  const actor = record(raw.actor);
  const actorLogin = actor && boundedString(actor.login, 39);
  const repository = record(raw.repo);
  const repositoryFullName = repository && boundedString(repository.name, 300);
  const createdAt = isoDate(raw.created_at);
  if (!actorLogin || !repositoryFullName || !createdAt) return null;
  const prefix = `${ORG_NAME}/`;
  if (!repositoryFullName.toLowerCase().startsWith(prefix)) return null;
  const repo = repositoryFullName.slice(prefix.length);
  if (!isValidRepoName(repo)) return null;
  const event = eventText(raw, repo);
  if (!event) return null;
  return { id: raw.id, actor: actorLogin, repo, created_at: createdAt, ...event };
}

export async function handleOrganizationActivity(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const limit = parsePositiveInt(params.get('limit'), 10, 20);
  if (limit === null) throw new UpstreamError(400, 'INVALID_PARAMETER', 'Activity limit must be between 1 and 20.');
  const hidden = hiddenRepos(env);
  const key = cacheKeyFor(new URL(request.url).origin, '/api/activity', { limit });
  return serveCached(key, ctx, async () => {
    const response = await githubGet(buildGitHubUrl(`/orgs/${ORG_NAME}/events`, { per_page: EVENT_PAGE_SIZE }), {}, {
      notFound: { code: 'ORG_NOT_FOUND', message: 'The GitHub organization could not be found.' },
    });
    const events = expectArray(await readJson(response))
      .map(sanitizeOrganizationEvent)
      .filter((event): event is OrganizationEvent => event !== null)
      // Visibility rule: drop activity belonging to a hidden repository.
      .filter((event) => !isHiddenRepo(event.repo, hidden))
      .slice(0, limit);
    return jsonResponse({ events, fetched_at: new Date().toISOString() }, CACHE_TTL_SECONDS);
  });
}

export async function handleOrganizationIssues(
  resource: 'issues' | 'pulls',
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  return handleIssueCollection(null, resource, new URL(request.url).searchParams, request, env, ctx);
}
