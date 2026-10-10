import type { Repository } from '../types';

export type RepoSort = 'stars' | 'updated' | 'name' | 'forks';

export interface RepoFilters {
  query: string;
  language: string;
  hideForks: boolean;
  hideArchived: boolean;
  sort: RepoSort;
}

export const DEFAULT_REPO_FILTERS: RepoFilters = {
  query: '',
  language: '',
  hideForks: false,
  hideArchived: false,
  sort: 'stars',
};

/** Distinct languages present in the list, sorted case-insensitively. */
export function listLanguages(repos: Repository[]): string[] {
  const set = new Set<string>();
  for (const repo of repos) {
    if (repo.language) set.add(repo.language);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

/** Filter and sort repositories. Pure, so it can be unit tested. */
export function filterRepos(repos: Repository[], filters: RepoFilters): Repository[] {
  const query = filters.query.trim().toLowerCase();
  const result = repos.filter((repo) => {
    if (filters.hideForks && repo.fork) return false;
    if (filters.hideArchived && repo.archived) return false;
    if (filters.language && repo.language !== filters.language) return false;
    if (query) {
      const haystack = [repo.name, repo.description ?? '', repo.language ?? '', ...repo.topics].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const byName = (a: Repository, b: Repository) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  result.sort((a, b) => {
    switch (filters.sort) {
      case 'stars':
        return b.stargazers_count - a.stargazers_count || byName(a, b);
      case 'forks':
        return b.forks_count - a.forks_count || byName(a, b);
      case 'updated':
        return (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0) || byName(a, b);
      case 'name':
        return byName(a, b);
    }
  });
  return result;
}
