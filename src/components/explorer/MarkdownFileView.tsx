/**
 * Markdown document viewer with Preview / Source / Edit modes (Forge-style).
 *
 * - Preview: sanitized GitHub-flavored Markdown with a table of contents.
 * - Source: the original Markdown with syntax highlighting and line numbers.
 * - Edit: the local-draft editing workspace (see MarkdownEditor). Saving to
 *   GitHub is gated behind sign-in, which arrives with the authentication
 *   milestone.
 *
 * The active mode is mirrored in the `?view=` query parameter so a mode can be
 * shared as a link. Switching away from an unsaved draft asks for confirmation.
 */
import { useCallback, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { extractHeadings } from '../../shared/markdown-toc';
import { parentPath } from '../../shared/routes';
import type { FileResponse } from '../../types';
import CodeView from './CodeView';
import Markdown from './Markdown';
import MarkdownEditor, { type CommitTarget } from './MarkdownEditor';
import MarkdownToc from './MarkdownToc';

export type MarkdownViewMode = 'preview' | 'source' | 'edit';

const MODES: { id: MarkdownViewMode; label: string }[] = [
  { id: 'preview', label: 'Preview' },
  { id: 'source', label: 'Source' },
  { id: 'edit', label: 'Edit' },
];

function parseMode(value: string | null): MarkdownViewMode {
  return value === 'source' || value === 'edit' ? value : 'preview';
}

interface MarkdownFileViewProps {
  file: FileResponse & { kind: 'text'; content: string };
  repo: string;
  path: string;
  /** Commit destination (branch + blob sha); omit to keep editing local-only. */
  target?: CommitTarget;
}

export default function MarkdownFileView({ file, repo, path, target }: MarkdownFileViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseMode(searchParams.get('view'));
  const [draftDirty, setDraftDirty] = useState(false);
  const name = path.split('/').pop() ?? path;

  const selectMode = useCallback(
    (next: MarkdownViewMode) => {
      if (view === 'edit' && next !== 'edit' && draftDirty) {
        const confirmed = window.confirm('You have unsaved draft changes. Discard them and switch views?');
        if (!confirmed) return;
      }
      setSearchParams(
        (params) => {
          const updated = new URLSearchParams(params);
          if (next === 'preview') updated.delete('view');
          else updated.set('view', next);
          return updated;
        },
        { replace: true }
      );
    },
    [view, draftDirty, setSearchParams]
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = MODES.findIndex((mode) => mode.id === view);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const next = MODES[(index + delta + MODES.length) % MODES.length];
      selectMode(next.id);
      document.getElementById(`markdown-tab-${next.id}`)?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectMode('preview');
      document.getElementById('markdown-tab-preview')?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      selectMode('edit');
      document.getElementById('markdown-tab-edit')?.focus();
    }
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label={`View mode for ${name}`}
        onKeyDown={onKeyDown}
        className="flex items-center gap-1 border-b border-border bg-elevated/40 px-2 pt-2"
      >
        {MODES.map((mode) => (
          <button
            key={mode.id}
            id={`markdown-tab-${mode.id}`}
            role="tab"
            type="button"
            aria-selected={view === mode.id}
            aria-controls={`markdown-panel-${mode.id}`}
            tabIndex={view === mode.id ? 0 : -1}
            onClick={() => selectMode(mode.id)}
            className={
              view === mode.id
                ? 'rounded-t-md border border-b-0 border-border bg-surface px-4 py-2 text-sm font-medium text-text'
                : 'rounded-t-md border border-transparent px-4 py-2 text-sm font-medium text-muted hover:text-text'
            }
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`markdown-panel-${view}`}
        aria-labelledby={`markdown-tab-${view}`}
        tabIndex={0}
        className="focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        {view === 'preview' && (
          <div className="px-6 py-5 sm:px-8">
            {extractHeadings(file.content).length > 0 && (
              <div className="mb-4 rounded-md border border-border bg-elevated/30 px-3 py-2 xl:hidden">
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-muted">On this page</summary>
                  <div className="pt-2">
                    <MarkdownToc source={file.content} minHeadings={1} />
                  </div>
                </details>
              </div>
            )}
            <div className="flex items-start gap-8">
              <div className="min-w-0 flex-1">
                <Markdown source={file.content} name={name} context={{ repo, commitSha: file.commit_sha, baseDir: parentPath(path) }} />
              </div>
              <aside className="sticky top-20 hidden w-56 shrink-0 xl:block">
                <MarkdownToc source={file.content} />
              </aside>
            </div>
          </div>
        )}
        {view === 'source' && <CodeView content={file.content} grammar="markdown" fileName={name} />}
        {view === 'edit' && (
          <div className="px-4 py-4 sm:px-6">
            <MarkdownEditor
              fileName={name}
              initialContent={file.content}
              context={{ repo, commitSha: file.commit_sha, baseDir: parentPath(path) }}
              onDirtyChange={setDraftDirty}
              target={target}
            />
          </div>
        )}
      </div>
    </div>
  );
}
