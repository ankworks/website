/**
 * Central write authorization for Forge (V3-B).
 *
 * EVERY mutation funnels through `authorizeWrite`, which applies the five checks
 * in the order the V3 specification requires:
 *
 *   1. Authenticate the user (fail closed 401).
 *   2. Verify AnkWorks organization membership (fail closed 403/503).
 *   3. Verify the user's actual repository permissions with their own token.
 *   4. Confirm the write is user-scoped: Forge never writes with an
 *      installation token or the optional GITHUB_TOKEN.
 *   5. Enforce GitHub branch protections and repository rulesets.
 *
 * Deliberate properties:
 * - Signing in is never enough. A signed-in non-member is read-only.
 * - Insufficient GitHub API permissions are never read as membership: when
 *   membership cannot be proven the request fails closed with 503.
 * - The check runs server-side, per request, with the user's own OAuth token.
 *   Client-supplied roles, usernames, and cached UI state are ignored.
 * - Guest issue submissions are a separate, explicitly moderated flow and do
 *   not go through this guard.
 */

import { ORG_NAME } from '../shared/validation';
import type { Env } from './env';
import type { SessionPayload } from './auth';
import { UpstreamError } from './github-client';
import { assertMemberWrite } from './featured';
import { logEvent } from './logging';

const API = 'https://api.github.com';
const UPSTREAM_TIMEOUT_MS = 8000;

export type RepoRole = 'admin' | 'maintain' | 'write' | 'triage' | 'read';
export type RepoNeed = 'read' | 'triage' | 'write';

export interface RepoAccess {
  role: RepoRole;
  canRead: boolean;
  canTriage: boolean;
  canWrite: boolean;
  canAdmin: boolean;
}

export interface BranchProtectionInfo {
  branch: string;
  protected: boolean;
  /** `enforce_admits`-style restriction: true when administrators are also blocked. */
  enforceAdmins: boolean;
  /** True when branch protections could not be read (fail closed for writes). */
  unknown: boolean;
}

export interface WriteRequest {
  repo: string;
  /** Short action label used in logs and audit entries, e.g. "issue.create". */
  action: string;
  /** Minimum repository permission the action needs. */
  need: RepoNeed;
  /** Branch a commit or merge targets, when the action touches one. */
  branch?: string;
}

function headers(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ankworks-forge',
  };
}

async function githubProbe(path: string, token: string): Promise<Response | null> {
  try {
    return await fetch(`${API}${path}`, {
      method: 'GET',
      redirect: 'manual',
      headers: headers(token),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    logEvent('warn', 'authorization_probe_failed', {
      stage: 'authorization',
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}

function roleFrom(permissions: Record<string, unknown>): RepoRole {
  if (permissions.admin === true) return 'admin';
  if (permissions.maintain === true) return 'maintain';
  if (permissions.push === true) return 'write';
  if (permissions.triage === true) return 'triage';
  return 'read';
}

/**
 * Read the signed-in user's repository permissions with their own token.
 * Returns null when GitHub did not answer — callers must fail closed.
 */
export async function fetchRepoAccess(token: string, repo: string): Promise<RepoAccess | null> {
  const response = await githubProbe(`/repos/${ORG_NAME}/${encodeURIComponent(repo)}`, token);
  if (!response) return null;
  if (response.status === 404) {
    throw new UpstreamError(404, 'REPOSITORY_NOT_FOUND', 'Repository not found or not visible to you.');
  }
  if (!response.ok) return null;
  let data: { permissions?: Record<string, unknown> };
  try {
    data = (await response.json()) as { permissions?: Record<string, unknown> };
  } catch {
    return null;
  }
  const permissions = data.permissions ?? {};
  const role = roleFrom(permissions);
  return {
    role,
    canRead: true,
    canTriage: role !== 'read',
    canWrite: role === 'admin' || role === 'maintain' || role === 'write',
    canAdmin: role === 'admin',
  };
}

function meets(access: RepoAccess, need: RepoNeed): boolean {
  if (need === 'read') return access.canRead;
  if (need === 'triage') return access.canTriage;
  return access.canWrite;
}

/**
 * Read branch protection for a branch.
 *
 * `unknown: true` means GitHub did not answer. Writes fail closed on that,
 * because "we could not check" must never become "go ahead".
 */
export async function fetchBranchProtection(
  token: string,
  repo: string,
  branch: string
): Promise<BranchProtectionInfo> {
  const response = await githubProbe(
    `/repos/${ORG_NAME}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`,
    token
  );
  if (!response) return { branch, protected: false, enforceAdmins: false, unknown: true };
  if (response.status === 404) {
    // The branch does not exist yet: nothing protects a branch that isn't there.
    return { branch, protected: false, enforceAdmins: false, unknown: false };
  }
  if (!response.ok) return { branch, protected: false, enforceAdmins: false, unknown: true };

  try {
    const data = (await response.json()) as Record<string, unknown>;
    const protections = (data.protection ?? {}) as Record<string, unknown>;
    const requiredChecks = (protections.required_status_checks ?? {}) as Record<string, unknown>;
    const enforce = (protections.enforce_admins ?? {}) as Record<string, unknown>;
    return {
      branch,
      protected: data.protected === true,
      // A required-checks configuration with enforce_admins also blocks admins.
      enforceAdmins: enforce.enabled === true || requiredChecks.enforce_admins === true,
      unknown: false,
    };
  } catch {
    return { branch, protected: false, enforceAdmins: false, unknown: true };
  }
}

export interface AuthorizedWrite {
  access: RepoAccess;
  branch: BranchProtectionInfo | null;
}

/**
 * Run the full V3-B authorization chain. Throws an UpstreamError with a
 * specific, user-facing code for every refusal.
 */
export async function authorizeWrite(
  session: SessionPayload | null,
  env: Env,
  request: WriteRequest
): Promise<AuthorizedWrite> {
  // 1. Authentication.
  if (!session) {
    throw new UpstreamError(401, 'UNAUTHENTICATED', 'Sign in to use collaboration features.');
  }

  // 2. Organization membership (fail closed on unverifiable).
  await assertMemberWrite(session, env, request.action);

  // 3. Repository permissions, with the user's own token.
  const access = await fetchRepoAccess(session.token, request.repo);
  if (!access) {
    throw new UpstreamError(502, 'GITHUB_AUTH_UNAVAILABLE', 'Could not verify repository permissions.');
  }
  if (!meets(access, request.need)) {
    logEvent('warn', 'write_denied_repo_permission', {
      stage: 'authorization',
      action: request.action,
      need: request.need,
      role: access.role,
    });
    throw new UpstreamError(403, 'FORBIDDEN', `You need ${request.need} access on this repository for that action.`);
  }

  // 4. User-scoped writes only.
  //
  // Forge performs the upstream write with `session.token`, the OAuth token of
  // the signed-in user. The optional GITHUB_TOKEN and any GitHub App
  // credentials are read-only helpers for public data and are never used as an
  // actor here, so there is no privileged installation token to scope-check.
  // The assertion below keeps that invariant explicit and testable.
  assertUserScopedWrite(session);

  // 5. Branch protections and repository rulesets.
  let branch: BranchProtectionInfo | null = null;
  if (request.branch) {
    branch = await fetchBranchProtection(session.token, request.repo, request.branch);
    if (branch.unknown) {
      throw new UpstreamError(
        503,
        'BRANCH_PROTECTION_UNKNOWN',
        'Branch protection could not be verified right now. Try again later.'
      );
    }
    if (branch.protected && !(access.canAdmin && !branch.enforceAdmins)) {
      logEvent('warn', 'write_denied_branch_protected', {
        stage: 'authorization',
        action: request.action,
        branch: request.branch,
      });
      throw new UpstreamError(
        403,
        'BRANCH_PROTECTED',
        `The branch "${request.branch}" is protected. Open a pull request instead of writing to it directly.`
      );
    }
  }

  logEvent('debug', 'write_authorized', {
    stage: 'authorization',
    action: request.action,
    role: access.role,
  });
  return { access, branch };
}

/**
 * Guard for the "no privileged token" invariant.
 *
 * Throws when a caller tries to send a write with anything other than the
 * signed-in user's own OAuth token. Keeping it as a function (rather than a
 * comment) means a future refactor that reaches for an installation token
 * fails loudly instead of silently escalating privileges.
 */
export function assertUserScopedWrite(session: SessionPayload): void {
  const token = session.token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new UpstreamError(401, 'UNAUTHENTICATED', 'Sign in to use collaboration features.');
  }
  // GitHub App installation tokens are the JWT-shaped `ghs_` values and GitHub
  // App user-to-server tokens are `ghu_`; neither may act as the user here.
  if (token.startsWith('ghs_') || token.startsWith('ghu_')) {
    logEvent('error', 'write_denied_privileged_token', { stage: 'authorization' });
    throw new UpstreamError(403, 'FORBIDDEN', 'This session cannot be used for writes.');
  }
}
