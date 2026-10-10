import { useState, useEffect, useCallback } from 'react';
import type { OrganizationStats } from '../types';
import { getOrganizationStats, getFeaturedProject, invalidateCache } from '../api/github';

export function useStats() {
  const [stats, setStats] = useState<OrganizationStats | null>(null);
  const [featuredProject, setFeaturedProject] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async (forceRefresh: boolean = false) => {
    try {
      setLoading(true);
      setError(null);
      
      if (forceRefresh) {
        invalidateCache();
      }
      
      const [statsData, featured] = await Promise.all([
        getOrganizationStats(),
        getFeaturedProject(),
      ]) as [OrganizationStats, any];
      
      setStats(statsData);
      setFeaturedProject(featured);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch statistics');
      setStats(null);
      setFeaturedProject(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStats(true);
    }, 5 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [fetchStats]);

  const refresh = useCallback(() => {
    fetchStats(true);
  }, [fetchStats]);

  return {
    stats,
    featuredProject,
    loading,
    error,
    refresh,
  };
}
