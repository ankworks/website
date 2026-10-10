import { explorerApi } from '../api/explorer';
import { ErrorState, ExternalLink, Notice, Panel, Skeleton } from '../components/explorer/ui';
import { useAsync } from '../hooks/useAsync';
import { formatDate, formatExactCount } from '../lib/format';

/** "/about" — organization information and an explanation of the explorer. */
export default function AboutPage() {
  const org = useAsync('org', () => explorerApi.organization());
  const profile = org.data?.org;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-text">About AnkWorks</h1>
        {org.status === 'loading' || org.status === 'idle' ? (
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        ) : org.status === 'error' ? (
          <div className="mt-4">
            <ErrorState error={org.error} onRetry={org.reload} compact title="Organization details unavailable" />
          </div>
        ) : (
          <p className="mt-3 text-muted">
            {profile?.description || 'The organization has not published a description on GitHub.'}
          </p>
        )}
      </header>

      {profile && (
        <Panel aria-label="Organization facts">
          <dl className="divide-y divide-border text-sm">
            <Fact label="Name">{profile.name || profile.login}</Fact>
            <Fact label="GitHub">
              <ExternalLink href={profile.html_url}>github.com/ankworks</ExternalLink>
            </Fact>
            <Fact label="Public repositories">{formatExactCount(profile.public_repos)}</Fact>
            {profile.location && <Fact label="Location">{profile.location}</Fact>}
            {profile.blog && (
              <Fact label="Website">
                <ExternalLink href={profile.blog}>{profile.blog.replace(/^https:\/\//, '')}</ExternalLink>
              </Fact>
            )}
            {profile.created_at && <Fact label="On GitHub since">{formatDate(profile.created_at)}</Fact>}
          </dl>
        </Panel>
      )}

      <section aria-labelledby="explorer-heading" className="space-y-3 text-sm text-muted">
        <h2 id="explorer-heading" className="text-base font-medium text-text">
          About this explorer
        </h2>
        <p>
          This site browses the public repositories of the AnkWorks organization directly: repository lists, directories,
          source files, README files, branches, and commit history. Pages never redirect to GitHub for normal browsing.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Read-only. The explorer cannot push, edit, create pull requests, or sign in.</li>
          <li>Public repositories only. Private repositories are never requested or shown.</li>
          <li>GitHub remains the source of truth. Each page links to the matching page on GitHub.</li>
          <li>Responses are cached briefly on the server and in the browser; reload to fetch the latest state.</li>
        </ul>
        <Notice title="Limits">
          Files over 512 KB are not rendered in the viewer (download them raw instead). Directory listings show up to
          1,000 entries. Git LFS content is not downloaded.
        </Notice>
      </section>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}
