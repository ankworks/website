/**
 * Search and notifications (Milestone F).
 *
 *   GET /api/search?q=&type=code|issues|repos   org-scoped GitHub search
 *   GET /api/notifications                      signed-in user's notifications
 *
 * Search is read-only and org-scoped (`org:ankworks` qualifier) so it can
 * never become a general GitHub proxy. Notifications require a session and use
 * the user's own token (fail closed 401).
 */

import { ORG_NAME } from '../shared/validation';
import { isHiddenRepo, parseHiddenRepos } from '../shared/visibility';
import { readSession } from './auth';
import type { Env } from './env';
import { UpstreamError, errorResponse, jsonResponse, readJson } from './github-client';
import { logEvent } from './logging';

const SEARCH_TYPES = ['code', 'issues', 'repos'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function githubHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ankworks-forge',
  };
}

function sanitizeSearchItems(type: SearchType, payload: unknown): Array<Record<string, unknown>> {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return [];
  return payload.items.slice(0, 30).map((item) => {
    const record = isRecord(item) ? item : {};
    const repository = isRecord(record.repository) ? record.repository : {};
    const base: Record<string, unknown> = {
      type,
      title: typeof record.name === 'string' ? record.name : typeof record.title === 'string' ? record.title : '',
      html_url: typeof record.html_url === 'string' ? record.html_url : '',
    };
    if (type === 'code') {
      return {
        ...base,
        path: typeof record.path === 'string' ? record.path : '',
        repo: typeof repository.full_name === 'string' ? repository.full_name : '',
        sha: typeof record.sha === 'string' ? record.sha.slice(0, 7) : '',
      };
    }
    if (type === 'issues') {
      return {
        ...base,
        number: typeof record.number === 'number' ? record.number : 0,
        state: typeof record.state === 'string' ? record.state : 'open',
        repo: typeof repository.full_name === 'string' ? repository.full_name : '',
        is_pull: isRecord(record.pull_request),
        updated_at: typeof record.updated_at === 'string' ? record.updated_at : '',
      };
    }
    return {
      ...base,
      description: typeof record.description === 'string' ? record.description : '',
      language: typeof record.language === 'string' ? record.language : '',
      stars: typeof record.stargazers_count === 'number' ? record.stargazers_count : 0,
      updated_at: typeof record.updated_at === 'string' ? record.updated_at : '',
    };
  });
}

export async function handleSearch(request: Request, env?: Pick<Env, 'FORGE_SELF_REPO'>): Promise<Response> {
  if (request.method !== 'GET') {
    const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
    response.headers.set('Allow', 'GET');
    return response;
  }
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  const type = (url.searchParams.get('type') ?? 'issues') as SearchType;
  if (query.length === 0 || query.length > 200) {
    return errorResponse(400, 'INVALID_QUERY', 'A search query of 1–200 characters is required.');
  }
  if (!(SEARCH_TYPES as readonly string[]).includes(type)) {
    return errorResponse(400, 'INVALID_PARAMETER', 'type must be code, issues, or repos.');
  }

  const qualifiers = type === 'repos' ? `org:${ORG_NAME}` : `org:${ORG_NAME}`;
  const searchUrl = new URL('https://api.github.com/search/' + type);
  searchUrl.searchParams.set('q', `${query} ${qualifiers}`);
  searchUrl.searchParams.set('per_page', '20');

  const response = await fetch(searchUrl.toString(), {
    method: 'GET',
    redirect: 'manual',
    headers: githubHeaders(),
  });
  if (response.status === 422) {
    return errorResponse(400, 'INVALID_QUERY', 'GitHub rejected the search query.');
  }
  if (!response.ok) {
    throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'Search is temporarily unavailable.');
  }
  const payload = await readJson(response);
  const total = isRecord(payload) && typeof payload.total_count === 'number' ? payload.total_count : 0;
  const hidden = parseHiddenRepos(env?.FORGE_SELF_REPO);
  let items = sanitizeSearchItems(type, payload);
  if (hidden.length > 0) {
    // Visibility rule: drop results that belong to a hidden repository. The
    // match is on the `owner/name` pair or on the bare repository name.
    items = items.filter((item) => {
      const repoName = String(item.repo ?? item.title ?? '');
      const short = repoName.split('/').pop() ?? repoName;
      return !isHiddenRepo(short, hidden) && !isHiddenRepo(repoName, hidden);
    });
  }
  logEvent('debug', 'search_performed', { type });
  return jsonResponse({ query, type, total_count: total, items }, 60);
}

export async function handleNotifications(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') {
    const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
    response.headers.set('Allow', 'GET');
    return response;
  }
  const session = await readSession(request, env);
  if (!session) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Sign in to view notifications.');
  }
  const response = await fetch('https://api.github.com/notifications?all=false&per_page=20', {
    method: 'GET',
    redirect: 'manual',
    headers: {
      ...githubHeaders(),
      Authorization: `Bearer ${session.token}`,
    },
  });
  if (response.status === 304) return jsonResponse({ items: [] }, 0);
  if (!response.ok) {
    throw new UpstreamError(502, 'GITHUB_UNAVAILABLE', 'Could not load notifications.');
  }
  const payload = await readJson(response);
  const items = Array.isArray(payload)
    ? payload.slice(0, 20).map((entry) => {
        const record = isRecord(entry) ? entry : {};
        const subject = isRecord(record.subject) ? record.subject : {};
        const repository = isRecord(record.repository) ? record.repository : {};
        return {
          id: typeof record.id === 'string' ? record.id : '',
          title: typeof subject.title === 'string' ? subject.title : '',
          type: typeof subject.type === 'string' ? subject.type : '',
          repo: typeof repository.full_name === 'string' ? repository.full_name : '',
          unread: record.unread === true,
          updated_at: typeof record.updated_at === 'string' ? record.updated_at : '',
          url: typeof subject.url === 'string' ? subject.url : '',
        };
      })
    : [];
  return jsonResponse({ items }, 0);
}
