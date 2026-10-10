/**
 * Authenticated collaboration controls (Milestone D).
 *
 * CommentForm: conversation comment composer.
 * IssueControls: close/reopen + label management (triage).
 * PullRequestControls: review actions, merge (write), close/reopen (triage).
 *
 * Every control degrades to a truthful explanation when the viewer is signed
 * out or lacks permission — nothing pretends to work while gated.
 */

import { useCallback, useEffect, useState } from 'react';
import { authApi } from '../../api/auth';
import { collabWrites } from '../../api/collab-writes';
import { ExplorerApiError } from '../../api/explorer';
import { useAuth } from '../../auth/AuthContext';
import { CommitIcon } from '../explorer/icons';
import { Notice } from '../explorer/ui';

function usePermissions(repo: string) {
  const { status } = useAuth();
  const [state, setState] = useState<{ loaded: boolean; canWrite: boolean; canTriage: boolean }>({
    loaded: false,
    canWrite: false,
    canTriage: false,
  });
  useEffect(() => {
    if (status !== 'authenticated') {
      setState({ loaded: status !== 'loading', canWrite: false, canTriage: false });
      return undefined;
    }
    let cancelled = false;
    authApi
      .permissions('ankworks', repo)
      .then((response) => {
        if (!cancelled) setState({ loaded: true, canWrite: response.canWrite, canTriage: response.canTriage });
      })
      .catch(() => {
        if (!cancelled) setState({ loaded: true, canWrite: false, canTriage: false });
      });
    return () => {
      cancelled = true;
    };
  }, [repo, status]);
  return state;
}

function SignInNotice({ action }: { action: string }) {
  const { authEnabled } = useAuth();
  if (!authEnabled) {
    return <Notice title="Sign-in unavailable">{action} requires GitHub sign-in, which is not configured on this deployment.</Notice>;
  }
  return (
    <Notice title="Sign-in required">
      <a href="/api/auth/login" className="font-medium text-primary underline-offset-2 hover:underline">
        Sign in with GitHub
      </a>{' '}
      to {action.toLowerCase()}.
    </Notice>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await action();
      setDone(success);
    } catch (err) {
      setError(err instanceof ExplorerApiError ? err.message : 'The action failed unexpectedly.');
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, done, run };
}

function Feedback({ error, done }: { error: string | null; done: string | null }) {
  if (error) return <p role="alert" className="text-xs text-red-400">{error}</p>;
  if (done) return <p className="text-xs text-primary">{done}</p>;
  return null;
}

// ---------------------------------------------------------------------------

export function CommentForm({ repo, number, onPosted, label = 'Add a comment' }: { repo: string; number: number; onPosted?: () => void; label?: string }) {
  const { status } = useAuth();
  const [body, setBody] = useState('');
  const { busy, error, done, run } = useSubmit();

  if (status !== 'authenticated') return <SignInNotice action="Comment on this discussion" />;

  return (
    <section aria-label={label} className="space-y-2 rounded-md border border-border bg-elevated/40 p-3">
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted">{label}</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          placeholder="Leave a comment (Markdown is supported)"
          className="w-full resize-y rounded-md border border-border bg-surface p-3 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        />
      </label>
      <div className="flex items-center justify-between gap-2">
        <Feedback error={error} done={done} />
        <button
          type="button"
          disabled={busy || body.trim() === ''}
          onClick={() =>
            void run(async () => {
              await collabWrites.commentOnIssue(repo, number, body);
              setBody('');
              onPosted?.();
            }, 'Comment posted. Reload the conversation to see it.')
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary enabled:hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <CommitIcon size={14} />
          {busy ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

export function IssueControls({ repo, number, state, labels, onChanged }: { repo: string; number: number; state: string; labels: string[]; onChanged?: () => void }) {
  const { status } = useAuth();
  const permissions = usePermissions(repo);
  const [labelText, setLabelText] = useState('');
  const { busy, error, done, run } = useSubmit();

  if (status !== 'authenticated') return <SignInNotice action="Manage this issue" />;
  if (permissions.loaded && !permissions.canTriage) {
    return <p className="text-xs text-muted">Managing labels and issue state requires triage access to {`ankworks/${repo}`}.</p>;
  }

  const toggleState = () =>
    void run(async () => {
      await collabWrites.updateIssue(repo, number, { state: state === 'open' ? 'closed' : 'open' });
      onChanged?.();
    }, state === 'open' ? 'Issue closed.' : 'Issue reopened.');

  const applyLabels = () =>
    void run(async () => {
      const next = labelText
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      await collabWrites.updateIssue(repo, number, { labels: next });
      setLabelText('');
      onChanged?.();
    }, 'Labels updated.');

  return (
    <section aria-label="Issue management" className="space-y-2 rounded-md border border-border bg-elevated/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={toggleState}
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text hover:bg-elevated disabled:opacity-70"
        >
          {state === 'open' ? 'Close issue' : 'Reopen issue'}
        </button>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted">
          <span className="shrink-0">Labels</span>
          <input
            type="text"
            value={labelText}
            onChange={(event) => setLabelText(event.target.value)}
            placeholder={labels.length ? labels.join(', ') : 'bug, enhancement'}
            aria-label="Labels (comma separated)"
            className="h-8 w-full min-w-0 rounded-md border border-border bg-surface px-2 text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          />
        </label>
        <button
          type="button"
          disabled={busy || labelText.trim() === ''}
          onClick={applyLabels}
          className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary enabled:hover:bg-primary/20 disabled:opacity-70"
        >
          Apply labels
        </button>
      </div>
      <Feedback error={error} done={done} />
    </section>
  );
}

// ---------------------------------------------------------------------------

const REVIEW_EVENTS = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'] as const;

export function PullRequestControls({ repo, number, state, onChanged }: { repo: string; number: number; state: string; onChanged?: () => void }) {
  const { status } = useAuth();
  const permissions = usePermissions(repo);
  const [reviewBody, setReviewBody] = useState('');
  const [mergeMethod, setMergeMethod] = useState<'merge' | 'squash' | 'rebase'>('squash');
  const { busy, error, done, run } = useSubmit();

  if (status !== 'authenticated') return <SignInNotice action="Review or merge this pull request" />;
  if (permissions.loaded && !permissions.canTriage && !permissions.canWrite) {
    return <p className="text-xs text-muted">Reviewing or merging requires triage access to {`ankworks/${repo}`}.</p>;
  }

  const submitReview = (event: (typeof REVIEW_EVENTS)[number]) =>
    void run(async () => {
      await collabWrites.submitReview(repo, number, { event, body: reviewBody });
      setReviewBody('');
      onChanged?.();
    }, `Review submitted (${event}).`);

  const merge = () =>
    void run(async () => {
      await collabWrites.mergePull(repo, number, mergeMethod);
      onChanged?.();
    }, 'Pull request merged.');

  // The issues PATCH endpoint also opens/closes pull requests.
  const toggleState = () =>
    void run(async () => {
      await collabWrites.updateIssue(repo, number, { state: state === 'open' ? 'closed' : 'open' });
      onChanged?.();
    }, state === 'open' ? 'Pull request closed.' : 'Pull request reopened.');

  return (
    <section aria-label="Pull request management" className="space-y-3 rounded-md border border-border bg-elevated/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted">
          <span className="shrink-0">Review</span>
          <input
            type="text"
            value={reviewBody}
            onChange={(event) => setReviewBody(event.target.value)}
            placeholder="Review summary (required for comment/request changes)"
            aria-label="Review body"
            className="h-8 w-full min-w-0 rounded-md border border-border bg-surface px-2 text-xs text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          />
        </label>
        <button type="button" disabled={busy} onClick={() => submitReview('COMMENT')} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text hover:bg-elevated disabled:opacity-70">
          Comment
        </button>
        <button type="button" disabled={busy} onClick={() => submitReview('APPROVE')} className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary enabled:hover:bg-primary/20 disabled:opacity-70">
          Approve
        </button>
        <button type="button" disabled={busy || reviewBody.trim() === ''} onClick={() => submitReview('REQUEST_CHANGES')} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text hover:bg-elevated disabled:opacity-70">
          Request changes
        </button>
      </div>
      {permissions.canWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            <span>Merge method</span>
            <select
              value={mergeMethod}
              onChange={(event) => setMergeMethod(event.target.value as 'merge' | 'squash' | 'rebase')}
              aria-label="Merge method"
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text"
            >
              <option value="merge">Merge</option>
              <option value="squash">Squash</option>
              <option value="rebase">Rebase</option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy || state === 'closed'}
            onClick={merge}
            data-testid="merge-button"
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary enabled:hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <CommitIcon size={14} />
            {busy ? 'Merging…' : 'Merge pull request'}
          </button>
          <button type="button" disabled={busy} onClick={toggleState} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text hover:bg-elevated disabled:opacity-70">
            {state === 'open' ? 'Close pull request' : 'Reopen pull request'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted">Merging requires write access to {`ankworks/${repo}`}.</p>
      )}
      <Feedback error={error} done={done} />
    </section>
  );
}
