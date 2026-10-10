import { explorerApi } from '../api/explorer';
import { getRepositories } from '../api/github';
import RepoList from '../components/explorer/RepoList';
import { ErrorState, ExternalLink, Notice, Skeleton, SkeletonRows } from '../components/explorer/ui';
import { useAsync } from '../hooks/useAsync';
import { formatDate, formatExactCount } from '../lib/format';

/** "/" — organization overview with its public repositories. */
export default function OrganizationPage() {
  const org = useAsync('org', () => explorerApi.organization());
  const repos = useAsync('repos', () => getRepositories(false));

  const profile = org.data?.org;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <section aria-labelledby="org-heading" className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-start">
        {profile ? (
          <img
            src={profile.avatar_url}
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 shrink-0 rounded-lg border border-border"
          />
        ) : (
          <Skeleton className="h-16 w-16 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <h1 id="org-heading" className="text-2xl font-semibold tracking-tight text-text">
            {profile ? profile.name || profile.login : 'AnkWorks'}
          </h1>
          <p className="mt-0.5 font-mono text-sm text-muted">@ankworks</p>
          {profile?.description && <p className="mt-3 max-w-3xl text-sm text-text/90">{profile.description}</p>}
          {org.status === 'loading' && <Skeleton className="mt-3 h-4 w-72 max-w-full" />}
          {profile && (
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
              <li>{formatExactCount(profile.public_repos)} public repositories</li>
              {profile.location && <li>{profile.location}</li>}
              {profile.blog && (
                <li>
                  <ExternalLink href={profile.blog}>{profile.blog.replace(/^https:\/\//, '')}</ExternalLink>
                </li>
              )}
              {profile.created_at && <li>On GitHub since {formatDate(profile.created_at)}</li>}
              <li>
                <ExternalLink href={profile.html_url}>github.com/ankworks</ExternalLink>
              </li>
            </ul>
          )}
          {org.status === 'error' && (
            <div className="mt-3">
              <Notice title="Organization details are unavailable">The repository list below still works.</Notice>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="repos-heading" className="pt-8">
        <h2 id="repos-heading" className="mb-4 text-sm font-medium text-text">
          Repositories
        </h2>
        {repos.status === 'loading' || repos.status === 'idle' ? (
          <div className="overflow-hidden rounded-md border border-border bg-surface">
            <SkeletonRows rows={5} label="Loading repositories" />
          </div>
        ) : repos.status === 'error' ? (
          <ErrorState error={repos.error} onRetry={repos.reload} />
        ) : (
          <RepoList repos={repos.data ?? []} />
        )}
      </section>
    </div>
  );
}
