/**
 * Browser client for search and notifications (Milestone F).
 */

import { ExplorerApiError } from './explorer';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export interface SearchItem {
  type: 'code' | 'issues' | 'repos';
  title: string;
  html_url: string;
  [key: string]: unknown;
}

export interface SearchResponse {
  query: string;
  type: 'code' | 'issues' | 'repos';
  total_count: number;
  items: SearchItem[];
}

export interface NotificationItem {
  id: string;
  title: string;
  type: string;
  repo: string;
  unread: boolean;
  updated_at: string;
  url: string;
}

async function opsFetch(path: string): Promise<Response> {
  try {
    return await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
  } catch {
    throw new ExplorerApiError('Could not reach the service.', 0, 'NETWORK_ERROR');
  }
}

async function readError(response: Response): Promise<ExplorerApiError> {
  let message = 'The request failed.';
  let code = 'REQUEST_FAILED';
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    if (typeof body.message === 'string' && body.message) message = body.message;
    if (typeof body.error === 'string' && body.error) code = body.error;
  } catch {
    // Keep the generic message.
  }
  return new ExplorerApiError(message, response.status, code);
}

export const searchApi = {
  async search(query: string, type: 'code' | 'issues' | 'repos' = 'issues'): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query, type });
    const response = await opsFetch(`/api/search?${params.toString()}`);
    if (!response.ok) throw await readError(response);
    const data: unknown = await response.json();
    if (!isRecord(data) || !Array.isArray(data.items)) {
      throw new ExplorerApiError('Search returned an invalid payload.', 500, 'INVALID_RESPONSE');
    }
    return data as unknown as SearchResponse;
  },

  async notifications(): Promise<NotificationItem[]> {
    const response = await opsFetch('/api/notifications');
    if (!response.ok) throw await readError(response);
    const data: unknown = await response.json();
    if (!isRecord(data) || !Array.isArray(data.items)) {
      throw new ExplorerApiError('Notifications returned an invalid payload.', 500, 'INVALID_RESPONSE');
    }
    return data.items as NotificationItem[];
  },
};
