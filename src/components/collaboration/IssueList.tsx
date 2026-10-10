import { Link, useSearchParams } from 'react-router-dom';
import type { CollaborationState, IssueSummary } from '../../types/collaboration';
import { issueListPath, issuePath } from '../../shared/routes';
import { formatDate, formatExactCount, formatRelative } from '../../lib/format';
import { CommentIcon, IssueIcon } from '../explorer/icons';
import { Badge, EmptyState, ErrorState, Panel, SkeletonRows } from '../explorer/ui';
import { useAsync } from '../../hooks/useAsync';
import { explorerApi } from '../../api/explorer';
import LabelList from './LabelList';
import Pagination from './Pagination';

export function validCollaborationState(value: string | null): CollaborationState {
  return value === 'closed' || value === 'all' ? value : 'open';
}

export function IssueStatus({ state }: { state: 'open' | 'closed' }) {
  return state === 'open' ? <Badge tone="accent">Open</Badge> : <Badge tone="warning">Closed</Badge>;
}

export default function IssueList({ repo }: { repo: string | null }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = validCollaborationState(searchParams.get('state'));
  const pageValue = Number(searchParams.get('page') ?? '1');
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 && pageValue <= 10_000 ? pageValue : 1;
  const invalidPage = searchParams.has('page') && page !== pageValue;
  const key = invalidPage ? null : `${repo ?? 'organization'}|issues|${state}|${page}`;
  const result = useAsync(key, () => explorerApi.issues(repo, state, page));

  const setState = (next: CollaborationState) => {
    setSearchParams(next === 'open' ? {} : { state: next }, { replace: false });
  };
  const previous = issueListPath(repo ?? undefined, state, Math.max(1, page - 1));
  const next = issueListPath(repo ?? undefined, state, page + 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text">Issues</h2>
          <p className="mt-1 text-xs text-muted">{repo ? 'This public repository' : 'Across public AnkWorks repositories'}</p>
        </div>
        <StateFilter value={state} onChange={setState} label="Filter issues by state" />
      </div>

      {invalidPage ? (
        <ErrorState error={new Error('Invalid page')} title="Invalid page number" />
      ) : result.status === 'loading' || result.status === 'idle' ? (
        <Panel><SkeletonRows rows={7} label="Loading issues" /></Panel>
      ) : result.status === 'error' ? (
        <ErrorState error={result.error} onRetry={result.reload} />
      ) : result.data ? (
        <>
          <Panel aria-label="Issues">
            {result.data.items.length ? (
              <ul className="divide-y divide-border">
                {result.data.items.map((issue) => <IssueRow key={`${issue.repo}-${issue.number}`} issue={issue} showRepo={!repo} />)}
              </ul>
            ) : (
              <EmptyState title={state === 'closed' ? 'No closed issues found.' : state === 'all' ? 'No issues found.' : 'No open issues.'} />
            )}
          </Panel>
          {result.data.total_count !== null && <p className="text-xs text-muted">{formatExactCount(result.data.total_count)} matching public issues</p>}
          <Pagination page={page} hasNext={result.data.has_next} previous={previous} next={next} label="Issue pagination" />
        </>
      ) : null}
    </div>
  );
}


function StateFilter({ value, onChange, label }: { value: CollaborationState; onChange: (value: CollaborationState) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as CollaborationState)} className="rounded-md border border-border bg-elevated px-2.5 py-1.5 text-sm text-text focus-visible:ring-2 focus-visible:ring-primary/60">
        <option value="open">Open</option>
        <option value="closed">Closed</option>
        <option value="all">All</option>
      </select>
    </label>
  );
}

function IssueRow({ issue, showRepo }: { issue: IssueSummary; showRepo: boolean }) {
  const dateLabel = issue.state === 'closed' ? 'Closed' : 'Updated';
  const dateValue = issue.state === 'closed' ? issue.closed_at ?? issue.updated_at : issue.updated_at;
  return (
    <li className="px-4 py-3.5 hover:bg-elevated/50">
      <div className="flex items-start gap-3">
        <IssueIcon size={16} className={`mt-0.5 shrink-0 ${issue.state === 'open' ? 'text-primary' : 'text-muted'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={issuePath(issue.repo, issue.number)} className="break-words font-medium text-text hover:text-primary">
              {issue.title}
            </Link>
            <IssueStatus state={issue.state} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>#{issue.number}</span>
            {showRepo && <><span aria-hidden="true">·</span><Link to={`/repos/${encodeURIComponent(issue.repo)}`} className="font-medium hover:text-text">{issue.repo}</Link></>}
            <span aria-hidden="true">·</span>
            <span>{issue.author?.login ? `@${issue.author.login}` : 'Unknown author'}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={dateValue} title={formatDate(dateValue)}>{dateLabel} {formatRelative(dateValue)}</time>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1" title={`${formatExactCount(issue.comments)} comments`}><CommentIcon size={13} />{formatExactCount(issue.comments)}</span>
            {issue.state_reason && <span className="capitalize">· {issue.state_reason.replace('_', ' ')}</span>}
          </div>
          <div className="mt-2"><LabelList labels={issue.labels} /></div>
        </div>
        {showRepo && <span className="hidden shrink-0 text-xs text-muted lg:inline">{issue.repo}</span>}
      </div>
    </li>
  );
}
