/**
 * The official AnkWorks Organization Profile README.
 *
 * Source: `ankworks/.github` → `profile/README.md`, fetched through the Worker
 * (`GET /api/org/profile-readme`) which resolves an exact commit SHA and caches
 * the result. Nothing about the organization is hardcoded here: the content is
 * whatever the organization published on GitHub, and when it has not published
 * one the page says so instead of inventing copy.
 *
 * The dashboard and /about render this SAME component, so there is one canonical
 * source and one rendering path.
 *
 * The Markdown is sanitized exactly like a repository README (see
 * `markdown-components.tsx`): no scripts, no event handlers, no unsafe URL
 * schemes, images restricted to GitHub hosts.
 */

import { Suspense, lazy } from 'react';
import { explorerApi } from '../../api/explorer';
import { useAsync } from '../../hooks/useAsync';
import { EmptyState, ErrorState, ExternalLink, Notice, SkeletonRows } from './ui';

// The Markdown renderer pulls in the syntax highlighter and Mermaid, so it
// stays a lazy chunk on every page that shows the profile.
const Markdown = lazy(() => import('./Markdown'));

export interface OrgProfileReadmeProps {
  /** Heading level used for the section title ("About AnkWorks"). */
  headingId?: string;
  /** Show the "View source on GitHub" link. */
  showSourceLink?: boolean;
}

export default function OrgProfileReadme({
  headingId = 'org-profile-readme-heading',
  showSourceLink = true,
}: OrgProfileReadmeProps = {}) {
  const state = useAsync('org-profile-readme', () => explorerApi.orgProfileReadme());
  const errorCode = (state.error as { code?: unknown } | null)?.code;

  return (
    <section aria-labelledby={headingId} data-testid="org-profile-readme" className="min-w-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Organization profile</p>
          <h2 id={headingId} className="mt-1 text-lg font-semibold text-text">
            About AnkWorks
          </h2>
          <p className="mt-0.5 font-mono text-xs text-muted">ankworks/.github · profile/README.md</p>
        </div>
        {showSourceLink && state.status === 'success' && state.data && (
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
