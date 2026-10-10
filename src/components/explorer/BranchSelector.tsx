import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { explorerApi } from '../../api/explorer';
import type { BranchInfo } from '../../types';
import type { TagInfo } from '../../types/collaboration';
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

export default function BranchSelector({ repo, gitRef, mode, path = '' }: BranchSelectorProps) {
  const navigate = useNavigate();
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [branchPage, setBranchPage] = useState(0);
  const [tagPage, setTagPage] = useState(0);
  const [branchHasNext, setBranchHasNext] = useState(false);
  const [tagHasNext, setTagHasNext] = useState(false);
  const [branchStatus, setBranchStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tagStatus, setTagStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBranches([]);
    setTags([]);
    setBranchStatus('loading');
    setTagStatus('loading');
    explorerApi.branches(repo, 1).then((response) => {
      if (cancelled) return;
      setBranches(response.branches);
      setBranchHasNext(response.has_next);
      setBranchPage(1);
      setBranchStatus('ready');
    }).catch(() => {
      if (!cancelled) setBranchStatus('error');
    });
    explorerApi.tags(repo, 1).then((response) => {
      if (cancelled) return;
      setTags(response.tags);
      setTagHasNext(response.has_next);
      setTagPage(1);
      setTagStatus('ready');
    }).catch(() => {
      if (!cancelled) setTagStatus('error');
    });
    return () => { cancelled = true; };
  }, [repo]);

  const loadMoreBranches = () => {
    const next = branchPage + 1;
    setLoadingBranches(true);
    explorerApi.branches(repo, next).then((response) => {
      setBranches((previous) => {
        const seen = new Set(previous.map((branch) => branch.name));
        return [...previous, ...response.branches.filter((branch) => !seen.has(branch.name))];
      });
      setBranchHasNext(response.has_next);
      setBranchPage(next);
    }).catch(() => setBranchHasNext(false)).finally(() => setLoadingBranches(false));
  };

  const loadMoreTags = () => {
    const next = tagPage + 1;
    setLoadingTags(true);
    explorerApi.tags(repo, next).then((response) => {
      setTags((previous) => {
        const seen = new Set(previous.map((tag) => tag.name));
        return [...previous, ...response.tags.filter((tag) => !seen.has(tag.name))];
      });
      setTagHasNext(response.has_next);
      setTagPage(next);
    }).catch(() => setTagHasNext(false)).finally(() => setLoadingTags(false));
  };

  const branchNames = new Set(branches.map((branch) => branch.name));
  const listed = branchNames.has(gitRef) || tags.some((tag) => tag.name === gitRef);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm text-muted">
        <BranchIcon size={14} className="shrink-0" />
        <span className="sr-only sm:not-sr-only">Branch or tag</span>
        <select
          aria-label="Branch or ref"
          value={gitRef}
          disabled={branchStatus === 'loading' && tagStatus === 'loading'}
          onChange={(event) => navigate(targetFor(mode, repo, event.target.value, path))}
          className="max-w-[16rem] truncate rounded-md border border-border bg-elevated px-2.5 py-1.5 font-mono text-sm text-text focus:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-60"
        >
          {!listed && <option value={gitRef}>{gitRef}</option>}
          {branches.length > 0 && <optgroup label="Branches">{branches.map((branch) => <option key={`branch:${branch.name}`} value={branch.name}>{branch.name}{branch.protected ? ' · protected' : ''}</option>)}</optgroup>}
          {tags.some((tag) => !branchNames.has(tag.name)) && <optgroup label="Tags">{tags.filter((tag) => !branchNames.has(tag.name)).map((tag) => <option key={`tag:${tag.name}`} value={tag.name}>{tag.name}</option>)}</optgroup>}
        </select>
      </label>
      {branchStatus === 'error' && <span className="text-xs text-muted">Branches unavailable</span>}
      {tagStatus === 'error' && <span className="text-xs text-muted">Tags unavailable</span>}
      {branchHasNext && <button type="button" onClick={loadMoreBranches} disabled={loadingBranches} className="btn-secondary-sm">{loadingBranches ? 'Loading…' : 'More branches'}</button>}
      {tagHasNext && <button type="button" onClick={loadMoreTags} disabled={loadingTags} className="btn-secondary-sm">{loadingTags ? 'Loading…' : 'More tags'}</button>}
    </div>
  );
}
