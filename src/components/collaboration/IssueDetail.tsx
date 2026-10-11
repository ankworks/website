import { Link, useSearchParams } from 'react-router-dom';
import type { IssueComment, IssueSummary } from '../../types/collaboration';
import { explorerApi } from '../../api/explorer';
import { useAsync } from '../../hooks/useAsync';
import { formatDate, formatRelative } from '../../lib/format';
import { issueListPath } from '../../shared/routes';
import { CommentIcon, IssueIcon } from '../explorer/icons';
import { Badge, EmptyState, ErrorState, ExternalLink, Panel, Skeleton, SkeletonRows } from '../explorer/ui';
import { CommentForm, IssueControls } from './DiscussionActions';
import IssueMarkdown from './IssueMarkdown';
import LabelList from './LabelList';
import Pagination from './Pagination';
import { IssueStatus } from './IssueList';
import ReactionsBar from './ReactionsBar';

export default function IssueDetail({ repo, number }: { repo: string; number: number }) {
  const [searchParams] = useSearchParams();
  const pageValue = Number(searchParams.get('comments_page') ?? '1');
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 && pageValue <= 10_000 ? pageValue : 1;
  const invalidPage = searchParams.has('comments_page') && page !== pageValue;
  const issue = useAsync(`issue|${repo}|${number}`, () => explorerApi.issue(repo, number));
  const comments = useAsync(invalidPage ? null : `issue-comments|${repo}|${number}|${page}`, () => explorerApi.issueComments(repo, number, page));
  const issueItem = issue.data?.issue;
  const previous = detailCommentsPath(repo, number, Math.max(1, page - 1));
  const next = detailCommentsPath(repo, number, page + 1);

  return (
    <div className="space-y-5">
      <Link to={issueListPath(repo)} className="text-sm text-muted hover:text-text">← Back to issues</Link>
      {issue.status === 'loading' || issue.status === 'idle' ? (
        <div aria-busy="true" className="space-y-3"><Skeleton className="h-8 w-3/4" /><Skeleton className="h-4 w-56" /><Skeleton className="h-48 w-full" /></div>
      ) : issue.status === 'error' ? (
        <ErrorState error={issue.error} onRetry={issue.reload} />
      ) : issueItem ? (
        <>
          <IssueHeader issue={issueItem} />
          <IssueControls
            repo={repo}
            number={number}
            state={issueItem.state}
            labels={issueItem.labels.map((label) => label.name)}
            onChanged={() => issue.reload()}
          />
          <Panel aria-label="Issue description" className="p-4 sm:p-6">
            <IssueMarkdown source={issueItem.body ?? ''} label="Issue description" />
            <div className="mt-4 border-t border-border pt-3">
              <ReactionsBar repo={repo} kind="issue" target={String(number)} />
            </div>
          </Panel>
          <section aria-labelledby="issue-comments-heading" className="space-y-3">
            <div className="flex items-center gap-2">
              <CommentIcon size={16} className="text-muted" />
              <h2 id="issue-comments-heading" className="text-base font-semibold text-text">Conversation</h2>
              <Badge>{issueItem.comments} comments</Badge>
            </div>
            {invalidPage ? (
              <ErrorState error={new Error('Invalid comments page')} title="Invalid comments page" />
            ) : comments.status === 'loading' || comments.status === 'idle' ? (
              <Panel><SkeletonRows rows={3} label="Loading issue comments" /></Panel>
            ) : comments.status === 'error' ? (
              <ErrorState error={comments.error} onRetry={comments.reload} />
            ) : comments.data ? (
              <>
                {comments.data.comments.length ? (
                  <ol className="space-y-3" aria-label="Issue comments">
                    {comments.data.comments.map((comment) => <IssueCommentCard key={comment.id} comment={comment} repo={repo} />)}
                  </ol>
                ) : (
                  <Panel><EmptyState title="No comments on this issue." /></Panel>
                )}
                <Pagination page={page} hasNext={comments.data.has_next} previous={previous} next={next} label="Issue comment pagination" />
              </>
            ) : null}
            <CommentForm repo={repo} number={number} onPosted={() => { issue.reload(); comments.reload(); }} />
          </section>
        </>
      ) : null}
    </div>
  );
}

function IssueHeader({ issue }: { issue: IssueSummary }) {
  const updated = issue.closed_at ?? issue.updated_at;
  return (
    <header className="border-b border-border pb-5">
      <div className="flex flex-wrap items-center gap-2">
        <IssueStatus state={issue.state} />
        <span className="font-mono text-sm text-muted">#{issue.number}</span>
      </div>
      <h2 className="mt-3 break-words text-2xl font-semibold tracking-tight text-text">{issue.title}</h2>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <Author author={issue.author?.login ?? null} avatar={issue.author?.avatar_url ?? null} />
        <span>opened {formatRelative(issue.created_at)}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={updated} title={formatDate(updated)}>updated {formatRelative(updated)}</time>
        <ExternalLink href={issue.html_url} className="ml-auto">View on GitHub</ExternalLink>
      </div>
      <div className="mt-3"><LabelList labels={issue.labels} /></div>
    </header>
  );
}

function IssueCommentCard({ comment, repo }: { comment: IssueComment; repo: string }) {
  return (
    <li>
      <Panel className="overflow-hidden">
        <CommentHeader author={comment.author?.login ?? null} avatar={comment.author?.avatar_url ?? null} createdAt={comment.created_at} />
        <div className="p-4"><IssueMarkdown source={comment.body} label="Issue comment" /></div>
        <div className="border-t border-border px-4 py-2">
          <ReactionsBar repo={repo} kind="issue-comment" target={String(comment.id)} />
        </div>
      </Panel>
    </li>
  );
}

export function CommentHeader({ author, avatar, createdAt, updatedAt }: { author: string | null; avatar: string | null; createdAt: string; updatedAt?: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-elevated/60 px-4 py-2.5 text-xs text-muted">
      {avatar ? <img src={avatar} alt="" width={20} height={20} loading="lazy" className="h-5 w-5 rounded-full" /> : <IssueIcon size={15} />}
      <span className="font-medium text-text">{author ? `@${author}` : 'Unknown author'}</span>
      <span>{updatedAt && updatedAt !== createdAt ? 'updated' : 'commented'}</span>
      <time dateTime={createdAt} title={formatDate(createdAt)}>{formatRelative(createdAt)}</time>
    </div>
  );
}

function Author({ author, avatar }: { author: string | null; avatar: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {avatar && <img src={avatar} alt="" width={20} height={20} loading="lazy" className="h-5 w-5 rounded-full" />}
      <span className="font-medium text-text">{author ? `@${author}` : 'Unknown author'}</span>
    </span>
  );
}

function detailCommentsPath(repo: string, number: number, page: number): string {
  return page <= 1 ? `/repos/${encodeURIComponent(repo)}/issues/${number}` : `/repos/${encodeURIComponent(repo)}/issues/${number}?comments_page=${page}`;
}
