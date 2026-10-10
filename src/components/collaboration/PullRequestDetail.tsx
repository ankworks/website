import { Link, useSearchParams } from 'react-router-dom';
import type { IssueComment, IssueCommentsResponse, PullRequestCommitsResponse, PullRequestDetail as PullRequest, PullRequestFile, PullRequestFilesResponse, PullRequestReviewComment, PullRequestReviewCommentsResponse } from '../../types/collaboration';
import { explorerApi } from '../../api/explorer';
import { useAsync, type AsyncState } from '../../hooks/useAsync';
import { formatDate, formatExactCount, formatRelative, shortSha } from '../../lib/format';
import { pullRequestListPath, pullRequestPath } from '../../shared/routes';
import { CommentIcon, CommitIcon, FileIcon, PullRequestIcon } from '../explorer/icons';
import { EmptyState, ErrorState, ExternalLink, Panel, Skeleton, SkeletonRows } from '../explorer/ui';
import { CommentForm, PullRequestControls } from './DiscussionActions';
import IssueMarkdown from './IssueMarkdown';
import LabelList from './LabelList';
import Pagination from './Pagination';
import { CommentHeader } from './IssueDetail';
import { PullRequestStatus } from './PullRequestList';

const PAGE_KEYS = ['files_page', 'commits_page', 'comments_page', 'review_page'] as const;
type PageKey = (typeof PAGE_KEYS)[number];

function pageFor(params: URLSearchParams, key: PageKey): { page: number; invalid: boolean } {
  const raw = params.get(key);
  const value = Number(raw ?? '1');
  const page = Number.isSafeInteger(value) && value > 0 && value <= 10_000 ? value : 1;
  return { page, invalid: raw !== null && page !== value };
}

function pagePath(repo: string, number: number, params: URLSearchParams, key: PageKey, page: number): string {
  const next = new URLSearchParams(params);
  if (page <= 1) next.delete(key);
  else next.set(key, String(page));
  const query = next.toString();
  return `${pullRequestPath(repo, number)}${query ? `?${query}` : ''}`;
}

export default function PullRequestDetail({ repo, number }: { repo: string; number: number }) {
  const [searchParams] = useSearchParams();
  const filesPage = pageFor(searchParams, 'files_page');
  const commitsPage = pageFor(searchParams, 'commits_page');
  const commentsPage = pageFor(searchParams, 'comments_page');
  const reviewPage = pageFor(searchParams, 'review_page');

  const pull = useAsync(`pull|${repo}|${number}`, () => explorerApi.pullRequest(repo, number));
  const files = useAsync(filesPage.invalid ? null : `pull-files|${repo}|${number}|${filesPage.page}`, () => explorerApi.pullRequestFiles(repo, number, filesPage.page));
  const commits = useAsync(commitsPage.invalid ? null : `pull-commits|${repo}|${number}|${commitsPage.page}`, () => explorerApi.pullRequestCommits(repo, number, commitsPage.page));
  const comments = useAsync(commentsPage.invalid ? null : `pull-comments|${repo}|${number}|${commentsPage.page}`, () => explorerApi.pullRequestComments(repo, number, commentsPage.page));
  const reviews = useAsync(reviewPage.invalid ? null : `pull-review-comments|${repo}|${number}|${reviewPage.page}`, () => explorerApi.pullRequestReviewComments(repo, number, reviewPage.page));
  const detail = pull.data?.pull;

  return (
    <div className="space-y-6">
      <Link to={pullRequestListPath(repo)} className="text-sm text-muted hover:text-text">← Back to pull requests</Link>
      {pull.status === 'loading' || pull.status === 'idle' ? (
        <div aria-busy="true" className="space-y-3"><Skeleton className="h-8 w-3/4" /><Skeleton className="h-4 w-60" /><Skeleton className="h-48 w-full" /></div>
      ) : pull.status === 'error' ? (
        <ErrorState error={pull.error} onRetry={pull.reload} />
      ) : detail ? (
        <>
          <PullRequestHeader pull={detail} />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
            <div className="space-y-6">
              <Panel aria-label="Pull request description" className="p-4 sm:p-6">
                <IssueMarkdown source={detail.body ?? ''} label="Pull request description" />
              </Panel>
              <PullFilesSection repo={repo} number={number} result={files} page={filesPage.page} invalid={filesPage.invalid} params={searchParams} />
              <PullCommitsSection result={commits} page={commitsPage.page} invalid={commitsPage.invalid} repo={repo} number={number} params={searchParams} />
              <PullCommentsSection result={comments} page={commentsPage.page} invalid={commentsPage.invalid} repo={repo} number={number} params={searchParams} />
              <ReviewCommentsSection result={reviews} page={reviewPage.page} invalid={reviewPage.invalid} repo={repo} number={number} params={searchParams} />
              <CommentForm
                repo={repo}
                number={number}
                label="Add a comment to the conversation"
                onPosted={() => {
                  pull.reload();
                  comments.reload();
                }}
              />
            </div>
            <aside className="space-y-4">
              <Panel aria-label="Pull request status" className="p-4">
                <h2 className="text-sm font-semibold text-text">Status</h2>
                <div className="mt-3 flex flex-wrap items-center gap-2"><PullRequestStatus pull={detail} /></div>
                <dl className="mt-4 space-y-2 border-t border-border pt-4 text-xs">
                  <Fact label="Base branch" value={detail.base_ref} />
                  <Fact label="Head branch" value={detail.head_ref} />
                  <Fact label="Commits" value={formatExactCount(detail.commits_count)} />
                  <Fact label="Changed files" value={formatExactCount(detail.changed_files)} />
                  <Fact label="Additions" value={`+${formatExactCount(detail.additions)}`} />
                  <Fact label="Deletions" value={`−${formatExactCount(detail.deletions)}`} />
                </dl>
              </Panel>
              <Panel aria-label="Pull request labels" className="p-4">
                <h2 className="text-sm font-semibold text-text">Labels</h2>
                <div className="mt-3"><LabelList labels={detail.labels} /></div>
                {detail.labels.length === 0 && <p className="mt-2 text-xs text-muted">No labels</p>}
              </Panel>
              <PullRequestControls
                repo={repo}
                number={number}
                state={detail.state}
                onChanged={() => pull.reload()}
              />
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}

function PullRequestHeader({ pull }: { pull: PullRequest }) {
  const changedAt = pull.closed_at ?? pull.updated_at;
  return (
    <header className="border-b border-border pb-5">
      <div className="flex flex-wrap items-center gap-2">
        <PullRequestIcon size={17} className="text-muted" />
        <PullRequestStatus pull={pull} />
        <span className="font-mono text-sm text-muted">#{pull.number}</span>
      </div>
      <h2 className="mt-3 break-words text-2xl font-semibold tracking-tight text-text">{pull.title}</h2>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        {pull.author?.avatar_url && <img src={pull.author.avatar_url} alt="" width={20} height={20} loading="lazy" className="h-5 w-5 rounded-full" />}
        <span className="font-medium text-text">{pull.author?.login ? `@${pull.author.login}` : 'Unknown author'}</span>
        <span>opened {formatRelative(pull.created_at)}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={changedAt} title={formatDate(changedAt)}>updated {formatRelative(changedAt)}</time>
        <ExternalLink href={pull.html_url} className="ml-auto">View on GitHub</ExternalLink>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span className="rounded-md border border-border bg-surface px-2 py-1"><code className="font-mono text-text">{pull.base_ref ?? 'unknown'}</code> ← <code className="font-mono text-text">{pull.head_ref ?? 'unknown'}</code></span>
        {pull.merged_at && <time dateTime={pull.merged_at} title={formatDate(pull.merged_at)}>Merged {formatRelative(pull.merged_at)}</time>}
      </div>
      <div className="mt-3"><LabelList labels={pull.labels} /></div>
    </header>
  );
}

function PullFilesSection({
  repo,
  number,
  result,
  page,
  invalid,
  params,
}: {
  repo: string;
  number: number;
  result: AsyncState<PullRequestFilesResponse>;
  page: number;
  invalid: boolean;
  params: URLSearchParams;
}) {
  return (
    <section aria-labelledby="pull-files-heading" className="space-y-3">
      <SectionTitle id="pull-files-heading" icon={<FileIcon size={15} />} title="Changed files" />
      {invalid ? <ErrorState error={new Error('Invalid files page')} title="Invalid files page" /> : result.status === 'loading' || result.status === 'idle' ? (
        <Panel><SkeletonRows rows={4} label="Loading changed files" /></Panel>
      ) : result.status === 'error' ? <ErrorState error={result.error} onRetry={result.reload} /> : result.data ? (
        <>
          {result.data.files.length ? <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface" aria-label="Changed files">{result.data.files.map((file) => <FileRow key={`${file.filename}-${file.status}`} file={file} />)}</ul> : <Panel><EmptyState title="No changed files returned." /></Panel>}
          <Pagination page={page} hasNext={result.data.has_next} previous={pagePath(repo, number, params, 'files_page', page - 1)} next={pagePath(repo, number, params, 'files_page', page + 1)} label="Changed file pagination" />
        </>
      ) : null}
    </section>
  );
}

function FileRow({ file }: { file: PullRequestFile }) {
  return (
    <li className="px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex min-w-0 items-center gap-2"><FileIcon size={14} className="shrink-0 text-muted" /><code className="break-all font-mono text-text">{file.filename}</code>{file.previous_filename && <span className="text-xs text-muted">from {file.previous_filename}</span>}</div>
        <span className="text-xs text-muted"><span className="text-primary">+{file.additions}</span> <span className="text-red-400">−{file.deletions}</span> <span className="ml-1 rounded border border-border px-1.5 py-0.5">{file.status}</span></span>
      </div>
      <details className="mt-2 rounded-md border border-border bg-background">
        <summary className="cursor-pointer px-3 py-2 text-xs text-muted hover:text-text">View diff</summary>
        <pre className="max-h-96 overflow-auto border-t border-border p-3 text-xs leading-5 text-muted">{file.patch ?? 'Diff is unavailable for this file.'}</pre>
      </details>
    </li>
  );
}

function PullCommitsSection({ result, page, invalid, repo, number, params }: { result: AsyncState<PullRequestCommitsResponse>; page: number; invalid: boolean; repo: string; number: number; params: URLSearchParams }) {
  return (
    <section aria-labelledby="pull-commits-heading" className="space-y-3">
      <SectionTitle id="pull-commits-heading" icon={<CommitIcon size={15} />} title="Commits" />
      {invalid ? <ErrorState error={new Error('Invalid commits page')} title="Invalid commits page" /> : result.status === 'loading' || result.status === 'idle' ? <Panel><SkeletonRows rows={3} label="Loading pull request commits" /></Panel> : result.status === 'error' ? <ErrorState error={result.error} onRetry={result.reload} /> : result.data ? (
        <>
          <Panel aria-label="Pull request commits"><ol className="divide-y divide-border">{result.data.commits.length ? result.data.commits.map((commit) => <li key={commit.sha} className="flex items-start justify-between gap-4 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-text">{commit.title || '(no message)'}</p><p className="mt-1 text-xs text-muted">{commit.author_name} · {formatRelative(commit.date)}</p></div><ExternalLink href={commit.html_url} className="shrink-0 font-mono text-xs">{shortSha(commit.sha)}</ExternalLink></li>) : <li><EmptyState title="No commits returned." /></li>}</ol></Panel>
          <Pagination page={page} hasNext={result.data.has_next} previous={pagePath(repo, number, params, 'commits_page', page - 1)} next={pagePath(repo, number, params, 'commits_page', page + 1)} label="Commit pagination" />
        </>
      ) : null}
    </section>
  );
}

function PullCommentsSection({ result, page, invalid, repo, number, params }: { result: AsyncState<IssueCommentsResponse>; page: number; invalid: boolean; repo: string; number: number; params: URLSearchParams }) {
  return (
    <section aria-labelledby="pull-comments-heading" className="space-y-3">
      <SectionTitle id="pull-comments-heading" icon={<CommentIcon size={15} />} title="Conversation" />
      {invalid ? <ErrorState error={new Error('Invalid comments page')} title="Invalid comments page" /> : result.status === 'loading' || result.status === 'idle' ? <Panel><SkeletonRows rows={3} label="Loading pull request comments" /></Panel> : result.status === 'error' ? <ErrorState error={result.error} onRetry={result.reload} /> : result.data ? (
        <>
          {result.data.comments.length ? <ol className="space-y-3" aria-label="Pull request conversation comments">{result.data.comments.map((comment) => <CommentCard key={comment.id} comment={comment} />)}</ol> : <Panel><EmptyState title="No conversation comments." /></Panel>}
          <Pagination page={page} hasNext={result.data.has_next} previous={pagePath(repo, number, params, 'comments_page', page - 1)} next={pagePath(repo, number, params, 'comments_page', page + 1)} label="Pull request comment pagination" />
        </>
      ) : null}
    </section>
  );
}

function ReviewCommentsSection({ result, page, invalid, repo, number, params }: { result: AsyncState<PullRequestReviewCommentsResponse>; page: number; invalid: boolean; repo: string; number: number; params: URLSearchParams }) {
  return (
    <section aria-labelledby="review-comments-heading" className="space-y-3">
      <SectionTitle id="review-comments-heading" icon={<CommentIcon size={15} />} title="Review comments" />
      {invalid ? <ErrorState error={new Error('Invalid review comments page')} title="Invalid review comments page" /> : result.status === 'loading' || result.status === 'idle' ? <Panel><SkeletonRows rows={2} label="Loading review comments" /></Panel> : result.status === 'error' ? <ErrorState error={result.error} onRetry={result.reload} /> : result.data ? (
        <>
          {result.data.comments.length ? <ol className="space-y-3" aria-label="Pull request review comments">{result.data.comments.map((comment) => <ReviewCommentCard key={comment.id} comment={comment} />)}</ol> : <Panel><EmptyState title="No review comments." /></Panel>}
          <Pagination page={page} hasNext={result.data.has_next} previous={pagePath(repo, number, params, 'review_page', page - 1)} next={pagePath(repo, number, params, 'review_page', page + 1)} label="Review comment pagination" />
        </>
      ) : null}
    </section>
  );
}

function CommentCard({ comment }: { comment: IssueComment }) {
  return (
    <li>
      <Panel><CommentHeader author={comment.author?.login ?? null} avatar={comment.author?.avatar_url ?? null} createdAt={comment.created_at} updatedAt={comment.updated_at} /><div className="p-4"><IssueMarkdown source={comment.body} label="Pull request comment" /></div></Panel>
    </li>
  );
}

function ReviewCommentCard({ comment }: { comment: PullRequestReviewComment }) {
  return (
    <li>
      <Panel>
        <CommentHeader author={comment.author?.login ?? null} avatar={comment.author?.avatar_url ?? null} createdAt={comment.created_at} updatedAt={comment.updated_at} />
        {comment.path && <p className="border-b border-border px-4 py-2 text-xs text-muted"><code className="font-mono text-text">{comment.path}</code></p>}
        <div className="p-4"><IssueMarkdown source={comment.body} label="Pull request review comment" /></div>
      </Panel>
    </li>
  );
}

function SectionTitle({ id, icon, title }: { id: string; icon: React.ReactNode; title: string }) {
  return <h3 id={id} className="flex items-center gap-2 text-sm font-semibold text-text">{icon}{title}</h3>;
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-muted">{label}</dt><dd className="truncate font-mono text-text" title={value ?? undefined}>{value ?? '—'}</dd></div>;
}

