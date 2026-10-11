/**
 * Server-side verification of AnkWorks organization membership (V3-B).
 *
 * Security properties:
 * - Verification ALWAYS uses the signed-in user's own OAuth token. No
 *   installation token, no app token, no GITHUB_TOKEN is ever accepted as proof
 *   of a user's identity or membership.
 * - The GitHub login used in the API call comes from `GET /user` (proven with
 *   that same token), never from a request body, header, or client hint.
 * - Primary check: `GET /user/memberships/orgs/{org}` — authoritative, and the
 *   only check that can see PRIVATE membership. Requires `read:org`.
 * - Fallback check: `GET /orgs/{org}/members/{login}` — public membership only.
 * - FAIL CLOSED: when the primary check is inconclusive because the token lacks
 *   scope, a 404 from the public endpoint is NEVER read as membership. The
 *   result is `unverifiable` and every write is denied with HTTP 503.
 * - Results are cached per user id for a short window INSIDE the isolate only.
 *   Authenticated data is never written to the shared Cloudflare cache.
 */

import { ORG_NAME } from '../shared/validation';
import {
  GUEST_MEMBERSHIP,
  type MembershipReason,
  type MembershipStatus,
  type OrgRole,
} from '../shared/membership';
import type { Env } from './env';
import type { SessionPayload } from './auth';
import { logEvent } from './logging';

const API = 'https://api.github.com';
const UPSTREAM_TIMEOUT_MS = 8000;

/** Membership is re-verified at most this often per user per isolate. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Bound the in-isolate cache so a busy worker cannot grow it without limit. */
const CACHE_MAX_ENTRIES = 2_000;

interface CacheEntry {
  status: MembershipStatus;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Cleared by tests. */
export function clearMembershipCache(): void {
  cache.clear();
}

function cacheKey(userId: number): string {
  return `user:${userId}`;
}

function readCache(userId: number): MembershipStatus | null {
  const entry = cache.get(cacheKey(userId));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(cacheKey(userId));
    return null;
  }
  return { ...entry.status, cached: true };
}

function writeCache(userId: number, status: MembershipStatus): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Drop the oldest insertion; Map preserves insertion order.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(cacheKey(userId), { status, expiresAt: Date.now() + CACHE_TTL_MS });
}

function build(status: Omit<MembershipStatus, 'checked_at' | 'cached'>): MembershipStatus {
  return { ...status, checked_at: new Date().toISOString(), cached: false };
}

function denied(reason: MembershipReason, login: string | null, id: number | null): MembershipStatus {
  return build({
    state: reason === 'unauthenticated' ? 'not-member' : 'unverifiable',
    login,
    id,
    role: 'unknown',
    reason,
    isMember: false,
    isOrgAdmin: false,
    isForgeAdmin: false,
  });
}

function notMember(login: string, id: number, reason: MembershipReason = 'not-a-member'): MembershipStatus {
  return build({
    state: 'not-member',
    login,
    id,
    role: 'unknown',
    reason,
    isMember: false,
    isOrgAdmin: false,
    isForgeAdmin: false,
  });
}

interface ProbeResult {
  status: number;
  body: Record<string, unknown> | null;
  ok: boolean;
}

/** One bounded GitHub call with the USER's token. Never throws for HTTP errors. */
async function probe(path: string, token: string): Promise<ProbeResult> {
  try {
    const response = await fetch(`${API}${path}`, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ankworks-forge',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (response.status === 204) return { status: 204, body: null, ok: true };
    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = await response.json();
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = null;
    }
    // Redirects must never be followed here: a 3xx is inconclusive, not proof.
    return { status: response.status, body, ok: response.ok };
  } catch (error) {
    logEvent('warn', 'membership_probe_failed', {
      stage: 'membership',
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return { status: 0, body: null, ok: false };
  }
}

function roleOf(value: unknown): OrgRole {
  return value === 'admin' ? 'admin' : value === 'member' ? 'member' : 'unknown';
}

async function checkForgeAdmin(env: Env, login: string, id: number): Promise<boolean> {
  // 1. Explicit allowlist configured as a Worker secret.
  const configured = (env.FORGE_ADMIN_LOGINS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  if (configured.length > 0) {
    return configured.includes(login.toLowerCase());
  }
  // 2. Fallback: the D1 `forge_admins` table (optional binding).
  if (!env.DB) return false;
  try {
    const row = await env.DB.prepare('SELECT 1 AS ok FROM forge_admins WHERE github_id = ?1 OR login = ?2 LIMIT 1')
      .bind(id, login)
      .first<{ ok: number }>();
    return row?.ok === 1;
  } catch (error) {
    logEvent('warn', 'forge_admin_lookup_failed', {
      stage: 'membership',
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return false;
  }
}

/**
 * Verify the signed-in user's AnkWorks membership.
 *
 * Returns a `not-member` status for guests (never `unverifiable`): a signed-out
 * visitor is definitively not a member, and the UI must show "sign in".
 */
export async function verifyMembership(session: SessionPayload | null, env: Env): Promise<MembershipStatus> {
  if (!session) return { ...GUEST_MEMBERSHIP, checked_at: new Date().toISOString() };

  const userId = session.user.id;
  const login = session.user.login;

  // Membership is cached; the Forge-admin flag never is, so changing the admin
  // allowlist takes effect immediately for the next request.
  const cached = readCache(userId);
  if (cached) {
    return { ...cached, isForgeAdmin: await checkForgeAdmin(env, login, userId) };
  }

  // 1. Primary, authoritative check (sees private membership; needs read:org).
  const primary = await probe(`/user/memberships/orgs/${encodeURIComponent(ORG_NAME)}`, session.token);

  let resolved: MembershipStatus;
  if (primary.status === 200 && primary.body) {
    const state = primary.body.state;
    if (state === 'active') {
      const role = roleOf(primary.body.role);
      resolved = build({
        state: 'member',
        login,
        id: userId,
        role,
        reason: 'org-membership',
        isMember: true,
        isOrgAdmin: role === 'admin',
        isForgeAdmin: false,
      });
    } else if (state === 'pending') {
      resolved = notMember(login, userId, 'pending-membership');
    } else {
      resolved = notMember(login, userId);
    }
  } else if (primary.status === 404) {
    // Definitive: the authenticated user has no membership record for this org.
    resolved = notMember(login, userId);
  } else if (primary.status === 401 || primary.status === 403) {
    // The token cannot read org membership. Fall back to the PUBLIC membership
    // endpoint, but never treat its negative answer as proof of anything.
    const fallback = await probe(`/orgs/${encodeURIComponent(ORG_NAME)}/members/${encodeURIComponent(login)}`, session.token);
    if (fallback.status === 204) {
      resolved = build({
        state: 'member',
        login,
        id: userId,
        role: 'member',
        reason: 'public-membership',
        isMember: true,
        isOrgAdmin: false,
        isForgeAdmin: false,
      });
    } else if (fallback.status === 404) {
      // Ambiguous: not a member, OR a member whose membership is private and
      // invisible without read:org. Fail closed.
      resolved = denied('insufficient-scope', login, userId);
    } else {
      resolved = denied('upstream-unavailable', login, userId);
    }
  } else {
    // Timeouts, 5xx, rate limits, redirects: unverifiable → fail closed.
    resolved = denied('upstream-unavailable', login, userId);
  }

  const isForgeAdmin = resolved.isMember ? await checkForgeAdmin(env, login, userId) : false;
  const status: MembershipStatus = { ...resolved, isForgeAdmin };

  // Only cache definitive membership answers; an upstream outage must not be
  // sticky and the admin flag is always recomputed.
  if (status.state !== 'unverifiable') writeCache(userId, { ...resolved, isForgeAdmin: false });

  logEvent('debug', 'membership_checked', {
    stage: 'membership',
    membership: status.state,
    reason: status.reason,
    role: status.role,
  });
  return status;
}

/**
 * Guard for a Forge administration route.
 *
 * Requires BOTH a verified organization membership AND explicit authorization
 * (organization owner/admin role, or a configured Forge admin). Returns null
 * when access is granted, otherwise the status describing the refusal.
 */
export async function requireForgeAdmin(
  session: SessionPayload | null,
  env: Env
): Promise<{ granted: true; status: MembershipStatus } | { granted: false; status: MembershipStatus }> {
  const status = await verifyMembership(session, env);
  if (!status.isMember) return { granted: false, status };
  if (!status.isOrgAdmin && !status.isForgeAdmin) return { granted: false, status };
  return { granted: true, status };
}
