/**
 * Input validation shared by the Cloudflare Worker and the browser.
 *
 * Every value that reaches a GitHub API URL or a website route passes through
 * these checks first. They are deliberately stricter than Git's own rules: only
 * a conservative character set is accepted, which keeps the explorer free of
 * path traversal, header injection, and ambiguous ref names.
 *
 * Keep this module free of DOM and Workers-only APIs.
 */

/** The only GitHub organization the explorer may read. */
export const ORG_NAME = 'ankworks';

const REPO_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const REF_PATTERN = /^[A-Za-z0-9._+/-]{1,255}$/;
const BACKSLASH = 0x5c;
const DELETE = 0x7f;

/** Control characters and backslashes are never valid in a repository path. */
function hasForbiddenCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === DELETE || code === BACKSLASH) return true;
  }
  return false;
}

export const MAX_PATH_LENGTH = 1024;
export const MAX_SEGMENT_LENGTH = 255;

/** Repository names: GitHub's rules (letters, digits, dot, dash, underscore). */
export function isValidRepoName(name: string): boolean {
  return REPO_NAME_PATTERN.test(name) && name !== '.' && name !== '..';
}

/**
 * Branch, tag, or commit SHA. Rejects empty segments, leading dots (".."
 * traversal and hidden refs), ".lock" suffixes, and trailing dots, following
 * the spirit of `git check-ref-format`.
 */
export function isValidRef(ref: string): boolean {
  if (!REF_PATTERN.test(ref)) return false;
  if (ref.startsWith('/') || ref.endsWith('/') || ref.includes('//')) return false;
  if (ref.includes('..') || ref.endsWith('.') || ref.endsWith('.lock')) return false;
  return ref.split('/').every((segment) => segment !== '' && !segment.startsWith('.') && !segment.endsWith('.lock'));
}

export function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

/**
 * Normalize a repository-relative path (no leading or trailing slash).
 * Returns null when the path is unsafe: traversal segments, empty segments,
 * backslashes, control characters, or excessive length.
 */
export function normalizeRepoPath(input: string): string | null {
  if (input.length > MAX_PATH_LENGTH || hasForbiddenCharacters(input)) return null;
  const trimmed = input.replace(/^\/+/, '').replace(/\/+$/, '');
  if (trimmed === '') return '';
  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return null;
    if (segment.length > MAX_SEGMENT_LENGTH) return null;
  }
  return segments.join('/');
}

/** Encode each path segment for a URL, keeping the "/" separators. */
export function encodePathSegments(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** Split a normalized path into segments ("" → []). */
export function splitPath(path: string): string[] {
  return path === '' ? [] : path.split('/');
}

/** Parse a positive integer query value, falling back to the default when absent. */
export function parsePositiveInt(value: string | null, fallback: number, max: number): number | null {
  if (value === null || value === '') return fallback;
  if (!/^\d{1,6}$/.test(value)) return null;
  const parsed = Number(value);
  if (parsed < 1) return null;
  return Math.min(parsed, max);
}
