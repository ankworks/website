/**
 * Size limits enforced by the Worker and mirrored by the UI.
 * Every upstream read is bounded; nothing is buffered without a cap.
 */
export const EXPLORER_LIMITS = {
  /** Largest file rendered in the source viewer. */
  VIEW_MAX_BYTES: 512 * 1024,
  /** Largest file the raw download endpoint will stream. */
  RAW_MAX_BYTES: 10 * 1024 * 1024,
  /** Files at or below this size are syntax-highlighted. */
  HIGHLIGHT_MAX_BYTES: 200 * 1024,
  /** Largest README rendered in the page. */
  README_MAX_BYTES: 512 * 1024,
  /** Upper bound for a JSON body read from GitHub. */
  UPSTREAM_JSON_MAX_BYTES: 4 * 1024 * 1024,
  /** GitHub returns at most this many entries for a directory listing. */
  CONTENTS_LISTING_MAX: 1000,
} as const;
