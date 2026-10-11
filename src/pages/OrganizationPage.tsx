import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { explorerApi } from '../api/explorer';
import { featuredApi } from '../api/featured';
import { getRepositories } from '../api/github';
import ActivityFeed from '../components/ActivityFeed';
import { ForkIcon, RepoIcon, StarIcon } from '../components/explorer/icons';
import { Badge, EmptyState, ErrorState, ExternalLink, Notice, Skeleton, SkeletonRows } from '../components/explorer/ui';
import { useAsync } from '../hooks/useAsync';
import { formatDate, formatExactCount, formatRelative } from '../lib/format';
import { repoPath } from '../shared/routes';
import type { Repository } from '../types';

const Markdown = lazy(() => import('../components/explorer/Markdown'));

/** "/" — organization dashboard backed by live public GitHub data. */
export default function OrganizationPage() {
  const org = useAsync('org', () => explorerApi.organization());
  const repos = useAsync('repos', () => getRepositories(false));
  const pins = useAsync('featured', () => featuredApi.list());
  const profile = org.data?.org;
  const repositoryList = repos.data ?? [];

  // Featured order: admin pins first (in their configured order), then the rest
  // by stars. With no pins — or with pinning unconfigured — the dashboard falls
  // back to the star ordering exactly as it did before V3.
  const featured = useFeaturedOrder(repositoryList, pins.data?.items ?? []);

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:py-10">
      <section aria-labelledby="org-heading" className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-start">
        <img
          src="/branding/ankworks-logo.webp"
          alt="AnkWorks organization logo"
          width={72}
          height={72}
          className="h-[72px] w-[72px] shrink-0 rounded-lg border border-border bg-elevated object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Organization</p>
            <Badge>Public</Badge>
          </div>
          <h1 id="org-heading" className="mt-1 text-2xl font-semibold tracking-tight text-text sm:text-3xl">
            {profile?.name || 'AnkWorks'}
          </h1>
          <p className="mt-0.5 font-mono text-sm text-muted">@ankworks</p>
          {profile?.description ? (
            <p className="mt-3 max-w-3xl text-sm leading-6 text-text/90">{profile.description}</p>
          ) : org.status === 'loading' || org.status === 'idle' ? (
            <Skeleton className="mt-3 h-4 w-80 max-w-full" />
          ) : org.status === 'error' ? (
            <Notice title="Organization profile unavailable">Repository information is shown when it can be loaded.</Notice>
          ) : (
            <p className="mt-3 text-sm text-muted">The organization has not published a description on GitHub.</p>
          )}
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
            {profile?.location && <li>{profile.location}</li>}
            {profile?.created_at && <li>On GitHub since {formatDate(profile.created_at)}</li>}
            {profile?.blog && <li><ExternalLink href={profile.blog}>{profile.blog.replace(/^https:\/\//, '')}</ExternalLink></li>}
            <li><ExternalLink href="https://github.com/ankworks">github.com/ankworks</ExternalLink></li>
          </ul>
        </div>
        <Link to="/repos" className="btn-secondary-sm self-start">
          <RepoIcon size={14} /> Explore repositories
        </Link>
      </section>

      <section aria-label="Organization statistics">
        {repos.status === 'loading' || repos.status === 'idle' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-[82px] rounded-lg" />)}
          </div>
        ) : repos.status === 'error' ? (
          <ErrorState error={repos.error} onRetry={repos.reload} title="Repository statistics unavailable" />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric label="Public repositories" value={formatExactCount(profile?.public_repos ?? repositoryList.length)} icon={<RepoIcon size={16} />} />
            <Metric label="Stars across public repositories" value={formatExactCount(repositoryList.reduce((sum, repo) => sum + repo.stargazers_count, 0))} icon={<StarIcon size={16} />} />
            <Metric label="Forks across public repositories" value={formatExactCount(repositoryList.reduce((sum, repo) => sum + repo.forks_count, 0))} icon={<ForkIcon size={16} />} />
          </div>
        )}
      </section>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <section aria-labelledby="featured-heading" id="featured" className="min-w-0">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Explore</p>
              <h2 id="featured-heading" className="mt-1 text-lg font-semibold text-text">Featured repositories</h2>
            </div>
            <Link to="/repos" className="text-sm font-medium text-primary hover:underline">All repositories →</Link>
          </div>
          {repos.status === 'loading' || repos.status === 'idle' ? (
            <div className="space-y-2"><SkeletonRows rows={3} label="Loading featured repositories" /></div>
          ) : repos.status === 'error' ? (
            <ErrorState error={repos.error} onRetry={repos.reload} compact title="Featured repositories unavailable" />
          ) : featured.length ? (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface" aria-label="Featured repositories">
              {featured.map((repo) => <FeaturedRepository key={repo.id} repo={repo} />)}
            </ul>
          ) : (
            <div className="rounded-lg border border-border bg-surface"><EmptyState title="No public repositories yet." /></div>
          )}
        </section>

        <ActivityFeed />
      </div>

      <OrgProfileReadme />
    </div>
  );
}

/**
 * Pins first, then the remaining repositories by stars.
 *
 * Only repositories that actually exist in the public list are shown, so a pin
 * pointing at a renamed or deleted repository is skipped rather than fabricated.
 */
function useFeaturedOrder(repositoryList: Repository[], pins: Array<{ repo: string; position: number }>): Repository[] {
  const byName = new Map(repositoryList.map((repo) => [repo.name.toLowerCase(), repo]));
  const pinned: Repository[] = [];
  for (const pin of [...pins].sort((a, b) => a.position - b.position)) {
    const repo = byName.get(pin.repo.toLowerCase());
    if (repo) pinned.push(repo);
  }
  const pinnedNames = new Set(pinned.map((repo) => repo.name.toLowerCase()));
  const rest = repositoryList
    .filter((repo) => !pinnedNames.has(repo.name.toLowerCase()))
    .sort((a, b) => b.stargazers_count - a.stargazers_count);
  return [...pinned, ...rest].slice(0, 3);
}

/**
 * `ankworks/.github/profile/README.md` rendered below the organization
 * overview and featured projects. Missing repository/file shows a graceful
 * fallback; load failures stay quiet with a retry.
 */
function OrgProfileReadme() {
  const state = useAsync('org-profile-readme', () => explorerApi.orgProfileReadme());
  const errorCode = (state.error as { code?: unknown } | null)?.code;

  return (
    <section aria-labelledby="profile-readme-heading" id="org-profile-readme" className="min-w-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Organization profile</p>
          <h2 id="profile-readme-heading" className="mt-1 text-lg font-semibold text-text">
            About AnkWorks
          </h2>
          <p className="mt-0.5 font-mono text-xs text-muted">ankworks/.github · profile/README.md</p>
        </div>
        {state.status === 'success' && state.data && (
          <ExternalLink href={state.data.html_url} className="text-sm font-medium text-primary hover:underline">
            View source on GitHub
          </ExternalLink>
        )}
      </div>

      {state.status === 'loading' || state.status === 'idle' ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <SkeletonRows rows={6} label="Loading the organization profile README" />
        </div>
      ) : state.status === 'error' ? (
        errorCode === 'PROFILE_README_NOT_FOUND' ? (
          <div className="rounded-lg border border-border bg-surface">
            <EmptyState title="The organization has not published a profile README.">
              <ExternalLink href="https://github.com/ankworks/.github" className="text-primary/90 hover:text-primary">
                View ankworks/.github on GitHub
              </ExternalLink>
            </EmptyState>
          </div>
        ) : (
          <ErrorState error={state.error} onRetry={state.reload} compact title="Profile README unavailable" />
        )
      ) : state.data ? (
        state.data.kind === 'text' && state.data.content !== undefined ? (
          <div className="rounded-lg border border-border bg-surface px-6 py-6 sm:px-8">
            <Suspense fallback={<SkeletonRows rows={6} label="Rendering the profile README" />}>
              <Markdown
                source={state.data.content}
                name="profile/README.md"
                context={{ repo: state.data.repo, commitSha: state.data.commit_sha, baseDir: 'profile' }}
              />
            </Suspense>
          </div>
        ) : (
          <Notice title="The profile README cannot be displayed">
            <ExternalLink href={state.data.html_url} className="text-primary/90 hover:text-primary">
              View the file on GitHub
            </ExternalLink>
          </Notice>
        )
      ) : null}
    </section>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-elevated text-primary" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted">{label}</p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums text-text">{value}</p>
      </div>
    </div>
  );
}

function FeaturedRepository({ repo }: { repo: Repository }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3.5 hover:bg-elevated/50 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
      <div className="min-w-0">
        <Link to={repoPath(repo.name)} className="break-words font-semibold text-primary hover:underline">ankworks/{repo.name}</Link>
        {repo.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{repo.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          {repo.language && <span>{repo.language}</span>}
          {repo.default_branch && <span>Default branch <code className="font-mono text-text/80">{repo.default_branch}</code></span>}
          {repo.archived && <Badge tone="warning">Archived</Badge>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4 text-xs text-muted sm:pt-1">
        <span className="inline-flex items-center gap-1" title={`${formatExactCount(repo.stargazers_count)} stars`}><StarIcon size={13} />{formatExactCount(repo.stargazers_count)}</span>
        <span className="inline-flex items-center gap-1" title={`${formatExactCount(repo.forks_count)} forks`}><ForkIcon size={13} />{formatExactCount(repo.forks_count)}</span>
        <time dateTime={repo.updated_at} title={formatDate(repo.updated_at)}>{formatRelative(repo.updated_at)}</time>
      </div>
    </li>
  );
}
