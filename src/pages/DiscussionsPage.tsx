/**
 * GitHub Discussions list (V3-C).
 *
 * Discussions live only in GitHub's GraphQL API; Forge reads them through its
 * own Worker so no token reaches the browser. Everything shown here comes from
 * that response — a discussion GitHub does not return is simply absent, and an
 * empty list is described as empty rather than filled with samples.
 *
 * The repository shell hides the tab entirely when `has_discussions` is false,
 * and this page says so explicitly if it is opened directly.
 */
import { useParams, useSearchParams } from 'react-router-dom';
import { discussionsApi } from '../api/discussions';
import { useAsync } from '../hooks/useAsync';
import { formatRelative } from '../lib/format';
import { discussionPath } from '../shared/routes';
import RepoShell from '../components/explorer/RepoShell';
import { Badge, EmptyState, ErrorState, Notice, Panel, SkeletonRows } from '../components/explorer/ui';
import { CommentIcon } from '../components/explorer/icons';
import { Link } from 'react-router-dom';

export default function DiscussionsPage() {
  const { repo = '' } = useParams();
  return (
    <RepoShell repo={repo} tab="discussions">
      {({ hasDiscussions }) => <DiscussionsList repo={repo} enabled={hasDiscussions} />}
    </RepoShell>
  );
}

function DiscussionsList({ repo, enabled }: { repo: string; enabled: boolean }) {
  const [params] = useSearchParams();
  const category = params.get('category') ?? undefined;
  const query = params.get('q') ?? undefined;

  const categories = useAsync(`discussion-categories|${repo}`, () => discussionsApi.categories(repo));
  const list = useAsync(`discussions|${repo}|${category ?? ''}|${query ?? ''}`, () =>
    discussionsApi.list(repo, { category, q: query })
  );

  if (!enabled) {
    return (
      <Notice title="Discussions are not enabled">
        This repository has not enabled GitHub Discussions. Enable them in the repository settings on GitHub to see them
        here.
      </Notice>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-text">Discussions</h2>
        {categories.data?.categories.map((entry) => (
          <Link
            key={entry.id}
            to={`/repos/${encodeURIComponent(repo)}/discussions?category=${encodeURIComponent(entry.id)}`}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              category === entry.id ? 'border-accent/60 bg-accent/10 text-text' : 'border-border text-muted hover:text-text'
            }`}
          >
            {entry.emoji ? `${entry.emoji} ` : ''}
            {entry.name}
          </Link>
        ))}
      </div>

      {list.status === 'loading' || list.status === 'idle' ? (
        <Panel>
          <SkeletonRows rows={4} label="Loading discussions" />
        </Panel>
      ) : list.status === 'error' ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : list.data && list.data.discussions.length > 0 ? (
        <ol className="space-y-3" aria-label="Discussions">
          {list.data.discussions.map((discussion) => (
            <li key={discussion.id}>
              <Panel className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to={discussionPath(repo, discussion.number)}
                      className="font-medium text-text hover:text-primary"
                    >
                      {discussion.title}
                    </Link>
                    <p className="mt-1 text-xs text-muted">
                      {discussion.author ? `@${discussion.author.login}` : 'Unknown author'} opened{' '}
                      {formatRelative(discussion.createdAt)}
                      {discussion.category ? ` in ${discussion.category.name}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted">
                    {discussion.answered && <Badge tone="accent">Answered</Badge>}
                    {discussion.locked && <Badge>Locked</Badge>}
                    <span className="inline-flex items-center gap-1">
                      <CommentIcon size={13} /> {discussion.commentsCount}
                    </span>
                  </div>
                </div>
              </Panel>
            </li>
          ))}
        </ol>
      ) : (
        <Panel>
          <EmptyState title="No discussions yet">
            {query ? `Nothing matched “${query}”.` : 'This repository has no discussions in this category yet.'}
          </EmptyState>
        </Panel>
      )}
    </div>
  );
}
