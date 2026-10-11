/**
 * Repository document tabs (V3-A): README, Contributing, License, Security.
 *
 * Only documents that were proven to exist at the resolved commit are offered —
 * the tab list comes from `GET /api/repos/:repo/docs`, which probes the tree at
 * one exact commit SHA. A tab for a file that is not there is never shown.
 *
 * Rendering always goes through the shared Markdown pipeline
 * (remark-gfm → rehype-raw → rehype-sanitize). Raw HTML from the repository is
 * never injected: `rehype-raw` only parses it so the sanitizer can strip
 * scripts, event handlers, styles, and unsafe URL schemes.
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { insightsApi } from '../../api/insights';
import { useAsync } from '../../hooks/useAsync';
import { githubRepoLink, parentPath } from '../../shared/routes';
import type { RepoDocKey } from '../../shared/insights';
import { ErrorState, ExternalLink, Notice, Panel, Skeleton, SkeletonRows } from './ui';

const Markdown = lazy(() => import('./Markdown'));

interface RepoDocsProps {
  repo: string;
  gitRef: string;
}

export default function RepoDocs({ repo, gitRef }: RepoDocsProps) {
  const docsState = useAsync(`docs|${repo}|${gitRef}`, () => insightsApi.docs(repo, gitRef));
  const [selected, setSelected] = useState<RepoDocKey | null>(null);

  const available = docsState.data?.docs ?? [];
  const active = selected ?? available[0]?.key ?? null;

  // Reset the selection when the repository or ref changes so a stale key from
  // another tree can never be requested.
  useEffect(() => {
    setSelected(null);
  }, [repo, gitRef]);

  if (docsState.status === 'loading' || docsState.status === 'idle') {
    return <Skeleton className="h-48 w-full" />;
  }
  if (docsState.status === 'error') {
    return <ErrorState error={docsState.error} onRetry={docsState.reload} compact title="Documents unavailable" />;
  }
  if (available.length === 0 || active === null) return null;

  const doc = available.find((entry) => entry.key === active) ?? available[0];

  return (
    <Panel aria-label="Repository documents">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-elevated/40 px-2 py-1.5">
        <div role="tablist" aria-label="Repository documents" className="flex flex-wrap gap-1">
          {available.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              id={`doc-tab-${entry.key}`}
              aria-selected={entry.key === doc?.key}
              aria-controls={`doc-panel-${entry.key}`}
              onClick={() => setSelected(entry.key)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                entry.key === doc?.key
                  ? 'bg-elevated font-medium text-text'
                  : 'text-muted hover:bg-elevated/60 hover:text-text'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {doc && (
          <ExternalLink
            href={githubRepoLink(repo, 'blob', docsState.data?.commit_sha ?? gitRef, doc.path)}
            className="px-2 text-xs"
          >
            Open on GitHub
          </ExternalLink>
        )}
      </div>

      {doc && (
        <div role="tabpanel" id={`doc-panel-${doc.key}`} aria-labelledby={`doc-tab-${doc.key}`} className="px-6 py-5 sm:px-8">
          <DocContent repo={repo} gitRef={gitRef} docKey={doc.key} commitSha={docsState.data?.commit_sha ?? gitRef} path={doc.path} />
        </div>
      )}
    </Panel>
  );
}

function DocContent({
  repo,
  gitRef,
  docKey,
  commitSha,
  path,
}: {
  repo: string;
  gitRef: string;
  docKey: RepoDocKey;
  commitSha: string;
  path: string;
}) {
  const state = useAsync(`doc|${repo}|${gitRef}|${docKey}`, () => insightsApi.doc(repo, gitRef, docKey));

  if (state.status === 'loading' || state.status === 'idle') {
    return <SkeletonRows rows={6} label="Loading document" />;
  }
  if (state.status === 'error') {
    return <ErrorState error={state.error} onRetry={state.reload} compact />;
  }
  const doc = state.data;
  if (!doc) return null;

  if (doc.kind !== 'text' || doc.content === undefined) {
    return (
      <Notice title={doc.kind === 'too-large' ? 'This document is too large to display' : 'This document cannot be displayed'}>
        <ExternalLink href={githubRepoLink(repo, 'blob', commitSha, path)}>View the file on GitHub</ExternalLink>
      </Notice>
    );
  }

  return (
    <Suspense fallback={<SkeletonRows rows={5} label={`Rendering ${path}`} />}>
      <Markdown source={doc.content} name={path} context={{ repo, commitSha, baseDir: parentPath(path) }} />
    </Suspense>
  );
}
