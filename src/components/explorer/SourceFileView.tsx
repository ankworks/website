/**
 * Plain-text file viewer with Source / Edit modes.
 *
 * Mirrors the Forge-style Markdown viewer for every other editable text file
 * (`.ts`, `.json`, `.yml`, …): Source shows the highlighted file with line
 * numbers, Edit opens the same authenticated commit workspace Markdown files
 * use. Committing is gated behind sign-in and verified push permission, so the
 * Edit mode is safe to expose to every visitor.
 *
 * The active mode lives in the `?view=` query parameter, so `?view=edit` is a
 * shareable deep link into the editor.
 */
import { useCallback, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parentPath } from '../../shared/routes';
import type { FileResponse } from '../../types';
import CodeView from './CodeView';
import FileEditor, { type CommitTarget } from './FileEditor';

export type SourceViewMode = 'source' | 'edit';

const MODES: { id: SourceViewMode; label: string }[] = [
  { id: 'source', label: 'Source' },
  { id: 'edit', label: 'Edit' },
];

function parseMode(value: string | null): SourceViewMode {
  return value === 'edit' ? 'edit' : 'source';
}

interface SourceFileViewProps {
  file: FileResponse & { kind: 'text'; content: string };
  repo: string;
  path: string;
  grammar: string | null;
  /** Commit destination (branch + blob sha); omit to keep editing local-only. */
  target?: CommitTarget;
}

export default function SourceFileView({ file, repo, path, grammar, target }: SourceFileViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseMode(searchParams.get('view'));
  const [draftDirty, setDraftDirty] = useState(false);
  const name = path.split('/').pop() ?? path;

  const selectMode = useCallback(
    (next: SourceViewMode) => {
      if (view === 'edit' && next !== 'edit' && draftDirty) {
        const confirmed = window.confirm('You have unsaved draft changes. Discard them and switch views?');
        if (!confirmed) return;
      }
      setSearchParams(
        (params) => {
          const updated = new URLSearchParams(params);
          if (next === 'source') updated.delete('view');
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
      document.getElementById(`source-tab-${next.id}`)?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectMode('source');
      document.getElementById('source-tab-source')?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      selectMode('edit');
      document.getElementById('source-tab-edit')?.focus();
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
            id={`source-tab-${mode.id}`}
            role="tab"
            type="button"
            aria-selected={view === mode.id}
            aria-controls={`source-panel-${mode.id}`}
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
        id={`source-panel-${view}`}
        aria-labelledby={`source-tab-${view}`}
        tabIndex={0}
        className="focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        {view === 'source' && <CodeView content={file.content} grammar={grammar} fileName={name} />}
        {view === 'edit' && (
          <div className="px-4 py-4 sm:px-6">
            <FileEditor
              fileName={name}
              initialContent={file.content}
              context={{ repo, commitSha: file.commit_sha, baseDir: parentPath(path) }}
              onDirtyChange={setDraftDirty}
              target={target}
              preview={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
