import { Link } from 'react-router-dom';
import { getRepositories } from '../api/github';
import { ForkIcon, RepoIcon, StarIcon } from '../components/explorer/icons';
import { Badge, EmptyState, ErrorState, SkeletonRows } from '../components/explorer/ui';
import { useAsync } from '../hooks/useAsync';
import { formatDate, formatExactCount, formatRelative } from '../lib/format';
import { repoPath } from '../shared/routes';
import type { Repository } from '../types';

export default function ExplorePage() {
  const state = useAsync('explore-repositories', () => getRepositories(false));
  const repos = state.data ?? [];
  const popular = repos.slice().sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 5);
  const recentlyUpdated = repos.slice().sort((a, b) => safeTime(b.updated_at) - safeTime(a.updated_at)).slice(0, 5);

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted">AnkWorks organization</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">Explore</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">Discover public projects using repository data from GitHub.</p>
        </div>
        <Link to="/repos" className="btn-secondary-sm"><RepoIcon size={14} /> Browse all repositories</Link>
      </header>
      {state.status === 'loading' || state.status === 'idle' ? (
        <div className="grid gap-8 lg:grid-cols-2" aria-busy="true"><SkeletonRows rows={5} /><SkeletonRows rows={5} /></div>
      ) : state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={state.reload} />
      ) : repos.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface"><EmptyState title="No public repositories yet." /></div>
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-2">
          <section aria-labelledby="popular-heading">
            <h2 id="popular-heading" className="mb-3 text-base font-semibold text-text">Popular</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface" aria-label="Popular repositories">
              {popular.map((repo) => <ExploreRow key={repo.id} repo={repo} metric="stars" />)}
            </ul>
          </section>
          <section aria-labelledby="recent-heading">
            <h2 id="recent-heading" className="mb-3 text-base font-semibold text-text">Recently updated</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface" aria-label="Recently updated repositories">
              {recentlyUpdated.map((repo) => <ExploreRow key={repo.id} repo={repo} metric="updated" />)}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

function safeTime(date: string): number {
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function ExploreRow({ repo, metric }: { repo: Repository; metric: 'stars' | 'updated' }) {
  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3.5 hover:bg-elevated/50">
      <div className="min-w-0">
        <Link to={repoPath(repo.name)} className="break-words font-semibold text-primary hover:underline">ankworks/{repo.name}</Link>
        {repo.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{repo.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
          {repo.language && <span>{repo.language}</span>}
          {repo.archived && <Badge tone="warning">Archived</Badge>}
          {repo.fork && <Badge>Fork</Badge>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
        {metric === 'stars' ? (
          <span className="inline-flex items-center gap-1" title={`${formatExactCount(repo.stargazers_count)} stars`}><StarIcon size={13} />{formatExactCount(repo.stargazers_count)}</span>
        ) : (
          <time dateTime={repo.updated_at} title={formatDate(repo.updated_at)}>{formatRelative(repo.updated_at)}</time>
        )}
        <span className="hidden items-center gap-1 sm:inline-flex" title={`${formatExactCount(repo.forks_count)} forks`}><ForkIcon size={13} />{formatExactCount(repo.forks_count)}</span>
      </div>
    </li>
  );
}
