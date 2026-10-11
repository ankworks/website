/**
 * Authenticated issue creation.
 *
 * This is the primary way to open an issue on this site. It talks directly to
 * `POST /api/repos/:repo/issues`, which creates the issue on GitHub with the
 * signed-in user's own token. It has **no** dependency on D1, Turnstile, or the
 * guest moderation queue — those exist only for visitors without a GitHub
 * account (see GuestIssueForm).
 *
 * Authorization:
 * - Opening an issue on a public repository needs read access, which every
 *   signed-in GitHub user has. The Worker verifies that with the user's own
 *   token and fails closed, so this form deliberately does not require write
 *   access — requiring more here would only hide a control the backend allows.
 * - Signed-out visitors get a truthful sign-in prompt instead of a dead form.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { getRepositories } from '../../api/github';
import { collabWrites, type CollabWriteResult } from '../../api/collab-writes';
import { ExplorerApiError } from '../../api/explorer';
import { useAuth } from '../../auth/AuthContext';
import { ORG_NAME } from '../../shared/validation';
import { issuePath } from '../../shared/routes';
import { CommitIcon, IssueIcon, PlusIcon } from '../explorer/icons';
import { Panel, Skeleton } from '../explorer/ui';
import IssueTemplatePicker from './IssueTemplatePicker';
import type { IssueTemplate } from '../../shared/issue-templates';

const BODY_MAX = 10_000;
const TITLE_MAX = 300;

export interface NewIssueFormProps {
  /** Target repository. Omit to let the author choose one (organization view). */
  repo?: string;
  /** False when the repository has GitHub Issues turned off (writes return 410). */
  issuesEnabled?: boolean;
  /** Called after GitHub accepts the issue. */
  onCreated?: (result: CollabWriteResult, repo: string) => void;
  /** Optional destination offered next to the created issue. */
  cancelHref?: string;
}

function SignInPanel({ compact }: { compact: boolean }) {
  const { authEnabled } = useAuth();
  return (
    <Panel aria-label="New issue" className={compact ? 'p-4' : 'p-4 sm:p-6'} data-testid="new-issue-signin">
      <h2 className="flex items-center gap-2 text-base font-semibold text-text">
        <IssueIcon size={16} />
        New issue
      </h2>
      {authEnabled ? (
        <p className="mt-2 text-sm leading-6 text-muted">
          <a href="/api/auth/login" className="font-medium text-primary underline-offset-2 hover:underline">
            Sign in with GitHub
          </a>{' '}
          to open an issue. The issue is created with your own GitHub account — no email address, no queue, and no
          moderation step.
        </p>
      ) : (
        <p className="mt-2 text-sm leading-6 text-muted">
          GitHub sign-in is not configured on this deployment, so issues cannot be opened from here. You can still open
          one directly on GitHub.
        </p>
      )}
    </Panel>
  );
}

/** Repository picker used by the organization-wide issues page. */
function useRepositoryOptions(enabled: boolean) {
  const [repos, setRepos] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    getRepositories()
      .then((list) => {
        if (!cancelled) setRepos(list.map((entry) => entry.name).sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the repository list.');
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { repos, error };
}

export default function NewIssueForm({ repo, issuesEnabled = true, onCreated, cancelHref }: NewIssueFormProps) {
  const { status, user, isMember, membershipMessage } = useAuth();
  const { repos, error: reposError } = useRepositoryOptions(status === 'authenticated' && !repo);

  const [selectedRepo, setSelectedRepo] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [labels, setLabels] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ result: CollabWriteResult; repo: string } | null>(null);

  const targetRepo = repo ?? selectedRepo;

  /** Apply an issue template: pre-fill title, body, and labels (V3-C). */
  const applyTemplate = useCallback(
    (template: IssueTemplate) => {
      setTitle(template.title ?? title);
      setBody(template.body);
      if (template.labels.length > 0) {
        setLabels(template.labels.join(', '));
      }
    },
    [title]
  );

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!targetRepo || title.trim() === '' || busy) return;
      setBusy(true);
      setError(null);
      setCreated(null);
      try {
        const parsedLabels = labels
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        const result = await collabWrites.createIssue(targetRepo, {
          title: title.trim(),
          body,
          labels: parsedLabels,
        });
        setCreated({ result, repo: targetRepo });
        setTitle('');
        setBody('');
        setLabels('');
        onCreated?.(result, targetRepo);
      } catch (err) {
        setError(err instanceof ExplorerApiError ? err.message : 'Could not create the issue.');
      } finally {
        setBusy(false);
      }
    },
    [body, busy, labels, onCreated, targetRepo, title]
  );

  if (status === 'loading') {
    return (
      <Panel aria-label="New issue" className="p-4" data-testid="new-issue-loading">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-24 w-full" />
      </Panel>
    );
  }

  if (status !== 'authenticated') return <SignInPanel compact={Boolean(repo)} />;

  // V3-B: writing through Forge requires a server-verified AnkWorks membership.
  // A signed-in non-member reads public content only; guests use the separate
  // moderated guest form instead.
  if (!isMember) {
    return (
      <Panel aria-label="New issue" className="p-4 sm:p-6" data-testid="new-issue-members-only">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text">
          <IssueIcon size={16} />
          Members only
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">{membershipMessage}</p>
      </Panel>
    );
  }

  if (repo && !issuesEnabled) {
    return (
      <Panel aria-label="New issue" className="p-4 sm:p-6" data-testid="new-issue-disabled">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text">
          <IssueIcon size={16} />
          Issues are disabled
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          <span className="font-mono text-text">{ORG_NAME}/{repo}</span> has turned GitHub Issues off, so GitHub rejects
          new issues for it. Report it on the repository&apos;s discussions or contact the maintainers instead.
        </p>
      </Panel>
    );
  }

  return (
    <Panel aria-label="New issue" className="p-4 sm:p-6" data-testid="new-issue-form">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text">
          <PlusIcon size={16} />
          New issue
        </h2>
        <p className="text-xs text-muted">
          Signed in as <span className="font-mono text-text">{user?.login ?? 'your GitHub account'}</span> · the issue is
          created on GitHub as you
        </p>
      </div>

      <form className="mt-4 space-y-3" onSubmit={(event) => void submit(event)}>
        {!repo ? (
          <label className="block text-xs text-muted">
            Repository
            {repos === null ? (
              <span className="mt-1 block text-sm text-muted">{reposError ?? 'Loading repositories…'}</span>
            ) : (
              <select
                value={selectedRepo}
                onChange={(event) => setSelectedRepo(event.target.value)}
                aria-label="Repository"
                data-testid="new-issue-repo-select"
                className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:w-72"
              >
                <option value="">Select a repository…</option>
                {repos.map((name) => (
                  <option key={name} value={name}>
                    {ORG_NAME}/{name}
                  </option>
                ))}
              </select>
            )}
          </label>
        ) : (
          <p className="text-xs text-muted">
            Opening an issue in{' '}
            <Link to={`/repos/${encodeURIComponent(repo)}`} className="font-mono text-primary hover:underline">
              {ORG_NAME}/{repo}
            </Link>
          </p>
        )}

        {targetRepo && (
          <IssueTemplatePicker repo={targetRepo} onSelect={applyTemplate} />
        )}

        <label className="block text-xs text-muted">
          Title
          <input
            type="text"
            required
            maxLength={TITLE_MAX}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="Issue title"
            placeholder="Short, specific summary"
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          />
        </label>

        <label className="block text-xs text-muted">
          Description
          <textarea
            maxLength={BODY_MAX}
            rows={6}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            aria-label="Issue description"
            placeholder="What happened, what you expected, and how to reproduce it. Markdown is supported."
            className="mt-1 w-full resize-y rounded-md border border-border bg-surface p-2 font-mono text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          />
        </label>

        <label className="block text-xs text-muted">
          Labels <span className="text-muted/70">(optional, comma separated)</span>
          <input
            type="text"
            value={labels}
            onChange={(event) => setLabels(event.target.value)}
            aria-label="Labels (comma separated)"
            placeholder="bug, help wanted"
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          />
        </label>

        {error ? (
          <p role="alert" className="text-xs text-red-400">
            {error}
          </p>
        ) : null}

        {created ? (
          <p className="text-xs text-primary" data-testid="new-issue-created">
            Issue #{created.result.number} created in {ORG_NAME}/{created.repo}.{' '}
            <Link to={issuePath(created.repo, created.result.number)} className="font-medium underline-offset-2 hover:underline">
              View the issue
            </Link>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={busy || title.trim() === '' || (!repo && selectedRepo === '')}
            data-testid="new-issue-submit"
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary enabled:hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <CommitIcon size={15} />
            {busy ? 'Creating issue…' : 'Create issue'}
          </button>
          {cancelHref ? (
            <Link to={cancelHref} className="btn-secondary-sm">
              Cancel
            </Link>
          ) : null}
        </div>
        <p className="text-xs text-muted">
          Creating an issue needs read access to the repository, which every signed-in GitHub user has on public
          repositories. The server verifies that with your own token before it writes anything.
        </p>
      </form>
    </Panel>
  );
}
