import type { Repository } from '../types';

const GITHUB_API_BASE = 'https://api.github.com';
const ORG_NAME = 'ankworks';
const USER_AGENT = 'AnkWorks-Website';

// Cache configuration
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
let reposCache: { data: Repository[]; timestamp: number } | null = null;

/**
 * Normalize GitHub repository data to our internal format
 */
function normalizeRepository(repo: any): Repository {
  return {
    id: repo.id || 0,
    name: repo.name || '',
    full_name: repo.full_name || '',
    description: repo.description || null,
    html_url: repo.html_url || '',
    language: repo.language || null,
    stargazers_count: repo.stargazers_count || 0,
    forks_count: repo.forks_count || 0,
    updated_at: repo.updated_at || '',
    created_at: repo.created_at || '',
    archived: repo.archived || false,
    fork: repo.fork || false,
    size: repo.size || 0,
    open_issues_count: repo.open_issues_count || 0,
    topics: repo.topics || [],
  };
}

/**
 * Validate repository object
 */
function isValidRepository(repo: any): boolean {
  return Boolean(
    repo &&
    typeof repo === 'object' &&
    repo.id &&
    repo.name &&
    repo.full_name &&
    repo.html_url
  );
}

/**
 * Fetch repositories from GitHub API with pagination
 */
async function fetchGitHubRepos(
  page: number = 1,
  per_page: number = 100,
  token?: string
): Promise<{ repos: Repository[]; rate_limit: { limit: number; remaining: number; reset: number } }> {
  const url = new URL(`${GITHUB_API_BASE}/orgs/${ORG_NAME}/repos`);
  url.searchParams.append('page', page.toString());
  url.searchParams.append('per_page', per_page.toString());
  url.searchParams.append('type', 'all'); // Include all types (owner, member, etc.)
  url.searchParams.append('sort', 'updated');
  url.searchParams.append('direction', 'desc');

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/vnd.github+json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
      // Cloudflare Workers has a default timeout, but we set one for browser
      ...(typeof fetch === 'function' && !('request' in fetch) && { signal: AbortSignal.timeout(30000) }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw {
        status: response.status,
        message: errorData.message || `GitHub API returned ${response.status}`,
      };
    }

    const rate_limit = {
      limit: parseInt(response.headers.get('x-ratelimit-limit') || '0'),
      remaining: parseInt(response.headers.get('x-ratelimit-remaining') || '0'),
      reset: parseInt(response.headers.get('x-ratelimit-reset') || '0'),
    };

    const data = await response.json();
    
    if (!Array.isArray(data)) {
      throw { status: 500, message: 'Invalid response format from GitHub API' };
    }

    const repos = data
      .filter(isValidRepository)
      .map(normalizeRepository)
      .filter(repo => !repo.archived); // Exclude archived by default

    return { repos, rate_limit };
  } catch (error) {
    if (error instanceof Error) {
      throw { status: 500, message: error.message };
    }
    throw error;
  }
}

/**
 * Fetch all repositories with pagination
 */
async function fetchAllRepos(token?: string): Promise<Repository[]> {
  const allRepos: Repository[] = [];
  let page = 1;
  let hasMore = true;
  const per_page = 100;

  while (hasMore) {
    try {
      const { repos, rate_limit } = await fetchGitHubRepos(page, per_page, token);
      
      if (repos.length === 0) {
        hasMore = false;
        break;
      }

      allRepos.push(...repos);
      
      // Check if we've fetched all repos or hit rate limit
      if (repos.length < per_page || rate_limit.remaining <= 1) {
        hasMore = false;
      } else {
        page++;
      }
    } catch (error) {
      // If we have some repos, return them; otherwise rethrow
      if (allRepos.length > 0) {
        console.warn('Partial fetch completed, returning available repos');
        hasMore = false;
      } else {
        throw error;
      }
    }
  }

  return allRepos;
}

/**
 * Get repositories with caching
 */
export async function getRepositories(
  forceRefresh: boolean = false,
  token?: string
): Promise<Repository[]> {
  // Return cached data if available and not expired
  if (!forceRefresh && reposCache) {
    const now = Date.now();
    if (now - reposCache.timestamp < CACHE_DURATION) {
      return reposCache.data;
    }
  }

  const repos = await fetchAllRepos(token);
  
  // Update cache
  reposCache = {
    data: repos,
    timestamp: Date.now(),
  };

  return repos;
}

/**
 * Get organization statistics
 */
export async function getOrganizationStats(token?: string): Promise<{
  total_repos: number;
  total_stars: number;
  total_forks: number;
  languages: Record<string, number>;
}> {
  const repos = await getRepositories(false, token);
  
  const total_repos = repos.length;
  const total_stars = repos.reduce((sum, repo) => sum + repo.stargazers_count, 0);
  const total_forks = repos.reduce((sum, repo) => sum + repo.forks_count, 0);
  
  const languages: Record<string, number> = {};
  repos.forEach(repo => {
    if (repo.language) {
      languages[repo.language] = (languages[repo.language] || 0) + 1;
    }
  });

  return { total_repos, total_stars, total_forks, languages };
}

/**
 * Get featured project (Aurelia Browser if exists)
 */
export async function getFeaturedProject(token?: string): Promise<Repository | null> {
  const repos = await getRepositories(false, token);
  
  // Look for ankworks/browser repository
  const browserRepo = repos.find(repo => repo.name.toLowerCase() === 'browser');
  if (browserRepo) {
    return browserRepo;
  }
  
  // If browser doesn't exist, return the most starred non-fork repository
  const nonForkRepos = repos.filter(repo => !repo.fork);
  if (nonForkRepos.length > 0) {
    return nonForkRepos.reduce((prev, current) => 
      (prev.stargazers_count > current.stargazers_count) ? prev : current
    );
  }
  
  return null;
}

/**
 * Get repository by name
 */
export async function getRepositoryByName(name: string, token?: string): Promise<Repository | null> {
  const repos = await getRepositories(false, token);
  return repos.find(repo => repo.name.toLowerCase() === name.toLowerCase()) || null;
}

/**
 * Invalidate cache
 */
export function invalidateCache(): void {
  reposCache = null;
}

/**
 * Get cache status
 */
export function getCacheStatus(): { cached: boolean; timestamp: number | null } {
  return {
    cached: reposCache !== null,
    timestamp: reposCache?.timestamp || null,
  };
}

// Export for testing
export { normalizeRepository, isValidRepository, CACHE_DURATION };
