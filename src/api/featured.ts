/**
 * Browser client for featured (pinned) repositories (V3-A / V3-E).
 *
 * Reads are public and cached. Admin mutations always send `credentials:
 * same-origin` and an explicit JSON body; the Worker re-verifies membership and
 * requires a same-origin `Origin` header, so nothing here is trusted by the
 * server.
 */

import { isFeaturedReposResponse, type FeaturedReposResponse } from '../shared/insights';
import { isValidRepoName } from '../shared/validation';
import { ExplorerApiError } from './explorer';

const API_BASE = '/api';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

async function readError(response: Response): Promise<ExplorerApiError> {
  let message = 'The request failed.';
  let code = 'REQUEST_FAILED';
  try {
    const body: unknown = await response.json();
    if (isRecord(body)) {
      if (typeof body.message === 'string' && body.message) message = body.message;
      if (typeof body.error === 'string' && body.error) code = body.error;
    }
  } catch {
    // Keep the generic message.
  }
  return new ExplorerApiError(message, response.status, code);
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    throw new ExplorerApiError('Could not reach the Forge service.', 0, 'NETWORK_ERROR');
  }
}

export const featuredApi = {
  async list(): Promise<FeaturedReposResponse> {
    const response = await request('/featured');
    if (!response.ok) throw await readError(response);
    const body: unknown = await response.json();
    if (!isFeaturedReposResponse(body)) {
      throw new ExplorerApiError('The Forge service returned an invalid response.', 500, 'INVALID_RESPONSE');
    }
    return body;
  },

  /** Pin or reposition a repository (admin only). */
  async pin(repo: string, position?: number): Promise<void> {
    const name = repo.trim();
    if (!isValidRepoName(name)) throw new ExplorerApiError('Invalid repository name.', 400, 'INVALID_REPO');
    const response = await request('/admin/featured', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: name, ...(position === undefined ? {} : { position }) }),
    });
    if (!response.ok) throw await readError(response);
  },

  /** Reorder the pins (admin only). */
  async order(repos: string[]): Promise<void> {
    const response = await request('/admin/featured/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repos }),
    });
    if (!response.ok) throw await readError(response);
  },

  /** Unpin a repository (admin only). */
  async unpin(repo: string): Promise<void> {
    const response = await request(`/admin/featured/${encodeURIComponent(repo)}`, { method: 'DELETE' });
    if (!response.ok) throw await readError(response);
  },
};
