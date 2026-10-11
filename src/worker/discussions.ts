/**
 * GitHub Discussions (V3-C) — GraphQL only.
 *
 * GitHub deliberately exposes Discussions in the GraphQL API and has no
 * equivalent REST endpoints. Rather than inventing REST paths, this module
 * issues **fixed, named, parameterised** GraphQL documents through
 * `githubGraphql`, so no request-controlled text ever reaches the query.
 *
 * Routes (owner is always the AnkWorks organization):
 *   GET    /api/repos/:repo/discussions/categories
 *   GET    /api/repos/:repo/discussions?category=&after=&q=
 *   GET    /api/repos/:repo/discussions/:number
 *   POST   /api/repos/:repo/discussions                        create
 *   PATCH  /api/repos/:repo/discussions/:number                edit title/body/category
 *   DELETE /api/repos/:repo/discussions/:number                delete
 *   POST   /api/repos/:repo/discussions/:number/lock|unlock
 *   POST   /api/repos/:repo/discussions/:number/answer         mark a comment as the answer
 *   DELETE /api/repos/:repo/discussions/:number/answer         unmark it
 *   POST   /api/repos/:repo/discussions/:number/comments       comment
 *   POST   /api/repos/:repo/discussions/comments/:id/replies   reply to a comment
 *   PATCH  /api/repos/:repo/discussions/comments/:id           edit own comment
 *   DELETE /api/repos/:repo/discussions/comments/:id           delete own comment
 *   POST   /api/repos/:repo/discussions/reactions              react (GraphQL subject id)
 *   DELETE /api/repos/:repo/discussions/reactions              unreact
 *
 * Every mutation passes through `authorizeWrite`: session → verified AnkWorks
 * membership → real repository permission → user-scoped token. GitHub stays the
 * authority on "may this user edit this comment"; Forge only refuses early.
 *
 * NOT TESTED against the live GitHub GraphQL API (no production credentials in
 * this environment): the documents below follow GitHub's published schema and
 * are covered by mocked tests, and GraphQL's own `errors[]` are surfaced as
 * failures instead of being mistaken for success.
 */

import { ORG_NAME } from '../shared/validation';
import {
  isReactionContent,
  type DiscussionCategoriesResponse,
  type DiscussionCategory,
  type DiscussionComment,
  type DiscussionDetail,
  type DiscussionDetailResponse,
  type DiscussionMutationResponse,
  type DiscussionSummary,
  type DiscussionsResponse,
  type ReactionContent,
  type ReactionGroup,
} from '../shared/discussions';
import { readSession, type SessionPayload } from './auth';
import type { Env } from './env';
import { UpstreamError, errorResponse, githubGraphql, jsonResponse, type GraphQLOperation } from './github-client';
import { isSameOrigin, PRIVATE_HEADERS, privateJson, readJsonBody } from './http';
import { logEvent } from './logging';
import { requireRepo } from './params';
import { authorizeWrite, type RepoNeed } from './authorization';

const DISCUSSIONS_TTL_SECONDS = 60;
const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const BODY_MAX = 65_536;
const TITLE_MAX = 300;
/** GraphQL node ids are base64; anything else is rejected before it is sent. */
const NODE_ID = /^[A-Za-z0-9_=+/:-]{8,200}$/;

const AUTHOR_FIELDS = 'author { login avatarUrl(size: 64) url }';
const CATEGORY_FIELDS = 'category { id name emoji slug description isAnswerable }';
const REACTION_FIELDS = 'reactionGroups { content count viewerHasReacted }';

const COMMENT_FIELDS = `
  id
  body
  createdAt
  updatedAt
  isAnswer
  viewerCanUpdate
  viewerCanDelete
  ${AUTHOR_FIELDS}
  ${REACTION_FIELDS}
  replies(first: 20) {
    nodes {
      id
      body
      createdAt
      updatedAt
      isAnswer
      viewerCanUpdate
      viewerCanDelete
      ${AUTHOR_FIELDS}
      ${REACTION_FIELDS}
    }
  }`;

const SUMMARY_FIELDS = `
  id
  number
  title
  createdAt
  updatedAt
  upvoteCount
  locked
  url
  ${AUTHOR_FIELDS}
  ${CATEGORY_FIELDS}
  ${REACTION_FIELDS}
  answer { id }
  comments { totalCount }`;

const OPERATIONS = {
  repositoryId: {
    name: 'repositoryId',
    query: `query RepositoryId($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { id }
}`,
  },
  categories: {
    name: 'discussionCategories',
    query: `query DiscussionCategories($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    discussionCategories(first: 25) { nodes { id name emoji slug description isAnswerable } }
  }
}`,
  },
  list: {
    name: 'discussionList',
    query: `query DiscussionList($owner: String!, $name: String!, $first: Int!, $after: String, $categoryId: ID, $orderByField: DiscussionOrderField!, $direction: OrderDirection!) {
  repository(owner: $owner, name: $name) {
    discussions(first: $first, after: $after, categoryId: $categoryId, orderBy: { field: $orderByField, direction: $direction }) {
      totalCount
      pageInfo { hasNextPage endCursor hasPreviousPage startCursor }
      nodes { ${SUMMARY_FIELDS} }
    }
  }
}`,
  },
  search: {
    name: 'discussionSearch',
    query: `query DiscussionSearch($query: String!, $first: Int!, $after: String) {
  search(query: $query, type: DISCUSSION, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor hasPreviousPage startCursor }
    nodes { ... on Discussion { ${SUMMARY_FIELDS} } }
  }
}`,
  },
  detail: {
    name: 'discussionDetail',
    query: `query DiscussionDetail($owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    discussion(number: $number) {
      id
      number
      title
      body
      createdAt
      updatedAt
      upvoteCount
      locked
      url
      viewerCanUpdate
      viewerCanDelete
      ${AUTHOR_FIELDS}
      ${CATEGORY_FIELDS}
      ${REACTION_FIELDS}
      answer { ${COMMENT_FIELDS} }
      comments(first: $first, after: $after) {
        totalCount
        pageInfo { hasNextPage endCursor hasPreviousPage startCursor }
        nodes { ${COMMENT_FIELDS} }
      }
    }
  }
}`,
  },
  create: {
    name: 'createDiscussion',
    query: `mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
  createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
    discussion { id number url }
  }
}`,
  },
  update: {
    name: 'updateDiscussion',
    query: `mutation UpdateDiscussion($discussionId: ID!, $title: String, $body: String, $categoryId: ID) {
  updateDiscussion(input: { discussionId: $discussionId, title: $title, body: $body, categoryId: $categoryId }) {
    discussion { id number url }
  }
}`,
  },
  remove: {
    name: 'deleteDiscussion',
    query: `mutation DeleteDiscussion($id: ID!) {
  deleteDiscussion(input: { id: $id }) { discussion { id } }
}`,
  },
  lock: {
    name: 'lockDiscussion',
    query: `mutation LockDiscussion($id: ID!, $lockReason: LockReason) {
  lockDiscussion(input: { lockableId: $id, lockReason: $lockReason }) {
    lockedRecord { ... on Discussion { id locked } }
  }
}`,
  },
  unlock: {
    name: 'unlockDiscussion',
    query: `mutation UnlockDiscussion($id: ID!) {
  unlockDiscussion(input: { lockableId: $id }) {
    unlockedRecord { ... on Discussion { id locked } }
  }
}`,
  },
  markAnswer: {
    name: 'markDiscussionCommentAsAnswer',
    query: `mutation MarkAnswer($id: ID!) {
  markDiscussionCommentAsAnswer(input: { id: $id }) { discussion { id } }
}`,
  },
  unmarkAnswer: {
    name: 'unmarkDiscussionCommentAsAnswer',
    query: `mutation UnmarkAnswer($id: ID!) {
  unmarkDiscussionCommentAsAnswer(input: { id: $id }) { discussion { id } }
}`,
  },
  addComment: {
    name: 'addDiscussionComment',
    query: `mutation AddDiscussionComment($discussionId: ID!, $body: String!) {
  addDiscussionComment(input: { discussionId: $discussionId, body: $body }) { comment { id url } }
}`,
  },
  addReply: {
    name: 'addDiscussionReply',
    query: `mutation AddDiscussionReply($discussionId: ID!, $parentCommentId: ID!, $body: String!) {
  addDiscussionReply(input: { discussionId: $discussionId, parentCommentId: $parentCommentId, body: $body }) { comment { id url } }
}`,
  },
  updateComment: {
    name: 'updateDiscussionComment',
    query: `mutation UpdateDiscussionComment($id: ID!, $body: String!) {
  updateDiscussionComment(input: { id: $id, body: $body }) { comment { id url } }
}`,
  },
  deleteComment: {
    name: 'deleteDiscussionComment',
    query: `mutation DeleteDiscussionComment($id: ID!) {
  deleteDiscussionComment(input: { id: $id }) { comment { id } }
}`,
  },
  addReaction: {
    name: 'addReaction',
    query: `mutation AddReaction($subjectId: ID!, $content: ReactionContent!) {
  addReaction(input: { subjectId: $subjectId, content: $content }) { reaction { content } subject { id } }
}`,
  },
  removeReaction: {
    name: 'removeReaction',
    query: `mutation RemoveReaction($subjectId: ID!, $content: ReactionContent!) {
  removeReaction(input: { subjectId: $subjectId, content: $content }) { reaction { content } subject { id } }
}`,
  },
} satisfies Record<string, GraphQLOperation>;

function operation<K extends keyof typeof OPERATIONS>(key: K): GraphQLOperation {
  return OPERATIONS[key];
}

// --- mapping ----------------------------------------------------------------

type RawNode = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function mapAuthor(value: unknown): DiscussionComment['author'] {
  if (!value || typeof value !== 'object') return null;
  const node = value as RawNode;
  const login = str(node.login);
  if (!login) return null;
  return { login, avatarUrl: str(node.avatarUrl), htmlUrl: str(node.url) ?? `https://github.com/${login}` };
}

function mapReactionGroups(value: unknown): ReactionGroup[] {
  if (!Array.isArray(value)) return [];
  const groups: ReactionGroup[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const node = entry as RawNode;
    const content = str(node.content);
    if (!content || !isReactionContent(content)) continue;
    groups.push({ content, count: num(node.count), viewerHasReacted: node.viewerHasReacted === true });
  }
  return groups;
}

function mapCategory(value: unknown): DiscussionCategory | null {
  if (!value || typeof value !== 'object') return null;
  const node = value as RawNode;
  const id = str(node.id);
  const name = str(node.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    emoji: str(node.emoji) ?? '',
    slug: str(node.slug) ?? '',
    description: str(node.description),
    isAnswerable: node.isAnswerable === true,
  };
}

function mapComment(value: unknown): DiscussionComment | null {
  if (!value || typeof value !== 'object') return null;
  const node = value as RawNode;
  const id = str(node.id);
  if (!id) return null;
  const repliesNode = (node.replies ?? {}) as RawNode;
  const replies = Array.isArray(repliesNode.nodes)
    ? repliesNode.nodes.map(mapComment).filter((entry): entry is DiscussionComment => entry !== null)
    : [];
  return {
    id,
    body: str(node.body) ?? '',
    author: mapAuthor(node.author),
    createdAt: str(node.createdAt) ?? '',
    updatedAt: str(node.updatedAt),
    isAnswer: node.isAnswer === true,
    replies,
    viewerCanUpdate: node.viewerCanUpdate === true,
    viewerCanDelete: node.viewerCanDelete === true,
    reactions: mapReactionGroups(node.reactionGroups),
  };
}

function mapSummary(value: unknown): DiscussionSummary | null {
  if (!value || typeof value !== 'object') return null;
  const node = value as RawNode;
  const id = str(node.id);
  if (!id) return null;
  const comments = (node.comments ?? {}) as RawNode;
  return {
    id,
    number: num(node.number),
    title: str(node.title) ?? '',
    author: mapAuthor(node.author),
    category: mapCategory(node.category),
    createdAt: str(node.createdAt) ?? '',
    updatedAt: str(node.updatedAt),
    commentsCount: num(comments.totalCount),
    upvoteCount: num(node.upvoteCount),
    locked: node.locked === true,
    answered: node.answer !== null && node.answer !== undefined,
    url: str(node.url) ?? '',
  };
}

function mapDetail(value: unknown): DiscussionDetail | null {
  const summary = mapSummary(value);
  if (!summary) return null;
  const node = value as RawNode;
  const comments = (node.comments ?? {}) as RawNode;
  return {
    ...summary,
    body: str(node.body) ?? '',
    answer: mapComment(node.answer),
    comments: Array.isArray(comments.nodes)
      ? comments.nodes.map(mapComment).filter((entry): entry is DiscussionComment => entry !== null)
      : [],
    viewerCanUpdate: node.viewerCanUpdate === true,
    viewerCanDelete: node.viewerCanDelete === true,
    // GitHub's Discussion type exposes no `viewerCanLock`; Forge's own
    // permission answer decides whether the control is offered instead of
    // guessing a field the API may not have.
    viewerCanLock: false,
    reactions: mapReactionGroups(node.reactionGroups),
  };
}

function mapPageInfo(value: unknown): DiscussionsResponse['pageInfo'] {
  const node = (value ?? {}) as RawNode;
  return {
    hasNextPage: node.hasNextPage === true,
    endCursor: str(node.endCursor),
    hasPreviousPage: node.hasPreviousPage === true,
    startCursor: str(node.startCursor),
  };
}

// --- route parsing ----------------------------------------------------------

interface Route {
  repo: string;
  kind: 'categories' | 'list' | 'detail' | 'comments' | 'comment' | 'reactions' | 'answer' | 'lock' | 'unlock';
  number: number | null;
  commentId: string | null;
}

const ROUTE_PATTERNS: Array<{ pattern: RegExp; kind: Route['kind']; numberGroup?: number; commentGroup?: number }> = [
  { pattern: /^\/api\/repos\/([^/]+)\/discussions\/categories$/, kind: 'categories' },
  { pattern: /^\/api\/repos\/([^/]+)\/discussions\/reactions$/, kind: 'reactions' },
  { pattern: /^\/api\/repos\/([^/]+)\/discussions\/comments\/([A-Za-z0-9_=+/:-]{8,200})$/, kind: 'comment', commentGroup: 2 },
  { pattern: /^\/api\/repos\/([^/]+)\/discussions\/(\d{1,10})\/comments$/, kind: 'comments', numberGroup: 2 },
  { pattern: /^\/api\/repos\/([^/]+)\/discussions\/(\d{1,10})\/answer$/, kind: 'answer', numberGroup: 2 },
  { pattern: /^\/api\/repos\/([^/]+)\/discussions\/(\d{1,10})\/lock$/, kind: 'lock', numberGroup: 2 },
  { pattern: /^\/api\/repos\/([^/]+)\/discussions\/(\d{1,10})\/unlock$/, kind: 'unlock', numberGroup: 2 },
  { pattern: /^\/api\/repos\/([^/]+)\/discussions\/(\d{1,10})$/, kind: 'detail', numberGroup: 2 },
  { pattern: /^\/api\/repos\/([^/]+)\/discussions$/, kind: 'list' },
];

export function parseDiscussionRoute(pathname: string): Route | null {
  for (const entry of ROUTE_PATTERNS) {
    const match = entry.pattern.exec(pathname);
    if (!match) continue;
    return {
      repo: match[1] ?? '',
      kind: entry.kind,
      number: entry.numberGroup ? Number(match[entry.numberGroup]) : null,
      commentId: entry.commentGroup ? (match[entry.commentGroup] ?? null) : null,
    };
  }
  return null;
}

export function isDiscussionRoute(method: string, pathname: string): boolean {
  const route = parseDiscussionRoute(pathname);
  if (!route) return false;
  if (method === 'GET') return true;
  if (route.kind === 'categories') return false;
  if (route.kind === 'list') return method === 'POST';
  if (route.kind === 'detail') return method === 'PATCH' || method === 'DELETE';
  if (route.kind === 'comments') return method === 'POST';
  if (route.kind === 'comment') return method === 'POST' || method === 'PATCH' || method === 'DELETE';
  if (route.kind === 'answer') return method === 'POST' || method === 'DELETE';
  if (route.kind === 'lock' || route.kind === 'unlock' || route.kind === 'reactions') return method === 'POST' || method === 'DELETE';
  return false;
}

// --- authorization ----------------------------------------------------------

async function requireWriter(
  request: Request,
  env: Env,
  repo: string,
  action: string,
  need: RepoNeed
): Promise<SessionPayload> {
  const session = await readSession(request, env);
  if (!session) throw new UpstreamError(401, 'UNAUTHENTICATED', 'Sign in to use collaboration features.');
  if (!isSameOrigin(request)) throw new UpstreamError(403, 'CSRF_FAILED', 'Cross-origin writes are not allowed.');
  await authorizeWrite(session, env, { repo, action, need });
  return session;
}

function badRequest(code: string, message: string): Response {
  return errorResponse(400, code, message);
}

function forbidden(): Response {
  return errorResponse(403, 'FORBIDDEN', 'You do not have permission to do that here.');
}

// --- handlers ---------------------------------------------------------------

async function handleCategories(repo: string, env: Env): Promise<Response> {
  const data = await githubGraphql<{ repository: { discussionCategories?: { nodes?: unknown[] } } | null }>(
    operation('categories'),
    { owner: ORG_NAME, name: repo },
    env.GITHUB_TOKEN
  );
  const repository = data.repository;
  const nodes = repository?.discussionCategories?.nodes ?? [];
  const categories = nodes.map(mapCategory).filter((entry): entry is DiscussionCategory => entry !== null);
  const body: DiscussionCategoriesResponse = { repo, enabled: categories.length > 0, categories };
  return jsonResponse(body, DISCUSSIONS_TTL_SECONDS);
}

async function handleList(repo: string, request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const after = url.searchParams.get('after');
  const categoryId = url.searchParams.get('category');
  const query = url.searchParams.get('q');
  const direction = url.searchParams.get('direction') === 'ASC' ? 'ASC' : 'DESC';
  const orderByField = url.searchParams.get('orderBy') === 'UPDATED_AT' ? 'UPDATED_AT' : 'CREATED_AT';
  const first = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(url.searchParams.get('per_page') ?? PAGE_SIZE) || PAGE_SIZE)
  );

  const empty: DiscussionsResponse = {
    repo,
    categoryId,
    discussions: [],
    pageInfo: { hasNextPage: false, endCursor: null, hasPreviousPage: false, startCursor: null },
  };

  if (query && query.trim().length > 0) {
    // Search is scoped to this repository, and the caller-supplied text is only
    // ever passed as a GraphQL variable — never concatenated into the document.
    const searchQuery = `repo:${ORG_NAME}/${repo} ${query.trim()}`.slice(0, 256);
    const data = await githubGraphql<{ search: { pageInfo?: unknown; nodes?: unknown[] } }>(
      operation('search'),
      { query: searchQuery, first, after },
      env.GITHUB_TOKEN
    );
    const discussions = (data.search?.nodes ?? [])
      .map(mapSummary)
      .filter((entry): entry is DiscussionSummary => entry !== null);
    return jsonResponse({ ...empty, discussions, pageInfo: mapPageInfo(data.search?.pageInfo) }, DISCUSSIONS_TTL_SECONDS);
  }

  const data = await githubGraphql<{
    repository: { discussions?: { pageInfo?: unknown; nodes?: unknown[] } } | null;
  }>(operation('list'), {
    owner: ORG_NAME,
    name: repo,
    first,
    after: after && NODE_ID.test(after) ? after : null,
    categoryId: categoryId && NODE_ID.test(categoryId) ? categoryId : null,
    orderByField,
    direction,
  }, env.GITHUB_TOKEN);
  const connection = data.repository?.discussions;
  const discussions = (connection?.nodes ?? [])
    .map(mapSummary)
    .filter((entry): entry is DiscussionSummary => entry !== null);
  return jsonResponse(
    { ...empty, discussions, pageInfo: mapPageInfo(connection?.pageInfo) },
    DISCUSSIONS_TTL_SECONDS
  );
}

async function handleDetail(repo: string, number: number, request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const after = url.searchParams.get('after');
  const first = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(url.searchParams.get('per_page') ?? PAGE_SIZE) || PAGE_SIZE)
  );
  const data = await githubGraphql<{ repository: { discussion?: unknown } | null }>(
    operation('detail'),
    { owner: ORG_NAME, name: repo, number, first, after: after && NODE_ID.test(after) ? after : null },
    env.GITHUB_TOKEN
  );
  const discussion = mapDetail(data.repository?.discussion);
  if (!discussion) throw new UpstreamError(404, 'NOT_FOUND', 'That discussion does not exist.');
  const body: DiscussionDetailResponse = { repo, discussion };
  return jsonResponse(body, DISCUSSIONS_TTL_SECONDS);
}

function validBody(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || value.length > BODY_MAX) return null;
  return value;
}

function validTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= TITLE_MAX ? trimmed : null;
}

async function handleCreate(repo: string, request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request);
  const title = validTitle(body?.title);
  const text = validBody(body?.body);
  const categoryId = typeof body?.categoryId === 'string' && NODE_ID.test(body.categoryId) ? body.categoryId : null;
  if (!title) return badRequest('INVALID_TITLE', 'A non-empty title is required.');
  if (!text) return badRequest('INVALID_BODY', 'A non-empty body is required.');
  if (!categoryId) return badRequest('INVALID_CATEGORY', 'Pick one of the repository\'s discussion categories.');

  const session = await requireWriter(request, env, repo, 'discussion.create', 'read');

  // The category must belong to this repository: never trust a node id that
  // came from the browser without checking it against the real list.
  const categories = await githubGraphql<{ repository: { discussionCategories?: { nodes?: unknown[] } } | null }>(
    operation('categories'),
    { owner: ORG_NAME, name: repo },
    session.token
  );
  const allowed = (categories.repository?.discussionCategories?.nodes ?? [])
    .map(mapCategory)
    .filter((entry): entry is DiscussionCategory => entry !== null)
    .some((entry) => entry.id === categoryId);
  if (!allowed) return forbidden();

  const meta = await githubGraphql<{ repository: { id?: string } | null }>(
    operation('repositoryId'),
    { owner: ORG_NAME, name: repo },
    session.token
  );
  const repositoryId = meta.repository?.id;
  if (!repositoryId) throw new UpstreamError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub API returned an unexpected response format.');

  const data = await githubGraphql<{ createDiscussion?: { discussion?: RawNode } | null }>(
    operation('create'),
    { repositoryId, categoryId, title, body: text },
    session.token
  );
  const created = data.createDiscussion?.discussion;
  if (!created) throw new UpstreamError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub API returned an unexpected response format.');
  logEvent('debug', 'discussion_created', { repo, categoryId });
  const result: DiscussionMutationResponse = {
    id: str(created.id) ?? '',
    number: num(created.number),
    url: str(created.url) ?? '',
  };
  return privateJson(result, 201);
}

async function handleUpdate(repo: string, number: number, request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request);
  const session = await requireWriter(request, env, repo, 'discussion.update', 'read');

  const existing = await githubGraphql<{ repository: { discussion?: RawNode } | null }>(
    operation('detail'),
    { owner: ORG_NAME, name: repo, number, first: 1, after: null },
    session.token
  );
  const current = mapDetail(existing.repository?.discussion);
  if (!current) throw new UpstreamError(404, 'NOT_FOUND', 'That discussion does not exist.');
  // GitHub decides who may edit; but Forge refuses up front for a discussion
  // the viewer demonstrably does not own and cannot moderate.
  if (!current.viewerCanUpdate) return forbidden();

  const payload: Record<string, unknown> = { discussionId: current.id };
  if (body?.title !== undefined) {
    const title = validTitle(body.title);
    if (!title) return badRequest('INVALID_TITLE', 'A non-empty title is required.');
    payload.title = title;
  }
  if (body?.body !== undefined) {
    const text = validBody(body.body);
    if (!text) return badRequest('INVALID_BODY', 'A non-empty body is required.');
    payload.body = text;
  }
  if (body?.categoryId !== undefined) {
    if (typeof body.categoryId !== 'string' || !NODE_ID.test(body.categoryId)) {
      return badRequest('INVALID_CATEGORY', 'Pick one of the repository\'s discussion categories.');
    }
    payload.categoryId = body.categoryId;
  }
  if (!payload.title && !payload.body && !payload.categoryId) return badRequest('EMPTY_UPDATE', 'Nothing to update.');

  const data = await githubGraphql<{ updateDiscussion?: { discussion?: RawNode } | null }>(
    operation('update'),
    payload,
    session.token
  );
  const updated = data.updateDiscussion?.discussion;
  if (!updated) throw new UpstreamError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub API returned an unexpected response format.');
  logEvent('debug', 'discussion_updated', { repo, number });
  return privateJson({ id: str(updated.id) ?? '', number: num(updated.number), url: str(updated.url) ?? '' });
}

async function handleDelete(repo: string, number: number, request: Request, env: Env): Promise<Response> {
  const session = await requireWriter(request, env, repo, 'discussion.delete', 'write');
  const existing = await githubGraphql<{ repository: { discussion?: RawNode } | null }>(
    operation('detail'),
    { owner: ORG_NAME, name: repo, number, first: 1, after: null },
    session.token
  );
  const current = mapDetail(existing.repository?.discussion);
  if (!current) throw new UpstreamError(404, 'NOT_FOUND', 'That discussion does not exist.');
  if (!current.viewerCanDelete) return forbidden();
  await githubGraphql(operation('remove'), { id: current.id }, session.token);
  logEvent('debug', 'discussion_deleted', { repo, number });
  return new Response(null, { status: 204, headers: { ...PRIVATE_HEADERS } });
}

async function handleLock(repo: string, number: number, locked: boolean, request: Request, env: Env): Promise<Response> {
  const session = await requireWriter(request, env, repo, locked ? 'discussion.lock' : 'discussion.unlock', 'write');
  const existing = await githubGraphql<{ repository: { discussion?: RawNode } | null }>(
    operation('detail'),
    { owner: ORG_NAME, name: repo, number, first: 1, after: null },
    session.token
  );
  const current = mapDetail(existing.repository?.discussion);
  if (!current) throw new UpstreamError(404, 'NOT_FOUND', 'That discussion does not exist.');
  const data = await githubGraphql<{ lockedRecord?: { locked?: boolean } | null; unlockedRecord?: { locked?: boolean } | null }>(
    operation(locked ? 'lock' : 'unlock'),
    locked ? { id: current.id, lockReason: 'RESOLVED' } : { id: current.id },
    session.token
  );
  const record = locked ? data.lockedRecord : data.unlockedRecord;
  logEvent('debug', locked ? 'discussion_locked' : 'discussion_unlocked', { repo, number });
  return privateJson({ id: current.id, locked: record?.locked === true });
}

async function handleAnswer(repo: string, number: number, mark: boolean, request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request);
  const commentId = typeof body?.commentId === 'string' && NODE_ID.test(body.commentId) ? body.commentId : null;
  if (!commentId) return badRequest('INVALID_COMMENT', 'A comment id is required.');
  const session = await requireWriter(
    request,
    env,
    repo,
    mark ? 'discussion.answer' : 'discussion.unanswer',
    mark ? 'triage' : 'triage'
  );
  // The comment must belong to this discussion: verify before mutating.
  const existing = await githubGraphql<{ repository: { discussion?: RawNode } | null }>(
    operation('detail'),
    { owner: ORG_NAME, name: repo, number, first: 100, after: null },
    session.token
  );
  const current = mapDetail(existing.repository?.discussion);
  if (!current) throw new UpstreamError(404, 'NOT_FOUND', 'That discussion does not exist.');
  const owns = [current.answer, ...current.comments, ...current.comments.flatMap((entry) => entry.replies)]
    .filter((entry): entry is DiscussionComment => entry !== null)
    .some((entry) => entry.id === commentId);
  if (!owns) return forbidden();
  await githubGraphql(operation(mark ? 'markAnswer' : 'unmarkAnswer'), { id: commentId }, session.token);
  logEvent('debug', mark ? 'discussion_answered' : 'discussion_answer_removed', { repo, number });
  return privateJson({ id: current.id, answerId: mark ? commentId : null });
}

async function handleAddComment(repo: string, number: number, request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request);
  const text = validBody(body?.body);
  if (!text) return badRequest('INVALID_BODY', 'A non-empty body is required.');
  const session = await requireWriter(request, env, repo, 'discussion.comment', 'read');
  const existing = await githubGraphql<{ repository: { discussion?: RawNode } | null }>(
    operation('detail'),
    { owner: ORG_NAME, name: repo, number, first: 1, after: null },
    session.token
  );
  const current = mapDetail(existing.repository?.discussion);
  if (!current) throw new UpstreamError(404, 'NOT_FOUND', 'That discussion does not exist.');
  if (current.locked) throw new UpstreamError(409, 'LOCKED', 'This discussion is locked.');

  const parentId = typeof body?.parentCommentId === 'string' && NODE_ID.test(body.parentCommentId) ? body.parentCommentId : null;
  type CommentMutation = { addDiscussionReply?: { comment?: RawNode } | null; addDiscussionComment?: { comment?: RawNode } | null };
  const data = parentId
    ? await githubGraphql<CommentMutation>(operation('addReply'), { discussionId: current.id, parentCommentId: parentId, body: text }, session.token)
    : await githubGraphql<CommentMutation>(operation('addComment'), { discussionId: current.id, body: text }, session.token);
  const comment = (parentId ? data.addDiscussionReply?.comment : data.addDiscussionComment?.comment) as RawNode | undefined;
  if (!comment) throw new UpstreamError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub API returned an unexpected response format.');
  logEvent('debug', parentId ? 'discussion_reply_added' : 'discussion_comment_added', { repo, number });
  return privateJson({ id: current.id, number, url: str(comment.url) ?? '', commentId: str(comment.id) ?? '' }, 201);
}

async function handleCommentMutation(repo: string, commentId: string, request: Request, env: Env): Promise<Response> {
  if (request.method === 'PATCH') {
    const body = await readJsonBody(request);
    const text = validBody(body?.body);
    if (!text) return badRequest('INVALID_BODY', 'A non-empty body is required.');
    const session = await requireWriter(request, env, repo, 'discussion.comment.update', 'read');
    const data = await githubGraphql<{ updateDiscussionComment?: { comment?: RawNode } | null }>(
      operation('updateComment'),
      { id: commentId, body: text },
      session.token
    );
    const comment = data.updateDiscussionComment?.comment;
    if (!comment) throw new UpstreamError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub API returned an unexpected response format.');
    logEvent('debug', 'discussion_comment_updated', { repo });
    return privateJson({ id: str(comment.id) ?? '', url: str(comment.url) ?? '', commentId: str(comment.id) ?? '' });
  }

  const session = await requireWriter(request, env, repo, 'discussion.comment.delete', 'read');
  await githubGraphql(operation('deleteComment'), { id: commentId }, session.token);
  logEvent('debug', 'discussion_comment_deleted', { repo });
  return new Response(null, { status: 204, headers: { ...PRIVATE_HEADERS } });
}

async function handleReactions(repo: string, request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request);
  const subjectId = typeof body?.subjectId === 'string' && NODE_ID.test(body.subjectId) ? body.subjectId : null;
  const content = body?.content;
  if (!subjectId) return badRequest('INVALID_SUBJECT', 'A valid discussion or comment id is required.');
  if (!isReactionContent(content)) {
    return badRequest('INVALID_REACTION', 'content must be one of GitHub\'s eight reactions.');
  }
  const session = await requireWriter(request, env, repo, 'discussion.react', 'read');
  await githubGraphql(
    operation(request.method === 'DELETE' ? 'removeReaction' : 'addReaction'),
    { subjectId, content: content as ReactionContent },
    session.token
  );
  logEvent('debug', request.method === 'DELETE' ? 'discussion_reaction_removed' : 'discussion_reaction_added', {
    repo,
    content,
  });
  // The API never invents a new tally: the client re-reads the discussion.
  return new Response(null, { status: 204, headers: { ...PRIVATE_HEADERS } });
}

/** Entry point for every /api/repos/:repo/discussions* request. */
export async function handleDiscussionRoute(pathname: string, request: Request, env: Env): Promise<Response> {
  const route = parseDiscussionRoute(pathname);
  if (!route) return errorResponse(404, 'NOT_FOUND', 'API endpoint not found.');
  const repo = requireRepo(route.repo);

  if (route.kind === 'categories' && request.method === 'GET') return handleCategories(repo, env);
  if (route.kind === 'list') {
    if (request.method === 'GET') return handleList(repo, request, env);
    if (request.method === 'POST') return handleCreate(repo, request, env);
  }
  if (route.kind === 'detail' && route.number !== null) {
    if (request.method === 'GET') return handleDetail(repo, route.number, request, env);
    if (request.method === 'PATCH') return handleUpdate(repo, route.number, request, env);
    if (request.method === 'DELETE') return handleDelete(repo, route.number, request, env);
  }
  if (route.kind === 'comments' && route.number !== null && request.method === 'POST') {
    return handleAddComment(repo, route.number, request, env);
  }
  // Editing or deleting a single comment lives under /discussions/comments/:id;
  // replying happens through `parentCommentId` on the discussion's comments route.
  if (route.kind === 'comment' && route.commentId) {
    return handleCommentMutation(repo, route.commentId, request, env);
  }
  if (route.kind === 'answer' && route.number !== null) {
    return handleAnswer(repo, route.number, request.method === 'POST', request, env);
  }
  if (route.kind === 'lock' && route.number !== null && request.method === 'POST') {
    return handleLock(repo, route.number, true, request, env);
  }
  if (route.kind === 'unlock' && route.number !== null && request.method === 'POST') {
    return handleLock(repo, route.number, false, request, env);
  }
  if (route.kind === 'reactions') return handleReactions(repo, request, env);

  const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'That method is not supported on this route.');
  response.headers.set('Allow', 'GET');
  return response;
}
