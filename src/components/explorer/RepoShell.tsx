/**
 * Shared shell for every repository page (V3-A).
 *
 * Layout: a ~75% main column and a ~25% sidebar on large screens, a single
 * adaptive column on tablets, and a stacked column on phones. The sidebar is
 * rendered by `RepoSidebar` and holds the real insight data (About, Releases,
 * Contributors, Languages, recent activity).
 *
 * No GitHub branding or proprietary visual assets are used: the AnkWorks icon
 * set, Tailwind theme tokens, and typography carry the design.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync';
import { explorerApi } from '../../api/explorer';
import { isValidRepoName } from '../../shared/validation';
import {
  actionsPath,
  branchesPath,
  commitsPath,
  discussionsPath,
  issueListPath,
  pullRequestListPath,
  releaseListPath,
  repoPath,
  treePath,
  wikiPath,
} from '../../shared/routes';
import type { RepositoryDetail } from '../../types';
import { formatDate, formatRelative } from '../../lib/format';
import { Badge, ErrorState, ExternalLink, Skeleton } from './ui';
import {
  ActivityIcon,
  BranchIcon,
  ChevronDownIcon,
  CodeIcon,
  CommentIcon,
  FileIcon,
  HistoryIcon,
  IssueIcon,
  PlusIcon,
  PullRequestIcon,
  SearchIcon,
  TagIcon,
} from './icons';
import RepoSidebar from './RepoSidebar';
import FileSearchDialog from './FileSearchDialog';

export interface RepoContext {
  detail: RepositoryDetail;
  /** Default branch, or "HEAD" when GitHub did not report one. */
  defaultRef: string;
}

export type RepoTab =
  | 'code'
  | 'issues'
  | 'pulls'
  | 'commits'
  | 'branches'
  | 'releases'
  | 'actions'
  | 'discussions'
  | 'wiki';

interface RepoShellProps {
  repo: string;
  tab: RepoTab;
  /** Ref in the URL, when the page is ref-specific. */
  gitRef?: string;
  /** Show the insight sidebar (default true). Detail pages can turn it off. */
  sidebar?: boolean;
  children: (context: RepoContext) => ReactNode;
}

export default function RepoShell({ repo, tab, gitRef, sidebar = true, children }: RepoShellProps) {
  const valid = isValidRepoName(repo);
  const state = useAsync(valid ? repo : null, (name) => explorerApi.repository(name));

  if (!valid) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <ErrorState error={new Error('Invalid repository name.')} title="Invalid repository name" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <ErrorState error={state.error} onRetry={state.reload} />
      </div>
    );
  }

  if (state.status !== 'success' || !state.data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6" aria-busy="true">
        <Skeleton className="mb-3 h-6 w-64" />
        <Skeleton className="mb-6 h-4 w-96 max-w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const detail = state.data.repo;
  const defaultRef = detail.default_branch || 'HEAD';
  const currentRef = gitRef ?? defaultRef;
  const codeHref = gitRef ? treePath(detail.name, gitRef) : repoPath(detail.name);

  return (
    <div className="mx-auto max-w-[100rem] px-4 sm:px-6">
      <header className="border-b border-border pt-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <CodeIcon size={18} className="shrink-0 text-muted" />
          <h1 className="min-w-0 break-words text-lg font-semibold text-text">
            <span className="font-normal text-muted">ankworks / </span>
            <Link to={repoPath(detail.name)} className="hover:text-primary">
              {detail.name}
            </Link>
          </h1>
          <Badge>Public</Badge>
          {detail.archived && <Badge tone="warning">Archived</Badge>}
          {detail.fork && <Badge>Fork</Badge>}
        </div>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="max-w-3xl text-sm text-muted">{detail.description ?? 'No description provided.'}</p>
            <p className="mt-1 text-xs text-muted" title={formatDate(detail.updated_at)}>
              Updated {formatRelative(detail.updated_at)}
              {detail.default_branch && (
                <>
                  {' · Default branch '}
                  <span className="font-mono text-text">{detail.default_branch}</span>
                </>
              )}
            </p>
          </div>
          <RepositoryActions repo={detail.name} gitRef={currentRef} />
        </div>

        <nav aria-label="Repository sections" className="-mb-px mt-4 flex max-w-full gap-1 overflow-x-auto whitespace-nowrap">
          <TabLink to={codeHref} active={tab === 'code'} icon={<CodeIcon size={15} />} label="Code" />
          <TabLink to={issueListPath(detail.name)} active={tab === 'issues'} icon={<IssueIcon size={15} />} label="Issues" />
          <TabLink
            to={pullRequestListPath(detail.name)}
            active={tab === 'pulls'}
            icon={<PullRequestIcon size={15} />}
            label="Pull Requests"
          />
          <TabLink to={commitsPath(detail.name, currentRef)} active={tab === 'commits'} icon={<HistoryIcon size={15} />} label="Commits" />
          <TabLink to={branchesPath(detail.name)} active={tab === 'branches'} icon={<BranchIcon size={15} />} label="Branches" />
          <TabLink to={releaseListPath(detail.name)} active={tab === 'releases'} icon={<TagIcon size={15} />} label="Releases" />
          <TabLink to={actionsPath(detail.name)} active={tab === 'actions'} icon={<ActivityIcon size={15} />} label="Actions" />
          {detail.has_discussions ? (
            <TabLink
              to={discussionsPath(detail.name)}
              active={tab === 'discussions'}
              icon={<CommentIcon size={15} />}
              label="Discussions"
            />
          ) : (
            <span
              aria-disabled="true"
              title="This repository has not enabled GitHub Discussions."
              className="-mb-px flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm text-muted/50"
            >
              <CommentIcon size={15} /> Discussions
            </span>
          )}
          {detail.has_wiki ? (
            <TabLink to={wikiPath(detail.name)} active={tab === 'wiki'} icon={<FileIcon size={15} />} label="Wiki" />
          ) : (
            <span
              aria-disabled="true"
              title="This repository has not enabled a GitHub Wiki."
              className="-mb-px flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm text-muted/50"
            >
              <FileIcon size={15} /> Wiki
            </span>
          )}
        </nav>
      </header>

      {/* 75 / 25 on desktop → single column on tablet and mobile. */}
      <div
        data-repo-columns=""
        className="grid grid-cols-1 gap-6 py-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]"
      >
        <main data-repo-main="" className="min-w-0">
          {children({ detail, defaultRef })}
        </main>
        {sidebar && (
          <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
            <RepoSidebar detail={detail} />
          </div>
        )}
      </div>
    </div>
  );
}

function TabLink({ to, active, icon, label }: { to: string; active: boolean; icon: ReactNode; label: string }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors ${
        active ? 'border-primary text-text' : 'border-transparent text-muted hover:border-border hover:text-text'
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

/**
 * Code dropdown, "Go to file", and "Add file".
 *
 * "Add file" is a real shortcut into the authenticated create-file workspace;
 * the Worker re-verifies sign-in, membership, and push access before writing.
 */
function RepositoryActions({ repo, gitRef }: { repo: string; gitRef: string }) {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const cloneUrl = `https://github.com/ankworks/${encodeURIComponent(repo)}.git`;
  const archiveUrl = `https://github.com/ankworks/${encodeURIComponent(repo)}/archive/refs/heads/${encodeURIComponent(gitRef)}.zip`;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <button type="button" onClick={() => setSearchOpen(true)} className="btn-secondary-sm">
        <SearchIcon size={14} /> Go to file
      </button>

      <div className="relative" ref={containerRef}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="menu"
          className="btn-primary-sm"
        >
          <CodeIcon size={14} /> Code <ChevronDownIcon size={13} />
        </button>
        {open && (
          <div
            role="menu"
            aria-label="Code actions"
            className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-border bg-surface p-2 shadow-xl"
          >
            <p className="px-2 pb-1.5 pt-1 text-xs font-medium text-muted">Clone</p>
            <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <input
                readOnly
                value={cloneUrl}
                aria-label="HTTPS clone URL"
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded border border-border bg-elevated px-2 py-1 font-mono text-xs text-text"
              />
            </div>
            <div className="mt-2 space-y-1 border-t border-border pt-2">
              <a
                role="menuitem"
                href={archiveUrl}
                className="block rounded-md px-2 py-1.5 text-sm text-text hover:bg-elevated"
              >
                Download ZIP
              </a>
              <ExternalLink
                href={`https://github.com/ankworks/${encodeURIComponent(repo)}`}
                className="block rounded-md px-2 py-1.5 text-sm hover:bg-elevated"
              >
                Open on GitHub
              </ExternalLink>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => navigate(`/repos/${encodeURIComponent(repo)}/new/${encodeURIComponent(gitRef)}`)}
        className="btn-secondary-sm"
      >
        <PlusIcon size={14} /> Add file
      </button>

      {searchOpen && <FileSearchDialog repo={repo} gitRef={gitRef} onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
