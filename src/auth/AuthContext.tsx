/**
 * React context for the signed-in user session and their AnkWorks membership.
 *
 * The session lives in an HttpOnly cookie; this context only mirrors the
 * non-sensitive fields returned by `GET /api/auth/session`. Membership is
 * re-read from `GET /api/auth/membership`, which is the SERVER's answer — the
 * browser never decides membership itself, and a failed lookup degrades to
 * "not a member" (fail closed) instead of breaking the app.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi } from '../api/auth';
import { insightsApi } from '../api/insights';
import { clearRepoPermissionsCache } from '../lib/repo-permissions-cache';
import type { MembershipResponse } from '../shared/membership';
import { describeMembership, GUEST_MEMBERSHIP } from '../shared/membership';
import type { AuthUser } from '../types/auth';

export interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: AuthUser | null;
  /** False when the Worker has no GitHub App credentials configured. */
  authEnabled: boolean;
  expiresAt: string | null;
}

export interface MembershipState {
  /** `ready` once the server answered; `loading` until then. */
  status: 'loading' | 'ready';
  membership: MembershipResponse;
}

export interface AuthContextValue extends AuthState {
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /** Server-verified AnkWorks membership of the signed-in user. */
  membership: MembershipState;
  /** Convenience: verified member (never true for guests). */
  isMember: boolean;
  /** Convenience: explicitly authorized Forge administrator. */
  isForgeAdmin: boolean;
  /** Human-readable explanation of the current membership state. */
  membershipMessage: string;
}

const ANONYMOUS: AuthState = { status: 'anonymous', user: null, authEnabled: true, expiresAt: null };
const GUEST_MEMBERSHIP_STATE: MembershipState = { status: 'ready', membership: GUEST_MEMBERSHIP };

const AuthContext = createContext<AuthContextValue>({
  ...ANONYMOUS,
  status: 'loading',
  refresh: async () => {},
  logout: async () => {},
  membership: GUEST_MEMBERSHIP_STATE,
  isMember: false,
  isForgeAdmin: false,
  membershipMessage: describeMembership(GUEST_MEMBERSHIP),
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...ANONYMOUS, status: 'loading' });
  const [membership, setMembership] = useState<MembershipState>(GUEST_MEMBERSHIP_STATE);

  const refresh = useCallback(async () => {
    // Permission answers belong to a session: drop them before re-reading it so
    // a sign-in or sign-out can never be served another user's cached rights.
    clearRepoPermissionsCache();
    try {
      const session = await authApi.session();
      setState({
        status: session.authenticated ? 'authenticated' : 'anonymous',
        user: session.user,
        authEnabled: session.authEnabled,
        expiresAt: session.expiresAt,
      });
      if (!session.authenticated) {
        setMembership(GUEST_MEMBERSHIP_STATE);
        return;
      }
    } catch {
      // Fail closed: an unreachable or invalid auth service means "signed out".
      setState({ ...ANONYMOUS });
      setMembership(GUEST_MEMBERSHIP_STATE);
      return;
    }

    // Signed in: ask the server to verify organization membership. A failure
    // here is reported as "unverifiable" so write controls stay disabled.
    try {
      setMembership({ status: 'loading', membership: GUEST_MEMBERSHIP });
      const verified = await insightsApi.membership();
      setMembership({ status: 'ready', membership: verified });
    } catch {
      setMembership({
        status: 'ready',
        membership: {
          ...GUEST_MEMBERSHIP,
          state: 'unverifiable',
          reason: 'upstream-unavailable',
        },
      });
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(() => {
    const current = membership.membership;
    return {
      ...state,
      refresh,
      logout,
      membership,
      isMember: current.isMember,
      isForgeAdmin: current.isForgeAdmin,
      membershipMessage: describeMembership(current),
    };
  }, [state, refresh, logout, membership]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
