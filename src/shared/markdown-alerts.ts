/**
 * GitHub-style Markdown alerts (blockquote callouts).
 *
 * Syntax (GitHub's own, not an invention):
 *
 *   > [!NOTE]
 *   > Useful information.
 *
 * The five supported markers are NOTE, TIP, IMPORTANT, WARNING, and CAUTION.
 * Everything else is left as an ordinary blockquote — including a literal
 * `[!NOTE]` that is not at the very start of the blockquote, so a document that
 * merely *mentions* a marker does not turn into a callout.
 *
 * This module holds only pure helpers; transforming the tree is the remark
 * plugin's job (`src/shared/remark-alerts.ts`).
 */

export const ALERT_TYPES = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

/** Human-facing title rendered inside the callout. */
export const ALERT_LABELS: Record<AlertType, string> = {
  NOTE: 'Note',
  TIP: 'Tip',
  IMPORTANT: 'Important',
  WARNING: 'Warning',
  CAUTION: 'Caution',
};

/**
 * Leading marker. GitHub requires the marker on its own line, so a newline (or
 * the end of the text) must follow the closing bracket. A single trailing space
 * is tolerated for hand-written documents.
 */
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|$)/i;

export function isAlertType(value: string): value is AlertType {
  return (ALERT_TYPES as readonly string[]).includes(value);
}

export interface AlertMarker {
  type: AlertType;
  /** Text after the marker, with the blank line that follows it removed. */
  rest: string;
}

/**
 * Read a leading alert marker from the first text of a blockquote.
 *
 * Returns null when the text is not an alert, so the caller leaves the
 * blockquote untouched.
 */
export function parseAlertMarker(text: string): AlertMarker | null {
  const match = ALERT_MARKER.exec(text);
  if (!match) return null;
  const raw = match[1] ?? '';
  const type = raw.toUpperCase();
  if (!isAlertType(type)) return null;
  // Drop the marker line plus the single blank line GitHub allows after it.
  const rest = text.slice(match[0].length).replace(/^(?:\r?\n)+/, '');
  return { type, rest };
}
