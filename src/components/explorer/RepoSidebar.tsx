/**
 * Repository sidebar (V3-A): About, Releases, Contributors, Languages, and
 * recent activity.
 *
 * Every figure is rendered from data the Worker copied out of the GitHub API.
 * Nothing here estimates, caches a guess, or falls back to a placeholder number:
 * when GitHub does not report a value the row shows an em dash instead.
 */
import { Link } from 'react-router-dom';
import { insightsApi } from '../../api/insights';
import { explorerApi } from '../../api/explorer';
import { useAsync } from '../../hooks/useAsync';
import { formatBytes, formatExactCount, formatRelative } from '../../lib/format';
import { releaseListPath } from '../../shared/routes';
import type { RepositoryDetail } from '../../types';
import { Badge, EmptyState, ErrorState, ExternalLink, Panel, Skeleton } from './ui';
import { ActivityIcon, BookIcon, CommitIcon, EyeIcon, ForkIcon, GlobeIcon, RocketIcon, ScaleIcon, StarIcon, TagIcon, UsersIcon } from './icons';

interface RepoSidebarProps {
  detail: RepositoryDetail;
}

export default function RepoSidebar({ detail }: RepoSidebarProps) {
  return (
    <aside aria-label="About this repository" className="space-y-4">
      <AboutSection detail={detail} />
      <ReleaseSection repo={detail.name} />
      <ContributorsSection repo={detail.name} />
      <LanguagesSection repo={detail.name} />
      <ActivitySection repo={detail.name} gitRef={detail.default_branch || 'HEAD'} />
    </aside>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 border-b border-border bg-elevated/40 px-4 py-2.5 text-sm font-medium text-text">
      {icon}
      {children}
    </h2>
  );
}

function AboutSection({ detail }: { detail: RepositoryDetail }) {
  return (
    <Panel>
      <SectionTitle icon={<BookIcon size={14} className="text-muted" />}>About</SectionTitle>
      <div className="space-y-3 px-4 py-3 text-sm">
        <p className="text-muted">{detail.description ?? 'No description provided.'}</p>

        {detail.homepage && (
          <p className="flex items-start gap-2 text-sm">
            <GlobeIcon size={14} className="mt-0.5 shrink-0 text-muted" />
            <a
              href={detail.homepage}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="min-w-0 break-all text-primary/90 hover:text-primary"
            >
              {detail.homepage.replace(/^https?:\/\//, '')}
            </a>
          </p>
        )}

        {detail.topics.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Topics">
            {detail.topics.map((topic) => (
              <li key={topic}>
                <Badge tone="accent">{topic}</Badge>
              </li>
            ))}
          </ul>
        )}

        <dl className="space-y-1.5 text-sm">
          <StatRow icon={<StarIcon size={13} />} label="Stars" value={formatExactCount(detail.stargazers_count)} />
          <StatRow
            icon={<EyeIcon size={13} />}
            label="Watchers"
            value={detail.watchers_count === null ? '—' : formatExactCount(detail.watchers_count)}
            title="GitHub subscribers count"
          />
          <StatRow icon={<ForkIcon size={13} />} label="Forks" value={formatExactCount(detail.forks_count)} />
          <StatRow
            icon={<ScaleIcon size={13} />}
            label="License"
            value={detail.license ?? '—'}
          />
          <StatRow
            icon={<CommitIcon size={13} />}
            label="Open issues"
            value={formatExactCount(detail.open_issues_count)}
          />
        </dl>

        <p className="border-t border-border pt-3 text-xs text-muted">
          <ExternalLink href={detail.html_url}>View repository on GitHub</ExternalLink>
        </p>
      </div>
    </Panel>
  );
}

function StatRow({
  icon,
  label,
  value,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="flex items-center gap-2" title={title}>
      <dt className="flex min-w-0 flex-1 items-center gap-2 text-muted">
        <span className="shrink-0">{icon}</span>
        {label}
      </dt>
      <dd className="shrink-0 font-medium text-text">{value}</dd>
    </div>
  );
}

function ReleaseSection({ repo }: { repo: string }) {
  const state = useAsync(`releases|${repo}`, () => insightsApi.releases(repo, 1));
  const releases = state.data?.releases ?? [];
  const latest = releases.find((release) => release.published_at !== null) ?? releases[0] ?? null;

  return (
    <Panel>
      <SectionTitle icon={<RocketIcon size={14} className="text-muted" />}>
        <span className="flex-1">Releases</span>
        {releases.length > 0 && (
          <Link to={releaseListPath(repo)} className="text-xs font-normal text-muted hover:text-text">
            + {Math.max(releases.length - 1, 0)} more
          </Link>
        )}
      </SectionTitle>
      <div className="px-4 py-3">
        {state.status === 'loading' || state.status === 'idle' ? (
          <Skeleton className="h-5 w-40" />
        ) : state.status === 'error' ? (
          <ErrorState error={state.error} onRetry={state.reload} compact />
        ) : !latest ? (
          <EmptyState title="No releases yet" />
        ) : (
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center gap-2">
              <TagIcon size={13} className="shrink-0 text-primary/80" />
              <Link to={releaseListPath(repo)} className="min-w-0 truncate font-medium text-text hover:text-primary">
                {latest.name?.trim() ? latest.name : latest.tag_name}
              </Link>
              {latest.prerelease && <Badge tone="warning">Pre-release</Badge>}
            </div>
            <p className="text-xs text-muted">
              {latest.published_at ? `Published ${formatRelative(latest.published_at)}` : 'Not published yet'}
              {latest.assets.length > 0 && ` · ${latest.assets.length} asset${latest.assets.length === 1 ? '' : 's'}`}
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}

function ContributorsSection({ repo }: { repo: string }) {
  const state = useAsync(`contributors|${repo}`, () => insightsApi.contributors(repo, 1));
  const contributors = (state.data?.contributors ?? []).filter((entry) => entry.login !== null).slice(0, 12);

  return (
    <Panel>
      <SectionTitle icon={<UsersIcon size={14} className="text-muted" />}>
        <span className="flex-1">Contributors</span>
        {contributors.length > 0 && <span className="text-xs font-normal text-muted">{contributors.length} shown</span>}
      </SectionTitle>
      <div className="px-4 py-3">
        {state.status === 'loading' || state.status === 'idle' ? (
          <Skeleton className="h-10 w-full" />
        ) : state.status === 'error' ? (
          <ErrorState error={state.error} onRetry={state.reload} compact />
        ) : contributors.length === 0 ? (
          <EmptyState title="No contributors reported">
            GitHub has not computed contributors for this repository yet.
          </EmptyState>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {contributors.map((contributor) => (
              <li key={contributor.login ?? contributor.html_url}>
                <a
                  href={contributor.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${contributor.login} · ${contributor.contributions} commits`}
                  className="block rounded-full focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  {contributor.avatar_url ? (
                    <img
                      src={contributor.avatar_url}
                      alt={contributor.login ?? 'Contributor'}
                      width={28}
                      height={28}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="h-7 w-7 rounded-full bg-elevated"
                    />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-elevated text-[10px] text-muted">
                      {(contributor.login ?? '?').slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/**
 * Language bar colors are a presentation choice (a fixed palette), NOT data.
 * The percentages themselves come from GitHub's languages API.
 */
const LANGUAGE_COLORS = ['#4f7cff', '#57d9a3', '#f2b34b', '#d9739b', '#7cc4ff', '#b78cf0', '#e8735a', '#5ec8c8'];

function LanguagesSection({ repo }: { repo: string }) {
  const state = useAsync(`languages|${repo}`, () => insightsApi.languages(repo));
  const languages = (state.data?.languages ?? []).filter((entry) => entry.bytes > 0).slice(0, 8);

  return (
    <Panel>
      <SectionTitle icon={<CommitIcon size={14} className="text-muted" />}>Languages</SectionTitle>
      <div className="px-4 py-3">
        {state.status === 'loading' || state.status === 'idle' ? (
          <Skeleton className="h-5 w-full" />
        ) : state.status === 'error' ? (
          <ErrorState error={state.error} onRetry={state.reload} compact />
        ) : languages.length === 0 ? (
          <EmptyState title="No language data">
            GitHub has not computed language statistics for this repository.
          </EmptyState>
        ) : (
          <>
            <div className="flex h-2 overflow-hidden rounded-full bg-elevated" role="img" aria-label="Language breakdown">
              {languages.map((language, index) => (
                <span
                  key={language.name}
                  style={{ width: `${language.percent}%`, backgroundColor: LANGUAGE_COLORS[index % LANGUAGE_COLORS.length] }}
                  title={`${language.name} ${language.percent}%`}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {languages.map((language, index) => (
                <li key={language.name} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: LANGUAGE_COLORS[index % LANGUAGE_COLORS.length] }}
                  />
                  <span className="text-text">{language.name}</span>
                  <span className="text-muted">
                    {language.percent}% · {formatBytes(language.bytes)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted">Source: GitHub languages API.</p>
          </>
        )}
      </div>
    </Panel>
  );
}

function ActivitySection({ repo, gitRef }: { repo: string; gitRef: string }) {
  const state = useAsync(`activity|${repo}|${gitRef}`, () => explorerApi.commits(repo, gitRef, 1));
  const commits = (state.data?.commits ?? []).slice(0, 5);

  return (
    <Panel>
      <SectionTitle icon={<ActivityIcon size={14} className="text-muted" />}>Recent activity</SectionTitle>
      <div className="px-4 py-3">
        {state.status === 'loading' || state.status === 'idle' ? (
          <Skeleton className="h-16 w-full" />
        ) : state.status === 'error' ? (
          <ErrorState error={state.error} onRetry={state.reload} compact />
        ) : commits.length === 0 ? (
          <EmptyState title="No commits yet" />
        ) : (
          <ul className="space-y-2 text-xs">
            {commits.map((commit) => (
              <li key={commit.sha} className="flex items-start gap-2">
                <CommitIcon size={12} className="mt-0.5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="min-w-0 truncate text-text" title={commit.title}>
                    {commit.title}
                  </p>
                  <p className="text-muted">
                    {commit.author_name} · {formatRelative(commit.date)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted">
          Public activity only. Private repository events are never fetched.
        </p>
      </div>
    </Panel>
  );
}
