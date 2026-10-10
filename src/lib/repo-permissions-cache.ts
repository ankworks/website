/**
 * Short-lived cache for `GET /api/auth/permissions` results.
 *
 * Several write controls on one page (the file viewer's Edit action, the commit
 * editor, the issue controls) all need the same answer for the same repository.
 * Without a shared cache each of them would trigger its own round trip to
 * GitHub, and — worse — they could disagree while the answers are in flight.
 *
 * The cache is keyed by the signed-in login plus repository, so it can never
 * leak one user's permissions to another, and it is cleared whenever the
 * session is refreshed (sign-in, sign-out, or an explicit refresh).
 *
 * This module is deliberately free of React and of the auth context so both the
 * hook and the auth provider can import it without a cycle.
 */

import type { AuthPermissionsResponse } from '../types/auth';

/** Permissions are stable for the length of a session; 60s is plenty fresh. */
export const PERMISSIONS_CACHE_TTL_MS = 60_000;

interface Entry {
  at: number;
  value: AuthPermissionsResponse;
}

const cache = new Map<string, Entry>();

function keyFor(login: string, repo: string): string {
  return `${login}|${repo}`;
}

/** Read a cached, unexpired permission set. Never returns stale entries. */
export function readCachedPermissions(login: string, repo: string, now = Date.now()): AuthPermissionsResponse | null {
  const entry = cache.get(keyFor(login, repo));
  if (!entry) return null;
  if (now - entry.at >= PERMISSIONS_CACHE_TTL_MS) {
    cache.delete(keyFor(login, repo));
    return null;
  }
  return entry.value;
}

export function writeCachedPermissions(login: string, repo: string, value: AuthPermissionsResponse, now = Date.now()): void {
  cache.set(keyFor(login, repo), { at: now, value });
}

/** Drop every cached answer. Called on sign-in, sign-out, and session refresh. */
export function clearRepoPermissionsCache(): void {
  cache.clear();
}
