/**
 * Shared validation for file management (Directive C).
 *
 * The Worker and the browser run the SAME checks, in this order:
 *
 *   1. the file NAME (a single path segment) — no separators, no traversal,
 *      no reserved names, no control characters;
 *   2. the repository-relative PATH assembled from a directory + that name;
 *   3. the content size and the commit message.
 *
 * Running them in the browser is a usability feature: it gives feedback before
 * a request is sent. It is never a security control — the Worker re-runs
 * everything, because a request does not have to come from our UI.
 */

import { COMMIT_MAX_BYTES } from './changes';

/** Maximum UTF-8 size of a file written through Forge. */
export const FILE_CONTENT_MAX_BYTES = COMMIT_MAX_BYTES;
/** Maximum length of one path segment (Git and most filesystems agree on 255). */
export const FILE_NAME_MAX = 255;
/** Maximum length of the assembled repository-relative path. */
export const FILE_PATH_MAX = 1000;

/**
 * Placeholder file used to create a directory.
 *
 * Git tracks files, not directories: a directory exists only while it contains
 * at least one file, and an "empty" directory cannot be committed at all. The
 * only honest way to create one is to commit a file inside it, and `.gitkeep`
 * is the widely understood convention for that. Forge therefore creates
 * `<directory>/.gitkeep` and says so in the UI — it never claims to create an
 * empty directory.
 */
export const GITKEEP_NAME = '.gitkeep';

/** Trailing separator of a directory path, normalized away. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point here.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
/** Names Windows refuses, which would also be un-checkoutable for many users. */
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

const INVALID_NAME = {
  ok: false as const,
  code: 'INVALID_FILE_NAME',
  message: 'Use a file name without "/", "\\", control characters, or the reserved names ".", "..", CON, PRN, AUX, NUL.',
};

/**
 * Validate ONE path segment (a file or directory name).
 *
 * The path as a whole is validated separately by `validateCommitPath`; this
 * catches the mistakes that belong to the name the user typed, so the UI can
 * point at the right field.
 */
export function validateFileName(name: unknown): ValidationResult<string> {
  if (typeof name !== 'string') return INVALID_NAME;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > FILE_NAME_MAX) return INVALID_NAME;
  if (trimmed !== name) return INVALID_NAME;
  if (trimmed === '.' || trimmed === '..') return INVALID_NAME;
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return { ok: false, code: 'INVALID_FILE_NAME', message: 'A file name cannot contain "/" or "\\". Use the directory field instead.' };
  }
  if (CONTROL_CHARACTERS.test(trimmed)) {
    return { ok: false, code: 'INVALID_FILE_NAME', message: 'A file name cannot contain control characters.' };
  }
  if (RESERVED_WINDOWS_NAME.test(trimmed.split('.')[0] ?? '')) {
    return { ok: false, code: 'INVALID_FILE_NAME', message: `"${trimmed}" is a reserved name on Windows and would not check out.` };
  }
  if (trimmed.endsWith('.') || trimmed.endsWith(' ')) {
    return { ok: false, code: 'INVALID_FILE_NAME', message: 'A file name cannot end with "." or a space.' };
  }
  return { ok: true, value: trimmed };
}

/** Validate a directory path: "" for the repository root, otherwise "a/b". */
export function validateDirectoryPath(directory: unknown): ValidationResult<string> {
  if (typeof directory !== 'string') {
    return { ok: false, code: 'INVALID_PATH', message: 'The directory is invalid.' };
  }
  const trimmed = directory.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (trimmed === '') return { ok: true, value: '' };
  if (trimmed.length > FILE_PATH_MAX) {
    return { ok: false, code: 'INVALID_PATH', message: 'The directory path is too long.' };
  }
  for (const segment of trimmed.split('/')) {
    const check = validateFileName(segment);
    if (!check.ok) return { ok: false, code: check.code, message: check.message };
  }
  return { ok: true, value: trimmed };
}

/**
 * Join a directory and a file name into one repository-relative path.
 *
 * Returns null when either part is invalid, so callers cannot accidentally
 * proceed with a half-validated string.
 */
export function joinRepoPath(directory: unknown, name: unknown): string | null {
  const dir = validateDirectoryPath(directory);
  if (!dir.ok) return null;
  const file = validateFileName(name);
  if (!file.ok) return null;
  const path = dir.value === '' ? file.value : `${dir.value}/${file.value}`;
  return path.length > FILE_PATH_MAX ? null : path;
}

/** A 40-character Git object sha (blob or commit). */
export function isObjectSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
}

/** Human-readable size limit for UI hints. */
export function formatFileLimit(bytes: number = FILE_CONTENT_MAX_BYTES): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
