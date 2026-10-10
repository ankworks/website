/**
 * URL builders for the explorer routes.
 *
 * Git refs may contain "/" (e.g. "feature/login"), so the ref is always encoded
 * as ONE path segment ("feature%2Flogin"). The path inside the repository follows
 * as the splat and keeps its "/" separators. Because the ref is a single encoded
 * segment, the boundary between ref and path is unambiguous; no string guessing
 * or ref-prefix search is needed.
 */
import { ORG_NAME, encodePathSegments } from './validation';

/**
 * Encode a Git ref for use as ONE path segment in an explorer URL.
 *
 * Refs may contain "/" (e.g. "feature/login"). A single "%2F" is not safe: the
 * static-asset layer decodes it back into "/" and redirects, which would make
 * "feature" the ref and "login" part of the path. Encoding twice ("%252F")
 * survives that step. The router decodes once; decodeRouteRef decodes the rest.
 */
export function encodeRef(ref: string): string {
  return encodeURIComponent(encodeURIComponent(ref));
}

/** Inverse of encodeRef for a route parameter the router already decoded once. Null when malformed. */
export function decodeRouteRef(param: string): string | null {
  try {
    return decodeURIComponent(param);
  } catch {
    return null;
  }
}

/** Public GitHub URL for a path inside an AnkWorks repository (never a user-supplied host). */
export function githubRepoLink(repo: string, kind: 'tree' | 'blob' | 'commit', ref: string, path = ''): string {
  const base = `https://github.com/${ORG_NAME}/${encodeURIComponent(repo)}`;
  if (kind === 'commit') return `${base}/commit/${encodePathSegments(ref)}`;
  const suffix = path === '' ? '' : `/${encodePathSegments(path)}`;
  // GitHub's own URLs keep "/" inside branch names, so only each segment is encoded.
  return `${base}/${kind}/${encodePathSegments(ref)}${suffix}`;
}

export function repoPath(repo: string): string {
  return `/repos/${encodeURIComponent(repo)}`;
}

export function treePath(repo: string, ref: string, path = ''): string {
  const base = `${repoPath(repo)}/tree/${encodeRef(ref)}`;
  return path === '' ? base : `${base}/${encodePathSegments(path)}`;
}

export function blobPath(repo: string, ref: string, path: string): string {
  return `${repoPath(repo)}/blob/${encodeRef(ref)}/${encodePathSegments(path)}`;
}

export function commitsPath(repo: string, ref: string, page = 1): string {
  const base = `${repoPath(repo)}/commits/${encodeRef(ref)}`;
  return page <= 1 ? base : `${base}?page=${page}`;
}

export function issueListPath(repo?: string, state = 'open', page = 1): string {
  const base = repo ? `${repoPath(repo)}/issues` : '/issues';
  return appendListQuery(base, state, page);
}

export function issuePath(repo: string, number: number): string {
  return `${repoPath(repo)}/issues/${number}`;
}

/** Authenticated issue composer for one repository. */
export function newIssuePath(repo: string): string {
  return `${repoPath(repo)}/issues/new`;
}

export function pullRequestListPath(repo?: string, state = 'open', page = 1): string {
  const base = repo ? `${repoPath(repo)}/pulls` : '/pulls';
  return appendListQuery(base, state, page);
}

export function pullRequestPath(repo: string, number: number): string {
  return `${repoPath(repo)}/pulls/${number}`;
}

export function branchesPath(repo: string, page = 1): string {
  return page <= 1 ? `${repoPath(repo)}/branches` : `${repoPath(repo)}/branches?page=${page}`;
}

export function refsPath(repo: string, view: 'branches' | 'tags', page = 1): string {
  const params = new URLSearchParams();
  if (view === 'tags') params.set('view', 'tags');
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `${repoPath(repo)}/branches?${query}` : `${repoPath(repo)}/branches`;
}

function appendListQuery(base: string, state: string, page: number): string {
  const params = new URLSearchParams();
  if (state !== 'open') params.set('state', state);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** Parent directory of a repository-relative path ("a/b/c.ts" → "a/b", "c.ts" → ""). */
export function parentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

export function fileName(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}
