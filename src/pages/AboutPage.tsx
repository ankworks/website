import { explorerApi } from '../api/explorer';
import { ErrorState, ExternalLink, Notice, Panel, Skeleton } from '../components/explorer/ui';
import { useAsync } from '../hooks/useAsync';
import { formatDate, formatExactCount } from '../lib/format';

/** "/about" — organization information and an explanation of AnkWorks Forge. */
export default function AboutPage() {
  const org = useAsync('org', () => explorerApi.organization());
  const profile = org.data?.org;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6">
      <header className="flex items-start gap-4 border-b border-border pb-6">
        <img src="/branding/ankworks-logo.webp" alt="AnkWorks organization logo" width={56} height={56} className="h-14 w-14 rounded-lg border border-border object-cover" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted">About the organization</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">AnkWorks Forge</h1>
          {org.status === 'loading' || org.status === 'idle' ? (
            <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          ) : org.status === 'error' ? (
            <div className="mt-3"><ErrorState error={org.error} onRetry={org.reload} compact title="Organization details unavailable" /></div>
          ) : (
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">{profile?.description || 'The organization has not published a description on GitHub.'}</p>
          )}
        </div>
      </header>

      {profile && (
        <Panel aria-label="Organization facts">
          <dl className="divide-y divide-border text-sm">
            <Fact label="Organization">{profile.name || profile.login}</Fact>
            <Fact label="GitHub"><ExternalLink href={profile.html_url}>github.com/ankworks</ExternalLink></Fact>
            <Fact label="Public repositories">{formatExactCount(profile.public_repos)}</Fact>
            {profile.location && <Fact label="Location">{profile.location}</Fact>}
            {profile.blog && <Fact label="Website"><ExternalLink href={profile.blog}>{profile.blog.replace(/^https:\/\//, '')}</ExternalLink></Fact>}
            {profile.created_at && <Fact label="On GitHub since">{formatDate(profile.created_at)}</Fact>}
          </dl>
        </Panel>
      )}

      <section aria-labelledby="forge-heading" className="space-y-3 text-sm leading-6 text-muted">
        <h2 id="forge-heading" className="text-base font-semibold text-text">A development platform for AnkWorks</h2>
        <p>
          Forge brings AnkWorks public repositories, source files, branch and tag references, commit history, issues,
          pull requests, and public organization activity into one same-domain interface. GitHub remains the source of truth.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Read-only in this milestone. No repository writes, comments, reviews, or merge actions are available.</li>
          <li>Only public AnkWorks repositories are exposed. Private repository checks fail closed.</li>
          <li>Markdown is rendered without raw HTML, and repository code is never executed.</li>
          <li>Authentication has not been enabled; the interface does not simulate a signed-in user.</li>
        </ul>
        <Notice title="Data and limits">
          Data is fetched from the GitHub REST API through the AnkWorks Worker and cached briefly. GitHub API rate limits,
          pagination, and upstream availability apply. Large files remain subject to the existing explorer limits.
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
