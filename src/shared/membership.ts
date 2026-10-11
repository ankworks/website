/**
 * Organization membership contract shared by the Worker and the browser (V3-B).
 *
 * THE RULE: only a server-verified AnkWorks organization member may perform a
 * normal write through Forge. Guests and signed-in non-members read public
 * content and nothing else.
 *
 * The browser only ever receives the *result* of a server-side check. Client
 * flags, usernames supplied by the client, cached UI roles, and public profile
 * claims are never trusted as proof of membership.
 *
 * Keep this file free of DOM and Workers-only APIs.
 */

/** Outcome of a server-side organization membership check. */
export type MembershipState =
  /** Verified active member of the AnkWorks organization. */
  | 'member'
  /** Verified NOT to be a member (or not signed in). */
  | 'not-member'
  /** Membership could not be proven. Every write must be denied (fail closed). */
  | 'unverifiable';

export type MembershipReason =
  | 'org-membership'
  | 'public-membership'
  | 'not-a-member'
  | 'pending-membership'
  | 'unauthenticated'
  | 'upstream-unavailable'
  | 'insufficient-scope';

export type OrgRole = 'admin' | 'member' | 'unknown';

export interface MembershipStatus {
  state: MembershipState;
  /** GitHub login of the signed-in user, or null when signed out. */
  login: string | null;
  /** GitHub numeric id of the signed-in user, or null when signed out. */
  id: number | null;
  role: OrgRole;
  reason: MembershipReason;
  /** True only when state === 'member'. */
  isMember: boolean;
  /** True only when membership is verified AND the role is organization owner/admin. */
  isOrgAdmin: boolean;
  /** True when the user is an explicitly authorized Forge administrator. */
  isForgeAdmin: boolean;
  /** ISO timestamp of the check. */
  checked_at: string;
  /** True when the result came from the short-lived server cache. */
  cached: boolean;
}

/** The shape exposed to the browser. Never contains a token. */
export type MembershipResponse = MembershipStatus;

export const GUEST_MEMBERSHIP: MembershipStatus = {
  state: 'not-member',
  login: null,
  id: null,
  role: 'unknown',
  reason: 'unauthenticated',
  isMember: false,
  isOrgAdmin: false,
  isForgeAdmin: false,
  checked_at: '1970-01-01T00:00:00.000Z',
  cached: false,
};

const STATES: readonly MembershipState[] = ['member', 'not-member', 'unverifiable'];
const REASONS: readonly MembershipReason[] = [
  'org-membership',
  'public-membership',
  'not-a-member',
  'pending-membership',
  'unauthenticated',
  'upstream-unavailable',
  'insufficient-scope',
];
const ROLES: readonly OrgRole[] = ['admin', 'member', 'unknown'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function isMembershipResponse(value: unknown): value is MembershipResponse {
  if (!isRecord(value)) return false;
  const { state, login, id, role, reason, isMember, isOrgAdmin, isForgeAdmin, checked_at } = value;
  return (
    typeof state === 'string' && STATES.includes(state as MembershipState) &&
    (login === null || typeof login === 'string') &&
    (id === null || typeof id === 'number') &&
    typeof role === 'string' && ROLES.includes(role as OrgRole) &&
    typeof reason === 'string' && REASONS.includes(reason as MembershipReason) &&
    typeof isMember === 'boolean' &&
    typeof isOrgAdmin === 'boolean' &&
    typeof isForgeAdmin === 'boolean' &&
    typeof checked_at === 'string'
  );
}

/** Human-readable, non-technical explanation shown in the UI. */
export function describeMembership(status: MembershipStatus): string {
  switch (status.state) {
    case 'member':
      return 'You are a verified AnkWorks organization member.';
    case 'not-member':
      return status.reason === 'unauthenticated'
        ? 'Sign in with GitHub to use write features.'
        : 'Your GitHub account is not a verified member of the AnkWorks organization. You can read public content only.';
    default:
      return 'AnkWorks membership could not be verified right now. Write actions are disabled until verification succeeds.';
  }
}

/** HTTP status used when a write is refused for a given membership state. */
export function membershipDenialStatus(status: MembershipStatus): number {
  if (status.state === 'member') return 200;
  if (status.state === 'not-member') return status.reason === 'unauthenticated' ? 401 : 403;
  // Unverifiable: this is our failure to prove, not the user's fault → 503.
  return 503;
}

export const MEMBERSHIP_DENIAL_CODES = {
  unauthenticated: 'UNAUTHENTICATED',
  notMember: 'NOT_ORG_MEMBER',
  unverifiable: 'MEMBERSHIP_UNVERIFIABLE',
} as const;
