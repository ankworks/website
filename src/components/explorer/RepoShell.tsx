import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync';
import { explorerApi } from '../../api/explorer';
import { isValidRepoName } from '../../shared/validation';
import { commitsPath, repoPath, treePath } from '../../shared/routes';
import type { RepositoryDetail } from '../../types';
import { formatDate, formatExactCount, formatRelative } from '../../lib/format';
import { Badge, ErrorState, ExternalLink, Skeleton } from './ui';
import { CodeIcon, ForkIcon, HistoryIcon, RepoIcon, StarIcon } from './icons';

export interface RepoContext {
  detail: RepositoryDetail;
  /** Default branch, or "HEAD" when GitHub did not report one. */
  defaultRef: string;
}

interface RepoShellProps {
  repo: string;
  tab: 'code' | 'commits';
  /** Ref in the URL, when the page is ref-specific. */
  gitRef?: string;
  children: (context: RepoContext) => ReactNode;
}

/** Shared header for every repository page: metadata and the Code / Commits tabs. */
export default function RepoShell({ repo, tab, gitRef, children }: RepoShellProps) {
  const valid = isValidRepoName(repo);
  const state = useAsync(valid ? repo : null, (name) => explorerApi.repository(name));

  if (!valid) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <ErrorState error={new Error('Invalid repository name.')} title="Invalid repository name" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <ErrorState error={state.error} onRetry={state.reload} />
      </div>
    );
  }

  if (state.status !== 'success' || !state.data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6" aria-busy="true">
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
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <header className="border-b border-border pt-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <RepoIcon size={18} className="shrink-0 text-muted" />
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

        {detail.description && <p className="mt-2 max-w-3xl text-sm text-muted">{detail.description}</p>}

        <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
          {detail.language && (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Language</dt>
              <dd className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-primary/80" />
                {detail.language}
              </dd>
            </div>
          )}
          <div className="flex items-center gap-1">
            <dt className="sr-only">Stars</dt>
            <dd className="flex items-center gap-1" title={`${formatExactCount(detail.stargazers_count)} stars`}>
              <StarIcon size={13} /> {formatExactCount(detail.stargazers_count)}
            </dd>
          </div>
          <div className="flex items-center gap-1">
            <dt className="sr-only">Forks</dt>
            <dd className="flex items-center gap-1" title={`${formatExactCount(detail.forks_count)} forks`}>
              <ForkIcon size={13} /> {formatExactCount(detail.forks_count)}
            </dd>
          </div>
          {detail.license && <div>License: {detail.license}</div>}
          <div>
            Default branch: <span className="font-mono text-text">{detail.default_branch || '—'}</span>
          </div>
          <div title={formatDate(detail.updated_at)}>Updated {formatRelative(detail.updated_at)}</div>
          <div>
            <ExternalLink href={detail.html_url}>View on GitHub</ExternalLink>
          </div>
        </dl>

        <nav aria-label="Repository sections" className="-mb-px mt-4 flex gap-1">
          <TabLink to={codeHref} active={tab === 'code'} icon={<CodeIcon size={15} />} label="Code" />
          <TabLink
            to={commitsPath(detail.name, currentRef)}
            active={tab === 'commits'}
            icon={<HistoryIcon size={15} />}
            label="Commits"
          />
        </nav>
      </header>

      <div className="py-6">{children({ detail, defaultRef })}</div>
    </div>
  );
}

function TabLink({ to, active, icon, label }: { to: string; active: boolean; icon: ReactNode; label: string }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors ${
        active ? 'border-primary text-text' : 'border-transparent text-muted hover:text-text'
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

