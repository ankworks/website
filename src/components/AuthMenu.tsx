/**
 * Sign-in / account menu for the top navigation.
 *
 * - Signed out with auth enabled: a plain link to `/api/auth/login` (a full
 *   navigation to the Worker's OAuth redirect — no tokens touch JS).
 * - Signed out with auth disabled: the control is still rendered, but disabled
 *   and explained. Hiding it entirely made a missing Worker secret look like a
 *   missing feature: the user could not find sign-in and had nothing to act on.
 * - Signed in: avatar + login + Sign out.
 */

import { useAuth } from '../auth/AuthContext';

export default function AuthMenu() {
  const { status, user, authEnabled, logout, membership, isMember, membershipMessage } = useAuth();

  if (status === 'loading') {
    return (
      <span
        aria-hidden="true"
        data-testid="auth-menu-skeleton"
        className="inline-block h-8 w-20 animate-pulse rounded-md border border-border bg-elevated"
      />
    );
  }

  if (status !== 'authenticated') {
    if (!authEnabled) {
      return (
        <span
          data-testid="sign-in-unavailable"
          title="GitHub sign-in is not configured for this deployment (missing Worker secrets)."
          aria-disabled="true"
          className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-md border border-border bg-surface/60 px-2.5 text-sm font-medium text-muted"
        >
          Sign in unavailable
        </span>
      );
    }
    return (
      <a
        href="/api/auth/login"
        data-testid="sign-in-link"
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm font-medium text-text transition-colors hover:bg-elevated focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <img src="/branding/ankworks-logo.webp" alt="" width={16} height={16} className="h-4 w-4 rounded-sm object-cover" />
        Sign in with GitHub
      </a>
    );
  }

  return (
    <details className="relative" data-testid="auth-menu">
      <summary
        aria-label={`Account menu for ${user?.login ?? 'user'}`}
        className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-md border border-border bg-surface px-2 text-sm text-text hover:bg-elevated focus-visible:ring-2 focus-visible:ring-primary/60 [&::-webkit-details-marker]:hidden"
      >
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt="" width={20} height={20} className="h-5 w-5 rounded-full object-cover" />
        ) : null}
        <span className="max-w-28 truncate font-medium">{user?.login}</span>
      </summary>
      <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-48 rounded-lg border border-border bg-surface p-1.5 shadow-xl">
        <p className="px-2 py-1.5 text-xs text-muted">
          Signed in as <span className="font-medium text-text">{user?.login}</span>
        </p>
        {/* Why write controls are absent is a membership fact, not a mystery. */}
        {membership.status === 'ready' && !isMember ? (
          <p data-testid="membership-hint" className="mx-2 mb-1 rounded border border-border bg-elevated px-2 py-1.5 text-[11px] leading-4 text-muted">
            {membershipMessage}
          </p>
        ) : null}
        <button
          type="button"
          data-testid="sign-out-button"
          onClick={() => void logout()}
          className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-text hover:bg-elevated focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          Sign out
        </button>
      </div>
    </details>
  );
}
