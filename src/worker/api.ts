/**
 * Cloudflare Worker API endpoint for GitHub repositories
 * 
 * This worker fetches repositories from GitHub API and caches the results
 */

import type { Repository, GitHubApiResponse, ApiError } from '../types';

const GITHUB_API_BASE = 'https://api.github.com';
const ORG_NAME = 'ankworks';
const USER_AGENT = 'AnkWorks-Website-Worker';
const CACHE_TTL = 5 * 60; // 5 minutes in seconds

// Normalize repository data
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

// Validate repository
function isValidRepository(repo: any): boolean {
  return (
    repo &&
    typeof repo === 'object' &&
    repo.id &&
    repo.name &&
    repo.full_name &&
    repo.html_url
  );
}

// Create error response
function createErrorResponse(error: any, status: number = 500): Response {
  const message = error.message || error.toString() || 'Internal server error';
  const response: ApiError = {
    error: 'API_ERROR',
    message,
    status,
  };
  return new Response(JSON.stringify(response), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
  });
}

// Create success response
function createSuccessResponse(
  repos: Repository[],
  page: number,
  per_page: number,
  total_count: number,
  rate_limit: { limit: number; remaining: number; reset: number },
  cached: boolean = false
): Response {
  const response: GitHubApiResponse = {
    repos,
    total_count,
    page,
    per_page,
    total_pages: Math.ceil(total_count / per_page),
    rate_limit,
    cached,
    cached_at: cached ? new Date().toISOString() : null,
  };
  
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_TTL}`,
    },
  });
}

// Handle GitHub API request
async function fetchGitHubRepos(
  page: number = 1,
  per_page: number = 100,
  request: Request
): Promise<{ repos: Repository[]; rate_limit: { limit: number; remaining: number; reset: number }; total_count: number }> {
  const url = new URL(`${GITHUB_API_BASE}/orgs/${ORG_NAME}/repos`);
  url.searchParams.append('page', page.toString());
  url.searchParams.append('per_page', per_page.toString());
  url.searchParams.append('type', 'all');
  url.searchParams.append('sort', 'updated');
  url.searchParams.append('direction', 'desc');

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/vnd.github+json',
  };

  // Check for GitHub token in Worker secrets
  const token = (request as any).GITHUB_TOKEN;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
    // Cloudflare Workers fetch has built-in timeout
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

  // Get total count from Link header if available
  let total_count = rate_limit.limit * 10; // Default estimate
  const linkHeader = response.headers.get('link');
  if (linkHeader) {
    const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
    if (lastMatch) {
      const lastPage = parseInt(lastMatch[1]);
      total_count = lastPage * per_page;
    }
  }

  const data = await response.json();
  
  if (!Array.isArray(data)) {
    throw { status: 500, message: 'Invalid response format from GitHub API' };
  }

  const repos = data
    .filter(isValidRepository)
    .map(normalizeRepository);

  return { repos, rate_limit, total_count };
}

// Fetch all repositories with pagination
async function fetchAllRepos(request: Request): Promise<{ repos: Repository[]; rate_limit: { limit: number; remaining: number; reset: number } }> {
  const allRepos: Repository[] = [];
  let page = 1;
  let hasMore = true;
  const per_page = 100;
  let rate_limit = { limit: 0, remaining: 0, reset: 0 };

  while (hasMore) {
    try {
      const { repos, rate_limit: currentRateLimit } = await fetchGitHubRepos(page, per_page, request);
      
      if (repos.length === 0) {
        hasMore = false;
        break;
      }

      allRepos.push(...repos);
      rate_limit = currentRateLimit;
      
      // Check if we've fetched all repos or hit rate limit
      if (repos.length < per_page || rate_limit.remaining <= 1) {
        hasMore = false;
      } else {
        page++;
      }
    } catch (error) {
      // If we have some repos, return them; otherwise rethrow
      if (allRepos.length > 0) {
        // Partial fetch completed, returning available repos
        hasMore = false;
      } else {
        throw error;
      }
    }
  }

  return { repos: allRepos, rate_limit };
}

// Main handler
export async function handleApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Only handle /api/repos endpoint
  if (path !== '/api/repos' && !path.startsWith('/api/repos/')) {
    return createErrorResponse({ message: 'Not found' }, 404);
  }

  // Handle GET requests only
  if (request.method !== 'GET') {
    return createErrorResponse({ message: 'Method not allowed' }, 405);
  }

  try {
    // Check cache first
    const cacheKey = new Request(url.toString(), request);
    const cache = caches.default;
    const cachedResponse = await cache.match(cacheKey);
    
    if (cachedResponse) {
      // Return cached response with updated cached flag
      const cachedData = await cachedResponse.json();
      return createSuccessResponse(
        cachedData.repos,
        cachedData.page,
        cachedData.per_page,
        cachedData.total_count,
        cachedData.rate_limit,
        true
      );
    }

    // Fetch fresh data
    const { repos, rate_limit } = await fetchAllRepos(request);
    
    // Cache the response
    const response = createSuccessResponse(
      repos,
      1,
      repos.length,
      repos.length,
      rate_limit,
      false
    );
    
    // Cache in Cloudflare
    const cacheResponse = new Response(response.body, response);
    await cache.put(cacheKey, cacheResponse.clone());

    return cacheResponse;
  } catch (error: any) {
    // API Error
    return createErrorResponse(error, error.status || 500);
  }
}

// Worker export
export default {
  fetch: handleApiRequest,
};
