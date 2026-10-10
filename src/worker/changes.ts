/**
 * Authenticated repository writes and read-only compare (Milestone C).
 *
 * Every write:
 * 1. requires a valid encrypted session (fail closed 401),
 * 2. verifies push permission with the user's OWN token before acting
 *    (fail closed 403/404),
 * 3. performs the GitHub call with that same user token — the optional
 *    GITHUB_TOKEN / app credentials are never used for user writes.
 *
 * Routes:
 *   POST /api/repos/:repo/commit    create/update a file on a branch
 *   POST /api/repos/:repo/branches  create a branch
 *   GET  /api/repos/:repo/compare   unified diff between two refs (read-only)
 */

import {
  validateBranchName,
  validateCommitContent,
  validateCommitMessage,
  validateCommitPath,
  PATCH_MAX_CHARS,
} from '../shared/changes';
import { ORG_NAME } from '../shared/validation';
import type { CommitResponse, CompareFile, CompareResponse, CreateBranchResponse } from '../types';
import { readSession, type SessionPayload } from './auth';
import type { Env } from './env';
import { UpstreamError, errorResponse, jsonResponse } from './github-client';
import { logEvent } from './logging';
import { requireRepo } from './params';

const API = 'https://api.github.com';
const API_HEADERS = (token: string): Record<string, string> => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ankworks-forge',
});

function authError(status: number, code: string, message: string): Response {
  return errorResponse(status, code, message);
}

/** Parse a bounded JSON object body; null for anything malformed. */
async function readRequestBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > 1_000_000) return null;
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Base64 of a UTF-8 string, encoded byte by byte.
 *
 * `btoa(String.fromCharCode(...bytes))` turns every byte into a call argument, so
 * it throws `RangeError: Maximum call stack size exceeded` once the file is large
 * enough — measured at 150 000 bytes under Node 22 (the exact threshold depends
 * on the runtime's remaining stack, which is why it is not a fixed number).
 * COMMIT_MAX_BYTES is 400 000, so a valid request could hit it and fail with an
 * opaque 500 instead of reaching GitHub. The loop has no argument limit and no
 * stack dependency.
 */
function toBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

/** Map GitHub's 422/409 from contents writes to stable codes. */
function mapWriteFailure(status: number, body: unknown): UpstreamError {
  const message = (body as { message?: string } | null)?.message ?? '';
  if (status === 409) return new UpstreamError(409, 'CONFLICT', 'The branch changed while you were editing. Reload and retry.');
  if (status === 422 && /sha/i.test(message)) return new UpstreamError(422, 'STALE_BLOB', 'The file changed since you loaded it. Reload and retry.');
  if (status === 422 && /does not match/i.test(message)) return new UpstreamError(422, 'INVALID_BRANCH', 'GitHub rejected the branch name.');
  return new UpstreamError(422, 'WRITE_REJECTED', 'GitHub rejected the write request.');
}

async function verifyPushAccess(session: SessionPayload, repo: string): Promise<void> {
  const response = await fetch(`${API}/repos/${ORG_NAME}/${repo}`, {
    method: 'GET',
    redirect: 'manual',
    headers: API_HEADERS(session.token),
  });
  if (response.status === 404) {
    throw new UpstreamError(404, 'REPOSITORY_NOT_FOUND', 'Repository not found or not visible to you.');
  }
  if (!response.ok) throw new UpstreamError(502, 'GITHUB_AUTH_UNAVAILABLE', 'Could not verify repository permissions.');
  const data = (await response.json()) as { permissions?: Record<string, unknown>; private?: boolean };
  const permissions = data.permissions ?? {};
  if (permissions.push !== true) {
    throw new UpstreamError(403, 'FORBIDDEN', 'You need push access to modify this repository.');
  }
}

async function handleCommit(repo: string, request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session) return authError(401, 'UNAUTHENTICATED', 'Sign in to commit changes.');
  const body = await readRequestBody(request);
  const message = validateCommitMessage(body?.message);
  const content = validateCommitContent(body?.content);
  const branch = validateBranchName(body?.branch);
  const path = validateCommitPath(body?.path);
  const sha = body?.sha;
  if (!message.ok) return authError(400, 'INVALID_MESSAGE', 'A non-empty commit message is required.');
  if (!content.ok) return authError(400, content.code, 'The file content is missing or too large.');
  if (!branch.ok) return authError(400, 'INVALID_BRANCH', 'A valid branch name is required.');
  if (!path.ok) return authError(400, 'INVALID_PATH', 'A valid repository-relative path is required.');
  if (sha !== undefined && (typeof sha !== 'string' || !/^[0-9a-f]{40}$/i.test(sha))) {
    return authError(400, 'INVALID_BLOB_SHA', 'sha must be the 40-character blob sha of the file being replaced.');
  }

  await verifyPushAccess(session, repo);

  const payload: Record<string, unknown> = {
    message: message.message,
    content: toBase64Utf8(content.content),
    branch: branch.name,
  };
  if (typeof sha === 'string') payload.sha = sha;

  const response = await fetch(`${API}/repos/${ORG_NAME}/${repo}/contents/${path.path}`, {
    method: 'PUT',
    redirect: 'manual',
    headers: { ...API_HEADERS(session.token), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw mapWriteFailure(response.status, data);
  const record = (data ?? {}) as { commit?: { sha?: string; html_url?: string }; content?: { sha?: string; path?: string } };
  logEvent('debug', 'repo_commit', { repo, branch: branch.name, path: path.path });
  const result: CommitResponse = {
    branch: branch.name,
    path: path.path,
    commit: {
      sha: record.commit?.sha ?? '',
      message: message.message,
      html_url: record.commit?.html_url ?? `https://github.com/${ORG_NAME}/${repo}/commits/${branch.name}`,
    },
    content: { sha: record.content?.sha ?? '', path: record.content?.path ?? path.path },
  };
  return jsonResponse(result, 0);
}

async function handleCreateBranch(repo: string, request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session) return authError(401, 'UNAUTHENTICATED', 'Sign in to create branches.');
  const body = await readRequestBody(request);
  const name = validateBranchName(body?.name);
  const from = body?.from;
  if (!name.ok) return authError(400, 'INVALID_BRANCH', 'A valid branch name is required.');
  if (typeof from !== 'string' || from.length === 0 || from.length > 255) {
    return authError(400, 'INVALID_REF', 'A start point (from) is required.');
  }

  await verifyPushAccess(session, repo);

  // Resolve the start point. A 40-hex string is treated as a commit sha;
  // anything else must be an existing branch.
  let startSha: string;
  if (/^[0-9a-f]{40}$/i.test(from)) {
    startSha = from;
  } else {
    const refResponse = await fetch(`${API}/repos/${ORG_NAME}/${repo}/git/ref/heads/${encodeURIComponent(from)}`, {
      method: 'GET',
      redirect: 'manual',
      headers: API_HEADERS(session.token),
    });
    if (refResponse.status === 404) {
      return authError(404, 'REF_NOT_FOUND', 'The start branch does not exist.');
    }
    if (!refResponse.ok) throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'Could not resolve the start point.');
    const refData = (await refResponse.json()) as { object?: { sha?: string } };
    startSha = refData.object?.sha ?? '';
    if (!/^[0-9a-f]{40}$/i.test(startSha)) throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'GitHub returned an invalid start commit.');
  }

  const response = await fetch(`${API}/repos/${ORG_NAME}/${repo}/git/refs`, {
    method: 'POST',
    redirect: 'manual',
    headers: { ...API_HEADERS(session.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${name.name}`, sha: startSha }),
  });
  const data: unknown = await response.json().catch(() => null);
  if (response.status === 422) {
    const message = (data as { message?: string } | null)?.message ?? '';
    if (message.toLowerCase().includes('already exists')) {
      return authError(422, 'BRANCH_EXISTS', 'A branch with that name already exists.');
    }
    return authError(422, 'WRITE_REJECTED', 'GitHub rejected the new branch.');
  }
  if (!response.ok) throw mapWriteFailure(response.status, data);
  const record = (data ?? {}) as { object?: { sha?: string } };
  const result: CreateBranchResponse = { name: name.name, sha: record.object?.sha ?? startSha };
  logEvent('debug', 'repo_branch_created', { repo, branch: name.name });
  return jsonResponse(result, 0);
}

function truncatePatch(patch: string | null | undefined): string | null {
  if (typeof patch !== 'string') return null;
  return patch.length > PATCH_MAX_CHARS ? `${patch.slice(0, PATCH_MAX_CHARS)}\n… (patch truncated)` : patch;
}

async function handleCompare(repo: string, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const base = url.searchParams.get('base') ?? '';
  const head = url.searchParams.get('head') ?? '';
  if (!base || !head || base.length > 255 || head.length > 255) {
    return authError(400, 'INVALID_PARAMETER', 'base and head are required.');
  }
  const response = await fetch(`${API}/repos/${ORG_NAME}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ankworks-forge',
    },
  });
  if (response.status === 404) return authError(404, 'COMPARE_NOT_FOUND', 'One of the refs does not exist.');
  if (!response.ok) throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'Could not compare the requested refs.');
  const data = (await response.json()) as {
    status?: string;
    ahead_by?: number;
    behind_by?: number;
    total_commits?: number;
    html_url?: string;
    files?: Array<{ filename?: string; status?: string; additions?: number; deletions?: number; patch?: string }>;
  };
  const files: CompareFile[] = (data.files ?? []).map((file) => ({
    filename: file.filename ?? '',
    status: file.status ?? 'modified',
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    patch: truncatePatch(file.patch),
  }));
  const result: CompareResponse = {
    repo,
    base,
    head,
    status: data.status === 'behind' || data.status === 'diverged' || data.status === 'identical' ? data.status : 'ahead',
    ahead_by: data.ahead_by ?? 0,
    behind_by: data.behind_by ?? 0,
    total_commits: data.total_commits ?? 0,
    html_url: data.html_url ?? `https://github.com/${ORG_NAME}/${repo}/compare/${base}...${head}`,
    files,
    fetched_at: new Date().toISOString(),
  };
  return jsonResponse(result, 60);
}

/**
 * Dispatch for /api/repos/:repo/{commit|branches|compare}.
 * `action` and `repo` are pre-extracted by the API router.
 */
export async function handleChangesRoute(action: string, repo: string, request: Request, env: Env): Promise<Response> {
  const name = requireRepo(repo);
  if (action === 'commit') {
    if (request.method !== 'POST') {
      const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported.');
      response.headers.set('Allow', 'POST');
      return response;
    }
    return handleCommit(name, request, env);
  }
  if (action === 'branches') {
    if (request.method !== 'POST') {
      const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported.');
      response.headers.set('Allow', 'POST');
      return response;
    }
    return handleCreateBranch(name, request, env);
  }
  if (action === 'compare') {
    if (request.method !== 'GET') {
      const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
      response.headers.set('Allow', 'GET');
      return response;
    }
    return handleCompare(name, request);
  }
  return errorResponse(404, 'NOT_FOUND', 'API endpoint not found.');
}
