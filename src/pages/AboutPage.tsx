/**
 * "/about" — the official AnkWorks Organization Profile README.
 *
 * The page no longer explains the explorer. It renders the organization's own
 * published profile document (`ankworks/.github` → `profile/README.md`) fetched
 * through the Worker, using the same renderer and the same sanitization as every
 * other Markdown surface. When the organization has not published one, the page
 * says so — it never substitutes its own text.
 *
 * It does not redirect to GitHub: the README renders inside Forge.
 */

import { explorerApi } from '../api/explorer';
import { useAsync } from '../hooks/useAsync';
import { ErrorState, ExternalLink, Panel, Skeleton } from '../components/explorer/ui';
import OrgProfileReadme from '../components/explorer/OrgProfileReadme';
import { formatDate, formatExactCount } from '../lib/format';

export default function AboutPage() {
  const org = useAsync('org', () => explorerApi.organization());
  const profile = org.data?.org;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6">
      <header className="flex items-start gap-4 border-b border-border pb-6">
        <img
          src="/branding/ankworks-logo.webp"
          alt="AnkWorks organization logo"
          width={56}
          height={56}
          className="h-14 w-14 rounded-lg border border-border object-cover"
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted">About the organization</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">{profile?.name || 'AnkWorks'}</h1>
          {org.status === 'loading' || org.status === 'idle' ? (
            <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          ) : org.status === 'error' ? (
            <div className="mt-3">
              <ErrorState error={org.error} onRetry={org.reload} compact title="Organization details unavailable" />
            </div>
          ) : (
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
              {profile?.description || 'The organization has not published a description on GitHub.'}
            </p>
          )}
        </div>
      </header>

      {profile && (
        <Panel aria-label="Organization facts">
          <dl className="divide-y divide-border text-sm">
            <Fact label="Organization">{profile.name || profile.login}</Fact>
            <Fact label="GitHub">
              <ExternalLink href={profile.html_url}>github.com/{profile.login}</ExternalLink>
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

      {/* The canonical profile README, shared with the dashboard. */}
      <OrgProfileReadme headingId="about-profile-readme-heading" />
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
