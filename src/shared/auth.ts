/**
 * Client-safe guards and helpers for the auth contract.
 *
 * Kept dependency-free so both the browser bundle and the Worker can import it.
 */

import type { AuthPermissionsResponse, AuthSessionResponse, AuthUser, RepoRole } from '../types/auth';

export type { AuthPermissionsResponse, AuthSessionResponse, AuthUser, RepoRole };

/** Session cookie name (HttpOnly; the browser never reads it from JS). */
export const SESSION_COOKIE = 'ankworks_session';
/** Short-lived OAuth CSRF state cookie. */
export const OAUTH_STATE_COOKIE = 'ankworks_oauth_state';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function isAuthUser(value: unknown): value is AuthUser {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.login === 'string' &&
    (typeof value.name === 'string' || value.name === null) &&
    typeof value.avatarUrl === 'string' &&
    typeof value.htmlUrl === 'string'
  );
}

export function isAuthSessionResponse(value: unknown): value is AuthSessionResponse {
  if (!isRecord(value)) return false;
  const { authenticated, user, expiresAt, authEnabled } = value;
  if (typeof authenticated !== 'boolean' || typeof authEnabled !== 'boolean') return false;
  if (expiresAt !== null && typeof expiresAt !== 'string') return false;
  if (authenticated) return isAuthUser(user);
  return user === null;
}

export function isAuthPermissionsResponse(value: unknown): value is AuthPermissionsResponse {
  if (!isRecord(value)) return false;
  const { owner, repo, canRead, canWrite, canTriage, canAdmin, role, source } = value;
  return (
    typeof owner === 'string' &&
    typeof repo === 'string' &&
    typeof canRead === 'boolean' &&
    typeof canWrite === 'boolean' &&
    typeof canTriage === 'boolean' &&
    typeof canAdmin === 'boolean' &&
    (role === 'admin' || role === 'maintain' || role === 'write' || role === 'triage' || role === 'read') &&
    source === 'user-token'
  );
}
