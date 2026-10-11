/**
 * Explanation shown instead of a write control (V3-B).
 *
 * Forge is read-only for guests and for signed-in users who are not verified
 * AnkWorks members. Rather than hiding the control silently, the UI states why
 * writing is unavailable — but the notice is presentation only: the Worker
 * re-verifies everything and fails closed regardless of what is rendered here.
 */
import { useAuth } from '../../auth/AuthContext';
import { Notice } from '../explorer/ui';

export interface WriteAccessNoticeProps {
  /** Repository permission requirement, when the viewer is already a member. */
  requireWrite?: boolean;
  /** Action label used in the explanation, e.g. "comment on issues". */
  action?: string;
}

export default function WriteAccessNotice({ requireWrite = true, action = 'make changes' }: WriteAccessNoticeProps) {
  const { status, membership, membershipMessage, isMember } = useAuth();

  if (status === 'loading' || membership.status === 'loading') {
    return <Notice title="Checking your access…" />;
  }

  if (status !== 'authenticated') {
    return (
      <Notice title="Sign in required">
        Sign in with GitHub to {action}. Only verified AnkWorks organization members can write through Forge.
      </Notice>
    );
  }

  if (!isMember) {
    return (
      <Notice title={membership.membership.state === 'unverifiable' ? 'Membership could not be verified' : 'Members only'}>
        {membershipMessage}
      </Notice>
    );
  }

  if (requireWrite) {
    return (
      <Notice title="Insufficient repository permission">
        You are a verified AnkWorks member, but this action needs write access on this repository. GitHub decides that
        permission — Forge cannot widen it.
      </Notice>
    );
  }

  return null;
}
