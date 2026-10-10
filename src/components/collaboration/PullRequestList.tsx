import { Link, useSearchParams } from 'react-router-dom';
import type { CollaborationState, PullRequestDetail } from '../../types/collaboration';
import { pullRequestListPath, pullRequestPath } from '../../shared/routes';
import { formatDate, formatExactCount, formatRelative } from '../../lib/format';
import { CommentIcon, PullRequestIcon } from '../explorer/icons';
import { Badge, EmptyState, ErrorState, Panel, SkeletonRows } from '../explorer/ui';
import { useAsync } from '../../hooks/useAsync';
import { explorerApi } from '../../api/explorer';
import LabelList from './LabelList';
import Pagination from './Pagination';
import { validCollaborationState } from './IssueList';

export function PullRequestStatus({ pull }: { pull: Pick<PullRequestDetail, 'state' | 'merged' | 'draft'> }) {
  if (pull.merged) return <Badge tone="accent">Merged</Badge>;
  if (pull.draft) return <Badge>Draft</Badge>;
  return pull.state === 'open' ? <Badge tone="accent">Open</Badge> : <Badge tone="warning">Closed</Badge>;
}

export default function PullRequestList({ repo }: { repo: string | null }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = validCollaborationState(searchParams.get('state'));
  const rawPage = Number(searchParams.get('page') ?? '1');
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 10_000 ? rawPage : 1;
  const invalidPage = searchParams.has('page') && page !== rawPage;
  const key = invalidPage ? null : `${repo ?? 'organization'}|pulls|${state}|${page}`;
  const result = useAsync(key, () => explorerApi.pullRequests(repo, state, page));
  const previous = pullRequestListPath(repo ?? undefined, state, Math.max(1, page - 1));
  const next = pullRequestListPath(repo ?? undefined, state, page + 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text">Pull Requests</h2>
          <p className="mt-1 text-xs text-muted">{repo ? 'This public repository' : 'Across public AnkWorks repositories'}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          <span>Filter pull requests by state</span>
          <select
            value={state}
            onChange={(event) => {
              const value = event.target.value as CollaborationState;
              setSearchParams(value === 'open' ? {} : { state: value });
            }}
            className="rounded-md border border-border bg-elevated px-2.5 py-1.5 text-sm text-text focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>

      {invalidPage ? (
        <ErrorState error={new Error('Invalid page')} title="Invalid page number" />
      ) : result.status === 'loading' || result.status === 'idle' ? (
        <Panel><SkeletonRows rows={7} label="Loading pull requests" /></Panel>
      ) : result.status === 'error' ? (
        <ErrorState error={result.error} onRetry={result.reload} />
      ) : result.data ? (
        <>
          <Panel aria-label="Pull Requests">
            {result.data.items.length ? (
              <ul className="divide-y divide-border">
                {result.data.items.map((pull) => <PullRequestRow key={`${pull.repo}-${pull.number}`} pull={pull} showRepo={!repo} />)}
              </ul>
            ) : (
              <EmptyState title={state === 'closed' ? 'No closed pull requests found.' : state === 'all' ? 'No pull requests found.' : 'No open pull requests.'} />
            )}
          </Panel>
          {result.data.total_count !== null && <p className="text-xs text-muted">{formatExactCount(result.data.total_count)} matching public pull requests</p>}
          <Pagination page={page} hasNext={result.data.has_next} previous={previous} next={next} label="Pull request pagination" />
        </>
      ) : null}
    </div>
  );
}

function PullRequestRow({ pull, showRepo }: { pull: PullRequestDetail; showRepo: boolean }) {
  const dateValue = pull.updated_at;
  return (
    <li className="px-4 py-3.5 hover:bg-elevated/50">
      <div className="flex items-start gap-3">
        <PullRequestIcon size={16} className={`mt-0.5 shrink-0 ${pull.state === 'open' && !pull.merged ? 'text-primary' : 'text-muted'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={pullRequestPath(pull.repo, pull.number)} className="break-words font-medium text-text hover:text-primary">{pull.title}</Link>
            <PullRequestStatus pull={pull} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>#{pull.number}</span>
            {showRepo && <><span aria-hidden="true">·</span><span className="font-medium text-muted">{pull.repo}</span></>}
            <span aria-hidden="true">·</span>
            <span>{pull.author?.login ? `@${pull.author.login}` : 'Unknown author'}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={dateValue} title={formatDate(dateValue)}>Updated {formatRelative(dateValue)}</time>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1" title={`${formatExactCount(pull.comments)} comments`}><CommentIcon size={13} />{formatExactCount(pull.comments)}</span>
          </div>
          <div className="mt-2"><LabelList labels={pull.labels} /></div>
        </div>
        {showRepo && <span className="hidden shrink-0 text-xs text-muted lg:inline">{pull.repo}</span>}
      </div>
    </li>
  );
}
