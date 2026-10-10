import { Link } from 'react-router-dom';
import { explorerApi } from '../../api/explorer';
import { useAsync } from '../../hooks/useAsync';
import { formatDate, formatRelative, shortSha } from '../../lib/format';
import { commitsPath } from '../../shared/routes';
import type { CommitSummary } from '../../types';
import BranchSelector from './BranchSelector';
import { ErrorState, ExternalLink, Panel, Skeleton, SkeletonRows, EmptyState } from './ui';

interface CommitHistoryProps {
  repo: string;
  gitRef: string;
  page: number;
}

/** Paginated, read-only commit history for a ref. Page state lives in the URL. */
export default function CommitHistory({ repo, gitRef, page }: CommitHistoryProps) {
  const state = useAsync(`commits|${repo}|${gitRef}|${page}`, () => explorerApi.commits(repo, gitRef, page));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-text">Commits on {gitRef}</h2>
        <BranchSelector repo={repo} gitRef={gitRef} mode="commits" />
      </div>

      <Panel aria-label="Commit history">
        {state.status === 'loading' || state.status === 'idle' ? (
          <SkeletonRows rows={10} label="Loading commits" />
        ) : state.status === 'error' ? (
          <div className="p-4">
            <ErrorState error={state.error} onRetry={state.reload} compact />
          </div>
        ) : state.data && state.data.commits.length > 0 ? (
          <ol className="divide-y divide-border">
            {state.data.commits.map((commit) => (
              <CommitRow key={commit.sha} commit={commit} />
            ))}
          </ol>
        ) : (
          <EmptyState title="No commits found on this ref." />
        )}
      </Panel>

      {state.status === 'success' && state.data && (
        <Pager repo={repo} gitRef={gitRef} page={page} hasNext={state.data.has_next} />
      )}
      {state.status === 'loading' && <Skeleton className="h-8 w-40" />}
    </div>
  );
}

function CommitRow({ commit }: { commit: CommitSummary }) {
  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3 hover:bg-elevated/50">
      <div className="min-w-0">
        <ExternalLink href={commit.html_url} className="block truncate text-sm font-medium text-text hover:text-primary">
          {commit.title || '(no message)'}
        </ExternalLink>
        <p className="mt-1 text-xs text-muted">
          <span className="text-text/90">{commit.author_name}</span>
          {commit.author_login && commit.author_login !== commit.author_name && <span> (@{commit.author_login})</span>}
          <span aria-hidden="true"> · </span>
          <time dateTime={commit.date} title={formatDate(commit.date)}>
            committed {formatRelative(commit.date)}
          </time>
        </p>
      </div>
      <ExternalLink href={commit.html_url} className="shrink-0 font-mono text-xs">
        {shortSha(commit.sha)}
      </ExternalLink>
    </li>
  );
}

function Pager({ repo, gitRef, page, hasNext }: { repo: string; gitRef: string; page: number; hasNext: boolean }) {
  const linkClass = 'btn-secondary-sm';
  const disabledClass = 'btn-secondary-sm pointer-events-none opacity-40';
  return (
    <nav aria-label="Commit pagination" className="flex items-center justify-between gap-3 text-sm">
      {page > 1 ? (
        <Link to={commitsPath(repo, gitRef, page - 1)} className={linkClass} rel="prev">
          ← Newer
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          ← Newer
        </span>
      )}
      <span className="text-muted">Page {page}</span>
      {hasNext ? (
        <Link to={commitsPath(repo, gitRef, page + 1)} className={linkClass} rel="next">
          Older →
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          Older →
        </span>
      )}
    </nav>
  );
}
