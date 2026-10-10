import { Link, useParams, useSearchParams } from 'react-router-dom';
import RepoShell from '../components/explorer/RepoShell';
import { BranchIcon, TagIcon } from '../components/explorer/icons';
import { Badge, EmptyState, ErrorState, Panel, SkeletonRows } from '../components/explorer/ui';
import Pagination from '../components/collaboration/Pagination';
import { explorerApi } from '../api/explorer';
import { useAsync } from '../hooks/useAsync';
import { refsPath, treePath } from '../shared/routes';
import { parsePositiveInt } from '../shared/validation';
import { shortSha } from '../lib/format';
import type { BranchInfo } from '../types';
import type { TagInfo } from '../types/collaboration';

export default function BranchesPage() {
  const { repo = '' } = useParams();
  return <RepoShell repo={repo} tab="branches">{({ detail }) => <RefsList repo={detail.name} />}</RepoShell>;
}

function RefsList({ repo }: { repo: string }) {
  const [params] = useSearchParams();
  const view = params.get('view') === 'tags' ? 'tags' : 'branches';
  const page = parsePositiveInt(params.get('page'), 1, 10_000);
  const key = page === null ? null : `${repo}|${view}|${page}`;
  const branches = useAsync(view === 'branches' ? key : null, () => explorerApi.branches(repo, page ?? 1));
  const tags = useAsync(view === 'tags' ? key : null, () => explorerApi.tags(repo, page ?? 1));
  const result = view === 'branches' ? branches : tags;
  const data = view === 'branches' ? branches.data : tags.data;
  const hasNext = data?.has_next ?? false;
  const nextPage = (page ?? 1) + 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text">Branches and tags</h2>
          <p className="mt-1 text-xs text-muted">Public Git references for this repository.</p>
        </div>
        <div className="inline-flex rounded-md border border-border bg-surface p-1" aria-label="Reference type">
          <Link to={refsPath(repo, 'branches')} aria-current={view === 'branches' ? 'page' : undefined} className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm ${view === 'branches' ? 'bg-elevated text-text' : 'text-muted hover:text-text'}`}><BranchIcon size={14} /> Branches</Link>
          <Link to={refsPath(repo, 'tags')} aria-current={view === 'tags' ? 'page' : undefined} className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm ${view === 'tags' ? 'bg-elevated text-text' : 'text-muted hover:text-text'}`}><TagIcon size={14} /> Tags</Link>
        </div>
      </div>

      {page === null ? (
        <ErrorState error={new Error('Invalid page')} title="Invalid page number" />
      ) : result.status === 'loading' || result.status === 'idle' ? (
        <Panel><SkeletonRows rows={8} label={`Loading ${view}`} /></Panel>
      ) : result.status === 'error' ? (
        <ErrorState error={result.error} onRetry={result.reload} />
      ) : view === 'branches' ? (
        <>
          <Panel aria-label="Branches">{branches.data?.branches.length ? <ul className="divide-y divide-border">{branches.data.branches.map((branch) => <BranchRow key={branch.name} repo={repo} branch={branch} />)}</ul> : <EmptyState title="No branches found." />}</Panel>
          <Pagination page={page} hasNext={hasNext} previous={refsPath(repo, view, page - 1)} next={refsPath(repo, view, nextPage)} label="Branch pagination" />
        </>
      ) : (
        <>
          <Panel aria-label="Tags">{tags.data?.tags.length ? <ul className="divide-y divide-border">{tags.data.tags.map((tag) => <TagRow key={tag.name} repo={repo} tag={tag} />)}</ul> : <EmptyState title="No tags found." />}</Panel>
          <Pagination page={page} hasNext={hasNext} previous={refsPath(repo, view, page - 1)} next={refsPath(repo, view, nextPage)} label="Tag pagination" />
        </>
      )}
    </div>
  );
}

function BranchRow({ repo, branch }: { repo: string; branch: BranchInfo }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-elevated/50">
      <div className="flex min-w-0 items-center gap-2"><BranchIcon size={15} className="shrink-0 text-muted" /><Link to={treePath(repo, branch.name)} className="break-all font-mono text-sm font-medium text-primary hover:underline">{branch.name}</Link>{branch.protected && <Badge tone="accent">Protected</Badge>}</div>
      <span className="font-mono text-xs text-muted" title={branch.sha}>{shortSha(branch.sha)}</span>
    </li>
  );
}

function TagRow({ repo, tag }: { repo: string; tag: TagInfo }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-elevated/50">
      <div className="flex min-w-0 items-center gap-2"><TagIcon size={15} className="shrink-0 text-muted" /><Link to={treePath(repo, tag.name)} className="break-all font-mono text-sm font-medium text-primary hover:underline">{tag.name}</Link></div>
      <span className="font-mono text-xs text-muted" title={tag.sha}>{shortSha(tag.sha)}</span>
    </li>
  );
}
