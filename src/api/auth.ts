/**
 * Browser client for the auth endpoints (`/api/auth/*`).
 *
 * These calls are never cached: session state must be fresh, and responses
 * never contain credentials (the session cookie is HttpOnly).
 */

import { isAuthPermissionsResponse, isAuthSessionResponse } from '../shared/auth';
import type { AuthPermissionsResponse, AuthSessionResponse } from '../types/auth';
import { ExplorerApiError } from './explorer';

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch {
    throw new ExplorerApiError('Could not reach the authentication service.', 0, 'NETWORK_ERROR');
  }
}

async function readError(response: Response): Promise<ExplorerApiError> {
  let message = 'Authentication request failed.';
  let code = 'REQUEST_FAILED';
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    if (typeof body.message === 'string' && body.message) message = body.message;
    if (typeof body.error === 'string' && body.error) code = body.error;
  } catch {
    // Keep the generic message when the error body is not JSON.
  }
  return new ExplorerApiError(message, response.status, code);
}

export const authApi = {
  /** Current session state. Never rejects for "signed out" — that is a valid answer. */
  async session(): Promise<AuthSessionResponse> {
    const response = await authFetch('/api/auth/session');
    if (!response.ok) throw await readError(response);
    const body: unknown = await response.json();
    if (!isAuthSessionResponse(body)) {
      throw new ExplorerApiError('The authentication service returned an invalid payload.', 500, 'INVALID_RESPONSE');
    }
    return body;
  },

  /** Clear the session cookie. */
  async logout(): Promise<void> {
    const response = await authFetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) throw await readError(response);
  },

  /** Permission detection for a repository (requires a signed-in session). */
  async permissions(owner: string, repo: string): Promise<AuthPermissionsResponse> {
    const params = new URLSearchParams({ owner, repo });
    const response = await authFetch(`/api/auth/permissions?${params.toString()}`);
    if (!response.ok) throw await readError(response);
    const body: unknown = await response.json();
    if (!isAuthPermissionsResponse(body)) {
      throw new ExplorerApiError('The authentication service returned an invalid payload.', 500, 'INVALID_RESPONSE');
    }
    return body;
  },
};
