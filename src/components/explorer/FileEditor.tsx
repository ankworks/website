/**
 * Split editing workspace with authenticated committing.
 *
 * - Source: CSP-safe CodeEditor with a synchronized line-number gutter.
 * - Live preview: sanitized GitHub-flavored Markdown (Markdown files only).
 * - Commit: real GitHub commit (and optional new branch) through the Worker,
 *   gated behind sign-in and verified push permission. Every gate state has a
 *   truthful explanation — nothing is claimed to work while disabled.
 *
 * Drafts stay local until the commit succeeds; unsaved-change tracking and the
 * navigation warning are unchanged.
 *
 * The gate is advisory: the Worker re-verifies push permission with the user's
 * own token before it writes anything, so a stale or spoofed UI state can never
 * produce an unauthorized commit.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { changesApi } from '../../api/changes';
import { ExplorerApiError } from '../../api/explorer';
import { useAuth } from '../../auth/AuthContext';
import { useRepoPermissions } from '../../hooks/useRepoPermissions';
import type { LinkContext } from '../../shared/markdown-links';
import { ORG_NAME } from '../../shared/validation';
import CodeEditor from './CodeEditor';
import { CheckIcon, CommitIcon } from './icons';
import Markdown from './Markdown';
import { ExternalLink } from './ui';

/** Where a committed draft goes. Omit to keep the workspace local-only. */
export interface CommitTarget {
  repo: string;
  path: string;
  /** Branch the draft is based on. */
  ref: string;
  /** Blob sha of the loaded file (required to replace an existing file). */
  blobSha?: string;
}

interface FileEditorProps {
  fileName: string;
  initialContent: string;
  /** Link context for relative links in the live preview. */
  context: LinkContext;
  /** Invoked whenever the dirty flag changes (used by the tab guard). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Repository location; omit to keep the workspace local-only. */
  target?: CommitTarget;
  /** Render the sanitized Markdown live preview pane (default: true). */
  preview?: boolean;
}

interface Gate {
  ok: boolean;
  title: string;
}

export default function FileEditor({ fileName, initialContent, context, onDirtyChange, target, preview = true }: FileEditorProps) {
  const { status } = useAuth();
  const permissions = useRepoPermissions(target?.repo ?? null);
  const [baseline, setBaseline] = useState(initialContent);
  const [draft, setDraft] = useState(initialContent);
  const dirty = draft !== baseline;

  const [message, setMessage] = useState('');
  const [branchName, setBranchName] = useState(target?.ref ?? '');
  const [busy, setBusy] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sha: string; htmlUrl: string; branch: string } | null>(null);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const gate = useMemo<Gate>(() => {
    if (status === 'loading') return { ok: false, title: 'Checking your sign-in status…' };
    if (status !== 'authenticated') return { ok: false, title: 'Committing to GitHub requires sign-in.' };
    if (!target) return { ok: false, title: 'This file has no commit target.' };
    if (permissions.error) return { ok: false, title: permissions.error };
    if (!permissions.loaded) return { ok: false, title: 'Checking repository permissions…' };
    if (!permissions.canWrite) return { ok: false, title: `Committing requires write access to ${ORG_NAME}/${target.repo}.` };
    return { ok: true, title: '' };
  }, [status, target, permissions]);

  const discard = useCallback(() => {
    if (!window.confirm(`Discard the unsaved draft changes to ${fileName}?`)) return;
    setDraft(baseline);
  }, [baseline, fileName]);

  const commit = useCallback(async () => {
    if (!target || !gate.ok || !dirty || message.trim() === '') return;
    setBusy(true);
    setCommitError(null);
    setResult(null);
    try {
      const branch = branchName.trim() || target.ref;
      if (branch !== target.ref) {
        try {
          await changesApi.createBranch(target.repo, { name: branch, from: target.ref });
        } catch (error) {
          // Committing to an existing branch is valid — only real failures stop us.
          const code = error instanceof ExplorerApiError ? error.code : '';
          if (code !== 'BRANCH_EXISTS') throw error;
        }
      }
      const response = await changesApi.commit(target.repo, {
        message,
        content: draft,
        branch,
        path: target.path,
        sha: target.blobSha,
      });
      setBaseline(draft);
      setResult({ sha: response.commit.sha, htmlUrl: response.commit.html_url, branch: response.branch });
      setMessage('');
    } catch (error) {
      setCommitError(error instanceof ExplorerApiError ? error.message : 'The commit failed unexpectedly.');
    } finally {
      setBusy(false);
    }
  }, [branchName, dirty, draft, gate.ok, message, target]);

  const sourceLabel = preview ? `Markdown source of ${fileName}` : `Source of ${fileName}`;

  return (
    <div className="space-y-3">
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
            disabled={!gate.ok || !dirty || busy || message.trim() === ''}
            title={gate.ok ? (message.trim() === '' ? 'Enter a commit message first.' : 'Commit the draft to GitHub.') : gate.title}
            aria-describedby="commit-gate-hint"
            onClick={() => void commit()}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors enabled:hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-80"
            data-testid="commit-button"
          >
            <CommitIcon size={14} />
            {busy ? 'Committing…' : 'Commit changes…'}
          </button>
        </div>
      </div>
      <p id="commit-gate-hint" className="sr-only">
        {gate.ok ? 'Commits go to GitHub on the selected branch after permission checks.' : gate.title}
      </p>

      <section aria-label="Commit settings" className="space-y-2 rounded-md border border-border bg-elevated/40 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted">
            <span className="shrink-0">Message</span>
            <input
              type="text"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={`Update ${fileName}`}
              aria-label="Commit message"
              className="h-8 w-full rounded-md border border-border bg-surface px-2 font-mono text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            />
          </label>
          <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
            <span className="shrink-0">Branch</span>
            <input
              type="text"
              value={branchName}
              onChange={(event) => setBranchName(event.target.value)}
              placeholder={target?.ref ?? 'main'}
              aria-label="Target branch (type a new name to create it)"
              className="h-8 w-44 rounded-md border border-border bg-surface px-2 font-mono text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            />
          </label>
        </div>
        {commitError ? (
          <p role="alert" className="text-xs text-red-400">
            {commitError}
          </p>
        ) : null}
        {result ? (
          <p className="text-xs text-primary">
            Committed to <span className="font-mono">{result.branch}</span>
            {result.sha ? <> at <span className="font-mono">{result.sha.slice(0, 7)}</span></> : null}
            {result.htmlUrl ? (
              <>
                {' · '}
                <ExternalLink href={result.htmlUrl}>View commit</ExternalLink>
              </>
            ) : null}
          </p>
        ) : null}
      </section>

      <div className={preview ? 'grid gap-3 lg:grid-cols-2' : 'grid gap-3'}>
        <section aria-label={preview ? 'Markdown source editor' : 'File source editor'} className="min-w-0">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Source</p>
          <CodeEditor value={draft} onChange={setDraft} ariaLabel={sourceLabel} />
        </section>
        {preview ? (
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
        ) : null}
      </div>
    </div>
  );
}
