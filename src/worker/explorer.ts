/**
 * Explorer endpoints: directory listings, file contents, README, raw downloads,
 * and last-commit lookups.
 *
 * Every handler first resolves the requested ref to a commit SHA and reads the
 * content at that SHA, so a response always describes one exact commit.
 */
import { EXPLORER_LIMITS } from '../shared/limits';
import { encodePathSegments } from '../shared/validation';
import type { CommitSummary, FileKind } from '../types';
import type { Env } from './env';
import { cacheKeyFor, serveCached } from './cache';
import {
  UpstreamError,
  buildGitHubUrl,
  contentsApiPath,
  expectArray,
  expectObject,
  githubGet,
  jsonResponse,
  readBodyLimited,
  readJson,
  repoApiPath,
} from './github-client';
import { requireFilePath, requirePath, requireRef } from './params';
import {
  type ContentsObject,
  githubUrl,
  sanitizeCommit,
  sanitizeContentsObject,
  sanitizeEntry,
  sortEntries,
} from './sanitize';

const TTL_SECONDS = 5 * 60;
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1';
const LFS_POINTER_MAX_LENGTH = 1024;

export interface RouteArgs {
  action: string;
  repo: string;
  params: URLSearchParams;
  request: Request;
  env: Env;
  ctx?: ExecutionContext;
}

export async function handleRepoRoute(args: RouteArgs): Promise<Response> {
  switch (args.action) {
    case 'tree':
      return handleTree(args);
    case 'last-commit':
      return handleLastCommit(args);
    case 'file':
      return handleFile(args);
    case 'readme':
      return handleReadme(args);
    case 'raw':
      return handleRaw(args);
    default:
      throw new UpstreamError(404, 'NOT_FOUND', 'API endpoint not found.');
  }
}

function keyFor(args: RouteArgs, params: Record<string, string | undefined>) {
  return cacheKeyFor(new URL(args.request.url).origin, `/api/repos/${args.repo}/${args.action}`, params);
}

/** Resolve a branch, tag, or commit SHA to a commit. */
export async function resolveCommit(env: Env, repo: string, ref: string): Promise<CommitSummary> {
  const response = await githubGet(buildGitHubUrl(repoApiPath(repo, `/commits/${encodeURIComponent(ref)}`)), env, {
    notFound: { code: 'REPO_NOT_FOUND', message: 'Repository not found.' },
    unprocessable: { code: 'REF_NOT_FOUND', message: 'The requested branch, tag, or commit does not exist.' },
  });
  const commit = sanitizeCommit(await readJson(response), repo);
  if (!commit) {
    throw new UpstreamError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub API returned an unexpected response format.');
  }
  return commit;
}

async function handleTree(args: RouteArgs): Promise<Response> {
  const { env, repo, ctx } = args;
  const ref = requireRef(args.params);
  const path = requirePath(args.params);

  return serveCached(keyFor(args, { ref, path }), ctx, async () => {
    const commit = await resolveCommit(env, repo, ref);
    const response = await githubGet(buildGitHubUrl(contentsApiPath(repo, path), { ref: commit.sha }), env, {
      notFound: { code: 'PATH_NOT_FOUND', message: 'This path does not exist at the requested ref.' },
    });
    const payload = await readJson(response);
    if (!Array.isArray(payload)) {
      throw new UpstreamError(400, 'NOT_A_DIRECTORY', 'The path is not a directory.');
    }
    const entries = sortEntries(
      payload
        .map((item) => sanitizeEntry(item, repo, commit.sha))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    );
    return jsonResponse(
      {
        repo,
        ref,
        commit_sha: commit.sha,
        path,
        entries,
        truncated: payload.length >= EXPLORER_LIMITS.CONTENTS_LISTING_MAX,
      },
      TTL_SECONDS
    );
  });
}

async function handleLastCommit(args: RouteArgs): Promise<Response> {
  const { env, repo, ctx } = args;
  const ref = requireRef(args.params);
  const path = requirePath(args.params);

  return serveCached(keyFor(args, { ref, path }), ctx, async () => {
    const url = buildGitHubUrl(repoApiPath(repo, '/commits'), {
      sha: ref,
      path: path === '' ? undefined : path,
      per_page: 1,
    });
    const response = await githubGet(url, env, {
      notFound: { code: 'REPO_NOT_FOUND', message: 'Repository not found.' },
      unprocessable: { code: 'REF_NOT_FOUND', message: 'The requested branch, tag, or commit does not exist.' },
    });
    const list = expectArray(await readJson(response));
    const commit = list.length > 0 ? sanitizeCommit(list[0], repo) : null;
    return jsonResponse({ path, commit }, TTL_SECONDS);
  });
}

/** Contents metadata for one path at a commit. Directories are rejected by the caller. */
async function fetchContentsObject(env: Env, repo: string, path: string, commitSha: string): Promise<ContentsObject> {
  const response = await githubGet(buildGitHubUrl(contentsApiPath(repo, path), { ref: commitSha }), env, {
    notFound: { code: 'FILE_NOT_FOUND', message: 'This file does not exist at the requested ref.' },
  });
  const payload = await readJson(response);
  if (Array.isArray(payload)) {
    throw new UpstreamError(400, 'IS_DIRECTORY', 'The path is a directory. Use the tree view instead.');
  }
  const object = sanitizeContentsObject(payload);
  if (!object) {
    throw new UpstreamError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub API returned an unexpected response format.');
  }
  return object;
}

function decodeBase64(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value.replace(/\s/g, ''));
  } catch {
    throw new UpstreamError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub API returned invalid file content.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export type ContentClassification =
  | { kind: 'text'; text: string }
  | { kind: 'binary' }
  | { kind: 'lfs-pointer' };

/**
 * Classify raw bytes. Anything with a NUL byte or invalid UTF-8 is binary.
 * Git LFS pointer files are reported separately because their real content
 * is not stored in the repository.
 */
export function classifyContent(bytes: Uint8Array): ContentClassification {
  if (bytes.includes(0)) return { kind: 'binary' };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return { kind: 'binary' };
  }
  if (text.startsWith(LFS_POINTER_PREFIX) && text.length <= LFS_POINTER_MAX_LENGTH) {
    return { kind: 'lfs-pointer' };
  }
  return { kind: 'text', text };
}

async function handleFile(args: RouteArgs): Promise<Response> {
  const { env, repo, ctx } = args;
  const ref = requireRef(args.params);
  const path = requireFilePath(args.params);

  return serveCached(keyFor(args, { ref, path }), ctx, async () => {
    const commit = await resolveCommit(env, repo, ref);
    const object = await fetchContentsObject(env, repo, path, commit.sha);

    const base = {
      repo,
      ref,
      commit_sha: commit.sha,
      path,
      name: object.name,
      size: object.size,
      blob_sha: object.sha,
      html_url: githubUrl(repo, 'blob', encodeURIComponent(commit.sha), encodePathSegments(path)),
    };

    if (object.type === 'symlink') {
      return jsonResponse({ ...base, kind: 'symlink' as FileKind, target: object.target }, TTL_SECONDS);
    }
    if (object.type === 'submodule') {
      return jsonResponse({ ...base, kind: 'submodule' as FileKind, submodule_url: object.submodule_url }, TTL_SECONDS);
    }
    if (object.type !== 'file') {
      throw new UpstreamError(400, 'IS_DIRECTORY', 'The path is a directory. Use the tree view instead.');
    }
    if (object.size > EXPLORER_LIMITS.VIEW_MAX_BYTES || object.encoding !== 'base64' || object.content === null) {
      return jsonResponse({ ...base, kind: 'too-large' as FileKind }, TTL_SECONDS);
    }

    const classified = classifyContent(decodeBase64(object.content));
    if (classified.kind === 'text') {
      return jsonResponse({ ...base, kind: 'text' as FileKind, content: classified.text }, TTL_SECONDS);
    }
    return jsonResponse({ ...base, kind: classified.kind as FileKind }, TTL_SECONDS);
  });
}

async function handleReadme(args: RouteArgs): Promise<Response> {
  const { env, repo, ctx } = args;
  const ref = requireRef(args.params);

  return serveCached(keyFor(args, { ref }), ctx, async () => {
    const commit = await resolveCommit(env, repo, ref);
    const response = await githubGet(buildGitHubUrl(repoApiPath(repo, '/readme'), { ref: commit.sha }), env, {
      notFound: { code: 'README_NOT_FOUND', message: 'This repository has no README.' },
    });
    const object = sanitizeContentsObject(expectObject(await readJson(response)));
    if (!object || object.type !== 'file') {
      throw new UpstreamError(404, 'README_NOT_FOUND', 'This repository has no README.');
    }

    const base = { repo, commit_sha: commit.sha, path: object.path, name: object.name, size: object.size };
    if (object.size > EXPLORER_LIMITS.README_MAX_BYTES || object.encoding !== 'base64' || object.content === null) {
      return jsonResponse({ ...base, kind: 'too-large' }, TTL_SECONDS);
    }
    const classified = classifyContent(decodeBase64(object.content));
    if (classified.kind === 'text') {
      return jsonResponse({ ...base, kind: 'text', content: classified.text }, TTL_SECONDS);
    }
    return jsonResponse({ ...base, kind: 'binary' }, TTL_SECONDS);
  });
}

/** Content-Disposition with an ASCII fallback and an RFC 5987 UTF-8 name. */
export function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\;]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

async function handleRaw(args: RouteArgs): Promise<Response> {
  const { env, repo, ctx } = args;
  const ref = requireRef(args.params);
  const path = requireFilePath(args.params);

  return serveCached(keyFor(args, { ref, path }), ctx, async () => {
    const commit = await resolveCommit(env, repo, ref);
    const object = await fetchContentsObject(env, repo, path, commit.sha);
    if (object.type !== 'file') {
      throw new UpstreamError(400, 'NOT_A_FILE', 'Only regular files can be downloaded raw.');
    }
    if (object.size > EXPLORER_LIMITS.RAW_MAX_BYTES) {
      throw new UpstreamError(413, 'FILE_TOO_LARGE', 'This file is too large to download through the explorer. Use the GitHub link instead.');
    }

    const response = await githubGet(buildGitHubUrl(contentsApiPath(repo, path), { ref: commit.sha }), env, {
      accept: 'application/vnd.github.raw+json',
      notFound: { code: 'FILE_NOT_FOUND', message: 'This file does not exist at the requested ref.' },
    });
    const bytes = await readBodyLimited(response, EXPLORER_LIMITS.RAW_MAX_BYTES);

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': attachmentDisposition(object.name),
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': `public, max-age=${TTL_SECONDS}, s-maxage=${TTL_SECONDS}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  });
}
