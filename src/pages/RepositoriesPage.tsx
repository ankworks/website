import { getRepositories } from '../api/github';
import RepoList from '../components/explorer/RepoList';
import { ErrorState, Skeleton, SkeletonRows } from '../components/explorer/ui';
import { useAsync } from '../hooks/useAsync';

export default function RepositoriesPage() {
  const state = useAsync('repositories-index', () => getRepositories(false));

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <header className="border-b border-border pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted">AnkWorks organization</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">Repositories</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">Public source repositories from GitHub, browsed on AnkWorks Forge.</p>
      </header>
      {state.status === 'loading' || state.status === 'idle' ? (
        <div aria-busy="true"><Skeleton className="mb-4 h-10 w-full" /><SkeletonRows rows={6} label="Loading repositories" /></div>
      ) : state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={state.reload} />
      ) : (
        <RepoList repos={state.data ?? []} />
      )}
    </div>
  );
}
