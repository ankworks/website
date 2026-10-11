/**
 * A single GitHub Discussion (V3-C).
 *
 * Comments, replies, reactions, marking an answer, and locking are all driven by
 * GitHub's GraphQL mutations through the Forge Worker. Forge never guesses who
 * may edit what: `viewerCanUpdate` / `viewerCanDelete` come from GitHub, and
 * membership plus repository permission are re-verified server-side on every
 * write. When GitHub says a control is unavailable, it is simply not offered.
 */
import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { discussionsApi } from '../api/discussions';
import { ExplorerApiError } from '../api/explorer';
import { useAsync } from '../hooks/useAsync';
import { useAuth } from '../auth/AuthContext';
import { formatRelative } from '../lib/format';
import { discussionsPath } from '../shared/routes';
import type { DiscussionComment } from '../shared/discussions';
import RepoShell from '../components/explorer/RepoShell';
import IssueMarkdown from '../components/collaboration/IssueMarkdown';
import WriteAccessNotice from '../components/collaboration/WriteAccessNotice';
import { Badge, ErrorState, ExternalLink, Notice, Panel, Skeleton } from '../components/explorer/ui';
import { CommentIcon } from '../components/explorer/icons';

export default function DiscussionDetailPage() {
  const { repo = '', number = '' } = useParams();
  const parsed = Number(number);
  const valid = Number.isSafeInteger(parsed) && parsed > 0;
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((value) => value + 1), []);

  return (
    <RepoShell repo={repo} tab="discussions">
      {() =>
        valid ? (
          <DiscussionDetail repo={repo} number={parsed} refreshKey={refreshKey} onChanged={reload} />
        ) : (
          <ErrorState error={new Error('That is not a discussion number.')} title="Invalid discussion" />
        )
      }
    </RepoShell>
  );
}

function DiscussionDetail({
  repo,
  number,
  refreshKey,
  onChanged,
}: {
  repo: string;
  number: number;
  refreshKey: number;
  onChanged: () => void;
}) {
  const state = useAsync(`discussion|${repo}|${number}|${refreshKey}`, () => discussionsApi.detail(repo, number));
  const { status, isMember } = useAuth();
  const canWrite = status === 'authenticated' && isMember;

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={state.reload} />;
  const discussion = state.data?.discussion;
  if (!discussion) return <Notice title="Discussion not found">This discussion could not be loaded.</Notice>;

  return (
    <article className="space-y-4">
      <Link to={discussionsPath(repo)} className="text-sm text-muted hover:text-text">
        ← Back to discussions
      </Link>

      <header className="border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {discussion.answered && <Badge tone="accent">Answered</Badge>}
          {discussion.locked && <Badge tone="warning">Locked</Badge>}
          {discussion.category && <Badge>{discussion.category.name}</Badge>}
        </div>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text">{discussion.title}</h2>
        <p className="mt-2 text-sm text-muted">
          {discussion.author ? `@${discussion.author.login}` : 'Unknown author'} started this discussion{' '}
          {formatRelative(discussion.createdAt)}
          <span aria-hidden="true"> · </span>
          <ExternalLink href={discussion.url}>View on GitHub</ExternalLink>
        </p>
      </header>

      <Panel aria-label="Discussion body" className="p-4 sm:p-6">
        <IssueMarkdown source={discussion.body} label="Discussion body" />
      </Panel>

      <section aria-labelledby="discussion-comments-heading" className="space-y-3">
        <div className="flex items-center gap-2">
          <CommentIcon size={16} className="text-muted" />
          <h3 id="discussion-comments-heading" className="text-base font-semibold text-text">
            Replies
          </h3>
          <Badge>{discussion.comments.length} shown</Badge>
        </div>

        {discussion.comments.length === 0 ? (
          <Panel>
            <p className="p-4 text-sm text-muted">No replies yet.</p>
          </Panel>
        ) : (
          <ol className="space-y-3" aria-label="Discussion replies">
            {discussion.comments.map((comment) => (
              <li key={comment.id}>
                <DiscussionCommentCard
                  repo={repo}
                  number={number}
                  comment={comment}
                  canWrite={canWrite}
                  onChanged={onChanged}
                />
              </li>
            ))}
          </ol>
        )}

        {canWrite ? (
          <CommentComposer repo={repo} number={number} onPosted={onChanged} />
        ) : (
          <WriteAccessNotice action="reply to this discussion" />
        )}
      </section>
    </article>
  );
}

function DiscussionCommentCard({
  repo,
  number,
  comment,
  canWrite,
  onChanged,
}: {
  repo: string;
  number: number;
  comment: DiscussionComment;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await discussionsApi.editComment(repo, comment.id, draft);
      setEditing(false);
      onChanged();
    } catch (cause) {
      setError(cause instanceof ExplorerApiError ? cause.message : 'The comment could not be updated.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await discussionsApi.deleteComment(repo, comment.id);
      onChanged();
    } catch (cause) {
      setError(cause instanceof ExplorerApiError ? cause.message : 'The comment could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  const answer = async () => {
    setBusy(true);
    setError(null);
    try {
      await discussionsApi.markAnswer(repo, number, comment.id);
      onChanged();
    } catch (cause) {
      setError(cause instanceof ExplorerApiError ? cause.message : 'The answer could not be marked.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-medium text-text">{comment.author ? `@${comment.author.login}` : 'Unknown author'}</span>
        <span>replied {formatRelative(comment.createdAt)}</span>
        {comment.isAnswer && <Badge tone="accent">Answer</Badge>}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={5}
            aria-label="Edit comment"
            className="w-full resize-y rounded-md border border-border bg-surface p-3 text-sm text-text"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || draft.trim().length === 0}
              className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary disabled:opacity-70"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
              disabled={busy}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <IssueMarkdown source={comment.body} label="Discussion reply" />
        </div>
      )}

      {comment.replies.length > 0 && (
        <ul className="mt-3 space-y-2 border-l border-border pl-3" aria-label="Nested replies">
          {comment.replies.map((reply) => (
            <li key={reply.id} className="text-sm">
              <div className="text-xs text-muted">
                {reply.author ? `@${reply.author.login}` : 'Unknown author'} · {formatRelative(reply.createdAt)}
              </div>
              <IssueMarkdown source={reply.body} label="Discussion reply" />
            </li>
          ))}
        </ul>
      )}

      {canWrite && !editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          {comment.viewerCanUpdate && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-text"
            >
              Edit
            </button>
          )}
          {comment.viewerCanDelete && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-text"
            >
              Delete
            </button>
          )}
          {!comment.isAnswer && (
            <button
              type="button"
              onClick={() => void answer()}
              disabled={busy}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-text"
            >
              Mark as answer
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {error}
        </p>
      )}
    </Panel>
  );
}

function CommentComposer({ repo, number, onPosted }: { repo: string; number: number; onPosted: () => void }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await discussionsApi.comment(repo, number, { body });
      setBody('');
      onPosted();
    } catch (cause) {
      setError(cause instanceof ExplorerApiError ? cause.message : 'The reply could not be posted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Add a reply" className="space-y-2 rounded-md border border-border bg-elevated/40 p-3">
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted">Add a reply</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          placeholder="Write a reply (Markdown is supported)"
          aria-label="Reply body"
          className="w-full resize-y rounded-md border border-border bg-surface p-3 text-sm text-text"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || body.trim().length === 0}
          className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary disabled:opacity-70"
        >
          {busy ? 'Posting…' : 'Post reply'}
        </button>
        {error && (
          <span role="alert" className="text-xs text-red-400">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
