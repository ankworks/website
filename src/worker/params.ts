/** Validation of request parameters for the explorer API. */
import { isValidRef, isValidRepoName, normalizeRepoPath } from '../shared/validation';
import { UpstreamError } from './github-client';

export function requireRepo(name: string): string {
  if (!isValidRepoName(name)) throw new UpstreamError(400, 'INVALID_REPO', 'Invalid repository name.');
  return name;
}

export function requireRef(params: URLSearchParams): string {
  const ref = params.get('ref');
  if (ref === null || ref === '') throw new UpstreamError(400, 'MISSING_REF', 'A ref (branch, tag, or commit) is required.');
  if (!isValidRef(ref)) throw new UpstreamError(400, 'INVALID_REF', 'Invalid ref name.');
  return ref;
}

/** Normalized repository path. Empty string means the repository root. */
export function requirePath(params: URLSearchParams): string {
  const path = normalizeRepoPath(params.get('path') ?? '');
  if (path === null) throw new UpstreamError(400, 'INVALID_PATH', 'Invalid repository path.');
  return path;
}

/** Like requirePath, but the path must name something (not the root). */
export function requireFilePath(params: URLSearchParams): string {
  const path = requirePath(params);
  if (path === '') throw new UpstreamError(400, 'INVALID_PATH', 'A file path is required.');
  return path;
}
