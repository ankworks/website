/**
 * Shared validation for repository write operations (Milestone C).
 *
 * Every privileged write path in the Worker runs these checks BEFORE touching
 * the GitHub API so malformed input can never reach upstream.
 */

/** Maximum UTF-8 size of a committed file. */
export const COMMIT_MAX_BYTES = 400_000;
/** Maximum commit message length. */
export const COMMIT_MESSAGE_MAX = 1000;
/** Maximum character count of a rendered diff patch hunk (kept for UI display). */
export const PATCH_MAX_CHARS = 120_000;

const REFUSE_PATH = /(^|\/)\.\.(\/|$)/;

/** Validate a repository-relative file path. Returns the path or an error code. */
export function validateCommitPath(path: unknown): { ok: true; path: string } | { ok: false; code: string } {
  if (typeof path !== 'string' || path.length === 0 || path.length > 1000) return { ok: false, code: 'INVALID_PATH' };
  if (path.startsWith('/') || path.includes('\\') || REFUSE_PATH.test(path) || path.includes('\0')) {
    return { ok: false, code: 'INVALID_PATH' };
  }
  if (path.split('/').some((segment) => segment.length === 0 || segment.length > 255)) {
    return { ok: false, code: 'INVALID_PATH' };
  }
  return { ok: true, path };
}

/** Git check-ref-format subset for branch names we create. */
export function validateBranchName(name: unknown): { ok: true; name: string } | { ok: false; code: string } {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) return { ok: false, code: 'INVALID_BRANCH' };
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.lock') || name.includes('..') || name.includes('@{') || name.includes(' ') || name.includes('\0')) {
    return { ok: false, code: 'INVALID_BRANCH' };
  }
  if (!/^[A-Za-z0-9]/.test(name) || !/[A-Za-z0-9]$/.test(name)) return { ok: false, code: 'INVALID_BRANCH' };
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) return { ok: false, code: 'INVALID_BRANCH' };
  return { ok: true, name };
}

export function validateCommitMessage(message: unknown): { ok: true; message: string } | { ok: false; code: string } {
  if (typeof message !== 'string') return { ok: false, code: 'INVALID_MESSAGE' };
  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > COMMIT_MESSAGE_MAX) return { ok: false, code: 'INVALID_MESSAGE' };
  return { ok: true, message: trimmed };
}

export function validateCommitContent(content: unknown): { ok: true; content: string } | { ok: false; code: string } {
  if (typeof content !== 'string') return { ok: false, code: 'INVALID_CONTENT' };
  if (new TextEncoder().encode(content).byteLength > COMMIT_MAX_BYTES) return { ok: false, code: 'CONTENT_TOO_LARGE' };
  return { ok: true, content };
}
