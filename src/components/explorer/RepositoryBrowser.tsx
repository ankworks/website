import { Suspense, lazy, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { explorerApi } from '../../api/explorer';
import { useAsync } from '../../hooks/useAsync';
import { formatBytes, formatDate, formatRelative, shortSha } from '../../lib/format';
import { blobPath, githubRepoLink, parentPath, treePath } from '../../shared/routes';
import { EXPLORER_LIMITS } from '../../shared/limits';
import type { DirectoryEntry } from '../../types';
import Breadcrumbs from './Breadcrumbs';
import BranchSelector from './BranchSelector';
import { FileIcon, FolderIcon, SubmoduleIcon, SymlinkIcon } from './icons';
import { ErrorState, ExternalLink, Notice, Panel, Skeleton, SkeletonRows, EmptyState } from './ui';

const RepoDocs = lazy(() => import('./RepoDocs'));

interface RepositoryBrowserProps {
  repo: string;
  gitRef: string;
  path: string;
  showReadme: boolean;
}

/** Directory explorer: breadcrumbs, branch switcher, last commit, listing, and README. */
export default function RepositoryBrowser({ repo, gitRef, path, showReadme }: RepositoryBrowserProps) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <Breadcrumbs repo={repo} gitRef={gitRef} path={path} />
        <BranchSelector repo={repo} gitRef={gitRef} mode="tree" path={path} />
      </div>

      <LastCommitBar repo={repo} gitRef={gitRef} path={path} />
      <DirectoryListing repo={repo} gitRef={gitRef} path={path} />
      {showReadme && (
        <Suspense fallback={<Skeleton className="h-48 w-full" />}>
          <RepoDocs repo={repo} gitRef={gitRef} />
        </Suspense>
      )}
    </div>
  );
}

function LastCommitBar({ repo, gitRef, path }: { repo: string; gitRef: string; path: string }) {
  const state = useAsync(`last|${repo}|${gitRef}|${path}`, () => explorerApi.lastCommit(repo, gitRef, path));

  if (state.status === 'loading' || state.status === 'idle') {
    return <Skeleton className="h-9 w-full" />;
  }
  if (state.status === 'error' || !state.data?.commit) {
    return null;
  }

  const commit = state.data.commit;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface px-4 py-2.5 text-sm">
      <span className="font-medium text-text">{commit.author_name}</span>
      <span className="min-w-0 truncate text-muted" title={commit.title}>
        {commit.title}
      </span>
      <span className="ml-auto flex items-center gap-3 text-xs text-muted">
        <ExternalLink href={commit.html_url} className="font-mono">
          {shortSha(commit.sha)}
        </ExternalLink>
        <span title={formatDate(commit.date)}>{formatRelative(commit.date)}</span>
      </span>
    </div>
  );
}

function entryHref(entry: DirectoryEntry, repo: string, gitRef: string): { to: string; external: boolean } {
  if (entry.type === 'dir') return { to: treePath(repo, gitRef, entry.path), external: false };
  if (entry.type === 'submodule') return { to: entry.html_url, external: true };
  return { to: blobPath(repo, gitRef, entry.path), external: false };
}

function EntryIcon({ type }: { type: DirectoryEntry['type'] }) {
  switch (type) {
    case 'dir':
      return <FolderIcon className="shrink-0 text-primary/80" />;
    case 'symlink':
      return <SymlinkIcon className="shrink-0 text-muted" />;
    case 'submodule':
      return <SubmoduleIcon className="shrink-0 text-muted" />;
    default:
      return <FileIcon className="shrink-0 text-muted" />;
  }
}

function DirectoryListing({ repo, gitRef, path }: { repo: string; gitRef: string; path: string }) {
  const state = useAsync(`tree|${repo}|${gitRef}|${path}`, () => explorerApi.tree(repo, gitRef, path));

  let body: ReactNode;
  if (state.status === 'loading' || state.status === 'idle') {
    body = <SkeletonRows rows={8} label="Loading directory" />;
  } else if (state.status === 'error') {
    body = (
      <div className="p-4">
        <ErrorState error={state.error} onRetry={state.reload} compact />
      </div>
    );
  } else if (!state.data || state.data.entries.length === 0) {
    body = <EmptyState title="This directory is empty." />;
  } else {
    const data = state.data;
    body = (
      <>
        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">Files and directories in {path || repo}</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Size</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry) => {
              const link = entryHref(entry, repo, gitRef);
              return (
                <tr key={entry.path} className="group border-t border-border/70 first:border-t-0 hover:bg-elevated/60">
                  <td className="min-w-0 py-2 pl-4 pr-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <EntryIcon type={entry.type} />
                      {link.external ? (
                        <ExternalLink href={link.to} className="min-w-0 truncate text-text hover:text-primary">
                          {entry.name}
                        </ExternalLink>
                      ) : (
                        <Link to={link.to} className="min-w-0 truncate text-text hover:text-primary">
                          {entry.name}
                        </Link>
                      )}
                    </div>
                  </td>
                  <td className="w-28 py-2 pr-4 text-right font-mono text-xs text-muted sm:w-36">
                    {entry.type === 'file' ? formatBytes(entry.size) : entry.type === 'dir' ? '' : entry.type}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.truncated && (
          <div className="border-t border-border p-3">
            <Notice title="Listing may be incomplete">
              GitHub returns at most {EXPLORER_LIMITS.CONTENTS_LISTING_MAX} entries per directory.{' '}
              <ExternalLink href={githubRepoLink(repo, 'tree', gitRef, path)}>
                View all files on GitHub
              </ExternalLink>
            </Notice>
          </div>
        )}
      </>
    );
  }

  return (
    <Panel aria-label={path ? `Contents of ${path}` : 'Repository contents'}>
      {path !== '' && state.status === 'success' && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-elevated/40 px-4 py-2 text-xs text-muted">
          <span className="truncate">
            Parent:{' '}
            <Link to={treePath(repo, gitRef, parentPath(path))} className="text-primary/90 hover:text-primary">
              {parentPath(path) || repo}
            </Link>
          </span>
          {state.data && <span>{state.data.entries.length} items</span>}
        </div>
      )}
      {body}
    </Panel>
  );
}
