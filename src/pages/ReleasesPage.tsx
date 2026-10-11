/**
 * Releases (V3-A): versions, tags, notes, assets, download links, dates, and
 * pre-release status — all read from the GitHub releases API.
 *
 * Binaries are never proxied through the Worker. Every asset links straight to
 * GitHub's own download endpoint, so a release of any size costs the Worker
 * nothing and cannot be turned into a bandwidth amplifier.
 */
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { insightsApi } from '../api/insights';
import { useAsync } from '../hooks/useAsync';
import { formatBytes, formatDateTime, formatExactCount } from '../lib/format';
import { releaseListPath } from '../shared/routes';
import { describeError } from '../lib/errors';
import RepoShell from '../components/explorer/RepoShell';
import Markdown from '../components/explorer/Markdown';
import Pagination from '../components/collaboration/Pagination';
import { Badge, EmptyState, ErrorState, ExternalLink, Panel, Skeleton } from '../components/explorer/ui';

export default function ReleasesPage() {
  const { repo = '' } = useParams();
  const [params] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  return (
    <RepoShell repo={repo} tab="releases">
      {() => <ReleasesList repo={repo} page={page} />}
    </RepoShell>
  );
}

function ReleasesList({ repo, page }: { repo: string; page: number }) {
  const state = useAsync(`releases|${repo}|${page}`, () => insightsApi.releases(repo, page));

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (state.status === 'error') {
    const described = describeError(state.error);
    if ((state.error as { code?: string } | null)?.code === 'REPO_NOT_FOUND') {
      return <ErrorState error={state.error} title="Repository not found" />;
    }
    return <ErrorState error={state.error} onRetry={state.reload} title={described.title} />;
  }
  const data = state.data;
  if (!data || data.releases.length === 0) {
    return (
      <Panel>
        <EmptyState title="No releases yet">
          When this repository publishes a release it appears here with its notes and assets.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        {data.releases.map((release) => (
          <li key={release.id}>
            <Panel>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-elevated/40 px-4 py-3">
                <div className="min-w-0">
                  <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-text">
                    <Link to={releaseListPath(repo)} className="hover:text-primary">
                      {release.name?.trim() ? release.name : release.tag_name}
                    </Link>
                    {release.prerelease && <Badge tone="warning">Pre-release</Badge>}
                    {release.draft && <Badge>Draft</Badge>}
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    <span className="font-mono text-text">{release.tag_name}</span>
                    {release.author && ` · ${release.author}`}
                    {' · '}
                    {release.published_at ? formatDateTime(release.published_at) : 'unpublished'}
                  </p>
                </div>
                <ExternalLink href={release.html_url} className="text-xs">
                  View on GitHub
                </ExternalLink>
              </div>

              <div className="px-4 py-4">
                {release.body ? (
                  <Markdown source={release.body} name={release.tag_name} context={{ repo, commitSha: '', baseDir: '' }} />
                ) : (
                  <p className="text-sm text-muted">No release notes were published.</p>
                )}

                {release.assets.length > 0 && (
                  <div className="mt-4 border-t border-border pt-3">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Assets</h3>
                    <ul className="mt-2 space-y-1.5">
                      {release.assets.map((asset) => (
                        <li key={asset.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <a
                            href={asset.browser_download_url}
                            rel="noopener noreferrer nofollow"
                            className="min-w-0 truncate font-medium text-primary/90 hover:text-primary"
                          >
                            {asset.name}
                          </a>
                          <span className="text-xs text-muted">
                            {formatBytes(asset.size)} · {formatExactCount(asset.download_count)} downloads
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] text-muted">
                      Downloads go directly to GitHub. Forge never proxies release binaries.
                    </p>
                  </div>
                )}
              </div>
            </Panel>
          </li>
        ))}
      </ol>

      <Pagination
        page={data.page}
        hasNext={data.has_next}
        previous={releaseListPath(repo, Math.max(1, data.page - 1))}
        next={releaseListPath(repo, data.page + 1)}
        label="Releases pages"
      />
    </div>
  );
}
