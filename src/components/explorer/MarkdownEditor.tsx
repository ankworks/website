/**
 * Split Markdown editing workspace (Milestone A scaffolding).
 *
 * The editor is a real local-draft workspace: the source and the live preview
 * are fully functional, including unsaved-change tracking and a navigation
 * warning. Saving is deliberately disabled — file writes require GitHub
 * authentication and repository authorization, which arrive with the GitHub
 * App sign-in milestone. Nothing here is uploaded anywhere.
 *
 * The source surface is a plain editor for now; Monaco replaces it when
 * authenticated file editing lands. Keep the component API stable so that swap
 * is contained to this file.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LinkContext } from '../../shared/markdown-links';
import { CheckIcon, CommitIcon } from './icons';
import Markdown from './Markdown';
import { Notice } from './ui';

interface MarkdownEditorProps {
  fileName: string;
  initialContent: string;
  /** Link context for relative links in the live preview. */
  context: LinkContext;
  /** Invoked whenever the dirty flag changes (used by the tab guard). */
  onDirtyChange?: (dirty: boolean) => void;
}

export default function MarkdownEditor({ fileName, initialContent, context, onDirtyChange }: MarkdownEditorProps) {
  const [draft, setDraft] = useState(initialContent);
  const dirty = draft !== initialContent;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Report dirty state to the parent (tab switching warns before discarding).
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Warn before closing or reloading the tab while the draft is unsaved.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const discard = useCallback(() => {
    if (!window.confirm(`Discard the unsaved draft changes to ${fileName}?`)) return;
    setDraft(initialContent);
    textareaRef.current?.focus();
  }, [fileName, initialContent]);

  return (
    <div className="space-y-3">
      <Notice title="Local draft — nothing is saved to GitHub yet">
        Editing and saving files require GitHub sign-in and repository authorization, which arrive with the authentication
        milestone. Until then this workspace keeps your draft in the browser only; closing the tab discards it.
      </Notice>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-elevated/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
          <span className="truncate font-mono text-text">{fileName}</span>
          {dirty ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              Unsaved changes
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
              <CheckIcon size={12} />
              No changes
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={discard} disabled={!dirty} className="btn-secondary-sm">
            Discard changes
          </button>
          <button
            type="button"
            disabled
            title="Saving to GitHub requires sign-in, which arrives with the authentication milestone."
            aria-describedby="commit-gate-hint"
            className="inline-flex cursor-not-allowed items-center gap-1.5 whitespace-nowrap rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary opacity-80"
          >
            <CommitIcon size={14} />
            Commit changes…
          </button>
        </div>
      </div>
      <p id="commit-gate-hint" className="sr-only">
        Committing is disabled: saving to GitHub requires sign-in, which arrives with the authentication milestone.
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        <section aria-label="Markdown source editor" className="min-w-0">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Source</p>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={`Markdown source of ${fileName}`}
            spellCheck={false}
            className="h-[28rem] w-full resize-y rounded-md border border-border bg-surface p-4 font-mono text-[13px] leading-6 text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          />
        </section>
        <section aria-label="Live preview pane" className="min-w-0">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Live preview</p>
          <div className="h-[28rem] overflow-auto rounded-md border border-border bg-surface px-5 py-4">
            {draft.trim() === '' ? (
              <p className="text-sm italic text-muted">Nothing to preview yet.</p>
            ) : (
              <Markdown source={draft} name={`${fileName} (draft)`} context={context} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
