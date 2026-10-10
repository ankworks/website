import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Repository, FilterState, SortBy, SortOrder } from '../types';
import { getRepositories, invalidateCache } from '../api/github';

const DEFAULT_FILTER: FilterState = {
  search: '',
  language: '',
  sort_by: 'stars',
  sort_order: 'desc',
  include_forks: false,
};

export function useRepos() {
  const [_repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTER);
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(false);

  const PER_PAGE = 12;

  // Fetch repositories
  const fetchRepos = useCallback(async (forceRefresh: boolean = false) => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await getRepositories(forceRefresh);
      setRepos(data);
      setHasMore(data.length > PER_PAGE);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch repositories');
      setRepos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchRepos();
    
    // Set up periodic refresh
    const interval = setInterval(() => {
      fetchRepos(true);
    }, 5 * 60 * 1000); // 5 minutes
    
    return () => clearInterval(interval);
  }, [fetchRepos]);

  // Filter and sort repositories
  const filteredRepos = useMemo(() => {
    let result = [..._repos];

    // Filter by search
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter(
        repo => 
          repo.name.toLowerCase().includes(searchLower) ||
          (repo.description?.toLowerCase().includes(searchLower) ?? false) ||
          (repo.language?.toLowerCase().includes(searchLower) ?? false)
      );
    }

    // Filter by language
    if (filters.language) {
      result = result.filter(repo => repo.language?.toLowerCase() === filters.language.toLowerCase());
    }

    // Filter forks
    if (!filters.include_forks) {
      result = result.filter(repo => !repo.fork);
    }

    // Sort
    const sortField = filters.sort_by;
    const sortDirection = filters.sort_order;
    
    result.sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'stars':
          comparison = b.stargazers_count - a.stargazers_count;
          break;
        case 'forks':
          comparison = b.forks_count - a.forks_count;
          break;
        case 'updated':
          comparison = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
          break;
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [_repos, filters]);

  // Paginated repositories
  const paginatedRepos = useMemo(() => {
    const start = (page - 1) * PER_PAGE;
    const end = start + PER_PAGE;
    return filteredRepos.slice(start, end);
  }, [filteredRepos, page, PER_PAGE]);

  // Get unique languages for filter
  const languages = useMemo(() => {
    const langSet = new Set<string>();
    _repos.forEach((repo: any) => {
      if (repo.language) langSet.add(repo.language);
    });
    return Array.from(langSet).sort();
  }, [_repos]);

  // Get total count
  const totalCount = useMemo(() => filteredRepos.length, [filteredRepos]);

  // Update filter
  const updateFilter = useCallback((newFilters: Partial<FilterState>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setPage(1); // Reset to first page when filters change
  }, []);

  // Update sort
  const updateSort = useCallback((sort_by: SortBy, sort_order?: SortOrder) => {
    setFilters(prev => ({
      ...prev,
      sort_by,
      sort_order: sort_order || (prev.sort_by === sort_by ? 
        (prev.sort_order === 'asc' ? 'desc' : 'asc') : 'desc'),
    }));
    setPage(1);
  }, []);

  // Next page
  const nextPage = useCallback(() => {
    if (hasMore && page * PER_PAGE < filteredRepos.length) {
      setPage(prev => prev + 1);
    }
  }, [page, hasMore, filteredRepos]);

  // Previous page
  const prevPage = useCallback(() => {
    if (page > 1) {
      setPage(prev => prev - 1);
    }
  }, [page]);

  // Refresh
  const refresh = useCallback(() => {
    invalidateCache();
    fetchRepos(true);
  }, [fetchRepos]);

  return {
    repos: paginatedRepos,
    allRepos: filteredRepos,
    loading,
    error,
    filters,
    updateFilter,
    updateSort,
    page,
    hasMore: page * PER_PAGE < filteredRepos.length,
    totalCount,
    languages,
    nextPage,
    prevPage,
    refresh,
    totalPages: Math.ceil(filteredRepos.length / PER_PAGE),
  };
}

export { DEFAULT_FILTER };
