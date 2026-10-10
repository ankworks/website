import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Repository } from '../../types';
import { filterRepos, listLanguages, DEFAULT_REPO_FILTERS, type RepoFilters, type RepoSort } from '../../lib/repo-filter';
import { formatDate, formatExactCount, formatRelative } from '../../lib/format';
import { repoPath } from '../../shared/routes';
import { RepoIcon, SearchIcon, StarIcon, ForkIcon } from './icons';
import { Badge, EmptyState } from './ui';

const PAGE_SIZE = 30;

const SORT_LABELS: Record<RepoSort, string> = {
  stars: 'Most stars',
  forks: 'Most forks',
  updated: 'Recently updated',
  name: 'Name',
};

interface RepoListProps {
  repos: Repository[];
}

/** Searchable, sortable, filterable list of organization repositories. */
export default function RepoList({ repos }: RepoListProps) {
  const [filters, setFilters] = useState<RepoFilters>(DEFAULT_REPO_FILTERS);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const searchRef = useRef<HTMLInputElement>(null);

  const languages = useMemo(() => listLanguages(repos), [repos]);
  const results = useMemo(() => filterRepos(repos, filters), [repos, filters]);

  // "/" focuses the search box, as on other developer platforms.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Changing a filter starts again from the first page of results.
  const update = (patch: Partial<RepoFilters>) => {
    setVisible(PAGE_SIZE);
    setFilters((previous) => ({ ...previous, ...patch }));
  };
  const filtersActive =
    filters.query !== '' || filters.language !== '' || filters.hideForks || filters.hideArchived;

  return (
    <div className="space-y-4">
      <form role="search" className="flex flex-col gap-3 md:flex-row md:items-center" onSubmit={(event) => event.preventDefault()}>
        <label className="relative flex-1">
          <span className="sr-only">Search repositories</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            ref={searchRef}
            type="search"
            value={filters.query}
            onChange={(event) => update({ query: event.target.value })}
            placeholder="Find a repository by name, topic, or language"
            className="w-full rounded-md border border-border bg-elevated py-2 pl-9 pr-12 text-sm text-text placeholder:text-muted/70 focus:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-[11px] text-muted sm:block">
            /
          </kbd>
        </label>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="sr-only" htmlFor="repo-language">
            Filter by language
          </label>
          <select
            id="repo-language"
            value={filters.language}
            onChange={(event) => update({ language: event.target.value })}
            className="rounded-md border border-border bg-elevated px-2.5 py-2 text-text focus:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <option value="">All languages</option>
            {languages.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="repo-sort">
            Sort repositories
          </label>
          <select
            id="repo-sort"
            value={filters.sort}
            onChange={(event) => update({ sort: event.target.value as RepoSort })}
            className="rounded-md border border-border bg-elevated px-2.5 py-2 text-text focus:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {(Object.keys(SORT_LABELS) as RepoSort[]).map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 text-muted">
            <input
              type="checkbox"
              checked={filters.hideForks}
              onChange={(event) => update({ hideForks: event.target.checked })}
              className="accent-primary"
            />
            Hide forks
          </label>
          <label className="flex items-center gap-1.5 text-muted">
            <input
              type="checkbox"
              checked={filters.hideArchived}
              onChange={(event) => update({ hideArchived: event.target.checked })}
              className="accent-primary"
            />
            Hide archived
          </label>
        </div>
      </form>

      <p className="text-xs text-muted" aria-live="polite">
        {filtersActive
          ? `${formatExactCount(results.length)} of ${formatExactCount(repos.length)} repositories`
          : `${formatExactCount(repos.length)} public ${repos.length === 1 ? 'repository' : 'repositories'}`}
      </p>

      {results.length === 0 ? (
        <div className="rounded-md border border-border bg-surface">
          {repos.length === 0 ? (
            <EmptyState title="No public repositories yet.">The organization has no public repositories to show.</EmptyState>
          ) : (
            <EmptyState title="No repositories match these filters.">
              <button
                type="button"
                className="btn-secondary-sm mt-2"
                onClick={() => {
                  setVisible(PAGE_SIZE);
                  setFilters(DEFAULT_REPO_FILTERS);
                }}
              >
                Clear filters
              </button>
            </EmptyState>
          )}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface" aria-label="Repositories">
            {results.slice(0, visible).map((repo) => (
              <RepoRow key={repo.id} repo={repo} />
            ))}
          </ul>
          {visible < results.length && (
            <div className="flex justify-center">
              <button type="button" className="btn-secondary-sm" onClick={() => setVisible((value) => value + PAGE_SIZE)}>
                Show more ({formatExactCount(results.length - visible)} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RepoRow({ repo }: { repo: Repository }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3.5 hover:bg-elevated/50 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <RepoIcon size={15} className="shrink-0 text-muted" />
          <Link to={repoPath(repo.name)} className="truncate font-semibold text-text hover:text-primary">
            {repo.name}
          </Link>
          {repo.archived && <Badge tone="warning">Archived</Badge>}
          {repo.fork && <Badge>Fork</Badge>}
        </div>
        {repo.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{repo.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          {repo.language && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-primary/80" />
              {repo.language}
            </span>
          )}
          {repo.default_branch && (
            <span>
              Default branch <span className="font-mono text-text/80">{repo.default_branch}</span>
            </span>
          )}
          {repo.topics.slice(0, 5).map((topic) => (
            <span key={topic} className="rounded bg-elevated px-1.5 py-px font-mono text-[11px]">
              {topic}
            </span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4 text-xs text-muted sm:pt-0.5">
        <span className="flex items-center gap-1" title={`${formatExactCount(repo.stargazers_count)} stars`}>
          <StarIcon size={13} />
          {formatExactCount(repo.stargazers_count)}
        </span>
        <span className="flex items-center gap-1" title={`${formatExactCount(repo.forks_count)} forks`}>
          <ForkIcon size={13} />
          {formatExactCount(repo.forks_count)}
        </span>
        <time dateTime={repo.updated_at} title={formatDate(repo.updated_at)} className="w-24 text-right">
          {formatRelative(repo.updated_at)}
        </time>
      </div>
    </li>
  );
}

