/**
 * Authentication and authorization contract shared by the Worker and the UI.
 *
 * The GitHub access token itself is NEVER part of any of these payloads — it
 * lives only inside the encrypted, HttpOnly session cookie and inside Worker
 * memory while proxying an authorized request.
 */

/** Public profile of the signed-in user. */
export interface AuthUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
}

/** `GET /api/auth/session` — current session state (never contains tokens). */
export interface AuthSessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
  /** ISO timestamp when the encrypted session expires, or null when signed out. */
  expiresAt: string | null;
  /** False when the GitHub App OAuth credentials are not configured on the Worker. */
  authEnabled: boolean;
}

/** Highest role the signed-in user holds on the requested repository. */
export type RepoRole = 'admin' | 'maintain' | 'write' | 'triage' | 'read';

/** `GET /api/auth/permissions?owner=&repo=` — permission detection (fail closed). */
export interface AuthPermissionsResponse {
  owner: string;
  repo: string;
  canRead: boolean;
  canWrite: boolean;
  canTriage: boolean;
  canAdmin: boolean;
  role: RepoRole;
  /** Always 'user-token': permissions come from the signed-in user's own token. */
  source: 'user-token';
}
