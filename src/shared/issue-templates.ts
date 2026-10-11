/**
 * Issue template shapes (V3-C).
 *
 * Templates are DISPLAYED only. GitHub's issue forms are an interactive,
 * server-rendered feature: Forge never executes them, never submits their
 * fields as a structured payload, and never pretends a form was filled in. A
 * YAML form is rendered into static Markdown so the author can copy the
 * structure into the issue body; if it cannot be parsed the raw text is shown
 * and the UI says so.
 */

export interface IssueTemplate {
  /** File name inside the repository. */
  fileName: string;
  /** Display name from the front matter (falls back to the file name). */
  name: string;
  /** Short description shown in the picker. */
  about: string | null;
  /** Suggested issue title from the template, when present. */
  title: string | null;
  labels: string[];
  assignees: string[];
  /** Pre-filled body text. Empty when the template has no body. */
  body: string;
  format: 'markdown' | 'yaml-form';
  /**
   * False when a YAML form could not be understood. The UI then shows the raw
   * template text and a link to GitHub instead of a half-rendered form.
   */
  parsed: boolean;
}

export interface IssueTemplatesResponse {
  repo: string;
  /** False when the repository has no issue templates. */
  enabled: boolean;
  templates: IssueTemplate[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isIssueTemplatesResponse(value: unknown): value is IssueTemplatesResponse {
  if (!isRecord(value)) return false;
  if (typeof value.repo !== 'string' || typeof value.enabled !== 'boolean') return false;
  if (!Array.isArray(value.templates)) return false;
  return value.templates.every((entry) => isRecord(entry) && typeof entry.fileName === 'string' && typeof entry.body === 'string');
}
