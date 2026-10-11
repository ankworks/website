/**
 * Repository insights (V3-A): contributors, languages, releases, GitHub Actions,
 * and the repository document tabs (README / Contributing / License / Security).
 *
 * Hard rules:
 * - Every figure is copied from the GitHub API. Nothing is estimated, cached as
 *   a guess, or filled in client-side. A missing upstream value stays 0/null and
 *   the UI renders "—".
 * - Release binaries are NEVER proxied. Only github.com /
 *   objects.githubusercontent.com download links are returned so the browser
 *   downloads directly from GitHub.
 * - Actions data is read-only. Secrets, logs, and artifacts are never fetched,
 *   stored, or re-served — the response carries a link to GitHub's own UI only.
 * - Document tabs only list files that were proven to exist at the resolved
 *   commit; the UI must not show a tab for a file that is not there.
 */

import {
  computeLanguageStats,
  REPO_DOC_LABELS,
  type Contributor,
  type LanguageStat,
  type Release,
  type ReleaseAsset,
  type RepoDocKey,
  type RepoDocSummary,
  type Workflow,
  type WorkflowRun,
  type WorkflowRunConclusion,
} from '../shared/insights';
import { EXPLORER_LIMITS } from '../shared/limits';
import { ORG_NAME, encodePathSegments, isCommitSha, isValidRef, parsePositiveInt } from '../shared/validation';
import type { Env } from './env';
import { cacheKeyFor, serveCached } from './cache';
import {
  UpstreamError,
  buildGitHubUrl,
  contentsApiPath,
  expectArray,
  expectObject,
  githubGet,
  hasNextPage,
  jsonResponse,
  readJson,
  repoApiPath,
} from './github-client';
import { githubUrl, sanitizeContentsObject } from './sanitize';
import { classifyContent, decodeBase64, resolveCommit } from './explorer';
import { requireRef } from './params';
import { logEvent } from './logging';
import { handleIssueTemplates as readIssueTemplates } from './issue-templates';
import type { IssueTemplatesResponse } from '../shared/issue-templates';

/** Public insight data changes slowly; a 5 minute shared cache is safe and cheap. */
const TTL_SECONDS = 5 * 60;
/** Actions data is more volatile. */
const ACTIONS_TTL_SECONDS = 60;
const DEFAULT_PER_PAGE = 30;
const MAX_PER_PAGE = 100;
const MAX_PAGE = 10_000;
const MAX_RELEASE_BODY = 20_000;

const CONCLUSIONS: readonly string[] = [
  'success',
  'failure',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'neutral',
  'stale',
  'startup_failure',
];

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null;
}

function asString(value: unknown, maxLength = 255): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null;
}

function asInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function asIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

/** HTTPS URL on an allowlisted host, without credentials. */
function safeUrl(value: unknown, hosts: readonly string[]): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (!hosts.includes(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Avatar images are only accepted from GitHub's own avatar service. */
function safeAvatar(value: unknown): string | null {
  return safeUrl(value, ['avatars.githubusercontent.com', 'github.com']);
}

function pagination(params: URLSearchParams): { page: number; perPage: number } {
  const page = parsePositiveInt(params.get('page'), 1, MAX_PAGE);
  const perPage = parsePositiveInt(params.get('per_page'), DEFAULT_PER_PAGE, MAX_PER_PAGE);
  if (page === null || perPage === null) {
    throw new UpstreamError(400, 'INVALID_PARAMETER', 'Invalid pagination parameters.');
  }
  return { page, perPage };
}

// ---------------------------------------------------------------------------
// Contributors
// ---------------------------------------------------------------------------

function sanitizeContributor(input: unknown): Contributor | null {
  const raw = asRecord(input);
  if (!raw) return null;
  const login = asString(raw.login, 39);
  // GitHub returns an anonymous "invalid-email-address" entry; keep the count but
  // never display a login that is not a real account.
  const isAnonymous = raw.type === 'Anonymous' || login === 'invalid-email-address';
  return {
    login: isAnonymous ? null : login,
    avatar_url: isAnonymous ? null : safeAvatar(raw.avatar_url),
    html_url: isAnonymous ? '' : `https://github.com/${login ?? ''}`,
    contributions: asInt(raw.contributions),
  };
}

export async function handleContributors(
  repo: string,
  params: URLSearchParams,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const { page, perPage } = pagination(params);
  const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/contributors`, { page, per_page: perPage });
  return serveCached(key, ctx, async () => {
    const url = buildGitHubUrl(repoApiPath(repo, '/contributors'), {
      per_page: perPage,
      page,
      anon: 'false',
    });
    // 204 No Content is GitHub's "an expensive computation is running"; treat it
    // as an empty page instead of an error.
    let response: Response;
    try {
      response = await githubGet(url, env, {
        notFound: { code: 'REPO_NOT_FOUND', message: 'Repository not found.' },
      });
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 204) {
        return jsonResponse({ contributors: [], page, per_page: perPage, has_next: false }, TTL_SECONDS);
      }
      throw error;
    }
    const contributors = expectArray(await readJson(response))
      .map(sanitizeContributor)
      .filter((item): item is Contributor => item !== null);
    return jsonResponse(
      { contributors, page, per_page: perPage, has_next: hasNextPage(response) },
      TTL_SECONDS
    );
  });
}

// ---------------------------------------------------------------------------
// Languages (GitHub languages API)
// ---------------------------------------------------------------------------

export async function handleLanguages(
  repo: string,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/languages`);
  return serveCached(key, ctx, async () => {
    const response = await githubGet(buildGitHubUrl(repoApiPath(repo, '/languages')), env, {
      notFound: { code: 'REPO_NOT_FOUND', message: 'Repository not found.' },
    });
    const payload = expectObject(await readJson(response));
    const raw: Record<string, number> = {};
    for (const [name, value] of Object.entries(payload)) {
      if (typeof value === 'number' && Number.isFinite(value)) raw[name] = value;
    }
    const { totalBytes, languages } = computeLanguageStats(raw);
    return jsonResponse(
      { total_bytes: totalBytes, languages, fetched_at: new Date().toISOString() },
      TTL_SECONDS
    );
  });
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

const ASSET_HOSTS = ['github.com', 'objects.githubusercontent.com'];

function sanitizeAsset(input: unknown, releaseUrl: string): ReleaseAsset | null {
  const raw = asRecord(input);
  if (!raw) return null;
  const name = asString(raw.name, 255);
  const id = asInt(raw.id);
  if (!name || id === 0) return null;
  // Only GitHub-hosted download links. Anything else (or a malformed URL) falls
  // back to the release page, so a bad upstream value can never become a link.
  const download = safeUrl(raw.browser_download_url, ASSET_HOSTS) ?? releaseUrl;
  return {
    id,
    name,
    content_type: asString(raw.content_type, 255) ?? 'application/octet-stream',
    size: asInt(raw.size),
    download_count: asInt(raw.download_count),
    browser_download_url: download,
  };
}

function sanitizeRelease(input: unknown, repo: string): Release | null {
  const raw = asRecord(input);
  if (!raw) return null;
  const id = asInt(raw.id);
  const tag = asString(raw.tag_name, 255);
  if (id === 0 || tag === null || !isValidRef(tag)) return null;

  const htmlUrl = `https://github.com/${ORG_NAME}/${encodeURIComponent(repo)}/releases/tag/${encodeURIComponent(tag)}`;
  const assets = Array.isArray(raw.assets)
    ? raw.assets
        .slice(0, 100)
        .map((asset) => sanitizeAsset(asset, htmlUrl))
        .filter((asset): asset is ReleaseAsset => asset !== null)
    : [];

  return {
    id,
    tag_name: tag,
    name: asString(raw.name, 255),
    // Drafts are invisible to the public API; the flag is kept for completeness.
    draft: raw.draft === true,
    prerelease: raw.prerelease === true,
    published_at: asIsoDate(raw.published_at),
    created_at: asIsoDate(raw.created_at) ?? '',
    body: typeof raw.body === 'string' && raw.body.length <= 200_000 ? raw.body.slice(0, MAX_RELEASE_BODY) : null,
    author: asRecord(raw.author) ? asString((raw.author as Raw).login, 39) : null,
    html_url: htmlUrl,
    assets,
  };
}

export async function handleReleases(
  repo: string,
  params: URLSearchParams,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const { page, perPage } = pagination(params);
  const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/releases`, { page, per_page: perPage });
  return serveCached(key, ctx, async () => {
    const url = buildGitHubUrl(repoApiPath(repo, '/releases'), { per_page: perPage, page });
    const response = await githubGet(url, env, {
      notFound: { code: 'REPO_NOT_FOUND', message: 'Repository not found.' },
    });
    const releases = expectArray(await readJson(response))
      .map((item) => sanitizeRelease(item, repo))
      .filter((item): item is Release => item !== null);
    return jsonResponse({ releases, page, per_page: perPage, has_next: hasNextPage(response) }, TTL_SECONDS);
  });
}

// ---------------------------------------------------------------------------
// GitHub Actions (read-only)
// ---------------------------------------------------------------------------

function sanitizeWorkflow(input: unknown, repo: string): Workflow | null {
  const raw = asRecord(input);
  if (!raw) return null;
  const id = asInt(raw.id);
  const name = asString(raw.name, 255);
  const path = asString(raw.path, 1024);
  if (id === 0 || name === null || path === null) return null;
  return {
    id,
    name,
    path,
    state: asString(raw.state, 64) ?? 'unknown',
    html_url: `https://github.com/${ORG_NAME}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(path)}`,
  };
}

export async function handleWorkflows(
  repo: string,
  params: URLSearchParams,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const { page, perPage } = pagination(params);
  const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/workflows`, { page, per_page: perPage });
  return serveCached(key, ctx, async () => {
    const url = buildGitHubUrl(repoApiPath(repo, '/actions/workflows'), { per_page: perPage, page });
    let response: Response;
    try {
      response = await githubGet(url, env, {
        notFound: { code: 'ACTIONS_NOT_FOUND', message: 'This repository has no visible workflows.' },
        forbidden: { code: 'ACTIONS_DISABLED', message: 'GitHub Actions is not available for this repository.' },
      });
    } catch (error) {
      // GitHub disables the Actions endpoints (403/404) when Actions is off.
      if (error instanceof UpstreamError && (error.status === 404 || error.status === 403)) {
        return jsonResponse({ total_count: 0, workflows: [], page, per_page: perPage, has_next: false }, ACTIONS_TTL_SECONDS);
      }
      throw error;
    }
    const payload = expectObject(await readJson(response));
    const workflows = (Array.isArray(payload.workflows) ? payload.workflows : [])
      .map((item) => sanitizeWorkflow(item, repo))
      .filter((item): item is Workflow => item !== null);
    return jsonResponse(
      { total_count: asInt(payload.total_count), workflows, page, per_page: perPage, has_next: hasNextPage(response) },
      ACTIONS_TTL_SECONDS
    );
  });
}

function sanitizeRun(input: unknown, repo: string): WorkflowRun | null {
  const raw = asRecord(input);
  if (!raw) return null;
  const id = asInt(raw.id);
  if (id === 0) return null;

  const startedAt = asIsoDate(raw.run_started_at) ?? asIsoDate(raw.created_at);
  const updatedAt = asIsoDate(raw.updated_at);
  let durationMs: number | null = null;
  if (startedAt !== null && updatedAt !== null) {
    const delta = Date.parse(updatedAt) - Date.parse(startedAt);
    if (Number.isFinite(delta) && delta >= 0) durationMs = delta;
  }
  const headSha = asString(raw.head_sha, 40);
  const conclusion = asString(raw.conclusion, 32);

  return {
    id,
    name: asString(raw.name, 255),
    display_title: asString(raw.display_title, 300) ?? '',
    status: asString(raw.status, 32) ?? 'unknown',
    conclusion: (conclusion !== null && CONCLUSIONS.includes(conclusion)
      ? conclusion
      : null) as WorkflowRunConclusion,
    event: asString(raw.event, 64) ?? '',
    head_branch: asString(raw.head_branch, 255),
    head_sha: headSha !== null && isCommitSha(headSha) ? headSha : '',
    run_number: asInt(raw.run_number),
    created_at: asIsoDate(raw.created_at) ?? '',
    updated_at: updatedAt ?? '',
    run_started_at: asIsoDate(raw.run_started_at),
    duration_ms: durationMs,
    actor: asRecord(raw.actor) ? asString((raw.actor as Raw).login, 39) : null,
    workflow_id: asInt(raw.workflow_id) || null,
    // Built from validated parts: never an upstream URL we have not checked.
    html_url: `https://github.com/${ORG_NAME}/${encodeURIComponent(repo)}/actions/runs/${id}`,
  };
}

export async function handleWorkflowRuns(
  repo: string,
  params: URLSearchParams,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const { page, perPage } = pagination(params);
  const branch = params.get('branch');
  const status = params.get('status');
  if (branch !== null && !isValidRef(branch)) {
    throw new UpstreamError(400, 'INVALID_REF', 'Invalid branch filter.');
  }
  if (status !== null && !/^[a-z_]{1,32}$/.test(status)) {
    throw new UpstreamError(400, 'INVALID_PARAMETER', 'Invalid status filter.');
  }

  const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/runs`, {
    page,
    per_page: perPage,
    branch: branch ?? undefined,
    status: status ?? undefined,
  });
  return serveCached(key, ctx, async () => {
    const url = buildGitHubUrl(repoApiPath(repo, '/actions/runs'), {
      per_page: perPage,
      page,
      branch: branch ?? undefined,
      status: status ?? undefined,
    });
    let response: Response;
    try {
      response = await githubGet(url, env, {
        notFound: { code: 'ACTIONS_NOT_FOUND', message: 'This repository has no visible workflow runs.' },
        forbidden: { code: 'ACTIONS_DISABLED', message: 'GitHub Actions is not available for this repository.' },
      });
    } catch (error) {
      if (error instanceof UpstreamError && (error.status === 404 || error.status === 403)) {
        return jsonResponse({ total_count: 0, runs: [], page, per_page: perPage, has_next: false }, ACTIONS_TTL_SECONDS);
      }
      throw error;
    }
    const payload = expectObject(await readJson(response));
    const runs = (Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [])
      .map((item) => sanitizeRun(item, repo))
      .filter((item): item is WorkflowRun => item !== null);
    return jsonResponse(
      { total_count: asInt(payload.total_count), runs, page, per_page: perPage, has_next: hasNextPage(response) },
      ACTIONS_TTL_SECONDS
    );
  });
}

// ---------------------------------------------------------------------------
// Repository documents (README / Contributing / License / Security)
// ---------------------------------------------------------------------------

/** Candidate filename patterns, matched case-insensitively against a listing. */
const DOC_PATTERNS: Record<Exclude<RepoDocKey, 'readme'>, RegExp> = {
  contributing: /^contributing(\.(md|markdown|rst|txt))?$/i,
  license: /^(licen[cs]e|copying)(\.(md|markdown|rst|txt))?$/i,
  security: /^security(\.(md|markdown|rst|txt))?$/i,
};

interface ListingEntry {
  name: string;
  path: string;
  type: string;
  size: number;
}

async function listDirectory(env: Env, repo: string, sha: string, path: string): Promise<ListingEntry[]> {
  try {
    const response = await githubGet(buildGitHubUrl(contentsApiPath(repo, path), { ref: sha }), env, {
      notFound: { code: 'PATH_NOT_FOUND', message: 'This path does not exist at the requested ref.' },
    });
    const payload = await readJson(response);
    if (!Array.isArray(payload)) return [];
    return payload.slice(0, EXPLORER_LIMITS.CONTENTS_LISTING_MAX).flatMap((item) => {
      const raw = asRecord(item);
      const name = raw && asString(raw.name, 255);
      const entryPath = raw && asString(raw.path, 1024);
      const type = raw && typeof raw.type === 'string' ? raw.type : '';
      if (!raw || !name || !entryPath || type !== 'file') return [];
      return [{ name, path: entryPath, type, size: asInt(raw.size) }];
    });
  } catch (error) {
    // A missing directory (no `.github`, empty repository) is not an error here.
    if (error instanceof UpstreamError && (error.status === 404 || error.status === 400)) return [];
    throw error;
  }
}

function matchDoc(key: Exclude<RepoDocKey, 'readme'>, entries: ListingEntry[]): ListingEntry | null {
  const pattern = DOC_PATTERNS[key];
  return entries.find((entry) => pattern.test(entry.name)) ?? null;
}

/**
 * List the repository documents that actually exist at `ref`.
 *
 * Two upstream calls at most (root listing + `.github` listing), each resolved
 * against one exact commit SHA, and the README resolution is delegated to
 * GitHub's own `/readme` endpoint. A tab is never offered for a file that is
 * not provably present at that commit.
 */
export async function handleRepoDocs(
  repo: string,
  params: URLSearchParams,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const ref = requireRef(params);
  const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/docs`, { ref });
  return serveCached(key, ctx, async () => {
    const commit = await resolveCommit(env, repo, ref);
    const [root, githubDir] = await Promise.all([
      listDirectory(env, repo, commit.sha, ''),
      listDirectory(env, repo, commit.sha, '.github'),
    ]);

    const docs: RepoDocSummary[] = [];
    const readme = await findReadme(env, repo, commit.sha);
    if (readme) {
      docs.push({ key: 'readme', label: REPO_DOC_LABELS.readme, path: readme.path, name: readme.name });
    }
    for (const entryKey of ['contributing', 'license', 'security'] as const) {
      const match = matchDoc(entryKey, root) ?? matchDoc(entryKey, githubDir);
      if (match) {
        docs.push({ key: entryKey, label: REPO_DOC_LABELS[entryKey], path: match.path, name: match.name });
      }
    }

    return jsonResponse({ repo, commit_sha: commit.sha, docs }, TTL_SECONDS);
  });
}

/** Resolve the repository README through GitHub's own endpoint. */
async function findReadme(env: Env, repo: string, sha: string): Promise<ListingEntry | null> {
  try {
    const response = await githubGet(buildGitHubUrl(repoApiPath(repo, '/readme'), { ref: sha }), env, {
      notFound: { code: 'README_NOT_FOUND', message: 'This repository has no README.' },
    });
    const object = sanitizeContentsObject(expectObject(await readJson(response)));
    if (!object || object.type !== 'file') return null;
    return { name: object.name, path: object.path, type: 'file', size: object.size };
  } catch (error) {
    if (error instanceof UpstreamError && (error.status === 404 || error.status === 400)) return null;
    throw error;
  }
}

export async function handleRepoDoc(
  repo: string,
  params: URLSearchParams,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const ref = requireRef(params);
  const rawKey = (params.get('key') ?? '').toLowerCase();
  const key = (['readme', 'contributing', 'license', 'security'] as const).find((value) => value === rawKey);
  if (!key) {
    throw new UpstreamError(400, 'INVALID_PARAMETER', 'key must be readme, contributing, license, or security.');
  }

  const cacheKey = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/doc`, { ref, key });
  return serveCached(cacheKey, ctx, async () => {
    const commit = await resolveCommit(env, repo, ref);

    const entry =
      key === 'readme'
        ? await findReadme(env, repo, commit.sha)
        : matchDoc(key, await listDirectory(env, repo, commit.sha, '')) ??
          matchDoc(key, await listDirectory(env, repo, commit.sha, '.github'));
    if (!entry) {
      throw new UpstreamError(404, 'DOC_NOT_FOUND', 'This repository does not have that document.');
    }

    const response = await githubGet(buildGitHubUrl(contentsApiPath(repo, entry.path), { ref: commit.sha }), env, {
      notFound: { code: 'DOC_NOT_FOUND', message: 'This repository does not have that document.' },
    });
    const object = sanitizeContentsObject(expectObject(await readJson(response)));
    if (!object || object.type !== 'file') {
      throw new UpstreamError(404, 'DOC_NOT_FOUND', 'This repository does not have that document.');
    }

    const base = {
      repo,
      commit_sha: commit.sha,
      key,
      path: object.path,
      name: object.name,
      size: object.size,
      html_url: githubUrl(repo, 'blob', encodeURIComponent(commit.sha), encodePathSegments(object.path)),
    };

    if (object.size > EXPLORER_LIMITS.README_MAX_BYTES || object.encoding !== 'base64' || object.content === null) {
      return jsonResponse({ ...base, kind: 'too-large' as const }, TTL_SECONDS);
    }
    const classified = classifyContent(decodeBase64(object.content));
    if (classified.kind === 'text') {
      return jsonResponse({ ...base, kind: 'text' as const, content: classified.text }, TTL_SECONDS);
    }
    return jsonResponse({ ...base, kind: 'binary' as const }, TTL_SECONDS);
  });
}

// ---------------------------------------------------------------------------
// "Go to file"
// ---------------------------------------------------------------------------

const FILE_SEARCH_MAX_RESULTS = 50;
const FILE_SEARCH_QUERY_MAX = 120;
/** Cap on the recursive tree payload: a huge repository must not be buffered. */
const FILE_SEARCH_TREE_MAX_BYTES = 4 * 1024 * 1024;

export interface FileSearchHit {
  path: string;
  name: string;
}

/**
 * Filter file paths inside a repository (the "Go to file" box).
 *
 * This reads ONE recursive tree listing per ref and caches it — it never
 * downloads file contents, never walks directories with extra requests, and
 * never fetches a repository archive. When GitHub marks the tree as truncated
 * (very large repositories) the response says so instead of implying a complete
 * index.
 */
export async function handleFileSearch(
  repo: string,
  params: URLSearchParams,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const ref = requireRef(params);
  const query = (params.get('q') ?? '').trim();
  if (query.length === 0 || query.length > FILE_SEARCH_QUERY_MAX) {
    throw new UpstreamError(400, 'INVALID_QUERY', 'A search term of 1–120 characters is required.');
  }

  const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/file-search`, { ref, q: query.toLowerCase() });
  return serveCached(key, ctx, async () => {
    const commit = await resolveCommit(env, repo, ref);
    const response = await githubGet(
      buildGitHubUrl(repoApiPath(repo, `/git/trees/${encodeURIComponent(commit.sha)}`), { recursive: '1' }),
      env,
      { notFound: { code: 'REPO_NOT_FOUND', message: 'Repository not found.' } }
    );
    const payload = expectObject(await readJson(response, FILE_SEARCH_TREE_MAX_BYTES));
    const tree = Array.isArray(payload.tree) ? payload.tree : [];
    const needle = query.toLowerCase();

    const hits: FileSearchHit[] = [];
    let overflow = false;
    for (const item of tree) {
      const raw = asRecord(item);
      if (!raw || raw.type !== 'blob') continue;
      const path = asString(raw.path, 1024);
      if (path === null || !path.toLowerCase().includes(needle)) continue;
      if (hits.length >= FILE_SEARCH_MAX_RESULTS) {
        overflow = true;
        break;
      }
      hits.push({ path, name: path.slice(path.lastIndexOf('/') + 1) });
    }

    return jsonResponse(
      {
        repo,
        ref,
        commit_sha: commit.sha,
        query,
        hits,
        truncated: payload.truncated === true || overflow,
      },
      TTL_SECONDS
    );
  });
}

/** Issue templates (V3-C): read-only, cached with the other public insights. */
export async function handleIssueTemplatesRoute(
  repo: string,
  params: URLSearchParams,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const ref = params.get('ref');
  const key = cacheKeyFor(new URL(request.url).origin, `/api/repos/${repo}/issue-templates`, { ref: ref ?? '' });
  return serveCached(key, ctx, async () => {
    const templates = await readIssueTemplates(repo, ref, env);
    const body: IssueTemplatesResponse = { repo, enabled: templates.length > 0, templates };
    return jsonResponse(body, TTL_SECONDS);
  });
}

// ---------------------------------------------------------------------------
// Router for the insight endpoints
// ---------------------------------------------------------------------------

export const INSIGHT_ACTIONS = ['contributors', 'languages', 'releases', 'workflows', 'runs', 'docs', 'doc', 'file-search', 'issue-templates'] as const;
export type InsightAction = (typeof INSIGHT_ACTIONS)[number];

export function isInsightAction(value: string): value is InsightAction {
  return (INSIGHT_ACTIONS as readonly string[]).includes(value);
}

export async function handleInsightRoute(
  action: InsightAction,
  repo: string,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  switch (action) {
    case 'contributors':
      return handleContributors(repo, params, request, env, ctx);
    case 'languages':
      return handleLanguages(repo, request, env, ctx);
    case 'releases':
      return handleReleases(repo, params, request, env, ctx);
    case 'workflows':
      return handleWorkflows(repo, params, request, env, ctx);
    case 'runs':
      return handleWorkflowRuns(repo, params, request, env, ctx);
    case 'docs':
      return handleRepoDocs(repo, params, request, env, ctx);
    case 'doc':
      return handleRepoDoc(repo, params, request, env, ctx);
    case 'file-search':
      return handleFileSearch(repo, params, request, env, ctx);
    case 'issue-templates':
      return handleIssueTemplatesRoute(repo, params, request, env, ctx);
    default:
      throw new UpstreamError(404, 'NOT_FOUND', 'API endpoint not found.');
  }
}

/** Logged once per insight request; contains no user data. */
export function logInsightRequest(action: InsightAction): void {
  logEvent('debug', 'insight_request', { action });
}

/** Re-exported for the language-breakdown unit tests. */
export type { LanguageStat };
