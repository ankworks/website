/**
 * Membership payloads for UI tests (V3-B).
 *
 * These mirror the shape the Worker returns from `GET /api/auth/membership`.
 * Tests that render write controls must serve one of them, because the UI now
 * gates writes on the server-verified membership answer.
 */

import type { MembershipResponse, MembershipState, OrgRole } from '../../shared/membership';

export function membershipBody(
  state: MembershipState,
  options: { login?: string | null; id?: number | null; role?: OrgRole; reason?: MembershipResponse['reason']; forgeAdmin?: boolean } = {}
): MembershipResponse {
  const { login = 'octocat', id = 7, role = 'member', reason = 'org-membership', forgeAdmin = false } = options;
  return {
    state,
    login: state === 'not-member' && reason === 'unauthenticated' ? null : login,
    id: state === 'not-member' && reason === 'unauthenticated' ? null : id,
    role,
    reason,
    isMember: state === 'member',
    isOrgAdmin: state === 'member' && role === 'admin',
    isForgeAdmin: state === 'member' && forgeAdmin,
    checked_at: '2026-01-01T00:00:00.000Z',
    cached: false,
  };
}

/** Verified AnkWorks member. */
export const MEMBER = (options: Parameters<typeof membershipBody>[1] = {}): MembershipResponse =>
  membershipBody('member', options);

/** Signed in, but not an AnkWorks member. */
export const NON_MEMBER = (): MembershipResponse => membershipBody('not-member', { reason: 'not-a-member' });

/** Membership could not be proven — every write control must stay disabled. */
export const UNVERIFIABLE = (): MembershipResponse =>
  membershipBody('unverifiable', { reason: 'upstream-unavailable' });

/** Not signed in. */
export const GUEST = (): MembershipResponse => membershipBody('not-member', { reason: 'unauthenticated' });
