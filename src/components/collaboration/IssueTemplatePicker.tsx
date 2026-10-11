/**
 * Issue template picker (V3-C).
 *
 * Templates come from the repository's own `.github/ISSUE_TEMPLATE/` (and the
 * legacy root/`.github` locations). Choosing one pre-fills the composer: the
 * template body becomes the issue body and its labels are applied.
 *
 * GitHub issue forms (YAML) are NOT executed here — Forge has no form runtime
 * and does not submit their fields as structured data. A form is rendered into
 * static Markdown so the author can fill it in by hand; if a form cannot be
 * understood, the picker says so and links to GitHub instead of silently
 * showing a broken body.
 */

import { useEffect } from 'react';
import { insightsApi } from '../../api/insights';
import { useAsync } from '../../hooks/useAsync';
import type { IssueTemplate } from '../../shared/issue-templates';

export interface IssueTemplatePickerProps {
  repo: string;
  /** Ref to read templates from. Defaults to the repository default branch. */
  ref?: string;
  /** Called with the chosen template so the composer can pre-fill itself. */
  onSelect: (template: IssueTemplate) => void;
}

export default function IssueTemplatePicker({ repo, ref: gitRef, onSelect }: IssueTemplatePickerProps) {
  const state = useAsync(repo ? `issue-templates|${repo}|${gitRef ?? ''}` : null, () =>
    insightsApi.issueTemplates(repo, gitRef)
  );

  const templates = state.data?.templates ?? [];

  // Preselect nothing: an issue opened without a template must stay a blank
  // issue rather than silently adopting the first template's body.
  useEffect(() => {
    // no-op; kept for symmetry with future default-template support.
  }, []);

  if (state.status === 'loading' || state.status === 'idle' || templates.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-elevated/40 p-3" data-testid="issue-template-picker">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Choose a template</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {templates.map((template) => (
          <button
            key={template.fileName}
            type="button"
            onClick={() => onSelect(template)}
            title={template.about ?? template.fileName}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-left text-xs text-text hover:border-accent/40"
            data-testid={`issue-template-${template.fileName}`}
          >
            <span className="font-medium">{template.name}</span>
            {template.format === 'yaml-form' && !template.parsed && (
              <span className="ml-1 text-amber-400" title="This GitHub issue form cannot be rendered by Forge.">
                (form)
              </span>
            )}
            {template.about && <span className="ml-1 block text-muted">{template.about}</span>}
          </button>
        ))}
      </div>
      {templates.some((template) => template.format === 'yaml-form' && !template.parsed) && (
        <p className="mt-2 text-xs text-muted">
          Some templates are GitHub issue forms. Forge cannot run them — their structure is shown as plain text so you
          can fill it in manually.
        </p>
      )}
    </div>
  );
}
