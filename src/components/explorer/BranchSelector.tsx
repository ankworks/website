import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { explorerApi } from '../../api/explorer';
import type { BranchInfo } from '../../types';
import { blobPath, commitsPath, treePath } from '../../shared/routes';
import { BranchIcon } from './icons';

export type BranchMode = 'tree' | 'blob' | 'commits';

interface BranchSelectorProps {
  repo: string;
  /** The ref currently shown (branch, tag, or commit SHA). */
  gitRef: string;
  mode: BranchMode;
  path?: string;
}

function targetFor(mode: BranchMode, repo: string, gitRef: string, path: string): string {
  if (mode === 'commits') return commitsPath(repo, gitRef);
  if (mode === 'blob') return blobPath(repo, gitRef, path);
  return treePath(repo, gitRef, path);
}

/**
 * Branch switcher. Lists branches page by page (GitHub's pagination) and keeps
 * the current ref selectable even when it is not in the loaded pages.
 */
export default function BranchSelector({ repo, gitRef, mode, path = '' }: BranchSelectorProps) {
  const navigate = useNavigate();
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setBranches([]);
    explorerApi
      .branches(repo, 1)
      .then((response) => {
        if (cancelled) return;
        setBranches(response.branches);
        setHasNext(response.has_next);
        setPage(1);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const loadMore = () => {
    const next = page + 1;
    setLoadingMore(true);
    explorerApi
      .branches(repo, next)
      .then((response) => {
        setBranches((previous) => {
          const seen = new Set(previous.map((branch) => branch.name));
          return [...previous, ...response.branches.filter((branch) => !seen.has(branch.name))];
        });
        setHasNext(response.has_next);
        setPage(next);
      })
      .catch(() => setHasNext(false))
      .finally(() => setLoadingMore(false));
  };

  const listed = branches.some((branch) => branch.name === gitRef);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm text-muted">
        <BranchIcon size={14} className="shrink-0" />
        <span className="sr-only sm:not-sr-only">Branch</span>
        <select
          aria-label="Branch or ref"
          value={gitRef}
          disabled={status === 'loading' && branches.length === 0}
          onChange={(event) => navigate(targetFor(mode, repo, event.target.value, path))}
          className="max-w-[16rem] truncate rounded-md border border-border bg-elevated px-2.5 py-1.5 font-mono text-sm text-text focus:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-60"
        >
          {!listed && <option value={gitRef}>{gitRef}</option>}
          {branches.map((branch) => (
            <option key={branch.name} value={branch.name}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
      {status === 'error' && <span className="text-xs text-muted">Branch list unavailable</span>}
      {hasNext && (
        <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-secondary-sm">
          {loadingMore ? 'Loading…' : 'Load more branches'}
        </button>
      )}
    </div>
  );
}
