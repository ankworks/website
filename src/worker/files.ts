/**
 * File management (Directive C): create, delete, rename, and move.
 *
 * Every operation is a real GitHub write performed with the signed-in user's
 * own OAuth token, behind the full V3-B authorization chain:
 *
 *   session → AnkWorks membership → repository permission → user-scoped token
 *           → branch protection / rulesets
 *
 * Routes:
 *   POST   /api/repos/:repo/files        create a file (optionally on a new branch)
 *   DELETE /api/repos/:repo/files        delete one file, verified by blob sha
 *   POST   /api/repos/:repo/files/move   rename or move, in ONE atomic commit
 *
 * Design notes that matter:
 *
 * - **Rename/move is atomic on purpose.** The GitHub Contents API has no move
 *   operation, so the naive implementation is "create + delete" — two commits,
 *   with a window in which both paths exist and a window in which neither does.
 *   Forge instead builds a Git tree that removes the old path and adds the new
 *   one, commits that tree, and fast-forwards the ref with `force: false`. The
 *   ref update is the concurrency check: if the branch moved while we were
 *   working, GitHub answers 409 and nothing is written. The response reports
 *   `atomic: true, commits: 1` because that is what happened — if this path
 *   ever has to fall back to two commits, the response must say so, and it
 *   does not, because there is no fallback.
 * - **Folders are not a Git concept.** Git tracks files; a directory exists
 *   only while it holds a file. Creating a directory therefore means creating
 *   a file inside it (`.gitkeep` by convention), and deleting a directory
 *   recursively is deliberately NOT offered: it would be a multi-file write
 *   with no sha to verify and no honest way to preview it. See
 *   src/shared/files.ts.
 * - **Nothing writes to a protected branch.** Branch protection is read with
 *   the user's token and fails closed; an unreadable protection is a refusal.
 */

import { ORG_NAME } from '../shared/validation';
import {
  validateBranchName,
  validateCommitContent,
  validateCommitMessage,
  validateCommitPath,
} from '../shared/changes';
import { isObjectSha, joinRepoPath, validateFileName } from '../shared/files';
import { readSession, type SessionPayload } from './auth';
import type { Env } from './env';
import { UpstreamError, errorResponse, jsonResponse } from './github-client';
import { isSameOrigin } from './http';
import { logEvent } from './logging';
import { requireRepo } from './params';
import { authorizeWrite } from './authorization';

const API = 'https://api.github.com';
const UPSTREAM_TIMEOUT_MS = 15_000;

interface HeadersInitLike {
  method?: string;
  body?: string;
}

function gitHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ankworks-forge',
  };
}

/** One authenticated GitHub call with the user's own token. */
async function githubCall(token: string, path: string, init: HeadersInitLike = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...(init.method ? { method: init.method } : {}),
    ...(init.body !== undefined ? { body: init.body } : {}),
    redirect: 'manual',
    headers: {
      ...gitHeaders(token),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

/** JSON body of a GitHub response; null when it is not JSON. */
async function readBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function upstreamMessage(body: Record<string, unknown> | null): string {
  const message = body?.message;
  return typeof message === 'string' ? message : '';
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

async function readRequestBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    // Content is base64-decodable to at most FILE_CONTENT_MAX_BYTES; the JSON
    // wrapper stays far below 2 MB.
    if (text.length > 2_000_000) return null;
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function badRequest(code: string, message: string): Response {
  return errorResponse(400, code, message);
}

/** The target path of a create: an explicit `path`, or `directory` + `name`. */
function requireTargetPath(body: Record<string, unknown> | null): string | Response {
  if (!body) return badRequest('INVALID_BODY', 'A JSON request body is required.');
  if (typeof body.path === 'string') {
    const path = validateCommitPath(body.path);
    if (!path.ok) return badRequest('INVALID_PATH', 'A valid repository-relative path is required.');
    return path.path;
  }
  // Fall back to directory + file name, which is what the UI sends.
  const name = validateFileName(body.name);
  if (!name.ok) return badRequest(name.code, name.message);
  const joined = joinRepoPath(body.directory ?? '', name.value);
  if (joined === null) return badRequest('INVALID_PATH', 'The directory or file name is invalid.');
  const check = validateCommitPath(joined);
  if (!check.ok) return badRequest('INVALID_PATH', 'The resulting repository path is invalid.');
  return check.path;
}

interface CommitFields {
  message: string;
  branch: string;
  newBranch: string | null;
}

function requireCommitFields(body: Record<string, unknown> | null): CommitFields | Response {
  if (!body) return badRequest('INVALID_BODY', 'A JSON request body is required.');
  const message = validateCommitMessage(body.message);
  if (!message.ok) return badRequest('INVALID_MESSAGE', 'A non-empty commit message of at most 1000 characters is required.');
  const branch = validateBranchName(body.branch);
  if (!branch.ok) return badRequest('INVALID_BRANCH', 'A valid branch name is required.');
  let newBranch: string | null = null;
  if (body.newBranch !== undefined && body.newBranch !== null && body.newBranch !== '') {
    const candidate = validateBranchName(body.newBranch);
    if (!candidate.ok) return badRequest('INVALID_BRANCH', 'A valid new branch name is required.');
    newBranch = candidate.name;
  }
  return { message: message.message, branch: branch.name, newBranch };
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/**
 * Full V3-B chain for a file operation.
 *
 * `target` is the branch the commit lands on. When the caller asked for a new
 * branch, that branch does not exist yet, so it has no protection to violate —
 * but the user still needs real push permission on the repository, which the
 * chain verifies with their own token.
 */
async function authorizeFileWrite(
  session: SessionPayload | null,
  request: Request,
  env: Env,
  repo: string,
  action: string,
  target: string
): Promise<void> {
  if (!session) {
    throw new UpstreamError(401, 'UNAUTHENTICATED', 'Sign in to manage files.');
  }
  if (!isSameOrigin(request)) {
    throw new UpstreamError(403, 'CSRF_FAILED', 'Cross-origin writes are not allowed.');
  }
  await authorizeWrite(session, env, { repo, action, need: 'write', branch: target });
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/** Resolve a branch to the commit it points at. */
async function resolveBranchHead(token: string, repo: string, branch: string): Promise<string> {
  const response = await githubCall(token, `/repos/${ORG_NAME}/${encodeURIComponent(repo)}/git/ref/heads/${encodePath(branch)}`);
  if (response.status === 404) {
    throw new UpstreamError(404, 'BRANCH_NOT_FOUND', `The branch "${branch}" does not exist.`);
  }
  if (!response.ok) {
    throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'Could not resolve the target branch.');
  }
  const data = await readBody(response);
  const sha = (data?.object as { sha?: unknown } | undefined)?.sha;
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'GitHub returned an invalid branch reference.');
  }
  return sha;
}

function encodePath(value: string): string {
  // Each segment is encoded so "/" inside a branch name or path survives.
  return value.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

interface BranchTree {
  /** Sha of the tree object the branch tip points at. */
  treeSha: string;
  entries: TreeEntry[];
}

/** Recursive tree listing of a commit. `truncated` is treated as a hard failure. */
async function readTree(token: string, repo: string, commitSha: string): Promise<BranchTree> {
  const response = await githubCall(token, `/repos/${ORG_NAME}/${encodeURIComponent(repo)}/git/commits/${commitSha}`);
  if (!response.ok) {
    throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'Could not read the branch tip commit.');
  }
  const commit = await readBody(response);
  const treeSha = (commit?.tree as { sha?: unknown } | undefined)?.sha;
  if (typeof treeSha !== 'string') {
    throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'GitHub returned an invalid commit.');
  }

  const treeResponse = await githubCall(token, `/repos/${ORG_NAME}/${encodeURIComponent(repo)}/git/trees/${treeSha}?recursive=1`);
  if (!treeResponse.ok) {
    throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'Could not read the repository tree.');
  }
  const tree = await readBody(treeResponse);
  if (tree?.truncated === true) {
    // A truncated tree would make the move silently drop files.
    throw new UpstreamError(422, 'TREE_TOO_LARGE', 'This repository is too large to move files through Forge. Use Git instead.');
  }
  const raw = tree?.tree;
  if (!Array.isArray(raw)) {
    throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'GitHub returned an invalid tree.');
  }
  const entries: TreeEntry[] = [];
  for (const item of raw) {
    const entry = item as Record<string, unknown>;
    const { path, mode, type, sha } = entry;
    if (typeof path === 'string' && typeof sha === 'string' && typeof type === 'string') {
      entries.push({ path, mode: typeof mode === 'string' ? mode : '100644', type, sha });
    }
  }
  return { treeSha, entries };
}

/** Create a branch from an existing branch (used for the "new branch" option). */
async function createBranch(token: string, repo: string, name: string, from: string): Promise<void> {
  const startSha = /^[0-9a-f]{40}$/i.test(from) ? from : await resolveBranchHead(token, repo, from);
  const response = await githubCall(token, `/repos/${ORG_NAME}/${encodeURIComponent(repo)}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${name}`, sha: startSha }),
  });
  if (response.status === 422) {
    throw new UpstreamError(422, 'BRANCH_EXISTS', `A branch named "${name}" already exists.`);
  }
  if (!response.ok) {
    throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'Could not create the new branch.');
  }
}

/** What a path on a branch turned out to be. */
type ExistingPath = { kind: 'file'; sha: string } | { kind: 'other' } | null;

/**
 * Read one path on a branch.
 *
 * `null` means it does not exist. GitHub answers a directory with an ARRAY of
 * entries, so that is reported as `other` — a directory is never a valid target
 * for a single-file delete.
 */
async function readContent(token: string, repo: string, branch: string, path: string): Promise<ExistingPath> {
  const response = await githubCall(
    token,
    `/repos/${ORG_NAME}/${encodeURIComponent(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'Could not read the file on the target branch.');
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'GitHub returned an unreadable response.');
  }
  if (Array.isArray(data)) return { kind: 'other' };
  if (data === null || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (record.type === 'dir') return { kind: 'other' };
  return typeof record.sha === 'string' ? { kind: 'file', sha: record.sha } : { kind: 'other' };
}

/** Map GitHub's write failures to stable, safe, actionable codes. */
function mapWriteFailure(status: number, body: Record<string, unknown> | null): UpstreamError {
  const message = upstreamMessage(body);
  if (status === 409) {
    return new UpstreamError(409, 'CONFLICT', 'The branch changed while you were working. Reload and try again.');
  }
  if (status === 422) {
    if (/sha/i.test(message)) {
      return new UpstreamError(409, 'SHA_CONFLICT', 'The file changed since you loaded it. Reload and try again.');
    }
    if (/does not match/i.test(message)) {
      return new UpstreamError(422, 'INVALID_BRANCH', 'GitHub rejected the branch name.');
    }
    if (/too large|exceeds/i.test(message)) {
      return new UpstreamError(413, 'CONTENT_TOO_LARGE', 'GitHub rejected the file because it is too large.');
    }
    return new UpstreamError(422, 'WRITE_REJECTED', 'GitHub rejected the write request.');
  }
  if (status === 404) {
    return new UpstreamError(404, 'FILE_NOT_FOUND', 'The file or branch does not exist.');
  }
  if (status === 413) {
    return new UpstreamError(413, 'CONTENT_TOO_LARGE', 'The file is too large to commit.');
  }
  if (status === 429) {
    return new UpstreamError(429, 'RATE_LIMITED', 'GitHub is rate limiting requests. Wait a moment and try again.');
  }
  if (status >= 500) {
    return new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'GitHub could not complete the request.');
  }
  return new UpstreamError(422, 'WRITE_REJECTED', 'GitHub rejected the write request.');
}

function commitSummary(data: Record<string, unknown> | null, repo: string, branch: string) {
  const commit = (data?.commit ?? {}) as { sha?: unknown; html_url?: unknown };
  const sha = typeof commit.sha === 'string' ? commit.sha : '';
  const htmlUrl =
    typeof commit.html_url === 'string'
      ? commit.html_url
      : `https://github.com/${ORG_NAME}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(branch)}`;
  return { sha, html_url: htmlUrl };
}

// ---------------------------------------------------------------------------
// POST /api/repos/:repo/files — create (or replace when `sha` is given)
// ---------------------------------------------------------------------------

async function handleCreateFile(repo: string, request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session) return errorResponse(401, 'UNAUTHENTICATED', 'Sign in to create files.');
  if (!isSameOrigin(request)) return errorResponse(403, 'CSRF_FAILED', 'Cross-origin writes are not allowed.');

  const body = await readRequestBody(request);
  const fields = requireCommitFields(body);
  if (isResponse(fields)) return fields;
  const path = requireTargetPath(body);
  if (isResponse(path)) return path;
  const content = validateCommitContent(body?.content);
  if (!content.ok) {
    return badRequest(content.code, content.code === 'CONTENT_TOO_LARGE' ? 'The file is too large to commit through Forge.' : 'The file content is missing.');
  }

  const target = fields.newBranch ?? fields.branch;
  await authorizeFileWrite(session, request, env, repo, 'file.create', target);

  if (fields.newBranch) {
    await createBranch(session.token, repo, fields.newBranch, fields.branch);
  }

  const requestedSha = body?.sha;
  if (requestedSha !== undefined && requestedSha !== null && requestedSha !== '' && !isObjectSha(requestedSha)) {
    return badRequest('INVALID_BLOB_SHA', 'sha must be the 40-character blob sha of the file being replaced.');
  }

  // Duplicate detection: the Contents API would happily replace an existing
  // file when no sha is supplied, silently destroying its history entry. Check
  // first so the user gets a real choice instead of an accident.
  if (requestedSha === undefined || requestedSha === null || requestedSha === '') {
    const existing = await readContent(session.token, repo, target, path);
    if (existing) {
      throw new UpstreamError(409, 'FILE_EXISTS', `"${path}" already exists on "${target}". Edit it, or choose another name.`);
    }
  }

  const payload: Record<string, unknown> = {
    message: fields.message,
    content: toBase64Utf8(content.content),
    branch: target,
  };
  if (typeof requestedSha === 'string' && requestedSha !== '') payload.sha = requestedSha;

  const response = await githubCall(session.token, `/repos/${ORG_NAME}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  const data = await readBody(response);
  if (!response.ok) throw mapWriteFailure(response.status, data);

  const contentSha = ((data?.content ?? {}) as { sha?: unknown }).sha;
  logEvent('debug', 'file_created', { repo, branch: target, path });
  return jsonResponse(
    {
      repo,
      action: 'create',
      branch: target,
      base_branch: fields.branch,
      path,
      commit: commitSummary(data, repo, target),
      content: { sha: typeof contentSha === 'string' ? contentSha : '', path },
      new_branch: fields.newBranch !== null,
    },
    0
  );
}

// ---------------------------------------------------------------------------
// DELETE /api/repos/:repo/files — delete one file, verified by blob sha
// ---------------------------------------------------------------------------

async function handleDeleteFile(repo: string, request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session) return errorResponse(401, 'UNAUTHENTICATED', 'Sign in to delete files.');
  if (!isSameOrigin(request)) return errorResponse(403, 'CSRF_FAILED', 'Cross-origin writes are not allowed.');

  const body = await readRequestBody(request);
  const fields = requireCommitFields(body);
  if (isResponse(fields)) return fields;
  const path = validateCommitPath(body?.path);
  if (!path.ok) return badRequest('INVALID_PATH', 'A valid repository-relative path is required.');
  if (fields.newBranch !== null) {
    return badRequest('INVALID_BRANCH', 'Deleting a file always commits to an existing branch.');
  }
  if (!isObjectSha(body?.sha)) {
    return badRequest('INVALID_BLOB_SHA', 'sha must be the 40-character blob sha of the file being deleted.');
  }

  await authorizeFileWrite(session, request, env, repo, 'file.delete', fields.branch);

  // Read the file first: this both confirms it is a file (not a directory) and
  // detects a concurrent modification before anything is destroyed.
  const existing = await readContent(session.token, repo, fields.branch, path.path);
  if (!existing) {
    throw new UpstreamError(404, 'FILE_NOT_FOUND', `"${path.path}" does not exist on "${fields.branch}".`);
  }
  if (existing.kind !== 'file') {
    throw new UpstreamError(
      422,
      'IS_DIRECTORY',
      `"${path.path}" is a directory. Forge deletes one file at a time so every change stays reviewable; delete the files inside it, or use Git for a bulk removal.`
    );
  }
  if (existing.sha !== body?.sha) {
    throw new UpstreamError(409, 'SHA_CONFLICT', 'The file changed since you loaded it. Reload and try again.');
  }

  const response = await githubCall(session.token, `/repos/${ORG_NAME}/${encodeURIComponent(repo)}/contents/${encodePath(path.path)}`, {
    method: 'DELETE',
    body: JSON.stringify({ message: fields.message, sha: body?.sha, branch: fields.branch }),
  });
  const data = await readBody(response);
  if (!response.ok) throw mapWriteFailure(response.status, data);

  logEvent('debug', 'file_deleted', { repo, branch: fields.branch, path: path.path });
  return jsonResponse(
    {
      repo,
      action: 'delete',
      branch: fields.branch,
      path: path.path,
      commit: commitSummary(data, repo, fields.branch),
    },
    0
  );
}

// ---------------------------------------------------------------------------
// POST /api/repos/:repo/files/move — rename or move in ONE atomic commit
// ---------------------------------------------------------------------------

async function handleMoveFile(repo: string, request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session) return errorResponse(401, 'UNAUTHENTICATED', 'Sign in to rename or move files.');
  if (!isSameOrigin(request)) return errorResponse(403, 'CSRF_FAILED', 'Cross-origin writes are not allowed.');

  const body = await readRequestBody(request);
  const fields = requireCommitFields(body);
  if (isResponse(fields)) return fields;

  const from = resolveMovePath(body, 'from', 'fromPath', 'source');
  if (isResponse(from)) return from;
  const to = resolveMovePath(body, 'to', 'toPath', 'destination');
  if (isResponse(to)) return to;
  if (from === to) return badRequest('SAME_PATH', 'The new path is identical to the current one.');

  const target = fields.newBranch ?? fields.branch;
  await authorizeFileWrite(session, request, env, repo, 'file.move', target);
  if (fields.newBranch) {
    await createBranch(session.token, repo, fields.newBranch, fields.branch);
  }

  const headSha = await resolveBranchHead(session.token, repo, target);
  const { treeSha: baseTreeSha, entries } = await readTree(session.token, repo, headSha);

  const direct = entries.find((entry) => entry.path === from && entry.type !== 'tree');
  const moves = direct
    ? [{ from: direct.path, to, mode: direct.mode, sha: direct.sha }]
    : collectDirectoryMoves(entries, from, to);

  if (moves.length === 0) {
    throw new UpstreamError(404, 'FILE_NOT_FOUND', `"${from}" does not exist on "${target}".`);
  }
  // Detect a destination conflict before writing anything.
  for (const move of moves) {
    if (entries.some((entry) => entry.path === move.to)) {
      throw new UpstreamError(409, 'DESTINATION_EXISTS', `"${move.to}" already exists on "${target}".`);
    }
  }
  // Concurrent-modification detection: the blob we are moving must still be
  // the blob the caller loaded.
  if (isObjectSha(body?.sha) && direct && direct.sha !== body.sha) {
    throw new UpstreamError(409, 'SHA_CONFLICT', 'The file changed since you loaded it. Reload and try again.');
  }

  // One tree: remove every source path (sha: null) and add every destination.
  const tree = [
    ...moves.map((move) => ({ path: move.from, mode: move.mode, type: 'blob', sha: null })),
    ...moves.map((move) => ({ path: move.to, mode: move.mode, type: 'blob', sha: move.sha })),
  ];

  const treeResponse = await githubCall(session.token, `/repos/${ORG_NAME}/${encodeURIComponent(repo)}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree }),
  });
  const treeData = await readBody(treeResponse);
  if (!treeResponse.ok) throw mapWriteFailure(treeResponse.status, treeData);

  // Rebuild the tree on top of the branch tip so every other file is untouched.
  const newTreeSha = typeof treeData?.sha === 'string' ? treeData.sha : null;
  if (newTreeSha === null) throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'GitHub did not return a tree.');

  const commitResponse = await githubCall(session.token, `/repos/${ORG_NAME}/${encodeURIComponent(repo)}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: fields.message, tree: newTreeSha, parents: [headSha] }),
  });
  const commitData = await readBody(commitResponse);
  if (!commitResponse.ok) throw mapWriteFailure(commitResponse.status, commitData);
  const newCommitSha = typeof commitData?.sha === 'string' ? commitData.sha : null;
  if (newCommitSha === null) throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'GitHub did not return a commit.');

  // Fast-forward only. `force: false` is the concurrency check: a 409 here
  // means the branch moved while we were building the tree, and nothing is
  // written. It is also what makes the whole operation atomic — the old and
  // new paths appear in exactly one commit, never in two.
  const refResponse = await githubCall(session.token, `/repos/${ORG_NAME}/${encodeURIComponent(repo)}/git/refs/heads/${encodePath(target)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommitSha, force: false }),
  });
  if (refResponse.status === 409 || refResponse.status === 422) {
    throw new UpstreamError(409, 'CONFLICT', 'The branch changed while you were working. Reload and try again.');
  }
  if (!refResponse.ok) throw mapWriteFailure(refResponse.status, await readBody(refResponse));

  logEvent('debug', 'file_moved', { repo, branch: target, from, to, files: moves.length });
  return jsonResponse(
    {
      repo,
      action: 'move',
      branch: target,
      base_branch: fields.branch,
      path: to,
      from,
      to,
      files: moves.map((move) => ({ from: move.from, to: move.to })),
      commit: { sha: newCommitSha, html_url: `https://github.com/${ORG_NAME}/${encodeURIComponent(repo)}/commit/${newCommitSha}` },
      // Honest reporting: the Git Trees + Commits API produced one commit that
      // removes the old path and adds the new one. Never claim this unless it
      // is true — a create+delete fallback would have to report 2 commits.
      atomic: true,
      commits: 1,
      new_branch: fields.newBranch !== null,
    },
    0
  );
}

function resolveMovePath(body: Record<string, unknown> | null, ...keys: string[]): string | Response {
  if (!body) return badRequest('INVALID_BODY', 'A JSON request body is required.');
  for (const key of keys) {
    if (typeof body[key] === 'string') {
      const check = validateCommitPath(body[key]);
      if (!check.ok) return badRequest('INVALID_PATH', `The ${key === 'from' ? 'current' : 'new'} path is invalid.`);
      return check.path;
    }
  }
  return badRequest('INVALID_PATH', 'Both the current path and the new path are required.');
}

/**
 * Collect the file moves that rename or move a whole directory.
 *
 * Git has no directories, so "moving a directory" means rewriting every blob
 * path that starts with `from/`. Returns an empty array when the prefix matches
 * nothing, which the caller reports as "not found".
 */
function collectDirectoryMoves(
  entries: TreeEntry[],
  from: string,
  to: string
): Array<{ from: string; to: string; mode: string; sha: string }> {
  const prefix = `${from}/`;
  const children = entries.filter((entry) => entry.path.startsWith(prefix) && entry.type !== 'tree');
  if (children.length === 0) return [];
  // Refuse to move a directory onto a path that is itself inside the source —
  // that would nest the tree inside itself.
  if (to === from || to.startsWith(prefix)) {
    throw new UpstreamError(400, 'INVALID_PATH', `"${to}" is inside "${from}". Choose a different destination.`);
  }
  return children.map((entry) => ({
    from: entry.path,
    to: `${to}/${entry.path.slice(prefix.length)}`,
    mode: entry.mode,
    sha: entry.sha,
  }));
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Base64 of a UTF-8 string, encoded byte by byte.
 *
 * `btoa(String.fromCharCode(...bytes))` turns every byte into a call argument
 * and throws RangeError once the file is large enough. The loop has no argument
 * limit and no stack dependency.
 */
function toBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export function isFileRoute(_method: string, path: string): boolean {
  return /^\/api\/repos\/[^/]+\/files(\/move)?$/.test(path);
}

/**
 * Dispatch for /api/repos/:repo/files[/move].
 *
 * `repo` is pre-extracted by the API router and is URL-encoded there.
 */
export async function handleFilesRoute(action: string, repo: string, request: Request, env: Env): Promise<Response> {
  let name: string;
  try {
    name = requireRepo(decodeURIComponent(repo));
  } catch {
    return errorResponse(400, 'INVALID_REPO', 'Invalid repository name.');
  }

  if (action === 'files') {
    if (request.method === 'POST') return handleCreateFile(name, request, env);
    if (request.method === 'DELETE') return handleDeleteFile(name, request, env);
    const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only POST and DELETE are supported.');
    response.headers.set('Allow', 'POST, DELETE');
    return response;
  }
  if (action === 'files/move') {
    if (request.method === 'POST') return handleMoveFile(name, request, env);
    const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported.');
    response.headers.set('Allow', 'POST');
    return response;
  }
  return errorResponse(404, 'NOT_FOUND', 'API endpoint not found.');
}

/** Exported for tests: the directory-move planner. */
export { collectDirectoryMoves };
