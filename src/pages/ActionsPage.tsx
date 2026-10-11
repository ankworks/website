/**
 * GitHub Actions viewer (V3-A): read-only workflow and run listing.
 *
 * Deliberately read-only. Forge never triggers, re-runs, cancels, or approves a
 * workflow, never fetches logs or artifacts, and cannot see secrets — the only
 * link we render is to GitHub's own run page.
 */
import { useParams, useSearchParams } from 'react-router-dom';
import { insightsApi } from '../api/insights';
import { useAsync } from '../hooks/useAsync';
import { formatRelative } from '../lib/format';
import { actionsPath } from '../shared/routes';
import RepoShell from '../components/explorer/RepoShell';
import Pagination from '../components/collaboration/Pagination';
import { Badge, EmptyState, ErrorState, ExternalLink, Notice, Panel, Skeleton } from '../components/explorer/ui';
import { ActivityIcon, BranchIcon, CommitIcon } from '../components/explorer/icons';

const STATUS_TONE: Record<string, 'neutral' | 'accent' | 'warning'> = {
  success: 'accent',
  failure: 'warning',
  cancelled: 'neutral',
  skipped: 'neutral',
  timed_out: 'warning',
  action_required: 'warning',
  neutral: 'neutral',
  stale: 'neutral',
  startup_failure: 'warning',
};

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

export default function ActionsPage() {
  const { repo = '' } = useParams();
  const [params] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  return (
    <RepoShell repo={repo} tab="actions">
      {() => <RunsList repo={repo} page={page} />}
    </RepoShell>
  );
}

function RunsList({ repo, page }: { repo: string; page: number }) {
  const runsState = useAsync(`runs|${repo}|${page}`, () => insightsApi.runs(repo, page));

  if (runsState.status === 'loading' || runsState.status === 'idle') {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (runsState.status === 'error') {
    return <ErrorState error={runsState.error} onRetry={runsState.reload} />;
  }
  const data = runsState.data;

  return (
    <div className="space-y-4">
      <Notice title="Read-only view">
        Forge shows workflow runs only. It cannot start, re-run, or cancel a workflow, and it never accesses logs,
        artifacts, or secrets.
      </Notice>

      <WorkflowsPanel repo={repo} />

      {!data || data.runs.length === 0 ? (
        <Panel>
          <EmptyState title="No workflow runs">
            This repository has no visible runs yet, or GitHub Actions is not enabled for it.
          </EmptyState>
        </Panel>
      ) : (
        <Panel aria-label="Workflow runs">
          <ul className="divide-y divide-border">
            {data.runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
                <span
                  aria-hidden="true"
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                    run.conclusion === 'success'
                      ? 'bg-emerald-400'
                      : run.conclusion === null
                        ? 'bg-amber-400'
                        : 'bg-red-400'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="min-w-0 truncate text-sm font-medium text-text" title={run.display_title}>
                    {run.display_title}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span className="flex items-center gap-1">
                      <ActivityIcon size={12} />
                      {run.name ?? 'workflow'}
                    </span>
                    {run.head_branch && (
                      <span className="flex items-center gap-1">
                        <BranchIcon size={12} />
                        {run.head_branch}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <CommitIcon size={12} />
                      <span className="font-mono">{run.head_sha.slice(0, 7)}</span>
                    </span>
                    <span>{run.event}</span>
                    <span>#{run.run_number}</span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[run.conclusion ?? ''] ?? 'neutral'}>
                      {run.conclusion ?? run.status}
                    </Badge>
                    <span className="text-xs text-muted" title={run.updated_at}>
                      {formatDuration(run.duration_ms)} · {formatRelative(run.updated_at)}
                    </span>
                  </div>
                  <ExternalLink href={run.html_url} className="text-xs">
                    View logs on GitHub
                  </ExternalLink>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {data && (
        <Pagination
          page={data.page}
          hasNext={data.has_next}
          previous={actionsPath(repo, Math.max(1, data.page - 1))}
          next={actionsPath(repo, data.page + 1)}
          label="Workflow run pages"
        />
      )}
    </div>
  );
}

function WorkflowsPanel({ repo }: { repo: string }) {
  const state = useAsync(`workflows|${repo}`, () => insightsApi.workflows(repo, 1));
  if (state.status !== 'success' || !state.data || state.data.workflows.length === 0) return null;

  return (
    <Panel>
      <h2 className="border-b border-border bg-elevated/40 px-4 py-2.5 text-sm font-medium text-text">
        Workflows ({state.data.total_count})
      </h2>
      <ul className="divide-y divide-border">
        {state.data.workflows.map((workflow) => (
          <li key={workflow.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="text-text">{workflow.name}</span>
              <span className="ml-2 font-mono text-xs text-muted">{workflow.path}</span>
            </span>
            <span className="flex items-center gap-3">
              <Badge>{workflow.state}</Badge>
              <ExternalLink href={workflow.html_url} className="text-xs">
                Open
              </ExternalLink>
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2 text-[11px] text-muted">
        Workflow files are read through the repository explorer; configuration is never modified from Forge.
      </p>
    </Panel>
  );
}
